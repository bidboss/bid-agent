// 拼装本轮对话发送给模型的完整消息列表
// 系统消息由 renderAgentPrompt() 异步渲染（ChatPromptTemplate + 模板变量）
// 多轮对话历史由 session.ts / app.ts 维护，本模块不接管

import { BaseMessage } from '@langchain/core/messages';
import { buildHumanMessage } from './messages.ts';
import { renderAgentPrompt } from './agents.ts';

function buildSkillMessages(): BaseMessage[] {
  // TODO: Phase 3 接入 skills 时实现
  return [];
}

/**
 * 拼装本轮消息：系统（异步渲染） + skill 占位 + history + userInput
 * - 由于 ChatPromptTemplate.formatMessages 是异步的，本函数也是 async
 * - history 由调用方传入，本函数不修改也不接管
 */
export async function buildSendMessages(
  history: BaseMessage[],
  userInput: string,
): Promise<BaseMessage[]> {
  const messages: BaseMessage[] = [];

  // 1. 系统消息（从 AGENTS.md 异步渲染）
  const { messages: agentMessages } = await renderAgentPrompt();
  messages.push(...agentMessages);

  // 2. skill 占位（Phase 3 接入）
  messages.push(...buildSkillMessages());

  // 3. 历史消息（保持 BaseMessage[] 形态不变）
  messages.push(...history);

  // 4. 当前用户输入
  messages.push(buildHumanMessage({ text: userInput }));

  return messages;
}
