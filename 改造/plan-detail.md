# FrontCode → LangChain 改造方案

> 本文档基于 `改造/plan.md` 的 7 个步骤，对每一步给出**可执行的具体方案**：目标、文件改动、关键代码骨架、验收方式。
> 原则：**局部替换 + 功能迭代**，每阶段都跑得通、都可比对 legacy 行为，绝不一次性重写。

---

## 0. 项目现状（基线盘点）

| 项 | 现状 |
|---|---|
| 项目名 | `frontcode`（CLI，Node.js + ESM） |
| legacy 入口 | `src/app.js` + `src/request/index.js`（手写 OpenAI SDK + 工具调用循环） |
| 工具层 | `src/tools/local/*`（一工具一文件）+ `src/tools/mcp/*`（MCP 拉取） |
| 上下文层 | `src/utils/contextRead.js`（systemDoc / 记忆 / Skills / Rules） |
| RAG | `src/utils/ragHandle.js` + `@lancedb/lancedb` |
| 配置 | `.front/settings.json`（项目级覆盖 `~/.front/settings.json`） |
| 已装 LC 依赖 | `@langchain/core@1.2.11` / `@langchain/openai@1.5.13` / `@langchain/textsplitters@1.0.1` |
| 已开坑 | `src/lc/config.js`（LC 配置归一化）、`src/lc/model.js`（ChatOpenAI 工厂） |
| 已开坑 | `scripts/smoke-lc.mjs`（自检脚本：`npm run smoke`） |

> **关键发现**：LC 引擎已经在 `src/lc/` 下起了骨架，思路正确。本方案往下把 `src/lc/` 补成一个**完整的 LC 引擎**，再让 `src/app.js` 可切换到 LC 引擎。

---

## 1. 总体架构（目标态）

```
                ┌──────────────────────────────────────────────┐
                │   src/app.js  (入口，编排循环)              │
                │   - 读输入、派发指令、拼装上下文             │
                │   - 选择使用 legacy 还是 lc 引擎            │
                └──────────────────────────────────────────────┘
                          │                │
                          ▼                ▼
        ┌──────────────────────────┐  ┌──────────────────────────┐
        │ src/request/ (legacy)     │  │ src/lc/ (新引擎，LC 优先) │
        │   getAIResponse()         │  │   engine.js              │
        │   OpenAI 原生 SDK         │  │   - 模型工厂 (model.js)  │
        │   手写工具循环             │  │   - 消息适配 (messages)  │
        │   保留作兜底 / 对照        │  │   - 工具执行 (tools)     │
        └──────────────────────────┘  │   - 记忆 (memory)        │
                                      │   - 会话 (session)       │
                                      │   - RAG                  │
                                      └──────────────────────────┘
                                                  │
                                                  ▼
                                      .front/settings.json
                                      .front/memory/*.md
                                      .front/skills/*/SKILL.md
                                      .front/rules/*.md
                                      .front/doc/   (RAG 源)
                                      .front/lancedb-data/
```

**切换方式**：`src/app.js` 顶部一行常量 `const ENGINE = 'lc' | 'legacy'`，逐步把 legacy 的能力切到 lc；任一阶段挂掉就回退 legacy。

---

## 2. 目录与命名约定（src/lc/）

```
src/lc/
├── config.js        ✅ 已存在（LC 配置归一化）
├── model.js         ✅ 已存在（ChatOpenAI 工厂 + getMessageText）
├── messages.js      🆕 Phase 1（system/user/tool 消息构造、文本/图片块）
├── tools.js         🆕 Phase 3（本地工具 + MCP 工具 → LC Tool[]）
├── session.js       🆕 Phase 2（会话 JSON 读写、按 userId+sessionId 分文件）
├── memory.js        🆕 Phase 4（短期：消息窗口；长期：.front/memory/*.md 注入）
├── rag.js           🆕 Phase 5（Embeddings + LanceDB 检索，替换 legacy 的 ragHandle）
├── prompts.js       🆕 Phase 1/6（拼装 system / RAG / Skills / Rules 模板）
└── engine.js        🆕 Phase 1（对外暴露 runTurn()，是 lc 引擎的总入口）
```

每个模块**只暴露 1–3 个函数**，保持单一职责，便于回滚。

---

## 3. 各 Phase 详细方案

### ✅ Phase 0：基线（已完成）
- 装好 `@langchain/core`、`@langchain/openai`、`@langchain/textsplitters`
- `src/lc/config.js` + `src/lc/model.js` + `scripts/smoke-lc.mjs`
- 验收：`npm run smoke` 能打通 `config → ChatOpenAI → 流式/非流式输出`

---

### Phase 1：替换基本对话链路（含工具消息）  *(优先级 P0)*

**目标**：用 LC 的 `ChatOpenAI + HumanMessage / AIMessage / ToolMessage` 替代 legacy 手写循环，跑通「发一条 → 收到回复 → 有 tool_calls → 执行 → 再发 → 出文本」的闭环。

**新增/改动文件**：
- 🆕 `src/lc/messages.js`
- 🆕 `src/lc/prompts.js`
- 🆕 `src/lc/engine.js`
- 🔧 `src/app.js`（最小化改动，新增一条 `runLcTurn()` 路径）

**关键骨架**：

```js
// src/lc/messages.js —— 负责把 legacy 的字符串消息/多模态消息 转成 LC 的 BaseMessage
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';

// buildSystemMessage(text)        -> SystemMessage
// buildHumanMessage(text, images=[])  -> HumanMessage（带 image_url 多模态）
// buildToolResult(toolCallId, content) -> ToolMessage
```

```js
// src/lc/engine.js —— LC 引擎的总入口，对外只暴露 runTurn()
// 入参：{ messages: BaseMessage[], tools: DynamicStructuredTool[], context: BaseMessage[] }
// 出参：{ messages: BaseMessage[] }（已 push 进 tool 回合的最新列表）
//
// 关键点：用 LC 的 bindTools + 一次 invoke + 手写 tool 循环（仍自己执行工具，
//         这是为了兼容 legacy 的本地工具调用是异步 console 交互的现状；
//         等 Phase 3 再切到 LC 的 AgentExecutor）
```

```js
// src/app.js —— 加一个开关：
const USE_LC_ENGINE = process.env.FRONT_USE_LC !== '0'; // 默认开
// 然后把 getAIResponse() 的调用改成：
if (USE_LC_ENGINE) {
  await runLcTurn({ /* 同上下文参数 */ });
} else {
  await getAIResponse({ /* legacy */ });
}
```

**验收方式**：
1. 跑 `front` 命令，输入 `你好`，LC 引擎也能回（与 legacy 对照无差异）
2. 输入 `读取 package.json 的内容`（走 `read_file` 工具），能正确处理 tool_calls
3. 关掉 `FRONT_USE_LC=0`，回 legacy 一切照旧
4. 自检：`scripts/smoke-lc.mjs` 已覆盖基础链路

**回滚**：删除 `src/app.js` 里的 if 分支即可。

---

### Phase 2：会话管理（JSON 文件持久化）  *(P0)*

**目标**：每次对话消息都持久化到 `.front/sessions/<userId>/<sessionId>.json`，下次启动按 session 续上。

**新增文件**：
- 🆕 `src/lc/session.js`

**关键设计**：
- **路径规则**：`.front/sessions/<userId>/<sessionId>.json`
  - `userId` 取自 `lc/config.js` 的 `resolveUserId()`
  - `sessionId` 默认 `default`，可用 CLI 参数 `--session <id>` 或 `/session xxx` 切换
- **文件结构**（兼容人类阅读 + 后续接 SQLite）：
  ```json
  {
    "version": 1,
    "sessionId": "default",
    "userId": "lxh",
    "createdAt": "2026-09-18T00:00:00Z",
    "updatedAt": "2026-09-18T00:10:00Z",
    "messages": [
      { "role": "system", "content": "..." },
      { "role": "user", "content": "..." },
      { "role": "assistant", "content": "...", "tool_calls": [...] },
      { "role": "tool", "tool_call_id": "...", "content": "..." }
    ]
  }
  ```
- **写入策略**：每轮结束 `fs.writeFileSync` 全量覆盖（消息量小，简单可控；量大再换增量）
- **读取策略**：启动时如果文件存在就把 `messages` 喂给 LC 引擎

**API 形状**：
```js
// src/lc/session.js
loadSession({ userId, sessionId })   -> { messages: BaseMessage[], meta: {...} } | null
saveSession({ userId, sessionId, messages, meta }) -> void
listSessions({ userId })              -> [{ sessionId, updatedAt, msgCount }]
newSessionId()                        -> string  // 用 crypto.randomUUID()
```

**内建指令**（借 `src/commands/` 的机制）：
- `/session` → 列出当前 userId 下所有会话
- `/session <id>` → 切换到指定会话
- `/session new [name]` → 新建会话
- `/clear` → 清空当前会话的 messages（保留文件 meta）

**验收**：
1. 输入 → 退出 → 重新启动，消息还在
2. 切到新会话 → 历史不串
3. JSON 文件可直接打开阅读，且重启不会因格式错误炸

---

### Phase 3：工具管理（LC 的 `Tool` / `DynamicStructuredTool`）  *(P1)*

**目标**：把 `src/tools/local/*` 的 `{ define, handle }` 改成 LC 的 `DynamicStructuredTool`，再统一加 MCP 工具。

**新增/改动文件**：
- 🆕 `src/lc/tools.js`
- 🔧 `src/tools/local/index.js`：增加 `toLcTool(localTool)` 适配器（不改单个工具源码）
- 🔧 `src/lc/engine.js`：`bindTools(tools)` 给模型

**关键骨架**：
```js
// src/lc/tools.js
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';          // LC 内置 zod
import getLocalTool from '../tools/local/index.js';
import { loadMcpTools } from './mcp.js'; // 复用 legacy 的 MCP 连接

export async function loadLcTools() {
  const { localTools } = getLocalTool();             // 旧格式
  const lcLocal = localTools.map(toLcTool);          // 适配成 LC Tool
  const lcMcp   = await loadMcpTools();              // MCP 拉到的也是旧格式，同样过 toLcTool
  return [...lcLocal, ...lcMcp];
}

function toLcTool(oldTool) {
  return new DynamicStructuredTool({
    name: oldTool.name,
    description: oldTool.description,
    schema: oldTool.inputSchema,   // 旧工具已经是 zod / JSON Schema，二选一
    func: async (args) => {
      const r = await oldTool.callTool({ name: oldTool.name, arguments: args });
      return r.content?.[0]?.text ?? '';
    },
  });
}
```

**关键点**：
- `zod` 已经在 `@langchain/core` 的依赖树里，直接 import 即可
- MCP 工具的 `inputSchema` 是 JSON Schema，要用 LC 的 `StructuredTool.from` 或者把 JSON Schema 转 zod（用 `@langchain/core/utils` 里的 `toJsonSchema`/互转）
- 本期**不切 AgentExecutor**，仍手写 tool 循环（因为 legacy 工具里有交互式 `confirm`/`select`，AgentExecutor 的同步调用模型容易打断终端状态）

**验收**：
1. `read_file`、`write_file`、`bash`、`grep`、`glob` 五个本地工具在 LC 引擎下行为一致
2. `skill`、`memory_get`、`memory_save` 也跑通
3. 配置了 MCP server，工具能正常注册和执行

---

### Phase 4：记忆管理  *(P1)*

**目标**：短期记忆（消息窗口）+ 长期记忆（`.front/memory/*.md` 注入）。

**新增文件**：
- 🆕 `src/lc/memory.js`

**两块记忆**：
| 块 | 存储 | 注入位置 |
|---|---|---|
| **短期**（会话内） | LC 引擎 messages 数组 | 直接进 `messages` |
| **项目级长期** | `.front/memory/memory.md`（项目） | system message 末尾追加 |
| **用户级长期** | `~/.front/memory/memory.md`（用户） | system message 末尾追加（在项目级之前） |

**API 形状**：
```js
// src/lc/memory.js
loadLongTermMemory() -> { project: string, user: string }   // 都读不到就返回空串
appendLongTermMemory({ scope: 'project'|'user', text }) -> void
// 配合模型自己写：/memory 指令触发（已经在 legacy 里有）
```

**短期记忆窗口**：
- 默认保留最近 N 轮（比如 20 轮）
- 超出后用 LC 的 `trimMessages`（来自 `@langchain/core/messages`）做窗口截断
- 工具调用回合永远保留完整（不能截到一半）

**验收**：
1. `/memory` 指令触发后，记忆文件被正确更新（覆盖式 → 改成增量追加）
2. 启动时记忆能正确注入到 system
3. 跑过 30 轮后，旧消息被窗口化，新消息仍能引用旧上下文（通过 RAG 检索补齐，详见 Phase 5）

---

### Phase 5：知识库 RAG 链路  *(P2)*

**目标**：复用 `@lancedb/lancedb` + `@langchain/textsplitters`，但用 LC 的 `Embeddings` + `VectorStore` 接口。

**新增/改动文件**：
- 🆕 `src/lc/rag.js`
- 🔧 legacy `src/utils/ragHandle.js`：标为 deprecated，新路径走 `src/lc/rag.js`

**关键骨架**：
```js
// src/lc/rag.js
import { LanceDB } from '@langchain/community/vectorstores/lancedb';   // 看装没装
// 如果没装 community 包：直接用原生 @lancedb/lancedb + 自写 wrapper（与 legacy 保持一致）
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getModelConfig } from './config.js';

const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 80 });

export async function indexDirectory(dir = '.front/doc') { /* 读取 → 切分 → embedding → 写 LanceDB */ }
export async function search(query, k = 4) { /* embedding → LanceDB 检索 → 返回 Document[] */ }
```

**注入策略**（与 legacy 对齐）：
- 命中后用 `src/docs/ragTemplate.md` 包一层，塞到本轮 user 消息后面
- 把 `Document.pageContent` 用 `\n---\n` 串起来

**关键点**：
- embedding 必须**单独配置**（当前主网关 DeepSeek 没有 `/v1/embeddings`），沿用 Phase 0 留下的 `getModelConfig().embedding` 兜底为 `null`
- 若 embedding 为空，RAG 模块要返回 `[]`，并在控制台打印黄色告警，不影响主链路

**验收**：
1. `/vector` 把 `.front/doc/` 下的文件向量化入库
2. 提问时检索能命中，且片段正确注入到 prompt
3. embedding 未配置时 RAG 静默降级，不阻塞主链路

---

### Phase 6：Skill / Rules 管理  *(P2)*

**目标**：保留 legacy 的 `.front/skills/*/SKILL.md` + `.front/rules/*.md` 扫描逻辑，输出方式切到 LC 的 `SystemMessage` / `HumanMessage` 块。

**新增/改动文件**：
- 🔧 `src/lc/prompts.js`：拼装 system + user context + skill headers + rule matches
- 🆕 `src/lc/skills.js`：扫 `.front/skills/*/SKILL.md`，启动注入**摘要**，按需用 `skill` 工具加载全文（沿用 legacy 行为）
- 🆕 `src/lc/rules.js`：扫 `.front/rules/*.md`，根据 `parseFileTags` 选中的文件做 glob 匹配（沿用 legacy 的 `matchRulesForFiles`）

**关键点**：
- 这一阶段几乎不动 legacy 逻辑，只把**拼装结果**从「拼接成大字符串再 push 到 messages」改成「构造多个 LC Message 块」
- Skill 的 `tool`（`load_skill`）最终会被 `src/lc/tools.js` 接管（Phase 3 顺带处理）

**验收**：
1. 启动时 skills 摘要出现在 system 末尾
2. `@[src/foo.ts]` 后匹配的 rules 出现在本轮 user 消息
3. 模型调用 `load_skill(name)` 时能加载到全文

---

### Phase 7：其他增强（后续）
- 多模型路由 / 流式输出 + 打字机效果
- LangSmith / LangChain Hub 接入（debug 可观测）
- 用 `langgraph` 重写 `engine.js` 的循环（当交互复杂到需要状态机时）
- `AgentExecutor` 替换手写循环（待交互式工具 `confirm/select` 的状态机明确后再切）

---

## 4. 切流策略（重点）

为了让整个改造**始终可运行**，采用"开关 + 比对"两件武器：

1. **入口开关**：`process.env.FRONT_USE_LC` 控制走 legacy / lc；默认 lc
2. **行为对照**：每个 Phase 完成时，跑 legacy 与 lc 两遍同一批 prompt，对比：
   - 文本回复是否一致（允许 tool_calls 顺序差异）
   - 工具调用次数 / 最终文本字数
   - 会话文件大小（Phase 2 后）
3. **回滚预案**：任一 Phase 异常，`FRONT_USE_LC=0` 即可秒切回 legacy

---

## 5. 阶段验收 Checklist

| Phase | 跑通命令 | 必过的检查 |
|---|---|---|
| 1 | `front` → 输入 "你好" | 文本/工具两路打通 |
| 2 | 启停 2 次 | 历史会话能续上 |
| 3 | `读 package.json` / `写一个新文件` / `跑 npm test` | 5+ 本地工具全跑通 |
| 4 | `/memory` + 多轮对话 | 记忆文件正确写入 |
| 5 | `/vector` 后提问文档相关问题 | 检索片段注入 prompt |
| 6 | `@[src/app.js]` + skills | rules 命中、skill 全文加载 |

---

## 6. 风险与备选

| 风险 | 应对 |
|---|---|
| `@langchain/community` 没装 | RAG 模块直接用原生 `@lancedb/lancedb`，不依赖 community |
| DeepSeek 网关没有 `/v1/embeddings` | embedding 强制单独配置，未配置时 RAG 降级返回空 |
| MCP 工具的 JSON Schema 与 zod 互转 | 用 `@langchain/core/utils` 的 `jsonSchemaToZod` / `zodToJsonSchema` |
| AgentExecutor 与交互式 `confirm/select` 工具冲突 | 暂不切 AgentExecutor，仍手写循环 |
| LangChain 大版本升级 break | 依赖固定在 `package.json` 当前 minor，升级单独走 PR |

---

## 7. 一句话里程碑

> **Phase 1 跑通 LC 引擎基本对话（无持久化无 RAG）→ Phase 2 让会话可续 → Phase 3 让工具可调 → Phase 4/5/6 让上下文丰满。**
> 每个 Phase 都是一次可发布的「小版本」，legacy 全程兜底，直到 lc 引擎在所有功能上对齐后再下架 legacy。