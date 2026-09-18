# FrontCode

仓库地址：https://github.com/bidboss/bid-agent

面向前端开发的 AI 终端助手（CLI），在本地终端中对话、读写代码、检索项目、调用工具，并支持设计稿对照与页面调试。定位类似 Claude Code，技术栈为 Node.js + ESM + OpenAI 兼容接口。

---

## 产品价值

- **终端内闭环开发**：提问 → 读代码 → 改文件 → 确认 → 调试截图 → 对比设计图，减少 IDE 与聊天工具之间的来回切换。
- **项目级上下文**：自动注入系统提示、`.front.md`、记忆、Skills、Rules、RAG 检索结果，回答更贴合当前仓库与个人习惯。
- **可扩展工具层**：本地 Function Tools 与 MCP 统一注册，可接外部服务而不改核心对话循环。
- **前端工作流友好**：`@` 附加源码、`#` 附加设计图、Playwright 页面调试、视觉 diff，贴合 UI 落地场景。
- **用户 / 项目双层配置**：`~/.front` 与项目 `.front` 分层，偏好与项目规范互不干扰。

---

## 功能介绍

### 对话与上下文

| 能力 | 说明 |
|------|------|
| 多轮对话 | 维护 `messages` 历史，支持工具调用后再追问 |
| 系统角色 | `src/docs/systemDoc.md` 定义前端助手行为与安全边界 |
| 用户 / 项目说明 | 读取 `~/.front/.front.md` 与项目根 `.front.md` |
| 长期记忆 | `.front/memory/memory.md`（用户级 + 项目级） |
| Skills | `.front/skills/*/SKILL.md`，启动时注入摘要，按需 `skill` 工具加载全文 |
| Rules | `.front/rules/*.md`，按 glob 匹配 `@` 选中的文件后附加 |
| RAG | LanceDB 向量检索 `.front/doc` 文档，相关片段注入对话 |

### 终端交互增强

输入时触发：

- **`/`**：指令列表（↑↓ 选择，Tab 确认）
- **`@`**：项目文件列表，选中后以 `@[path]` 附加文件内容
- **`#`**：`.front/design` 下设计图，选中后以 `#[name]` 作为多模态图片发送

### 内置指令

| 指令 | 作用 |
|------|------|
| `/help` | 帮助与使用技巧 |
| `/clear` | 清空对话历史 |
| `/context` | 查看当前上下文摘要（非阻断，会附带给模型） |
| `/vector [file]` | 将文档或指定文件向量化入库 |
| `/memory` | 让模型分析并写入记忆 |
| `/exit` / `/quit` | 退出（退出时写入历史） |
| 自定义指令 | `.front/commands/<组>/<名>.md` → `/组:名` |

### 本地工具（Function Calling）

| 工具 | 作用 |
|------|------|
| `read_file` / `write_file` | 读写文件 |
| `grep` / `glob` | 搜索与按模式找文件 |
| `bash` | 执行 shell 命令 |
| `confirm` / `select` | 终端确认与选项交互 |
| `skill` | 加载 Skill 全文 |
| `memory_get` / `memory_save` | 读取 / 保存记忆 |
| `debugger_page` | Playwright 打开页面，抓控制台与截图 |
| `diff_pic` | 对比设计图与测试截图差异 |

### MCP 扩展

在 `.front/settings.json` 的 `mcpServer` 中配置 HTTP / SSE / stdio 服务后，工具会以 `服务名__工具名` 形式并入同一工具列表。

---

## 实现架构

### 总体流程

```text
用户输入 (readline + 增强键控)
        │
        ├─ / 指令 ──► commands（阻断 / 非阻断）
        ├─ @[file] ──► 附加文件 + 匹配 Rules
        ├─ #[image] ──► 设计图转 base64
        └─ RAG 检索 ──► 相关文档片段
                │
                ▼
        context + messages
                │
                ▼
     OpenAI 兼容 Chat Completions
     （tools = 本地工具 ∪ MCP 工具）
                │
        ┌───────┴────────┐
        │ 有 tool_calls   │ 无 → 打印 Markdown 回复
        ▼                │
   excuteTool(...)       │
   结果写入 messages     │
        └──────► 再次请求 ◄┘
```

### 分层说明

| 层级 | 目录 / 模块 | 职责 |
|------|-------------|------|
| 入口 | `src/app.js` | CLI 启动、对话循环、拼装上下文与用户消息 |
| 输入 | `src/input/` | `/` `@` `#` 补全与行编辑 |
| 指令 | `src/commands/` | 内置与自定义指令 |
| 文件 / 设计图 | `src/files/` | 扫描、标签解析、Rules 匹配、设计图路径 |
| 请求 | `src/request/` | 读配置、创建 OpenAI 客户端、工具调用循环 |
| 工具 | `src/tools/` | 本地工具注册 + MCP 合并与执行 |
| 上下文 | `src/utils/contextRead.js` 等 | System / 记忆 / Skills / Rules |
| RAG | `src/utils/ragHandle.js` | 文档切分、embedding、LanceDB |
| 提示模板 | `src/docs/` | 发给模型的 Markdown 模板 |

### 配置优先级

1. **API**：项目 `.front/settings.json` → 用户 `~/.front/settings.json`
2. **MCP / 自定义指令 / Skills / Rules / 文档**：用户目录与项目目录合并，**项目侧同名覆盖用户侧**
3. **工作目录**：以 `process.cwd()` 为项目根，工具读写默认不越界

### 运行时数据目录（`.front`）

```text
.front/
├── settings.json      # apiKey、baseURL、model、mcpServer
├── memory/            # 长期记忆
├── doc/               # RAG 源文档（md / txt / docx）
├── langcedb-data/     # LanceDB 向量库
├── design/            # 设计稿图片（# 选择）
├── screenshot/        # debugger_page 截图
├── rules/             # 路径匹配规则
├── skills/            # Skill 包
└── commands/          # 自定义指令
```

用户级同样使用 `~/.front/`（另含 `history/<项目名>/` 对话历史等）。

---

## 目录结构

```text
code/
├── package.json              # 包名 frontcode，bin: front → src/app.js
├── .front.md                 # 项目级说明（注入上下文）
├── .front/                   # 项目级运行时配置与资源（见上）
└── src/
    ├── app.js                # 启动入口
    ├── commands/             # 指令系统
    ├── docs/                 # 系统提示与各类模板
    │   ├── systemDoc.md
    │   ├── userContext.md
    │   ├── skillTemplate.md
    │   ├── ragTemplate.md
    │   └── memoryTemplate.md
    ├── files/                # 文件 / 设计图 / Rules 匹配
    ├── input/                # 增强终端输入
    ├── request/              # OpenAI 客户端与对话请求
    ├── tools/
    │   ├── index.js          # 合并本地 + MCP，excuteTool
    │   ├── util.js           # 工具定义转 OpenAI 协议
    │   ├── mcp/              # MCP 连接与工具拉取
    │   └── local/            # 各本地工具（一工具一文件）
    └── utils/                # 日志、路径、记忆、RAG、调试等
```

**工具开发约定**：在 `src/tools/local/` 新增同名模块（参考 `skill.js`：`define` + `handle`），并在 `local/index.js` 中 `registerTool`。项目使用 **ESM**（`"type": "module"`），语言为 **JavaScript**（非 TypeScript）。

---

## 启动方式

### 环境要求

- Node.js（建议 18+）
- 可访问的 OpenAI 兼容 API（默认示例为通义 DashScope Compatible Mode）
- 使用页面调试时需能运行 Playwright（首次可能需安装浏览器）

### 安装

```bash
cd /path/to/code
npm install
```

可选：全局链接 CLI（`package.json` 的 `bin.front`）：

```bash
npm link
# 之后可在任意目录执行
front
```

### 配置 API

在项目或用户目录创建配置文件：

```bash
mkdir -p .front
```

写入 `.front/settings.json`（勿将真实密钥提交到仓库）：

```json
{
  "baseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "apiKey": "你的_API_Key",
  "model": "qwen3.6-plus"
}
```

可选 MCP 示例字段：

```json
{
  "mcpServer": {
    "demo": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  }
}
```

`type` 支持：`stdio`、`sse`、`http` / `streamablehttp`。

### 运行

在目标前端项目目录下启动（上下文与文件扫描以当前工作目录为准）：

```bash
# 方式一：直接跑入口
node ./src/app.js

# 方式二：已 npm link 时
front
```

启动后出现欢迎界面，在 `问：` 后输入需求即可。输入 `/help` 查看指令；`exit` / `quit` 或 `/exit` 退出。

### 常用工作流示例

1. **改代码**：描述需求，或 `@[src/App.vue]` 附加文件；模型经确认后 `write_file`。
2. **设计稿还原**：将图片放入 `.front/design/`，输入 `#` 选择后说明需求。
3. **知识库**：把文档放入 `.front/doc/`，执行 `/vector`，之后对话会自动检索相关片段。
4. **调试**：代码写入后可走 `debugger_page`；有设计图时可再 `diff_pic`。

---

## 技术依赖（摘要）

| 依赖 | 用途 |
|------|------|
| `openai` | Chat / Embeddings（兼容接口） |
| `@modelcontextprotocol/sdk` | MCP 客户端 |
| `@lancedb/lancedb` + `@langchain/textsplitters` | 向量库与文本切分 |
| `playwright` | 页面调试与截图 |
| `@inquirer/prompts` / `ora` / `chalk` / `marked-terminal` | 交互、加载态与终端 Markdown |
| `mammoth` | docx 文本提取 |

---

## 安全与规范提示

- 助手默认只协助前端相关任务，危险写操作前应经 `confirm`。
- `settings.json` 含密钥，请加入忽略规则，不要提交到公开仓库。
- 生成代码时注意与项目 `package.json` 中依赖版本一致，避免胡编 API。
