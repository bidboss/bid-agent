// /context 指令：打印当前会话的简要统计信息
//
// 输出字段：
//   - 文件路径：磁盘会话 JSON 的绝对路径
//   - 消息总数：按 user / ai / tool 分类计数
//   - 估算 tokens：复用 memory/window.ts 的 estimateTokens（字符数 / 3）
//   - 文件大小：磁盘会话文件大小（KB）

import fs from 'fs';
import type { BaseMessage } from '@langchain/core/messages';
import { estimateTokens } from '../memory/window.ts';

function messageToText(msg: BaseMessage): string {
  const c: any = (msg as any).content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((b: any) => (typeof b === 'string' ? b : b?.text ?? ''))
      .join('\n');
  }
  return '';
}

function getMessageType(msg: BaseMessage): string {
  const m = msg as any;
  return m.role ?? m.lc_kwargs?.type ?? m.type ?? 'unknown';
}

export function runContextCommand(
  history: BaseMessage[],
  sessionFilePath: string,
): void {
  const userCount = history.filter((m) => {
    const t = getMessageType(m);
    return t === 'human' || t === 'user';
  }).length;
  const aiCount = history.filter((m) => {
    const t = getMessageType(m);
    return t === 'ai' || t === 'assistant';
  }).length;
  const toolCount = history.filter((m) => getMessageType(m) === 'tool').length;

  let totalTokens = 0;
  for (const m of history) {
    totalTokens += estimateTokens(messageToText(m));
  }

  let sizeKb = '0.0';
  try {
    sizeKb = (fs.statSync(sessionFilePath).size / 1024).toFixed(1);
  } catch {
    // 文件可能不存在（新建会话尚未落库），静默降级
  }

  // eslint-disable-next-line no-console
  console.log('【当前会话】');
  // eslint-disable-next-line no-console
  console.log(`  文件路径  : ${sessionFilePath}`);
  // eslint-disable-next-line no-console
  console.log(`  消息总数  : ${history.length} (user=${userCount} ai=${aiCount} tool=${toolCount})`);
  // eslint-disable-next-line no-console
  console.log(`  估算 tokens: ~${totalTokens}`);
  // eslint-disable-next-line no-console
  console.log(`  文件大小  : ${sizeKb} KB`);
}
