// 短期记忆窗口
// 按 token 数截断过长的 messages 数组，并把被截掉的旧消息用 LLM summarize 成一段摘要插到顶部
//
// 设计要点：
// 1. 工具调用回合（assistant.tool_calls + 紧跟的若干 tool 消息 + 可选最终 AI 回复）必须成组处理：
//    要么整组都保留（keep），要么整组都丢弃（dropped），绝不允许半截留存
//    —— 这避免了模型收到"孤立 ToolMessage"导致 400 BadRequest
// 2. system 消息永远保留
// 3. 第一条 user 消息（即会话的最初提问）也保留，避免丢失上下文
// 4. 不引入 tiktoken 依赖，使用本地估算（length / 3），精度足够做软上限
//
// 算法：
//   ① 把 tail 切成"回合（round）"列表，每个回合是原子单位
//   ② 按回合倒序累加 token，整组进 keep 或整组进 dropped
//   ③ dropped 喂给 summarizer，组装 system + 摘要 + 首条 user + keep

import type { BaseMessage } from '@langchain/core/messages';
import type { TrimOptions } from './type.ts';

// 估算 token 数
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}

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

function tokensOf(msg: BaseMessage): number {
  return estimateTokens(messageToText(msg));
}

function getRole(msg: BaseMessage): string {
  const m = msg as any;
  // 优先用规范 role 字段；其次用 LangChain 内部 lc_kwargs.type；
  // 最后退到 type（兼容 coerceMessageLikeToMessage 还原后的 type 字段）
  return m.role ?? m.lc_kwargs?.type ?? m.type ?? 'unknown';
}

function isToolResultPair(msg: BaseMessage): boolean {
  const t = (msg as any).type ?? (msg.constructor?.name ?? '');
  return t === 'tool';
}

function hasToolCalls(msg: BaseMessage): boolean {
  return Array.isArray((msg as any).tool_calls) && (msg as any).tool_calls.length > 0;
}

// 回合类型：原子化的最小单位，trim 时要么整组保留要么整组丢弃
interface Round {
  messages: BaseMessage[];
  tokens: number;
  kind: 'tool' | 'plain';
}

/**
 * 把 tail 切成回合。规则：
 *   - 遇到 AI(tool_calls) → 启动 tool 回合，吸收后续紧跟的所有 ToolMessage，
 *     再吸收紧跟的"纯文本 AI(无 tool_calls)"作为最终回复（可选）
 *   - 其它情况（HumanMessage / AI 无 tool_calls / 孤儿 ToolMessage）→ plain 回合
 *
 * 防御性处理：
 *   - 如果 tool 回合里没吸收到任何 ToolMessage，标记 kind='tool' 但实际只有 AI(tc)——trim 时整组丢或整组留
 *   - 尾部的孤儿 ToolMessage（不在任何 AI(tc) 之后）独立成 plain 回合——理论上不该出现
 */
function splitIntoRounds(tail: BaseMessage[]): Round[] {
  const rounds: Round[] = [];
  let i = 0;
  while (i < tail.length) {
    const m = tail[i];

    if (hasToolCalls(m)) {
      // 工具回合：[AI(tc), ToolMessage × N, 可选 AI(无 tc) 作为最终回复]
      const group: BaseMessage[] = [m];
      let j = i + 1;
      while (j < tail.length && isToolResultPair(tail[j])) {
        group.push(tail[j]);
        j++;
      }
      // 吸收紧跟的"无 tool_calls 的 AI"作为回合的最终回复（如果有）
      if (j < tail.length && getRole(tail[j]) === 'ai' && !hasToolCalls(tail[j])) {
        group.push(tail[j]);
        j++;
      }
      const tokens = group.reduce((acc, x) => acc + tokensOf(x), 0);
      rounds.push({ messages: group, tokens, kind: 'tool' });
      i = j;
      continue;
    }

    // 普通回合：单条 Human / AI / 孤儿 Tool
    rounds.push({ messages: [m], tokens: tokensOf(m), kind: 'plain' });
    i++;
  }
  return rounds;
}

/**
 * 截断 messages 数组
 * @param messages 完整消息列表
 * @param options  maxTokens + summarizer
 * @returns trimmed: 截断后的消息（可能含摘要 system message）；summary: 新生成的摘要（无截断时为 null）
 */
export async function trimMessages(
  messages: BaseMessage[],
  options: TrimOptions,
): Promise<{ trimmed: BaseMessage[]; summary: string | null }> {
  const { maxTokens, summarizer } = options;

  // 1. 计算总 token
  let total = 0;
  for (const m of messages) total += tokensOf(m);
  console.log('total,当前token:', total);
  console.log('maxTokens,最大token:', maxTokens);
  if (total <= maxTokens) return { trimmed: messages, summary: null };

  // 2. 永远保留 system 与首条 user
  const systemMsgs = messages.filter((m) => getRole(m) === 'system');
  const firstUserIdx = messages.findIndex((m) => getRole(m) === 'user');

  // 3. 计算 budget：扣除 system + 首条 user
  let budget = maxTokens;
  for (const s of systemMsgs) budget -= tokensOf(s);
  if (firstUserIdx >= 0) budget -= tokensOf(messages[firstUserIdx]);
  if (budget < 0) budget = 0;

  // 4. 把 firstUserIdx 之后的剩余消息切成回合
  const tail = firstUserIdx >= 0 ? messages.slice(firstUserIdx + 1) : messages.slice();
  const rounds = splitIntoRounds(tail);

  // 5. 倒序按回合累加 token：整组进 keep 或整组进 dropped
  const keepRounds: Round[] = [];
  const droppedRounds: Round[] = [];
  let acc = budget;
  for (let k = rounds.length - 1; k >= 0; k--) {
    const r = rounds[k];
    if (r.tokens <= acc) {
      keepRounds.unshift(r);
      acc -= r.tokens;
    } else {
      // 预算不够装整组 → 整组丢；剩余回合（更早的）同理
      droppedRounds.unshift(r);
    }
  }

  // 6. 把 dropped 摊平喂给 summarizer（按时间顺序）
  const dropped: BaseMessage[] = [];
  for (const r of droppedRounds) dropped.push(...r.messages);

  // 7. summarize
  let summary: string | null = null;
  if (dropped.length > 0) {
    const record = dropped.map((m) => ({
      role: getRole(m),
      content: messageToText(m),
    }));
    try {
      summary = await summarizer(record);
    } catch (e: any) {
      console.warn(`[memory] summarize 失败: ${e.message ?? e}`);
      summary = null;
    }
  }

  // 8. 组装 trimmed：system + 摘要 + 首条 user + keep（回合内顺序与 tail 一致）
  const trimmed: BaseMessage[] = [];
  trimmed.push(...systemMsgs);
  if (summary) {
    const { SystemMessage } = await import('@langchain/core/messages');
    trimmed.push(new SystemMessage(`[会话早期摘要]\n${summary}`));
  }
  if (firstUserIdx >= 0) trimmed.push(messages[firstUserIdx]);
  for (const r of keepRounds) trimmed.push(...r.messages);

  return { trimmed, summary };
}
