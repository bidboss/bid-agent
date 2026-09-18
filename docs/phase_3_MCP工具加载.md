# 目标

- 把 `.front/settings.json` 的 `mcpServer` 字段描述的第三方 MCP 服务器加载进来
- 把 MCP 工具列表自动注册到 [registry.ts](src/lc/tools/registry.ts) 中
- 复用现有工具循环（[engine.ts](src/lc/tools/engine.ts) 不动）
- 兼容三种主流传输协议：**stdio / SSE / streamableHTTP**

---

# settings.json 配置约定

```json
{
  "mcpServer": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"],
      "env": {}
    },
    "remoteSse": {
      "type": "sse",
      "url": "https://example.com/mcp/sse",
      "headers": { "Authorization": "Bearer xxx" }
    },
    "remoteHttp": {
      "type": "streamable-http",
      "url": "https://example.com/mcp/http",
      "headers": {}
    }
  }
}
```

> 与官方 `.mcp.json` 兼容：直接搬运过来即可，字段名一致。
> 协议判定优先级：`type` 字段 → 字段特征（无 `type` 时推断：有 `url+command` 视为 stdio）

---

# 三种传输方式的 SDK 调用

`@modelcontextprotocol/sdk@1.29.0` 已经提供：

| 协议 | SDK 类 |
|---|---|
| stdio | `client/stdio.js` → `StdioClientTransport` + `Client` |
| SSE | `client/sse.js` → `SSEClientTransport` + `Client` |
| streamableHTTP | `client/streamableHttp.js` → `StreamableHTTPClientTransport` + `Client` |

> 注意：MCP SDK 提供的是 **原始 Client**（返回 JSON Schema 工具列表），不直接产出 LangChain 工具。需要手写：
> 1. `client.listTools()` → `[{ name, description, inputSchema }]`
> 2. `client.callTool({ name, arguments })` → `{ content: [{ type: 'text', text: '...' }] }`

---

# 架构

```
.settings.json (mcpServer)
        │
        ▼
[mcp/loader.ts]       读取 + 实例化 Client（按 type 分发到 stdio/sse/streamableHttp）
        │
        ▼
[mcp/adapter.ts]      把 MCP 工具转成 LangChain ToolDefinition
                      + 把 callTool 包成 ToolExecutor
        │
        ▼
[registry.ts]         registerTool() 一行一行注册进 toolStore
        │
        ▼
[engine.ts]           工具循环不变
```

每个 MCP 服务器对应一个 Client → 多个工具。需要在内存里维护 `Map<serverName, { client, tools }>` 以便后续 `connect / disconnect`。

---

# 文件改动清单

## 新增

| 文件 | 作用 |
|---|---|
| `src/lc/mcp/loader.ts` | 解析 `mcpServer` 配置，按 type 实例化对应的 `Client + Transport`，导出 `loadMcpServers()` 和 `disconnectAllMcp()` |
| `src/lc/mcp/adapter.ts` | 把 `client.listTools()` 结果转成 `ToolDefinition[]`，把每个工具的 `callTool` 包成 `ToolExecutor` |
| `src/lc/mcp/types.ts` | `McpServerConfig` 类型 + 三种传输的判别联合 |

## 修改

| 文件 | 改动 |
|---|---|
| [src/lc/tools/index.ts](src/lc/tools/index.ts) | 加一段：先注册本地工具，再 `await loadAndRegisterMcpTools(config.mcpServer)` |
| [src/lc/app.ts](src/lc/app.ts) | 把 `getModelConfig()` 的 `mcpServer` 字段传入注册流程；`process.on('SIGINT')` 注册 graceful shutdown，调 `disconnectAllMcp()` |

## 不改

- [src/lc/tools/registry.ts](src/lc/tools/registry.ts) — `ToolDefinition` 已经 provider 无关，MCP 工具经 adapter 后自然能注册进来
- [src/lc/tools/engine.ts](src/lc/tools/engine.ts) — 工具循环无差别

---

# 执行步骤

### Step 1. 类型定义 — `src/lc/mcp/types.ts`

定义 `McpServerConfig` 三种联合 + 工厂函数 `parseMcpServers(raw)`。

### Step 2. 加载器 — `src/lc/mcp/loader.ts`

- `loadMcpServers(servers: Record<string, McpServerConfig>)`：
  - 遍历每个服务器，按 `type` 选 transport
  - 创建 `Client`，调用 `client.connect(transport)`
  - 缓存到 `clientStore: Map<string, McpConnection>`
  - 任意一个服务器连接失败 → 打印 `console.warn`，不中断（其他服务器仍可用）
- `disconnectAllMcp()`：遍历 `clientStore` 调 `client.close()`

### Step 3. 适配器 — `src/lc/mcp/adapter.ts`

- `registerMcpTools(conn: McpConnection)`：
  - `const { tools } = await conn.client.listTools()`
  - 对每个 MCP tool：
    - `name` 前缀服务器名避免冲突（如 `filesystem.read_file`），保持可读性
    - MCP 的 `inputSchema`（JSON Schema）直接当 `ToolDefinition.parameters`
    - `executor`：包一个 `(args) => { client.callTool({ name, arguments: args }) }`，把返回的 `content[]` 转成 `ToolResult.content`

### Step 4. 注册入口 — [src/lc/tools/index.ts](src/lc/tools/index.ts)

```ts
// 先本地工具，再 MCP
export async function registerAllTools(mcpServers: Record<string, unknown>) {
  // 本地注册（同步）
  for (const tool of localTools) {
    registerTool(tool.name, tool.description, tool.schema, tool.wrap);
  }
  // MCP 加载（异步）
  await loadAndRegisterMcpTools(mcpServers);
}
```

### Step 5. app.ts 接入

```ts
const config = getModelConfig();
// 改成异步启动
await registerAllTools(config.mcpServer);
// ... 其余不变

// 退出时清理
process.on('SIGINT', async () => { await disconnectAllMcp(); process.exit(0); });
```

### Step 6. 测试三种传输

准备三份测试服务器：

1. **stdio**：用官方 `@modelcontextprotocol/server-filesystem`，给它 `read_file` 工具
2. **SSE**：本地起一个 echo MCP server（可用 `mcp-proxy` 或自己写）
3. **streamableHTTP**：同上，HTTP 版

测试问题举例：
- "把项目根目录的 package.json 给我看一下" → 触发 `filesystem.read_file`
- "用 echo 服务器说 hello" → 触发 SSE 工具
- 验证：工具名带前缀、调用结果能正确回流到 AI

### Step 7. 错误处理 & 日志

- 单个服务器失败：warn 后继续
- 工具调用超时：MCP SDK 自带超时配置，给个默认值 30s
- 工具名冲突：本地 vs MCP 重名时 MCP 覆盖（带前缀后基本不会撞，但需记录）

---

# 风险与决策点

| 决策点 | 推荐方案 |
|---|---|
| 工具名前缀 | `serverName.toolName`（可读性 + 不撞名） |
| 启动阻塞 vs 后台加载 | 阻塞：MCP 工具对对话是必要的，等加载完再进入 `while(true)` |
| MCP SDK 升级 | 锁 minor，升级走独立 PR（与项目惯例一致） |
| OAuth / Bearer Auth | 仅在 `headers` 透传 `Authorization`；Phase 1 不做完整 OAuth flow |

---

# 验收标准

1. 三种传输各能连上一台 MCP server（至少一种测试通过即视为 Phase 通过）
2. MCP 工具能出现在 `listTools()` 中，模型能看到并触发
3. 工具调用结果能正确回流到 `AIMessage`，对话能继续
4. 进程退出时 MCP client 全部 `close()`，无残留子进程
5. `npm run typecheck` 0 错误

