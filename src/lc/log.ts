import chalk from 'chalk';
import { marked } from 'marked';
import * as markedTerminalMod from 'marked-terminal';
import type { ToolCallTurn } from './tools/engine.ts';
import { AIMessage } from '@langchain/core/messages';

// 配置 marked：用 marked-terminal 渲染终端彩色输出
function renderMarkdown(text: string): string {
  if (!text) return '';
  try {
    const ext = (markedTerminalMod as any).markedTerminal
      ? (markedTerminalMod as any).markedTerminal()
      : (markedTerminalMod as any).default
        ? (markedTerminalMod as any).default()
        : null;
    if (ext) marked.use(ext);
    return marked.parse(text, { async: false }) as string;
  } catch {
    return text;
  }
}

export function toolCallLog(toolCallRecords: ToolCallTurn[]) {
  if (toolCallRecords.length === 0) return;
  console.log();
  console.log(chalk.gray.bold('[工具调用记录]'));
  for (const tc of toolCallRecords) {
    const name = chalk.cyan(tc.toolName);
    const args = chalk.gray(JSON.stringify(tc.args));
    console.log(`  ${name}(${args})`);
    if (tc.success) {
      const result = tc.result.length > 200 ? tc.result.slice(0, 200) + chalk.gray('…') : tc.result;
      console.log(`    ${chalk.gray('→')} ${chalk.gray(result)}`);
    } else {
      console.log(`    ${chalk.red('→ [失败] ' + tc.result)}`);
    }
  }
  console.log();
}

/**
 * 打印本轮 AI 最终回复文本
 * 从 newMessages 末尾向前找到最后一条无 tool_calls 的 AIMessage
 * 支持 Markdown 终端彩色渲染 + 推理内容单独展示
 */
export function aiReplyLog(newMessages: any[]) {
  const final = [...newMessages].reverse().find(
    (m) => m instanceof AIMessage && (!m.tool_calls || m.tool_calls.length === 0),
  );
  if (!final) return;

  // 推理内容（DeepSeek 等思考模型会带 reasoning_content）
  const reasoning = final.additional_kwargs?.reasoning_content;
  if (typeof reasoning === 'string' && reasoning.trim()) {
    console.log();
    console.log(chalk.dim.italic(`[思考] ${reasoning.trim()}`));
  }

  const c = final.content;
  let text: string;
  if (typeof c === 'string') {
    text = c;
  } else if (Array.isArray(c)) {
    text = c
      .filter((p: any) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n');
  } else {
    text = JSON.stringify(c);
  }
  text = text.trim();
  if (!text) return;

  console.log();
  console.log(chalk.green.bold('[AI]'));
  console.log(renderMarkdown(text));
  console.log();
}
