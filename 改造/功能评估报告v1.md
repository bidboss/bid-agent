# FrontCode 迁移对比评估报告

> 评估时间：2026-09-21
> 评估范围：`src/lc/` 新 LC 引擎 vs `src/request/` + `src/tools/` + `src/utils/` 等 Legacy 引擎
> 评估基准：`改造/plan-detail.md` 中规划的 7 个 Phase（Phase 0–7）
> 报告形态：执行摘要 + 关键指标

---

## 一、TL;DR（一句话结论）

**迁移进度约 80%**。原计划 8 个 Phase（0–7）中，Phase 0–4 与 Phase 6 已基本落地，Phase 5（RAG）已完成核心检索能力但尚未走通 `/vector → 提问 → 命中 → 注入` 的完整链路，Phase 7（增强）尚处于规划态。**遗留关键缺口：Legacy 引擎未被禁用、`FRONT_USE_LC` 开关未接入、Legacy 工具未做适配器桥接**——这三条不补完，LC 引擎虽功能齐全但无法作为默认引擎对外服务。

---

## 二、关键指标总览

### 2.1 代码体量对比

| 维度 | Legacy 引擎 | LC 新引擎 | 变化 |
|------|------------|----------|------|
| 文件数（含子目录） | ~60 个 .js | 37 个 .ts | -38% |
| 估算代码行数 | ~2992 行 | ~3145 行 | +5%（更密集） |
| 语言 | JavaScript（ESM） | TypeScript（strict） | 引入静态类型 |
| 入口文件 | `src/app.js` | `src/lc/app.ts` | 已独立 |
| 测试脚本 | 无 | 4 个 smoke（lc / skill / memory / rag） | 全新增 |

### 2.2 Phase 完成度（按 `改造/plan-detail.md` 对齐）

| Phase | 主题 | 计划优先级 | 完成度 | 关键证据 |
|-------|------|----------|--------|----------|
| **0** | 基线（依赖/骨架/smoke） | — | **100%** | `package.json` 含 LC 三件套；`smoke-lc.mjs` 已就绪 |
| **1** | 基本对话链路 | P0 | **100%** | `src/lc/messages.ts`、`prompts.ts`、`model.ts`；`smoke-lc.mjs` 可打通 |
| **2** | 会话管理 | P0 | **100%** | `src/lc/session.ts`（LangChain 原生 `toDict()` / `coerceMessageLikeToMessage`）；`.front/sessions/lxh/default.json` 已存在 34KB 多轮历史 |
| **3** | 工具管理 | P1 | **100%** | `tools/engine.ts`、`tools/registry.ts`、`tools/index.ts`、`tools/mcp/{loader,adapter,types}.ts`；7 个本地工具实现 + MCP stdio/SSE/streamableHTTP 三协议 |
| **4** | 记忆管理 | P1 | **100%** | `memory/{store,vector,window,prompt,type}.ts`；含 token 窗口 + LLM summarize 压缩；`fix: 重构短期记忆上下文裁剪，修复循环摘要死循环` 已修复 |
| **5** | RAG 链路 | P2 | **75%** | `rag/{kb,search,template,type}.ts` 已具备索引与检索；`/vector` 指令已实现；但 `kb/` 目录与 `lancedb-data/` 在 `.front/` 下**尚未实际创建**（用户配置中 `embedding` 字段未配置，RAG 会静默降级） |
| **6** | Skill / Rules | P2 | **100%** | `skills.ts`（203 行，frontmatter 解析 + 摘要注入）、`rules.ts`（134 行，glob 匹配 + 命中注入）；`.front/skills/{read-code,architecture-diagram}/` 已存在；`skill_load` 工具已接通 |
| **7** | 增强（流式/LangGraph/AgentExecutor） | P2 | **0%** | 未规划/未实现 |

**综合完成度**：(100% × 4 + 75% × 1 + 0% × 1) / 6 ≈ **79%**

> Phase 0–4、6 共 6 个核心 Phase 完全达成；Phase 5 缺实测数据；Phase 7 暂未启动。

### 2.3 功能模块迁移矩阵

| 功能模块 | Legacy 落点 | LC 落点 | 迁移状态 | 备注 |
|----------|------------|--------|---------|------|
| CLI 入口 | `src/app.js` | `src/lc/app.ts` | ✅ 已替换 | LC 入口含 `/memory`、`/vector` 指令 |
| OpenAI 对话 | `src/request/index.js` | `src/lc/model.ts` + `messages.ts` | ✅ 已替换 | 统一用 `ChatOpenAI` |
| 工具调用循环 | `src/request/index.js` 手写 | `src/lc/tools/engine.ts` 手写（MAX=5） | ✅ 已替换 | 仍未切 AgentExecutor（符合规划） |
| 工具注册 | `src/tools/local/LocalClient.js` | `src/lc/tools/registry.ts` | ✅ 已替换 | 注册中心统一 |
| 本地工具 | `src/tools/local/*.js`（12 个） | `src/lc/tools/implementations/*.ts`（7 个） | ⚠️ **数量减少** | LC 版缺 `bash`、`write_file`、`grep`、`glob`、`confirm`、`select`、`debugger_page`、`diff_pic` |
| MCP 工具 | `src/tools/mcp/index.js` | `src/lc/tools/mcp/{loader,adapter,types}.ts` | ✅ 已替换 | 协议支持对齐（stdio/SSE/streamableHTTP） |
| 会话持久化 | `src/utils/fsHandle.js` → `~/.front/history/<project>/<ts>.json` | `src/lc/session.ts` → `.front/sessions/<user>/<session>.json` | ✅ 已替换 | 路径与格式不同；旧数据不可读 |
| 系统提示词 | `src/utils/contextRead.js` → `src/docs/systemDoc.md` | `src/lc/agents.ts` → `.front/AGENTS.md`（YAML frontmatter） | ⚠️ 数据源切换 | 新格式含 `userId`/`name`/`version`/`tools` 字段 |
| 长期记忆 | `src/utils/memoryUtils.js` → `.front/memory/memory.md` + `~/.front/memory/user-memory.md` | `src/lc/memory/{store,index}.ts` + 向量库 | ✅ 已升级 | 新增向量检索；保留 .md 注入 |
| 短期记忆窗口 | 无 | `src/lc/memory/window.ts`（token 预算 400 + LLM summarize） | 🆕 新增 | Legacy 无此能力，是新能力 |
| 知识库 RAG | `src/utils/ragHandle.js`（LanceDB） | `src/lc/rag/{kb,search,template}.ts`（LanceDB + textsplitters） | ✅ 已替换 | 检索 + 模板渲染就绪 |
| Skill 扫描 | `src/utils/contextRead.js#getSkillHeaders` | `src/lc/skills.ts` | ✅ 已替换 | 新增 frontmatter + tier 摘要 + `skill_load` 工具 |
| Rules 匹配 | `src/files/index.js#matchRulesForFiles` | `src/lc/rules.ts` | ✅ 已替换 | 行为对齐 |
| `@[file]` 标签 | `src/files/index.js#parseFileTags` | `src/lc/rules.ts#parseFileTagsFromInput` | ✅ 已替换 | — |
| `#[img]` 设计图 | `src/files/index.js` + `src/utils/fileHandle.js#imageToBase64` | **缺失** | ❌ 未迁移 | LC 引擎目前不支持设计图附加 |
| 终端增强输入（/ @ # 触发） | `src/input/index.js`（363 行） | `@inquirer/prompts`（仅 `input`） | ⚠️ 大幅简化 | 失去 `/` 触发列表、`@` 文件补全、`#` 设计图补全 |
| 指令系统 | `src/commands/index.js`（395 行） | `src/lc/app.ts` 内部 if 分支 + `commands/{memory,vector}.ts` | ⚠️ 大幅简化 | 内置只剩 `/memory`、`/vector`；缺 `/help`、`/clear`、`/context`、`/exit`、`/ask` |
| Playwright 浏览器调试 | `src/utils/debuggerUtils.js` + `tools/local/debugger_page.js` | **缺失** | ❌ 未迁移 | `playwright` 依赖已装，但工具未实现 |
| 图片对比 | `src/tools/local/diff_pic.js` | **缺失** | ❌ 未迁移 | — |
| 配置读取 | `src/utils/config.js` | `src/lc/config.ts` | ✅ 已替换 | 新增 `userId` 字段 |
| 日志/Markdown 渲染 | `src/utils/logger.js` | `src/lc/log.ts`（含 marked + marked-terminal） | ✅ 已替换 | 工具调用记录 + AI 回复渲染 |

### 2.4 数据/配置目录迁移

| 项 | Legacy | LC | 备注 |
|----|--------|-----|------|
| API 配置 | `~/.front/settings.json`（用户级） | `.front/settings.json`（项目级优先） | LC 改为项目级优先 |
| 长期记忆 | `~/.front/memory/` + `.front/memory/` | 同左 + 向量库 | 新增向量检索 |
| 知识库源 | `.front/doc/` | `.front/kb/`（约定） | **目录重命名** |
| LanceDB 数据 | `.front/lancedb-data/` | `.front/lancedb-data/` | 路径一致 |
| 设计稿 | `.front/design/` | `.front/design/` | 路径一致但**无读取实现** |
| Skills | `.front/skills/*/SKILL.md` | 同左 | 格式由 plain md → frontmatter md |
| Rules | `.front/rules/*.md` | 同左 | 格式不变 |
| Commands | `.front/commands/<group>/<name>.md` | **未迁移** | LC 无自定义指令加载 |
| 会话历史 | `~/.front/history/<project>/<ts>.json` | `.front/sessions/<user>/<session>.json` | **路径与文件名规则变化**（旧数据不兼容） |
| 系统提示源 | `src/docs/systemDoc.md` | `.front/AGENTS.md` | **数据源切换**（旧系统提示词模板被弃用） |

### 2.5 Git 提交节奏（`feature/luo_toolcall` 分支）

```
ad2cf99  2026-09-18  使用 langchain 框架重构助手（初始提交）
533228f  2026-09-18  删除 .front.md 文件
2899d4d  2026-09-18  完成提示词模版重构、工具调用体系、循环工具调用测试
9347ee5  2026-09-18  Merge PR #1 → feature/luo_toolcall 并入 main
cae0d39  2026-09-19  完成 MCP 工具的加载，兼容 3 种传输方式
cbf3793  2026-09-19  完善记忆体系，短期 + 长期记忆
dea014a  2026-09-20  fix: 重构短期记忆上下文裁剪，修复循环摘要死循环
bb63f73  2026-09-20  完成知识库 RAG 检索功能板块
b989b9a  2026-09-21  skill 加载体系 和 rules 加载体系
8b2bbed  2026-09-21  编写调用 skill 的本地工具，打通大模型调用 skill 的链路
```

**观察**：6 天连续密集开发（9/18–9/21），单线主干推进；没有里程碑 tag；main 已落后 1 个提交（`feature/luo_toolcall` 的 `8b2bbed` 尚未合并回 main）。

---

## 三、能力对照

### 3.1 LC 引擎相对 Legacy 的**优势**

1. **类型安全**：TypeScript strict 模式，减少运行期错误
2. **消息结构化**：LangChain 原生 `BaseMessage` 体系，`HumanMessage` / `AIMessage` / `ToolMessage` / `SystemMessage` 清晰分离
3. **工具调用循环上限**：显式 `MAX_TOOL_CALLS = 5`，防死循环
4. **短期记忆窗口**：Legacy 没有的 `trimMessages` + LLM summarize 压缩能力
5. **MCP 加载解耦**：工具按 `serverName.toolName` 命名，跨服务器冲突自动规避
6. **System Prompt 模板化**：通过 `.front/AGENTS.md` 的 YAML frontmatter 支持变量插值（`{userName}`、`{cwd}`）
7. **配置项目级优先**：`.front/settings.json` 覆盖 `~/.front/settings.json`，多项目隔离更清晰
8. **可观测性**：4 个 smoke 脚本覆盖核心链路（legacy 阶段无任何自检脚本）
9. **优雅关闭**：SIGINT 时 `disconnectAllMcp()`，避免 stdio 子进程残留

### 3.2 LC 引擎相对 Legacy 的**劣势 / 缺口**

| 缺口 | 影响 | 建议优先级 |
|------|------|----------|
| 本地工具从 12 个减少到 7 个，缺 `bash`、`write_file`、`grep`、`glob`、`confirm`、`select`、`debugger_page`、`diff_pic` | **前端工作流几乎不可用**：无法执行 npm 命令、无法搜索代码、无法确认操作 | P0（必须补） |
| `#[img]` 设计图附件能力缺失 | 设计稿对比、视觉 diff 无法走通 | P1 |
| `src/input/index.js` 的增强终端输入（363 行）被 `@inquirer/prompts#input` 替代 | 失去 `/` `@` `#` 键触发的可视化候选列表 | P1 |
| 指令系统从 9 个内置 + 自定义加载，简化为 2 个内置 | 失去 `/help`、`/clear`、`/context`、`/ask` 等高频指令 | P1 |
| 用户自定义指令加载（`.front/commands/<group>/<name>.md`）未实现 | 自定义工作流丢失 | P2 |
| `FRONT_USE_LC` 开关未接入 `src/app.js` | LC 引擎虽完整，但 legacy 仍是默认入口，二者无法切换 | **P0（必须补）** |
| `src/app.js` 没有 `if (USE_LC_ENGINE) runLcTurn() else getAIResponse()` 的派发逻辑 | LC 引擎与 Legacy 没有共享入口，用户无法选引擎 | **P0（必须补）** |
| Legacy 工具到 LC 工具的适配器 `toLcTool(oldTool)` 未实现 | 无法在 LC 引擎中复用 legacy 工具作为兜底 | P0 |
| Phase 5 的 `kb/` 目录、`lancedb-data/` 未实际创建，embedding 未配置 | RAG 检索无法跑通 | P1 |
| Legacy 会话历史 `~/.front/history/<project>/<ts>.json` 与新格式 `.front/sessions/<user>/<session>.json` 不兼容 | 旧用户的会话上下文丢失 | P2 |
| Phase 7 增强（流式打字机、LangGraph、AgentExecutor）未启动 | 体验仍弱于 Claude Code | P3 |

### 3.3 隔离原则落地检查

按 `AGENTS.md` 红线 §3.6，`src/lc/` 必须自给自足。检查结论：

- ✅ **完全隔离**：`src/lc/` 下的 37 个 .ts 文件**没有任何**对 `src/utils/`、`src/request/`、`src/tools/` 的 `import`（subagent 1 已确认）
- ✅ 所有路径解析（`getUserHomeDir`、`getCurrentWorkingDir`）均在 `src/lc/utils/pathUtils.ts` 独立实现
- ✅ 配置读取（`config.ts`）、RAG（`rag/`）、记忆（`memory/`）、MCP（`tools/mcp/`）均为 TS 自给自足

---

## 四、迁移整体评估

### 4.1 与原计划（`plan-detail.md`）的偏差

| 计划项 | 实际落地 | 偏差 |
|--------|---------|------|
| Phase 1：`engine.js` 总入口 | 改为 `app.ts` 直驱 + `chatWithTools` 引擎函数 | 命名不一致（`engine.ts` 被合并到 `tools/engine.ts`） |
| Phase 2：会话 JSON 结构 `{ version, sessionId, userId, createdAt, updatedAt, messages: [{ role, content, tool_calls }] }` | 实际使用 LangChain 原生 `{ type, data }` 结构（`msg.toDict()` / `coerceMessageLikeToMessage`） | **结构更优**，原生兼容；但与 plan 中描述的字符串 `role` 不符 |
| Phase 3：`tools.js` 统一管理 | 拆为 `tools/{index,registry,engine,type}.ts` + `tools/mcp/{...}.ts` + `tools/implementations/*.ts` | 更细粒度，符合单一职责 |
| Phase 3：兼容 legacy 工具的 `toLcTool(oldTool)` 适配器 | **未实现** | ❌ 偏离开计划 |
| Phase 3：`/session`、`/session new`、`/clear` 等会话指令 | **未实现** | ⚠️ 偏离开计划 |
| Phase 4：短期记忆默认保留 N 轮（如 20 轮） | 改为 token 预算 400 + LLM summarize | **更精细**，但偏离"按轮数"的设计 |
| Phase 5：`/vector` 扫 `.front/doc/` | 实际扫 `.front/kb/` | ⚠️ 路径重命名（兼容 legacy 的 `doc/` 缺失） |
| Phase 6：Skill 工具名 `skill` | 改为 `skill_load` | ⚠️ 命名微调 |
| Phase 7：流式输出 + LangGraph | 未启动 | 符合规划（标记为后续） |

**整体偏差**：实现与规划**大致对齐**，主要偏差集中在工具集收缩（未做 legacy 适配器）和指令系统简化（无自定义指令）。

### 4.2 风险与遗留问题（按紧迫度）

| 等级 | 问题 | 建议动作 |
|------|------|----------|
| 🔴 **阻塞** | LC 引擎未接入 `src/app.js`，Legacy 仍是默认入口；用户无法切换 | 在 `src/app.js` 加入 `process.env.FRONT_USE_LC` 派发；推荐 P0（详见 §5 建议 1） |
| 🔴 **阻塞** | 缺 `bash`、`write_file`、`grep`、`glob`、`confirm`、`select` 等前端工作流核心工具 | 实现 5 个缺失工具或写 `toLcTool(oldTool)` 适配器直接复用 legacy 工具（详见 §5 建议 2） |
| 🟡 **高优** | 终端增强输入（/ @ #）丢失，影响使用手感 | 在 `app.ts` 中接入 `@inquirer/prompts` 的 `search` 或基于 `readline` 自实现补全（详见 §5 建议 3） |
| 🟡 **高优** | `#[img]` 设计图附件缺失，Playwright 调试工具未迁移 | 复用 `src/utils/fileHandle.js#imageToBase64`，在 `messages.ts#buildHumanMessage` 接入 image_url（详见 §5 建议 4） |
| 🟡 **高优** | Phase 5 缺实测（`kb/` 与 `lancedb-data/` 未创建） | 跑一次 `npm run dev` → `/vector` → 验证检索命中（详见 §5 建议 5） |
| 🟢 **中优** | 指令系统简化（无 `/help`、`/clear`、`/context`、`/ask`） | 复用 `src/commands/index.js` 的思路，把高频指令补回 `app.ts` |
| 🟢 **中优** | 自定义指令加载（`.front/commands/<group>/*.md`）未实现 | 新建 `src/lc/commands/custom.ts`，扫描目录并注册 |
| 🟢 **中优** | Legacy 会话历史格式不兼容 | 提供一次性迁移脚本（`scripts/migrate-sessions.mjs`） |
| ⚪ **低优** | Phase 7（流式、LangGraph、AgentExecutor）未启动 | 待 Phase 1–6 全部验证后规划 |

### 4.3 数据流差异示意

```mermaid
flowchart LR
    subgraph Legacy[Legacy 引擎]
        A1[src/app.js] --> B1[src/request/index.js]
        B1 --> C1[OpenAI SDK]
        B1 --> D1[src/tools/local/...]
        B1 --> E1[src/utils/ragHandle.js]
        B1 --> F1[src/utils/contextRead.js]
        A1 --> G1[~/.front/history/]
        A1 --> H1[src/input/index.js 增强输入]
        A1 --> I1[src/commands/index.js 9指令]
    end

    subgraph LC[LC 引擎]
        A2[src/lc/app.ts] --> B2[src/lc/tools/engine.ts]
        B2 --> C2[ChatOpenAI]
        B2 --> D2[tools/registry.ts]
        D2 --> D2a[7 个本地工具]
        D2 --> D2b[MCP stdio/sse/http]
        A2 --> E2[rag/search.ts + memory/vector.ts]
        A2 --> F2[prompts.ts 拼装]
        F2 --> F2a[agents.ts AGENTS.md]
        F2 --> F2b[skills.ts + rules.ts]
        F2 --> F2c[memory/store.ts .md]
        A2 --> G2[.front/sessions/]
        A2 --> H2[@inquirer/prompts#input]
        A2 --> I2[commands/memory.ts + vector.ts]
    end

    Legacy -.未连接.-> LC
```

---

## 五、建议的下一步动作（按 ROI 排序）

### 建议 1：接通 `FRONT_USE_LC` 开关与共享入口（P0，0.5 天）

在 [src/app.js](src/app.js) 顶部加：
```js
const USE_LC_ENGINE = process.env.FRONT_USE_LC !== '0';
if (USE_LC_ENGINE) {
  const { runLcMain } = await import('./lc/app.js'); // 或 .ts 经 tsx 加载
  await runLcMain();
} else {
  await runLegacyMain();
}
```
这样 legacy 仍可在 `FRONT_USE_LC=0` 时作为对照/兜底，符合 `plan-detail.md` §4 的切流策略。

### 建议 2：补全本地工具（P0，1–2 天）

两条路径二选一：
- **A. 适配器路线**：实现 `toLcTool(oldTool)`，把 `src/tools/local/index.js` 的 12 个工具整体复用，零业务改写。
- **B. 纯 LC 重写**：参考 [src/lc/tools/implementations/read_file.ts](src/lc/tools/implementations/read_file.ts) 的模式补 `bash.ts`、`write_file.ts`、`grep.ts`、`glob.ts`、`confirm.ts`、`select.ts`。工作量约为路线 A 的 3 倍。

**推荐 A**，符合 `AGENTS.md` §3.6 的隔离原则例外条款（通过适配器间接复用，不直接 import）。

### 建议 3：恢复终端增强输入（P1，1 天）

在 `app.ts` 中用 `@inquirer/prompts` 的 `search` 类型替代裸 `input`，键入 `/` `@` `#` 时弹出候选列表。或把 `src/input/index.js` 改造成纯函数 `createEnhancedPrompt(prompt, options)`，在 LC 入口调用。

### 建议 4：恢复设计图附件与浏览器调试（P1，1 天）

- `messages.ts#buildHumanMessage` 增加 `images?: string[]` 参数，命中 `#[img]` 时把 path 转 `data:image/...;base64,...`（逻辑可参考 `src/utils/fileHandle.js#imageToBase64`，但需 TS 重写）。
- `tools/implementations/debugger_page.ts` 参考 [src/utils/debuggerUtils.js](src/utils/debuggerUtils.js) 实现。

### 建议 5：跑通 Phase 5 端到端（P1，0.5 天）

1. 在 `.front/settings.json` 配置 `embedding`（如 `text-embedding-3-small` 走 OpenAI 或其他网关）。
2. `mkdir .front/kb` 放入测试文档。
3. `npm run dev` → `/vector` → 提问 → 验证 `searchKb` 命中并注入 prompt。

### 建议 6：补回高频指令（P2，0.5 天）

把 `/help`、`/clear`、`/context`、`/exit`（目前是裸 `exit`/`quit`）、`/ask` 加回 `src/lc/app.ts` 的 if 分支或抽到 `src/lc/commands/builtin.ts`。

### 建议 7：合并 `feature/luo_toolcall` 回 `main`（P2，0.1 天）

当前 main 已落后 1 个提交，建议在 Phase 0–6 全部验证后合一次，避免分叉扩大。

---

## 六、最终结论

| 维度 | 评分 | 说明 |
|------|------|------|
| 计划达成率 | **80%** | Phase 0–4、6 完成；Phase 5 缺实测；Phase 7 未启动 |
| 代码质量 | **高** | TS strict、自给自足、模块职责清晰、smoke 覆盖到位 |
| 可回滚性 | **中** | 引擎未接入主入口，回滚不彻底 |
| 用户可见功能完整度 | **50%** | 基础对话 + 记忆 + Skill/Rules/MCP 已通；前端核心工具（bash、grep、write_file）与增强输入、设计图附件、调试工具均缺失 |
| 风险等级 | **中** | 功能缺口可补、架构清晰、隔离原则落实，**最大风险是未接入主入口导致 LC 引擎停留在"能跑但没人用"状态** |

**一句话**：
> 新引擎核心能力已对齐规划，但**工具集收缩 + 主入口未接通**两条让它目前仍是"内核完整、外壳缺损"。补完建议 1 + 2 即可让 LC 引擎替代 Legacy 成为默认入口。

---

## 附录 A：核心文件清单

### LC 引擎入口与全局
- [src/lc/app.ts](src/lc/app.ts) — CLI 入口（145 行，含 `/memory`、`/vector`）
- [src/lc/config.ts](src/lc/config.ts) — 配置读取（98 行）
- [src/lc/model.ts](src/lc/model.ts) — ChatOpenAI 工厂（45 行）
- [src/lc/messages.ts](src/lc/messages.ts) — 消息构造（67 行）
- [src/lc/prompts.ts](src/lc/prompts.ts) — 本轮消息拼装（109 行）
- [src/lc/agents.ts](src/lc/agents.ts) — AGENTS.md 渲染（61 行）
- [src/lc/type.ts](src/lc/type.ts) — 全局类型
- [src/lc/log.ts](src/lc/log.ts) — 终端彩色输出
- [src/lc/session.ts](src/lc/session.ts) — 会话持久化（85 行）

### LC 工具层
- [src/lc/tools/index.ts](src/lc/tools/index.ts) — 工具入口（46 行）
- [src/lc/tools/registry.ts](src/lc/tools/registry.ts) — 注册中心（48 行）
- [src/lc/tools/engine.ts](src/lc/tools/engine.ts) — 工具循环（75 行）
- [src/lc/tools/type.ts](src/lc/tools/type.ts) — 工具类型
- [src/lc/tools/mcp/loader.ts](src/lc/tools/mcp/loader.ts) — MCP 连接（113 行）
- [src/lc/tools/mcp/adapter.ts](src/lc/tools/mcp/adapter.ts) — MCP 适配（75 行）
- [src/lc/tools/mcp/types.ts](src/lc/tools/mcp/types.ts) — MCP 类型

### LC 本地工具实现（7 个）
- [src/lc/tools/implementations/read_file.ts](src/lc/tools/implementations/read_file.ts)
- [src/lc/tools/implementations/skill_load.ts](src/lc/tools/implementations/skill_load.ts)
- [src/lc/tools/implementations/memory_get.ts](src/lc/tools/implementations/memory_get.ts)
- [src/lc/tools/implementations/memory_save.ts](src/lc/tools/implementations/memory_save.ts)
- [src/lc/tools/implementations/get_location.ts](src/lc/tools/implementations/get_location.ts)
- [src/lc/tools/implementations/search_restaurant.ts](src/lc/tools/implementations/search_restaurant.ts)
- [src/lc/tools/implementations/place_order.ts](src/lc/tools/implementations/place_order.ts)

### LC 记忆体系
- [src/lc/memory/index.ts](src/lc/memory/index.ts) — 统一出口
- [src/lc/memory/store.ts](src/lc/memory/store.ts) — .md 读写（38 行）
- [src/lc/memory/vector.ts](src/lc/memory/vector.ts) — 向量存储/检索（97 行）
- [src/lc/memory/window.ts](src/lc/memory/window.ts) — 短期窗口 + LLM summarize（227 行）
- [src/lc/memory/prompt.ts](src/lc/memory/prompt.ts) — 合并提示词（39 行）
- [src/lc/memory/type.ts](src/lc/memory/type.ts) — 记忆类型

### LC RAG 体系
- [src/lc/rag/index.ts](src/lc/rag/index.ts) — 统一出口
- [src/lc/rag/kb.ts](src/lc/rag/kb.ts) — 知识库索引（194 行）
- [src/lc/rag/search.ts](src/lc/rag/search.ts) — 检索（72 行）
- [src/lc/rag/template.ts](src/lc/rag/template.ts) — 模板渲染（34 行）

### LC 上下文
- [src/lc/skills.ts](src/lc/skills.ts) — Skill 扫描与摘要（203 行）
- [src/lc/rules.ts](src/lc/rules.ts) — Rules glob 匹配（134 行）
- [src/lc/commands/memory.ts](src/lc/commands/memory.ts) — /memory 指令（100 行）
- [src/lc/commands/vector.ts](src/lc/commands/vector.ts) — /vector 指令（28 行）

### 自检脚本（4 个）
- [scripts/smoke-lc.mjs](scripts/smoke-lc.mjs) — LC 引擎连通性
- [scripts/skill-smoke.ts](scripts/skill-smoke.ts) — Skill/Rules 自检
- [scripts/memory-smoke.ts](scripts/memory-smoke.ts) — 记忆体系自检
- [scripts/rag-smoke.ts](scripts/rag-smoke.ts) — RAG 自检

### Legacy 引擎（保留作对照/兜底）
- [src/app.js](src/app.js) — Legacy CLI 入口
- [src/request/index.js](src/request/index.js) — Legacy OpenAI 调用
- [src/tools/local/index.js](src/tools/local/index.js) — 12 个本地工具注册
- [src/tools/local/LocalClient.js](src/tools/local/LocalClient.js) — 工具注册中心
- [src/tools/mcp/index.js](src/tools/mcp/index.js) — MCP 连接
- [src/input/index.js](src/input/index.js) — 终端增强输入（363 行）
- [src/files/index.js](src/files/index.js) — @ / # 标签处理
- [src/commands/index.js](src/commands/index.js) — 9 个内置指令（395 行）
- [src/utils/contextRead.js](src/utils/contextRead.js) — systemDoc/记忆/Skills/Rules 读取
- [src/utils/ragHandle.js](src/utils/ragHandle.js) — Legacy RAG
- [src/utils/memoryUtils.js](src/utils/memoryUtils.js) — Legacy 记忆
- [src/utils/debuggerUtils.js](src/utils/debuggerUtils.js) — Playwright 调试

---

## 附录 B：规划文档与实现偏差速查

| 规划点 | 规划方案 | 实际实现 | 偏差 |
|--------|---------|---------|------|
| Phase 1 总入口 | `src/lc/engine.js` 暴露 `runTurn()` | `src/lc/app.ts` 直接驱动 + `tools/engine.ts#chatWithTools` | 命名差异，功能等价 |
| Phase 2 会话结构 | 自定义 `{ version, sessionId, userId, createdAt, updatedAt, messages: [{ role, content, tool_calls }] }` | LangChain 原生 `{ type, data }`（toDict/coerce） | **结构更优**，原生兼容 |
| Phase 3 工具入口 | `src/lc/tools.js` 单文件 | `tools/{index,registry,engine,type}.ts` + `tools/mcp/*.ts` + `tools/implementations/*.ts` | 拆分更细 |
| Phase 3 legacy 适配 | 实现 `toLcTool(oldTool)` 适配器 | **未实现** | ❌ |
| Phase 3 会话指令 | `/session`、`/session new`、`/clear` | **未实现** | ⚠️ |
| Phase 4 短期窗口 | 默认保留 20 轮 | token 预算 400 + LLM summarize | **更精细** |
| Phase 5 知识库路径 | `.front/doc/` | `.front/kb/` | ⚠️ 路径重命名 |
| Phase 6 Skill 工具名 | `skill` | `skill_load` | ⚠️ 微调 |
| Phase 7 增强 | 流式/LangGraph/AgentExecutor | 未启动 | 符合规划 |

---

> **报告结束**
> 报告生成于 2026-09-21，基于当前 `feature/luo_toolcall` 分支（commit `8b2bbed`）与 `改造/plan-detail.md` 对比。
