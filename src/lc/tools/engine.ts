// 工具调用引擎：工具循环调用的封装，对外暴露工具调用的过程中的所有消息、记录

import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { executeTool } from './registry.ts';

export const MAX_TOOL_CALLS = 5; // 循环上限

export interface ToolCallTurn {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
}

export interface ChatWithToolsResult {
  newMessages: BaseMessage[];// 本轮产生的新消息：AIMessage → n轮ToolMessage → 最终 AIMessage
  toolCallRecords: ToolCallTurn[];// 工具调用记录：调用的工具名称、参数、结果
}

/**
 * 带工具循环的模型调用
 * 只读不修改入参 messages，整个轮次产生的所有新消息返回给调用方
 * 工具循环结束条件：无 tool_calls 或达到 MAX_TOOL_CALLS 上限
 */
export async function chatWithTools(
  model: any,
  messages: BaseMessage[],
): Promise<ChatWithToolsResult> {
  const workingMessages = [...messages];// 使用副本，不修改入参
  const toolCallRecords: ToolCallTurn[] = [];

  let rounds = 0;

  while (true) {
    // 1. 模型调用
    const response: AIMessage = await model.invoke(workingMessages);
    workingMessages.push(response);

    const toolCalls = (response as any).tool_calls ?? [];
    if (toolCalls.length === 0) break;// 无工具调用，退出

    // 2. 串行执行每个工具调用，追加 ToolMessage
    for (const tc of toolCalls) {
      const toolName: string = tc.name;
      const toolArgs: Record<string, unknown> = tc.args ?? {};
      const toolCallId: string = tc.id;

      const result = await executeTool(toolName, toolArgs);
      const resultContent = result.success
        ? result.content
        : `Error: ${result.error ?? 'unknown'}`;

      const toolMsg = new ToolMessage({
        tool_call_id: toolCallId,
        content: resultContent,
      });

      workingMessages.push(toolMsg);
      toolCallRecords.push({
        toolCallId,
        toolName,
        args: toolArgs,
        result: resultContent,
        success: result.success,
      });
    }

    rounds++;
    if (rounds >= MAX_TOOL_CALLS) break; // 达到轮次上限，退出
  }

  const newMessages = workingMessages.slice(messages.length);
  return { newMessages, toolCallRecords };
}