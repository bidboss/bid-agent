// 工具入口文件
// 所有工具在此统一注册，app.ts 只需 import 本文件即可
// 新增工具：在这里加一行 import，然后 push 到数组即可

import { registerTool } from './registry.js';
import readFileTool from './implementations/read_file.js';
import getLocationTool from './implementations/get_location.js';
import searchRestaurantTool from './implementations/search_restaurant.js';
import placeOrderTool from './implementations/place_order.js';

// 各工具的 execute 签名是强类型 (args: infer<T>) => Promise<ToolResult>
// registerTool 接受 ToolExecutor = (args: Record<string, unknown>) => Promise<ToolResult>
// 需要统一 wrap 做类型兼容
function wrap<T>(tool: { execute: (args: T) => Promise<any> }) {
  return (args: Record<string, unknown>) => tool.execute(args as T);
}

const tools = [
  { ...readFileTool, wrap: wrap(readFileTool) },
  { ...getLocationTool, wrap: wrap(getLocationTool) },
  { ...searchRestaurantTool, wrap: wrap(searchRestaurantTool) },
  { ...placeOrderTool, wrap: wrap(placeOrderTool) },
];

for (const tool of tools) {
  registerTool(tool.name, tool.description, tool.schema, tool.wrap);
}
