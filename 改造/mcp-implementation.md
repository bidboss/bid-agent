# MCP 集成实现细节（待执行版）

> 本文件是 Phase 3 落地的代码模板，等用户切到 Agent 模式后按本文档逐步落地。
> 包含三个新文件 + 两个改造文件的完整源码。

---

## 1. 新增 `src/lc/tools/mcp/types.ts`

```ts
// MCP 服务器配置类型
// 支持三种传输协议：stdio / sse / streamableHTTP
// 配置来源：.front/settings.json 的 mcpServer 字段

/** stdio 传输：本地进程 */
export interface McpStdioConfig {
  type?: 'stdio'; // 可省略，字段推断时识别
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/** SSE 传输：远程 Server-Sent Events（已 deprecated，但仍需兼容） */
export interface McpSseConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

/** streamableHTTP 传输：现代远程 MCP 协议 */
export interface McpHttpConfig {
  type: 'streamable-http';
  url: string;
  headers?: Record<string, string>;
}

/** 配置联合类型 */
export type McpServerConfig = McpStdioConfig | McpSseConfig | McpHttpConfig;

/**
 * 字段特征推断传输类型
 * stdio：有 command 字段
 * sse：type=sse
 * streamable-http：type=streamable-http 或 url 字段无 type
 */
export function inferTransportType(raw: Record<string, unknown>): 'stdio' | 'sse' | 'streamable-http' {
  const t = raw.type as string | undefined;
  if (t === 'stdio' || raw.command) return 'stdio';
  if (t === 'sse') return 'sse';
  return 'streamable-http';
}

/**
 * 归一化配置：将原始对象转成对应类型
 */
export function normalizeMcpConfig(name: string, raw: Record<string, unknown>): McpServerConfig {
  const transport = inferTransportType(raw);

  if (transport === 'stdio') {
    if (!raw.command) throw new Error(`MCP server "${name}" (stdio) 缺少 command 字段`);
    return {
      type: 'stdio',
      command: raw.command as string,
      args: (raw.args as string[]) ?? [],
      env: raw.env as Record<string, string> | undefined,
      cwd: raw.cwd as string | undefined,
    };
  }

  if (!raw.url) throw new Error(`MCP server "${name}" (${transport}) 缺少 url 字段`);

  if (transport === 'sse') {
    return {
      type: 'sse',
      url: raw.url as string,
      headers: raw.headers as Record<string, string> | undefined,
    };
  }

  return {
    type: 'streamable-http',
    url: raw.url as string,
    headers: raw.headers as Record<string, string> | undefined,
  };
}
```

---

## 2. 新增 `src/lc/tools/mcp/loader.ts`

```ts
// MCP 服务器加载器
// 把 settings.json 里的 mcpServer 配置 → 实例化 Client + Transport → 连接 → 缓存
// 不注册工具（那是 adapter.ts 的职责）

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { normalizeMcpConfig, type McpServerConfig } from './types.ts';

export interface McpConnection {
  name: string;
  client: Client;
  config: McpServerConfig;
}

/** 所有活跃连接；key = server 名 */
const connectionStore = new Map<string, McpConnection>();

/**
 * 根据配置创建 Transport
 */
function createTransport(config: McpServerConfig) {
  if (config.type === 'stdio') {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
    });
  }
  if (config.type === 'sse') {
    return new SSEClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    });
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers },
  });
}

/**
 * 加载并连接单个 MCP 服务器
 * - 任意环节失败：warn 后返回 null，不抛出
 */
export async function connectMcpServer(
  name: string,
  raw: Record<string, unknown>,
): Promise<McpConnection | null> {
  let config: McpServerConfig;
  try {
    config = normalizeMcpConfig(name, raw);
  } catch (e: any) {
    console.warn(`[MCP] 配置解析失败 "${name}": ${e.message}`);
    return null;
  }

  try {
    const client = new Client(
      { name: 'frontcode-client', version: '1.0.0' },
      { capabilities: {} },
    );
    const transport = createTransport(config);
    await client.connect(transport);

    const conn: McpConnection = { name, client, config };
    connectionStore.set(name, conn);
    console.log(`[MCP] 已连接: ${name} (${config.type})`);
    return conn;
  } catch (e: any) {
    console.warn(`[MCP] 连接失败 "${name}": ${e.message}`);
    return null;
  }
}

/**
 * 批量加载所有 MCP 服务器
 * 并发连接，任一失败不影响其他
 */
export async function loadMcpServers(
  servers: Record<string, Record<string, unknown>>,
): Promise<McpConnection[]> {
  const entries = Object.entries(servers);
  if (entries.length === 0) return [];

  const results = await Promise.all(
    entries.map(([name, raw]) => connectMcpServer(name, raw)),
  );
  return results.filter((r): r is McpConnection => r !== null);
}

/**
 * 关闭所有 MCP 连接
 */
export async function disconnectAllMcp(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [name, conn] of connectionStore.entries()) {
    promises.push(
      conn.client.close().catch((e: any) => {
        console.warn(`[MCP] 关闭失败 "${name}": ${e.message}`);
      }),
    );
  }
  await Promise.all(promises);
  connectionStore.clear();
}

/**
 * 获取已注册的连接（供 adapter 使用）
 */
export function getMcpConnections(): McpConnection[] {
  return Array.from(connectionStore.values());
}
```

---

## 3. 新增 `src/lc/tools/mcp/adapter.ts`

```ts
// MCP 工具适配器
// 把 client.listTools() 返回的工具转成 LangChain ToolDefinition + ToolExecutor
// 注册进现有的 toolStore

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { registerTool } from '../registry.ts';
import type { McpConnection } from './loader.ts';

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
```

---

## 4. 改造 `src/lc/tools/index.ts`

```ts
// 工具入口文件
// 同步注册本地工具 + 异步加载 MCP 工具

import { registerTool } from './registry.js';
import readFileTool from './implementations/read_file.js';
import getLocationTool from './implementations/get_location.js';
import searchRestaurantTool from './implementations/search_restaurant.js';
import placeOrderTool from './implementations/place_order.js';
import { loadMcpServers } from './mcp/loader.js';
import { registerMcpTools } from './mcp/adapter.js';

function wrap<T>(tool: { execute: (args: T) => Promise<any> }) {
  return (args: Record<string, unknown>) => tool.execute(args as T);
}

const localTools = [
  { ...readFileTool, wrap: wrap(readFileTool) },
  { ...getLocationTool, wrap: wrap(getLocationTool) },
  { ...searchRestaurantTool, wrap: wrap(searchRestaurantTool) },
  { ...placeOrderTool, wrap: wrap(placeOrderTool) },
];

// 第一步：同步注册本地工具（立即可用）
for (const tool of localTools) {
  registerTool(tool.name, tool.description, tool.schema, tool.wrap);
}

/**
 * 第二步：异步加载 MCP 工具（fire-and-forget）
 * 本地对话立即可用；MCP 工具在加载完成后自动出现在 listTools() 中
 */
export async function registerAllMcpTools(
  mcpServers: Record<string, Record<string, unknown>>,
): Promise<number> {
  const connections = await loadMcpServers(mcpServers);
  const counts = await Promise.all(connections.map(registerMcpTools));
  return counts.reduce((a, b) => a + b, 0);
}
```

---

## 5. 改造 `src/lc/app.ts`

```ts
// 启动入口：inquirer 循环 + 拼装消息 + 调模型（含工具循环） + 存会话 |

// 触发本地工具注册（同步）
import './tools/index.ts';
import { listTools } from './tools/registry.ts';
import { registerAllMcpTools } from './tools/index.ts';
import { disconnectAllMcp } from './tools/mcp/loader.ts';
import { chatWithTools } from './tools/engine.ts';
import { input } from '@inquirer/prompts';
import { HumanMessage } from '@langchain/core/messages';
import { getModelConfig } from './config.ts';
import { createChatModel } from './model.ts';
import {
  saveMessagesToFile,
  loadMessagesFromFile,
  getSessionFilePath,
  type SessionMeta,
} from './session.ts';
import { buildSendMessages } from './prompts.ts';
import { toolCallLog } from './log.ts';

const SESSION_ID = 'default';

async function main() {
  const config = getModelConfig();
  const userId = config.userId;
  const sessionFilePath = getSessionFilePath(userId, SESSION_ID);

  const { meta, messages: history } = loadMessagesFromFile(sessionFilePath);
  const created_at = meta?.created_at ?? new Date().toISOString();
  console.log(`已加载会话: user=${userId}, session=${SESSION_ID}, 历史 ${history.length} 条`);

  const model = createChatModel({ temperature: 0.7 });

  // fire-and-forget：MCP 加载中，本地工具立即可用
  registerAllMcpTools(config.mcpServer).then((n) => {
    if (n > 0) console.log(`MCP 共注册 ${n} 个工具（可能仍在后台加载）`);
  }).catch((e) => {
    console.warn('MCP 加载出错:', e.message);
  });

  const boundModel = model.bindTools(listTools());

  while (true) {
    const userInput = (await input({ message: '问：' })).trim();
    if (!userInput) continue;
    if (userInput === 'exit' || userInput === 'quit') break;

    const sendMessages = await buildSendMessages(history, userInput);
    const { newMessages, toolCallRecords } = await chatWithTools(boundModel, sendMessages);

    toolCallLog(toolCallRecords);

    history.push(new HumanMessage(userInput));
    for (const msg of newMessages) {
      history.push(msg);
    }

    const metaToSave: SessionMeta = {
      user_id: userId,
      session_id: SESSION_ID,
      created_at,
    };
    saveMessagesToFile(sessionFilePath, history, metaToSave);
  }

  await disconnectAllMcp();
  console.log('对话结束，会话已保存');
}

process.on('SIGINT', async () => {
  await disconnectAllMcp();
  process.exit(0);
});

try {
  await main();
} catch (e) {
  console.error('运行出错:', e);
  await disconnectAllMcp().catch(() => {});
  process.exit(1);
}
```

---

## 6. `.front/settings.json` 示例（用户后续可加）

```json
{
  "baseURL": "https://api.deepseek.com/v1",
  "apiKey": "sk-xxx",
  "model": "deepseek-flash",
  "mcpServer": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"]
    }
  }
}
```

---

## 7. 落地步骤（执行清单）

1. 创建 `src/lc/tools/mcp/types.ts`
2. 创建 `src/lc/tools/mcp/loader.ts`
3. 创建 `src/lc/tools/mcp/adapter.ts`
4. 重写 `src/lc/tools/index.ts`
5. 改造 `src/lc/app.ts`（加 MCP 加载 + SIGINT 清理）
6. `npm run typecheck` 验证
7. 测试：stdio（filesystem MCP）→ `cat package.json`
8. 测试：streamableHTTP（本地起 echo server）
9. SSE 兼容性兜底测试（可选）

---

## 风险点 & 决策

| 决策 | 选择 | 备注 |
|---|---|---|
| 工具名前缀 | `serverName.toolName` | 用户已确认 |
| 加载策略 | fire-and-forget | 用户已确认；本地工具立即可用 |
| content 处理 | 只取 text 拼接 | 用户已确认 |
| 加载失败 | warn 后继续 | 不阻断主流程 |
| 工具名冲突 | MCP 覆盖本地（理论上不会撞） | 简单实现 |
| SIGINT 清理 | 是 | 避免 stdio 子进程残留 |
| OAuth/Bearer | 仅透传 `headers` | 完整 OAuth flow 留 Phase 4 |

---

## 验收标准

1. `npm run typecheck` 0 错误
2. 三种传输至少一种连接成功（stdio filesystem 优先）
3. `listTools()` 能看到 MCP 工具（如 `filesystem.read_file`）
4. AI 触发 MCP 工具调用后，结果能正确回流到对话
5. Ctrl+C 退出后 stdio 子进程无残留（`ps -ef | grep npx` 验证）
