// MCP 工具适配器
// 把 client.listTools() 返回的工具转成 LangChain ToolDefinition + ToolExecutor
// 注册进现有的 toolStore

import type { McpConnection } from './loader.ts';
import { registerTool } from '../registry.ts';

/**
 * 把 MCP 工具注册进全局 registry
 * 工具名加服务器前缀避免冲突：filesystem.read_file
 * content 处理：只取 text 类型，拼接成字符串
 */
export async function registerMcpTools(conn: McpConnection): Promise<number> {
  const { client, name: serverName } = conn;
  let mcpTools;
  try {
    const result = await client.listTools();
    mcpTools = result.tools;
  } catch (e: any) {
    console.warn(`[MCP] listTools 失败 "${serverName}": ${e.message}`);
    return 0;
  }

  let count = 0;
  for (const mcpTool of mcpTools) {
    const prefixedName = `${serverName}.${mcpTool.name}`;

    // MCP inputSchema 已经是 JSON Schema，可直接当 LangChain ToolDefinition.parameters
    const parameters = (mcpTool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>;

    const description = mcpTool.description ?? `(MCP 工具 ${mcpTool.name})`;

    const executor = async (args: Record<string, unknown>) => {
      try {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: args,
        });

        // 只取 text 类型，拼接
        const texts: string[] = [];
        for (const block of result.content as any[]) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            texts.push(block.text);
          }
        }
        const content = texts.join('\n') || '(无文本内容)';

        // MCP 错误约定：isError=true 表示工具调用失败
        if ((result as any).isError) {
          return { success: false, content, error: content };
        }
        return { success: true, content };
      } catch (e: any) {
        return { success: false, content: '', error: e.message ?? String(e) };
      }
    };

    // MCP 工具没有 zod schema，直接构造 ToolDefinition
    // 通过类型断言绕过 registerTool 的 zod 形参要求
    registerTool(
      prefixedName,
      description,
      parameters as any,
      executor as any,
    );
    count++;
  }

  if (count > 0) {
    console.log(`[MCP] ${serverName} 注册了 ${count} 个工具`);
  }
  return count;
}
