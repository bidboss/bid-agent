// 拼装本轮对话发送给模型的完整消息列表
// 系统消息由 renderAgentPrompt() 异步渲染（ChatPromptTemplate + 模板变量）
// 多轮对话历史由 session.ts / app.ts 维护，本模块不接管
//
// 记忆注入（在 agents.ts 之后、history 之前）：
// - 长期 .md 记忆（项目级 + 用户级）拼成一条 SystemMessage
// - 每轮自动做一次向量召回，按 userInput 检索 top-K，命中 0 时跳过
//
// 用户消息支持两种形式：
// - string：旧路径，文本含 @[#] 标签，内部 parse 后拼到单一 content
// - ComposedInput：新结构，text + attachments 拆开，附件作为独立 content block

import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import { buildHumanMessage, type ContentItem } from './messages.ts';
import { renderAgentPrompt } from './agents.ts';
import { loadAllMemory } from './memory/store.ts';
import { searchMemory } from './memory/vector.ts';
import { searchKb, renderKbRagTemplate } from './rag/index.ts';
import { getSkillSummaryText } from './skills.ts';
import {
  attachFilesToMessage,
  attachImagesToMessage,
  buildFileContentBlocks,
} from './files/index.ts';
import {
  parseFileTagsFromInput,
  matchRulesForFiles,
  scanRules,
  type RuleDoc,
} from './rules.ts';
import type { ComposedInput } from './input.ts';

// 把 skill 摘要（tier=1 默认注入）拼成一条 system 块；无 skill 时跳过
function buildSkillMessages(): BaseMessage[] {
  const text = getSkillSummaryText(1);
  if (!text) return [];
  return [new SystemMessage(text)];
}

// 根据 userInput 中 @[file] 标签匹配规则，命中后注入本轮 user 消息前的 system 块
// ComposedInput：复用 buffer（含标签）做匹配；string：直接匹配。
function buildRulesMessages(userInput: ComposedInput | string): BaseMessage[] {
  const buffer = typeof userInput === 'string' ? userInput : userInput.buffer;
  const files = parseFileTagsFromInput(buffer);
  if (files.length === 0) return [];

  // 复用一次扫描，避免每次匹配都重新读盘
  const rules: RuleDoc[] = scanRules();
  const matched = matchRulesForFiles(files, rules);
  if (!matched) return [];

  return [new SystemMessage(`## 匹配的规则（基于 @[file] 标签自动注入）\n\n${matched}`)];
}

// 把长期 .md 拼成 system 块
function buildLongTermMemoryMessages(): BaseMessage[] {
  const { project, user } = loadAllMemory();
  if (!project && !user) return [];
  const sections: string[] = [];
  if (user) sections.push(`### 用户级长期记忆\n${user.trim()}`);
  if (project) sections.push(`### 项目级长期记忆\n${project.trim()}`);

  console.log('长期记忆:', sections);
  
  return [new SystemMessage(`## 长期记忆\n\n${sections.join('\n\n')}`)];
}

// 按 query 检索向量记忆，命中为空时跳过注入
// query 优先用 ComposedInput.text（已剥离标签），保证检索语义干净。
async function buildMemoryRecallMessage(query: ComposedInput | string): Promise<BaseMessage | null> {
  const q = typeof query === 'string' ? query : query.text;
  if (!q) return null;
  try {
    const hits = await searchMemory(q, 4, 'all');
    if (hits.length === 0) return null;
    const body = hits
      .map((h, i) => `[#${i + 1}] (scope=${h.scope}, score=${h.score.toFixed(4)})\n${h.text}`)
      .join('\n\n---\n\n');
    return new SystemMessage(`## 相关历史记忆（自动检索）\n\n${body}`);
  } catch (e: any) {
    // 检索失败静默降级，不阻塞主流程
    return null;
  }
}

// 按 query 检索知识库 RAG，命中为空时跳过注入
async function buildKbRecallMessage(query: ComposedInput | string): Promise<BaseMessage | null> {
  const q = typeof query === 'string' ? query : query.text;
  if (!q) return null;
  try {
    const hits = await searchKb(q, 4);
    if (hits.length === 0) return null;
    const body = renderKbRagTemplate(hits);
    return new SystemMessage(body);
  } catch (e: any) {
    // 检索失败静默降级，不阻塞主流程
    return null;
  }
}

// 把 ComposedInput 的附件展开为多个独立 content block
// - @ 文件：每个文件一个 text block（buildFileContentBlocks）
// - # 图片：每个图片一个 image_url block
// 顺序与 attachments 数组一致（也即用户选择顺序）。
function buildAttachmentBlocks(attachments: { type: '@' | '#'; path: string }[]): ContentItem[] {
  const filePaths = attachments.filter((a) => a.type === '@').map((a) => a.path);
  const imagePaths = attachments.filter((a) => a.type === '#').map((a) => a.path);

  const blocks: ContentItem[] = [];
  blocks.push(...buildFileContentBlocks(filePaths));

  if (imagePaths.length > 0) {
    // 复用 attachImagesToMessage：传入伪 buffer 让它 parse # 标签
    const { images } = attachImagesToMessage(`#[${imagePaths.join('] #[')}]`);
    for (const imgUrl of images) {
      blocks.push({ type: 'image_url', image_url: { url: imgUrl } });
    }
  }

  return blocks;
}

// 拼装本轮消息：系统（异步渲染） + 长期记忆 + skill 占位 + history + userInput
// userInput 支持 string 或 ComposedInput；后者把附件作为独立 content block。
export async function buildSendMessages(
  history: BaseMessage[],
  userInput: ComposedInput | string,
): Promise<BaseMessage[]> {
  const messages: BaseMessage[] = [];

  const { messages: agentMessages } = await renderAgentPrompt();
  messages.push(...agentMessages);

  messages.push(...buildLongTermMemoryMessages());
  messages.push(...buildSkillMessages());

  const recallMsg = await buildMemoryRecallMessage(userInput);
  if (recallMsg) messages.push(recallMsg);

  const kbRecallMsg = await buildKbRecallMessage(userInput);
  if (kbRecallMsg) messages.push(kbRecallMsg);

  messages.push(...buildRulesMessages(userInput));

  messages.push(...history);

  if (typeof userInput === 'string') {
    // 旧路径：单字符串，附件以追加 text 的方式合并
    const expanded = attachImagesToMessage(userInput);
    const enrichedText = attachFilesToMessage(expanded.text);
    messages.push(buildHumanMessage({ text: enrichedText, images: expanded.images }));
  } else {
    // 新路径：ComposedInput → 多个独立 content block
    const { text, attachments } = userInput;
    const contentItems: ContentItem[] = [];
    if (text) contentItems.push({ type: 'text', text });
    contentItems.push(...buildAttachmentBlocks(attachments));
    messages.push(buildHumanMessage({ content: contentItems }));
  }

  return messages;
}
