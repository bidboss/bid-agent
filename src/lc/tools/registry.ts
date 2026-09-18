// 工具注册中心
// 提供工具的 注册、获取、列表、执行功能
//
// listTools() 返回 LangChain 标准 ToolDefinition（@langchain/core）,实现工具和模型解耦

import type { ToolDefinition } from '@langchain/core/language_models/base';
import type { ToolExecutor, ToolResult, ToolParameterSchema } from './type.ts';
import { z } from 'zod';

const toolStore = new Map<string, { def: ToolDefinition; executor: ToolExecutor }>();

export function registerTool(
  name: string,
  description: string,
  schema: z.ZodTypeAny,
  executor: ToolExecutor
): void {
  const parameters = z.toJSONSchema(schema) as ToolParameterSchema;

  const def = {
    type: 'function' as const,
    function: { name, description, parameters },
  } satisfies ToolDefinition;

  toolStore.set(name, { def, executor });
}

export function getTool(name: string) {
  return toolStore.get(name);
}

export function listTools(): ToolDefinition[] {
  return Array.from(toolStore.values()).map((t) => t.def);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const tool = toolStore.get(name);
  if (!tool) return { success: false, content: '', error: `Unknown tool: ${name}` };
  try {
    return await tool.executor(args);
  } catch (e: any) {
    return { success: false, content: '', error: e.message };
  }
}
