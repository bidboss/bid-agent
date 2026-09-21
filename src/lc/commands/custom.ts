// LC 引擎自定义指令模块
//
// 扫描 ~/.front/commands/ 与 <cwd>/.front/commands/ 下的 <group>/<name>.md 文件，
// 把每份 Markdown 注册为形如 /<group>:<name> 的指令。触发时按 frontmatter.passthrough
// 决定行为：true 时把正文 + {{args}} 占位符替换结果追加到本轮 userInput 后注入模型，
// false 时仅打印到终端（不进入对话循环）。
//
// 隔离红线（AGENTS.md §3.6）：本模块仅依赖 node:fs/path 与 src/lc/utils/pathUtils.ts，
// 不导入 src/commands/index.js 或 src/utils/ 任何 legacy 模块。

import fs from 'fs';
import path from 'path';
import { getUserHomeDir, getCurrentWorkingDir } from '../utils/pathUtils.ts';

// 单条自定义指令的元信息（不含正文，供列表/查表使用）
export interface CustomCommandMeta {
  name: string;
  description: string;
  passthrough: boolean;
  filePath: string;
}

// 缓存条目（含正文与 mtime，用于失效检测）
interface CacheEntry {
  meta: CustomCommandMeta;
  /** 去除 frontmatter 后的正文 */
  content: string;
  /** 文件 mtime ms，用于判断是否需要重新读盘 */
  mtime: number;
  /** 冗余字段，便于失效判断（与 meta.filePath 同步） */
  filePath: string;
}

// 模块级缓存。设计原则：mtime 驱动而非 TTL 驱动，保证文件修改后立即生效。
const cache = new Map<string, CacheEntry>();

/**
 * 从一段 Markdown 文本中解析 frontmatter 与正文。
 * 仅支持 4 个字段：name / description / passthrough / args_placeholder。
 * 解析失败时返回 null，调用方需降级为"首行 # 标题作为 description"。
 */
interface ParsedFrontmatter {
  meta: { name?: string; description?: string; passthrough?: boolean };
  body: string;
}

function parseFrontmatter(raw: string): ParsedFrontmatter | null {
  // 必须以 --- 起始（允许前导空白）
  const startMatch = raw.match(/^\s*---\r?\n/);
  if (!startMatch) return null;

  const startIdx = startMatch[0].length;
  const rest = raw.slice(startIdx);
  const endMatch = rest.match(/\r?\n---\r?\n?/);
  if (!endMatch) return null;

  const yamlBlock = rest.slice(0, endMatch.index);
  const body = rest.slice(endMatch.index! + endMatch[0].length).replace(/^\s+/, '');

  const meta: ParsedFrontmatter['meta'] = {};
  for (const line of yamlBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    let val: string | boolean = m[2].trim();
    // 去掉首尾引号
    val = val.replace(/^["']|["']$/g, '');
    if (key === 'passthrough') {
      meta.passthrough = val === 'true' || val === '1';
    } else if (key === 'name' || key === 'description') {
      meta[key] = String(val);
    }
    // 其他字段静默忽略（未来可扩展 args_placeholder 等）
  }
  return { meta, body };
}

/**
 * 从 Markdown 正文提取首行 # 标题作为 description 兜底。
 */
function extractTitleFromBody(body: string): string {
  const firstLine = body.trim().split(/\r?\n/)[0] ?? '';
  if (firstLine.startsWith('#')) {
    return firstLine.replace(/^#+\s*/, '').trim();
  }
  return '';
}

/**
 * 扫描指定基础目录下的 commands 子目录，返回该目录贡献的指令集合。
 * - baseDir/.front/commands/<group>/<name>.md
 * - group 名非法（含冒号/空字符）则跳过
 * - 单个文件读失败 warn 但不中断整体扫描
 */
function loadCustomCommandsFromDir(baseDir: string): Map<string, CacheEntry> {
  const result = new Map<string, CacheEntry>();
  const commandsDir = path.join(baseDir, '.front', 'commands');
  if (!fs.existsSync(commandsDir)) return result;

  let subdirs: fs.Dirent[];
  try {
    subdirs = fs
      .readdirSync(commandsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn(`[custom-commands] 扫描目录失败: ${commandsDir} (${e.message ?? e})`);
    return result;
  }

  for (const sub of subdirs) {
    const group = sub.name;
    // 校验 group 名：必须非空、不含冒号/空白
    if (!group || /[:\s]/.test(group)) continue;

    const subPath = path.join(commandsDir, group);
    let files: fs.Dirent[];
    try {
      files = fs
        .readdirSync(subPath, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith('.md'))
        .map((f) => f);
    } catch {
      continue;
    }

    for (const file of files) {
      const fileName = file.name;
      const cmdName = path.basename(fileName, '.md');
      if (!cmdName) continue;

      const fullName = `/${group}:${cmdName}`;
      const filePath = path.join(subPath, fileName);

      let raw: string;
      try {
        raw = fs.readFileSync(filePath, 'utf-8');
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn(`[custom-commands] 读取失败: ${filePath} (${e.message ?? e})`);
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }

      const parsed = parseFrontmatter(raw);
      let description: string;
      let passthrough = false;
      let body: string;

      if (parsed) {
        description = parsed.meta.description ?? extractTitleFromBody(parsed.body) ?? fullName;
        passthrough = parsed.meta.passthrough === true;
        body = parsed.body;
      } else {
        // 退化：非法 frontmatter 或无 frontmatter
        description = extractTitleFromBody(raw) || fullName;
        // 含未闭合 --- 时静默警告一次
        if (/^\s*---\r?\n/.test(raw) && !/---\s*$/.test(raw)) {
          // eslint-disable-next-line no-console
          console.warn(`[custom-commands] frontmatter 格式错误，已降级处理: ${filePath}`);
        }
        body = raw.replace(/^\s+/, '');
      }

      result.set(fullName, {
        meta: { name: fullName, description, passthrough, filePath },
        content: body,
        mtime: stat.mtimeMs,
        filePath,
      });
    }
  }

  return result;
}

/**
 * 加载并合并所有自定义指令（用户级 + 项目级，项目级覆盖用户级）。
 * 使用 mtime 失效：每个条目独立判断是否需要重读。
 */
export function loadAllCustomCommands(): Map<string, CacheEntry> {
  const merged = new Map<string, CacheEntry>();

  // 1) 用户级
  const userEntries = loadCustomCommandsFromDir(getUserHomeDir());
  for (const [name, entry] of userEntries.entries()) {
    const cached = cache.get(name);
    if (cached && cached.filePath === entry.meta.filePath && cached.mtime === entry.mtime) {
      merged.set(name, cached);
    } else {
      merged.set(name, entry);
      cache.set(name, entry);
    }
  }

  // 2) 项目级（覆盖用户级同名条目）
  const projectEntries = loadCustomCommandsFromDir(getCurrentWorkingDir());
  for (const [name, entry] of projectEntries.entries()) {
    const cached = cache.get(name);
    if (cached && cached.filePath === entry.meta.filePath && cached.mtime === entry.mtime) {
      merged.set(name, cached);
    } else {
      merged.set(name, entry);
      cache.set(name, entry);
    }
  }

  // 清理已不存在的指令缓存（避免无限增长）
  for (const key of Array.from(cache.keys())) {
    if (!merged.has(key)) cache.delete(key);
  }

  return merged;
}

/**
 * 给 /help 与候选列表使用的轻量摘要。
 */
export function listCustomCommands(): CustomCommandMeta[] {
  const all = loadAllCustomCommands();
  return Array.from(all.values()).map((e) => e.meta);
}

/**
 * 把正文中的 {{args}} 占位符替换为 argsText。
 * argsText 为空时静默替换为空串，避免残留字面量。
 */
function applyArgsPlaceholder(content: string, argsText: string): string {
  if (!content.includes('{{args}}')) return content;
  return content.split('{{args}}').join(argsText);
}

/**
 * 执行指定的自定义指令。
 * @returns null 表示未找到该指令；否则返回分派结果
 */
export type CustomCommandResult =
  | { kind: 'passthrough'; content: string }
  | { kind: 'print'; content: string };

export function runCustomCommand(
  cmdName: string,
  argsText: string,
): CustomCommandResult | null {
  const all = loadAllCustomCommands();
  const entry = all.get(cmdName);
  if (!entry) return null;

  const replaced = applyArgsPlaceholder(entry.content, argsText);
  if (entry.meta.passthrough) {
    return { kind: 'passthrough', content: replaced };
  }
  return { kind: 'print', content: replaced };
}

/**
 * 测试用：清空模块级缓存，强制下一次 loadAllCustomCommands 重新读盘。
 */
export function clearCustomCommandCache(): void {
  cache.clear();
}
