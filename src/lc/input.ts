// 终端输入层：所有 stdin 交互统一由 @inquirer/prompts 管理
//
// 设计要点（简化版 - "回车后才检测触发符"）：
// 1. 主输入直接用 @inquirer/prompts.input，自带 readline 渲染与字符回显
// 2. 回车拿到 buffer 后做以下分发：
//    - trim 后为空 → 空消息，跳过本轮
//    - 以 "/" 开头且无空格 → 视为指令（内置或自定义），由调用方执行
//    - 行末是 "@" 或 "#" → 弹对应候选，选中后拼成 @[path] / #[path] 作为附件消息
//    - 其它 → 普通消息（含 attachments 提取）
// 3. ESC / Ctrl+C：inquirer 抛 CancelPromptError / ExitPromptError，识别后返回 'exit'
//
// 与旧版"敲 @ 即弹"的差异：
// - 失去实时弹候选功能，改为回车后检测
// - 任何以 "/" 开头无空格的输入都会先尝试走指令路径（未识别则由 app.ts 兜底）

import {
  CancelPromptError,
  ExitPromptError,
} from '@inquirer/core';
import { input, search, select } from '@inquirer/prompts';
import {
  scanProjectFiles,
  scanDesignImages,
} from './files/index.ts';
import { listCustomCommands } from './commands/custom.ts';

/** inquirer 的取消 sentinel：用于 try/catch 后统一判断用户主动取消 */
export const PROMPT_CANCELED: unique symbol = Symbol('PROMPT_CANCELED');

function isCanceled(e: unknown): boolean {
  return e instanceof CancelPromptError || e instanceof ExitPromptError;
}

let allFiles: string[] = [];
let allImages: string[] = [];

/**
 * 初始化文件与设计图缓存，应在 main 入口调用一次。
 * 候选下拉（@ #）的数据源。
 */
export function initFileCache(): void {
  allFiles = scanProjectFiles();
  allImages = scanDesignImages();
}

// ============== 类型定义 ==============

export type Trigger = '/' | '@' | '#';

export type Attachment = {
  type: '@' | '#';
  path: string;
};

/**
 * 一次用户输入的完整结构（按回车发送时的产物）：
 * - text：剥离 @[#] 标签后的纯文本（用于 rules 匹配、RAG query、显示）
 * - buffer：含 @[#] 标签的原始字符串（用于回显与持久化）
 * - attachments：选中的附件列表（顺序与用户选择一致）
 */
export interface ComposedInput {
  text: string;
  buffer: string;
  attachments: Attachment[];
}

/**
 * composedDriver 的返回值：
 * - command：用户敲入 / 并选中指令，调用方立即执行
 * - message：用户按回车发送 buffer，拼出 ComposedInput 走对话流程
 * - empty：用户空 buffer 回车，调用方跳过本轮
 * - exit：用户 ESC / Ctrl+C，调用方退出主循环
 */
export type DriverResult =
  | { action: 'command'; command: string }
  | { action: 'message'; input: ComposedInput }
  | { action: 'empty' }
  | { action: 'exit' };

// ============== searchCandidate：弹候选 ==============

/**
 * 根据触发符弹出候选下拉（inquirer.search）。
 *
 * @param trigger '@' | '#'
 * @param prefix 主输入框已敲好的前缀（仅日志/展示用，不参与过滤）
 * @returns 用户选中的字符串；用户取消时返回 null
 */
export async function searchCandidate(
  trigger: '/' | '@' | '#',
  _prefix = '',
): Promise<string | null> {
  // '/' 用 select 弹离散指令列表（搜索式弹窗对短指令不友好）
  if (trigger === '/') {
    const cmds = listBuiltinCommands();
    try {
      return await select({
        message: '选择指令',
        choices: cmds.map((c) => ({ name: c, value: c })),
      });
    } catch (e) {
      if (isCanceled(e)) return null;
      throw e;
    }
  }

  const message =
    trigger === '@' ? '选择文件' : '选择设计图';

  const buildSource = <T extends string>(all: T[]) => async (term: string | undefined) => {
    const q = (term ?? '').toLowerCase();
    return all
      .filter((x) => x.toLowerCase().includes(q))
      .map((x) => ({ name: x, value: x }));
  };

  try {
    if (trigger === '@') {
      return await search({ message, source: buildSource(allFiles) });
    }
    // '#'
    return await search({ message, source: buildSource(allImages) });
  } catch (e) {
    if (isCanceled(e)) return null;
    throw e;
  }
}

/**
 * 列出所有内置 + 自定义 / 指令名，供 / 触发时统一使用。
 */
export function listBuiltinCommands(): string[] {
  const builtin = [
    '/help',
    '/clear',
    '/context',
    '/exit',
    '/quit',
    '/memory',
    '/vector',
  ];
  const custom = listCustomCommands().map((c) => c.name);
  return [...builtin, ...custom];
}

// ============== extractAttachments：从 buffer 解析 attachments ==============

/**
 * 从 buffer（含 @[#] 标签）中拆出 text 和 attachments。
 * text 用于 rules 匹配与 RAG query（避免标签干扰）；
 * attachments 按出现顺序收集（与用户选择顺序一致）。
 *
 * 正则策略：
 * - 标签以 @( 或 #( 起头，避免误匹配 a@b.com
 * - 标签前可以紧跟 `]`（前一标签结束）或 空白/行首
 *   通过"标签开始位置不能在 [A-Za-z0-9_] 之后"约束避免邮箱等误匹配
 */
export function extractAttachments(buffer: string): { text: string; attachments: Attachment[] } {
  const attachments: Attachment[] = [];
  // 逐字符扫描，遇到 @[ 或 #[ 且前一个字符不是字母数字下划线时算一个标签
  let i = 0;
  while (i < buffer.length) {
    const c = buffer[i];
    if ((c === '@' || c === '#') && buffer[i + 1] === '[') {
      const prev = i > 0 ? buffer[i - 1] : '';
      // 前一个字符：行首/空白/']'/'['/其它非字母数字字符 → 算合法标签
      const isLetter = /[A-Za-z0-9_]/.test(prev);
      if (!isLetter) {
        const end = buffer.indexOf(']', i + 2);
        if (end !== -1) {
          const path = buffer.slice(i + 2, end);
          attachments.push({ type: c === '@' ? '@' : '#', path });
          i = end + 1;
          continue;
        }
      }
    }
    i += 1;
  }
  // 从 buffer 中移除标签（按 attachments 顺序匹配，避免重复扫描）
  let text = buffer;
  for (const att of attachments) {
    const tag = `${att.type}[${att.path}]`;
    text = text.replace(tag, '');
  }
  // 合并连续空白为单空格并 trim
  text = text.replace(/\s+/g, ' ').trim();
  return { text, attachments };
}

// ============== composedDriver：主入口 ==============

/**
 * 主入口：while 循环驱动输入框 + 触发符统一处理。
 * - 行末是 @ / # / → 弹对应候选：
 *   - @ # 选中：拼成 @[path] / #[path] 进 buffer，回到输入框继续编辑（用户后续按回车才发送）
 *   - / 选中：直接 command 路径（不进 buffer，立即执行）
 *   - 取消候选：保留 prefix 继续编辑
 * - 行末不是触发符 → 普通消息（带 attachments 提取）
 * - 空 buffer → empty
 * - ESC / Ctrl+C → exit
 */
export async function composedDriver(message: string): Promise<DriverResult> {
  let buffer = '';
  while (true) {
    let line: string;
    try {
      line = await input({ message, default: buffer || undefined, prefill: 'editable' });
    } catch (e) {
      if (isCanceled(e)) return { action: 'exit' };
      throw e;
    }

    // 不 trim 头尾空白：保留用户输入意图，行末空白也会被 trimEnd 去掉
    const trimmed = line.trimEnd();
    if (!trimmed) return { action: 'empty' };

    const lastChar = trimmed[trimmed.length - 1];

    // 三个触发符统一处理：行末是触发符 → 弹候选
    if (lastChar === '@' || lastChar === '#' || lastChar === '/') {
      const trigger = lastChar as Trigger;
      const prefix = trimmed.slice(0, -1);
      const selected = await searchCandidate(trigger, prefix);
      if (selected === null) {
        // 取消候选：保留 prefix 回到输入框继续编辑
        buffer = prefix;
        continue;
      }
      if (trigger === '/') {
        // / 选中：直接执行（不进 buffer）
        return { action: 'command', command: selected };
      }
      // @ # 选中：拼接标签到 buffer，回到输入框继续编辑
      const tag = `${trigger}[${selected}] `;
      buffer = `${prefix}${tag}`;
      continue;
    }

    // 普通消息路径（含 attachments 提取）
    const { text, attachments } = extractAttachments(trimmed);
    return { action: 'message', input: { text, buffer: trimmed, attachments } };
  }
}
