# AGENTS.md — FrontCode 项目规范

> 本文件为 Cursor AI 助手的项目规范，包含项目目标、代码地图、编写约定和开发指引。
> 所有 AI 助手在处理本项目时必须遵循本文档的规则。

---

## 一、项目目标

`frontcode` 是一个面向前端开发的 **AI 终端助手（CLI）**，定位类似 Claude Code。

核心能力：
- **终端内闭环开发**：提问 → 读代码 → 改文件 → 确认 → 调试截图 → 对比设计稿
- **项目级上下文**：自动注入系统提示、记忆、Skills、Rules、RAG 检索
- **可扩展工具层**：本地 Function Tools 与 MCP 统一注册
- **前端工作流友好**：`@` 附加源码、`#` 附加设计图、Playwright 调试、视觉 diff

---

## 二、代码地图

### 2.1 整体目录结构

```
frontcode/
│
├── src/                          # 源代码主目录
│   ├── app.js                    # CLI 入口（legacy）
│   │
│   ├── lc/                       # 🆕 LangChain 引擎（新代码，TS）
│   │   ├── config.ts             # 配置归一化
│   │   ├── model.ts              # ChatOpenAI 工厂
│   │   ├── messages.ts           # 🆕 消息构造
│   │   ├── engine.ts             # 🆕 LC 引擎总入口 runTurn()
│   │   ├── session.ts            # 🆕 会话 JSON 持久化
│   │   ├── tools.ts              # 🆕 工具包装为 DynamicStructuredTool
│   │   ├── memory.ts             # 🆕 短期/长期记忆管理
│   │   ├── rag.ts                # 🆕 Embeddings + LanceDB RAG
│   │   ├── prompts.ts            # 🆕 上下文模板拼装
│   │   ├── skills.ts             # 🆕 Skills 扫描与摘要注入
│   │   └── rules.ts              # 🆕 Rules glob 匹配
│   │
│   ├── request/                  # 🏛️ Legacy 引擎（保持 JS）
│   ├── tools/                    # 🏛️ 工具层（legacy JS）
│   ├── input/                    # 🏛️ 终端增强输入
│   ├── files/                    # 🏛️ 文件/设计图/Rules 匹配
│   ├── commands/                 # 🏛️ 指令系统
│   └── utils/                    # 🏛️ 工具函数
│
├── docs/                         # 📄 文档目录（详见 2.3）
│
├── .front/                       # 项目级运行时配置与资源
│   ├── settings.json             # API 配置
│   ├── memory/                   # 长期记忆
│   ├── doc/                      # RAG 源文档
│   ├── langcedb-data/            # LanceDB 向量库
│   ├── design/                   # 设计稿图片
│   ├── screenshot/               # 调试截图
│   ├── rules/                    # 路径匹配规则
│   ├── skills/                   # Skill 包
│   ├── commands/                 # 自定义指令
│   └── sessions/                 # 🆕 会话 JSON 文件
│
├── scripts/                      # 脚本
│   └── smoke-lc.mjs              # LC 引擎自检脚本
│
├── 改造/                         # 📄 改造相关文档
│   ├── plan.md                   # 改造阶段总览
│   └── plan-detail.md            # 详细改造方案
│
├── package.json                  # 项目配置（ESM）
├── AGENTS.md                     # 项目规范和代码地图
└── README.md                     # 产品说明文档
```

### 2.2 运行时数据目录（.front）

```
.front/
├── settings.json          # apiKey、baseURL、model、mcpServer、embedding
├── memory/
│   ├── memory.md         # 项目级长期记忆
│   └── user-memory.md    # 用户级长期记忆（位于 ~/.front/memory/）
├── doc/                  # RAG 源文档（md / txt / docx）
├── langcedb-data/        # LanceDB 向量库
├── design/               # 设计稿图片（# 选择）
├── screenshot/           # debugger_page 截图
├── rules/               # 路径匹配规则 *.md
├── skills/              # Skill 包（每个 skill 一个目录）
│   └── <skill-name>/
│       └── SKILL.md     # Skill 定义文件
├── commands/             # 自定义指令
│   └── <group>/
│       └── <name>.md    # 触发 /group:name
└── sessions/            # 🆕 Phase 2 会话持久化
    └── <userId>/
        └── <sessionId>.json
```

### 2.3 文档目录

> 阶段详细方案文档放在根目录 `docs/`，原始模板文件在 `src/docs/`。

#### 根目录 docs/（阶段详细方案）

```
docs/
├── phase-0-env-setup.md      # 🔄 Phase 0：环境准备详细方案
├── phase-1-dialogue-chain.md # 🔄 Phase 1：基本对话链路详细方案
├── phase-2-session-mgmt.md   # 🔄 Phase 2：会话管理详细方案
├── phase-3-tool-mgmt.md      # 🔄 Phase 3：工具管理详细方案
├── phase-4-memory-mgmt.md   # 🔄 Phase 4：记忆管理详细方案
├── phase-5-rag-pipeline.md  # 🔄 Phase 5：RAG 链路详细方案
├── phase-6-skill-rules.md   # 🔄 Phase 6：Skill/Rules 详细方案
└── phase-7-enhancements.md  # 🔄 Phase 7：后续增强规划
```

#### src/docs/（原始模板文件）

```
src/docs/
├── systemDoc.md              # 系统角色定义
├── userContext.md            # 用户上下文模板
├── skillTemplate.md          # Skill 摘要注入模板
├── ragTemplate.md            # RAG 检索结果注入模板
└── memoryTemplate.md         # 记忆写入模板
```

---

## 三、编写约定

### 3.1 语言与框架

| 区域 | 语言 | 框架 | 说明 |
|------|------|------|------|
| `src/lc/` | **TypeScript** | LangChain | 新代码全部 TS，配合 `@langchain/core` 的 `.d.ts` 获得完整类型提示 |
| `src/request/` | JavaScript（ESM） | 原生 OpenAI SDK | Legacy 引擎，保持 JS，不新增开发 |
| `src/tools/` | JavaScript（ESM） | 原生实现 | Legacy 工具，Phase 3 后被 `lc/tools.ts` 逐步接管 |
| `src/input/` | JavaScript（ESM） | — | Legacy 终端输入，保持 JS |
| `src/files/` | JavaScript（ESM） | — | Legacy 文件处理，保持 JS |
| `src/commands/` | JavaScript（ESM） | — | Legacy 指令系统，保持 JS |
| `src/utils/` | JavaScript（ESM） | — | Legacy 工具函数，保持 JS |
| `docs/` | Markdown | — | 文档，用 Markdown 编写 |
| `scripts/` | JavaScript（ESM） | — | 自检脚本，保持 JS |

### 3.2 TypeScript 配置

- 目标：`tsconfig.json` 位于项目根目录
- `allowJs: true`：兼容 legacy JS 文件的 import
- `strict: true`：新 TS 代码启用严格模式
- 运行方式：开发用 `tsx`（`npx tsx ./src/app.js`），生产构建用 `tsc`

### 3.3 模块导出约定

```typescript
// src/lc/*.ts 模块只暴露 1–3 个核心函数，示例：
export { createChatModel, getMessageText, smokeTestModel } from './model.js';
export { loadSession, saveSession, listSessions, newSessionId } from './session.js';
```

### 3.4 文件命名约定

- **TypeScript 文件**：`.ts` 后缀（小写 + 驼峰，如 `session.ts`）
- **JavaScript 文件**：`.js` 后缀
- **模块入口文件**：`index.js` / `index.ts`
- **文档文件**：`.md` 后缀，阶段文档前缀 `phase-N-`（如 `phase-1-dialogue-chain.md`）

### 3.5 命名规范

- **禁止使用框架名作为前缀**：不能因为使用了 LangChain 就在函数名、变量名、文件名中加 `lc`、`langchain` 等前缀
  - ✅ 正确：`getModelConfig`、`createChatModel`、`session.ts`
  - ❌ 错误：`getLcConfig`、`normalizeLc`、`lcSession.ts`
- **按功能命名**：函数名要描述它做什么，而不是它用什么框架实现
- **重命名时同步更新引用**：改名后必须全局搜索并更新所有 import 和调用处

### 3.6 隔离原则（红线）

> 这是绝对红线，**任何时候都不允许违反**。

- **`src/lc/` 目录必须自给自足**：所有工具函数、类型定义、路径解析等必须独立实现，禁止直接调用 `src/utils/`、`src/request/`、`src/tools/` 等 legacy 目录下的 JS 工具
- **禁止跨目录复用工具**：TS 和 JS 的工具链必须隔离，`src/lc/` 内部的依赖仅限 Node.js 原生模块和第三方 npm 包
- **例外**：第三方库（`@langchain/*`、`@modelcontextprotocol/sdk` 等）不受此限制
- **改动的边界**：非功能需求的改动（如工具函数位置调整、依赖路径变更）必须先向用户确认，得到同意后才能执行

### 3.7 代码注释约定

- 所有公开函数必须有 JSDoc 注释（参考 `src/lc/model.js` 的写法）
- 函数注释包含：用途说明、参数类型、返回值类型、示例
- 复杂逻辑用行内注释标注关键决策点

---

## 四、开发规则

### 4.1 改造原则

1. **局部替换**：每次只改一个 Phase，不动其他代码
2. **开关切换**：`process.env.FRONT_USE_LC` 控制走 LC 引擎还是 legacy
   - `FRONT_USE_LC`（未设置或 `1`）→ 走 LC 引擎（`src/lc/`）
   - `FRONT_USE_LC=0` → 走 legacy（`src/request/`）
3. **回滚预案**：任何阶段异常，配置环境变量即可秒切 legacy
4. **不退步原则**：新引擎行为至少与 legacy 等价

### 4.2 Phase 开发流程

每个 Phase 按以下顺序开发：

```
① 阅读 docs/phase-N-*.md（详细方案文档）
② 阅读 改造/plan-detail.md（对照整体方案）
③ 实现 src/lc/ 对应模块
④ 运行 scripts/smoke-lc.mjs 验证基础连通
⑤ 手动功能测试（至少 3 个用例）
⑥ 对比 legacy 行为（FRONT_USE_LC=0 vs FRONT_USE_LC=1）
⑦ 提交代码，更新 改造/plan.md 状态
```

### 4.3 配置管理

- API 配置：`.front/settings.json`（项目级）或 `~/.front/settings.json`（用户级）
- **禁止将含密钥的配置文件提交到公开仓库**
- embedding 配置在 `settings.json` 的 `embedding` 字段单独指定（主网关可能不支持 embedding）

### 4.4 风险规避

| 场景 | 规则 |
|------|------|
| DeepSeek 等网关无 embedding 接口 | embedding 必须单独配置，未配置时 RAG 静默降级返回空数组 |
| 交互式工具 confirm/select | Phase 3–6 期间保持手写工具循环，不使用 AgentExecutor |
| MCP 工具 JSON Schema | 用 `@langchain/core/utils` 的互转工具处理 zod 与 JSON Schema |
| LangChain 版本升级 | 锁定 `package.json` 的 minor 版本，升级走独立 PR |

---

## 五、后续开发指引

### 5.1 新增功能的存放位置

| 功能类型 | 存放位置 | 约定 |
|----------|----------|------|
| LC 引擎相关 | `src/lc/*.ts` | 新模块用 TS |
| Legacy 功能迭代 | 对应 `src/` 子目录 | 保持 JS |
| 工具 | `src/tools/local/` | 一工具一文件，JS |
| 指令 | `src/commands/` | JS |
| 文档 | `docs/` | Markdown，阶段文档前缀 `phase-N-` |
| 改造记录 | `改造/` | plan.md + plan-detail.md + 各 Phase 总结 |

### 5.2 遇到问题时的处理

1. **LC 引擎问题**：检查 `src/lc/` 对应模块 + `scripts/smoke-lc.mjs`
2. **工具执行问题**：检查 `src/tools/local/` + `src/lc/tools.ts`
3. **RAG 问题**：检查 `src/lc/rag.ts` + embedding 配置
4. **记忆问题**：检查 `src/lc/memory.ts` + `.front/memory/`
5. **配置问题**：检查 `.front/settings.json`

### 5.3 版本与依赖

- LangChain 版本锁定：当前安装 `@langchain/core@1.2.11`，升级需验证兼容性
- Node.js 要求：18+
- ESM 项目：`package.json` 中 `"type": "module"`

---

## 六、变更记录

| 日期 | 变更内容 | 负责人 |
|------|----------|--------|
| 2026-09-18 | 初始化 AGENTS.md，建立项目规范与代码地图 | AI Assistant |
| 2026-09-18 | 建立改造计划：Phase 0–7 阶段划分 | AI Assistant |

---

> **最后更新**：2026-09-18
> **维护者**：项目所有者