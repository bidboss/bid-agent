// 工具入口文件
// 同步注册本地工具（立即可用）
// 暴露 registerAllMcpTools() 供 app.ts 异步调用（fire-and-forget）

import { registerTool } from './registry.js';
import readFileTool from './implementations/read_file.js';
import getLocationTool from './implementations/get_location.js';
import searchRestaurantTool from './implementations/search_restaurant.js';
import placeOrderTool from './implementations/place_order.js';
import memoryGetTool from './implementations/memory_get.js';
import memorySaveTool from './implementations/memory_save.js';
import skillLoadTool from './implementations/skill_load.js';
import { loadMcpServers } from './mcp/loader.js';
import { registerMcpTools } from './mcp/adapter.js';

// 各工具的 execute 签名是强类型 (args: infer<T>) => Promise<ToolResult>
// registerTool 接受 ToolExecutor = (args: Record<string, unknown>) => Promise<ToolResult>
// 需要统一 wrap 做类型兼容
function wrap<T>(tool: { execute: (args: T) => Promise<any> }) {
  return (args: Record<string, unknown>) => tool.execute(args as T);
}

const localTools = [
  { ...readFileTool, wrap: wrap(readFileTool) },
  { ...getLocationTool, wrap: wrap(getLocationTool) },
  { ...searchRestaurantTool, wrap: wrap(searchRestaurantTool) },
  { ...placeOrderTool, wrap: wrap(placeOrderTool) },
  { ...memoryGetTool, wrap: wrap(memoryGetTool) },
  { ...memorySaveTool, wrap: wrap(memorySaveTool) },
  { ...skillLoadTool, wrap: wrap(skillLoadTool) },
];

// 同步注册本地工具（立即可用）
for (const tool of localTools) {
  registerTool(tool.name, tool.description, tool.schema, tool.wrap);
}

// 异步加载 MCP 工具
export async function registerAllMcpTools(
  mcpServers: Record<string, Record<string, unknown>>,
): Promise<number> {
  const connections = await loadMcpServers(mcpServers);
  const counts = await Promise.all(connections.map(registerMcpTools));
  return counts.reduce((a, b) => a + b, 0);
}
