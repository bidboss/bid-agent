import { BaseMessage } from '@langchain/core/messages';
import { buildHumanMessage, buildSystemMessage } from './messages.js';

const PLACEHOLDER_SYSTEM_PROMPT = `你是一个友好的 AI 助手。`;


function buildSkillMessages(): BaseMessage[] {
  // TODO: Phase 3 接入 skills 时实现
  return [];
}

export function buildSendMessages(
  history: BaseMessage[],
  userInput: string,
): BaseMessage[] {
  const messages: BaseMessage[] = [];
  messages.push(buildSystemMessage(PLACEHOLDER_SYSTEM_PROMPT));
  messages.push(...buildSkillMessages());
  messages.push(...history);
  messages.push(buildHumanMessage({ text: userInput }));
  return messages;
}