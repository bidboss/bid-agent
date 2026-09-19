// 拼装本轮对话发送给模型的完整消息列表
// 系统消息由 renderAgentPrompt() 异步渲染（ChatPromptTemplate + 模板变量）
// 多轮对话历史由 session.ts / app.ts 维护，本模块不接管
//
// 记忆注入（在 agents.ts 之后、history 之前）：
// - 长期 .md 记忆（项目级 + 用户级）拼成一条 SystemMessage
// - 每轮自动做一次向量召回，按 userInput 检索 top-K，命中 0 时跳过

import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import { buildHumanMessage } from './messages.ts';
import { renderAgentPrompt } from './agents.ts';
import { loadAllMemory } from './memory/store.ts';
import { searchMemory } from './memory/vector.ts';

function buildSkillMessages(): BaseMessage[] {
  // TODO: Phase 6 接入 skills 时实现
  return [];
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
async function buildMemoryRecallMessage(query: string): Promise<BaseMessage | null> {
  try {
    const hits = await searchMemory(query, 4, 'all');
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

// 拼装本轮消息：系统（异步渲染） + 长期记忆 + skill 占位 + history + userInput
export async function buildSendMessages(
  history: BaseMessage[],
  userInput: string,
): Promise<BaseMessage[]> {
  const messages: BaseMessage[] = [];

  const { messages: agentMessages } = await renderAgentPrompt();
  messages.push(...agentMessages);

  messages.push(...buildLongTermMemoryMessages());
  messages.push(...buildSkillMessages());

  const recallMsg = await buildMemoryRecallMessage(userInput);
  if (recallMsg) messages.push(recallMsg);

  messages.push(...history);
  messages.push(buildHumanMessage({ text: userInput }));

  return messages;
}
