# 基础链路搭建计划（src/lc/ TS 版）

## 目标

跑通一次对话：`运行 src/lc/app.ts → 多轮对话 → 退出 → 重启能读回历史`。

不涉及工具循环、skills、image、流式输出。

---

## 一、新增文件清单

| 文件 | 作用 |
|------|------|
| `src/lc/session.ts` | 会话 JSON 文件读写：使用 LangChain 原生序列化方案 |
| `src/lc/prompts.ts` | 上下文拼装：system + 历史 + 当前输入，预留 skill 位置 |
| `src/lc/app.ts` | 启动入口：inquirer 循环 + 拼装消息 + 调模型 + 存会话 |

`src/lc/utils/pathUtils.ts` 已存在，复用。

---

## 二、关键设计

### 2.1 LangChain 原生序列化方案

会话 JSON 中只保存 LangChain 原生消息格式，禁止自定义消息结构。

| 方向 | 方法 | 输出 / 输入 |
|------|------|------|
| 写文件 | `msg.toDict()` | `{ type: "human" \| "ai" \| "system" \| "tool", data: { ...kwargs } }` |
| 读文件 | `coerceMessageLikeToMessage()` | 还原成 `BaseMessage` 实例 |

**为什么选 `toDict()` 而不是 `toJSON()`**：

- `toDict()` 自带 `type` 字段，读取时一眼能认出消息角色（`"human"` / `"ai"` / `"system"` / `"tool"`），格式直观。
- `toJSON()` 输出的是 `{ lc: 1, id: [...], kwargs: {...} }`，需要靠 `id` 数组的最后一项推断类名。

**为什么不需要自定义反序列化逻辑**：

`coerceMessageLikeToMessage()` 内部对 `{ type, data }` 格式的处理：

```
type === "human"     → new HumanMessage(rest)
type === "ai"        → new AIMessage(rest, 处理 tool_calls 兼容性)
type === "system"    → new SystemMessage(rest)
type === "tool"      → new ToolMessage(rest)
```

`data` 里包含的 `content`（含多模态数组）、`additional_kwargs`、`tool_call_id`、`name` 等 kwargs 原样透传，**不丢失**。

**业务代码里只看到消息实例**：

```
内存中：BaseMessage[] 流转
        ↓ saveMessagesToFile
磁盘中：JSON（toDict 输出）
        ↓ loadMessagesFromFile
内存中：BaseMessage[] 流转
```

序列化只在文件读写边界执行，业务代码全程只操作 `BaseMessage[]`。

### 2.2 会话文件结构

存放在 `项目目录/.front/sessions/<user_id>/<session_id>.json`：

```json
{
  "user_id": "lxh",
  "session_id": "default",
  "created_at": "2026-09-18T10:00:00.000Z",
  "updated_at": "2026-09-18T10:05:00.000Z",
  "messages": [
    {
      "type": "human",
      "data": { "content": "你好" }
    },
    {
      "type": "ai",
      "data": { "content": "你好！有什么可以帮你的？" }
    }
  ]
}
```

多模态消息示例（`content` 是数组，方法相同）：

```json
{
  "type": "human",
  "data": {
    "content": [
      { "type": "text", "text": "看这张图" },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
    ]
  }
}
```

### 2.3 上下文拼装顺序（每轮对话）

```
[SystemMessage]       ← 占位文本（Phase 1 不读文件）
[Skill 占位]          ← 预留位置（Phase 2/3 填）
[...历史 messages]    ← 从 session JSON 加载（toDict → 还原实例）
[HumanMessage]        ← 用户当前输入
```

技能位先用注释 + 空占位数组表达，后续接入时只需替换 `prompts.ts` 里的 `buildSkillMessages()` 一处。

### 2.4 隔离原则

- `src/lc/session.ts` 自己用 `fs / path / os` 实现文件读写，**不调用 `src/utils/fsHandle.js`**。
- 路径解析走 `src/lc/utils/pathUtils.ts` 里的 `getUserHomeDir` / `getCurrentWorkingDir`。
- 消息构造统一用 `src/lc/messages.ts` 已有的 `buildSystemMessage` / `buildHumanMessage` / `buildAIMessage` / `buildToolMessage`，**不重新定义自定义消息类型**。

---

## 三、各文件具体设计

### 3.1 `src/lc/session.ts`

**核心：两个函数 `saveMessagesToFile` / `loadMessagesFromFile`，其余为文件路径和会话元数据辅助函数。**

```typescript
import fs from 'fs';
import path from 'path';
import { BaseMessage } from '@langchain/core/messages';
import { coerceMessageLikeToMessage } from '@langchain/core/messages/utils';
import { getCurrentWorkingDir } from './utils/pathUtils.js';

/** 会话元数据（持久化到 JSON 头部） */
export interface SessionMeta {
  user_id: string;
  session_id: string;
  created_at?: string;
  updated_at?: string;
}

/** 会话文件完整结构 */
export interface SessionFile {
  user_id: string;
  session_id: string;
  created_at?: string;
  updated_at?: string;
  messages: Record<string, unknown>[]; // toDict() 输出，JSON 反序列化后是普通对象
}

// ---------- 路径工具 ----------

/** 项目下会话根目录：.front/sessions */
function getSessionRoot(): string {
  return path.join(getCurrentWorkingDir(), '.front', 'sessions');
}

/** 单个会话文件路径：.front/sessions/<user_id>/<session_id>.json */
export function getSessionFilePath(userId: string, sessionId: string): string {
  return path.join(getSessionRoot(), userId, `${sessionId}.json`);
}

// ---------- 序列化 / 反序列化 ----------

/**
 * 将消息实例数组序列化并写入 JSON 文件
 * - 调用每个消息的 .toDict() 输出标准 StoredMessage 格式
 * - 自动创建目录；写入失败抛异常
 */
export function saveMessagesToFile(
  filePath: string,
  messages: BaseMessage[],
  meta: SessionMeta,
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const now = new Date().toISOString();
  const sessionFile: SessionFile = {
    ...meta,
    created_at: meta.created_at ?? now,
    updated_at: now,
    messages: messages.map((m) => m.toDict()),
  };
  fs.writeFileSync(filePath, JSON.stringify(sessionFile, null, 2), 'utf-8');
}

/**
 * 从 JSON 文件读取并还原为 LangChain 消息实例数组
 * - 使用 coerceMessageLikeToMessage() 还原每个 toDict() 输出的消息
 * - 文件不存在 → 返回 { meta: null, messages: [] }
 * - 解析失败 → 打印警告并返回 { meta: null, messages: [] }
 */
export function loadMessagesFromFile(filePath: string): {
  meta: SessionMeta | null;
  messages: BaseMessage[];
} {
  if (!fs.existsSync(filePath)) {
    return { meta: null, messages: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    const sessionFile: SessionFile = JSON.parse(raw);
    const meta: SessionMeta = {
      user_id: sessionFile.user_id,
      session_id: sessionFile.session_id,
      created_at: sessionFile.created_at,
      updated_at: sessionFile.updated_at,
    };
    // coerceMessageLikeToMessage() 支持 { type, data } 格式还原
    const messages = (sessionFile.messages ?? []).map((m) =>
      coerceMessageLikeToMessage(m),
    );
    return { meta, messages };
  } catch (e: any) {
    console.warn(`会话文件解析失败: ${filePath}（${e.message}），按空会话处理`);
    return { meta: null, messages: [] };
  }
}

// ---------- 辅助函数 ----------

/** 生成新的 session_id（基于时间戳） */
export function newSessionId(): string {
  return `s_${Date.now()}`;
}
```

#### 使用示例

```ts
import { saveMessagesToFile, loadMessagesFromFile, getSessionFilePath } from './session.js';
import { buildSystemMessage, buildHumanMessage } from './messages.js';

// 写会话
const messages = [
  buildSystemMessage('你是 AI 助手'),
  buildHumanMessage({ text: '你好' }),
];
const filePath = getSessionFilePath('lxh', 'default');
saveMessagesToFile(filePath, messages, { user_id: 'lxh', session_id: 'default' });

// 读会话
const { meta, messages: restored } = loadMessagesFromFile(filePath);
// restored 是 BaseMessage[]，可直接 model.invoke(restored)
console.log(`用户 ${meta?.user_id}，历史 ${restored.length} 条`);
```

### 3.2 `src/lc/prompts.ts`

```typescript
import { BaseMessage } from '@langchain/core/messages';
import { AIMessage } from '@langchain/core/messages';
import { buildHumanMessage, buildSystemMessage } from './messages.js';

// Phase 1 占位系统提示
const PLACEHOLDER_SYSTEM_PROMPT = `你是一个友好的 AI 助手。`;

// Phase 2/3 在这里读取 skills 摘要，先返回空数组占位
function buildSkillMessages(): BaseMessage[] {
  // TODO: Phase 3 接入 skills 时实现
  return [];
}

/**
 * 拼装本轮对话要发给模型的完整消息列表
 * - 入参 history 是已经从 session 文件还原的 BaseMessage[]，无需再做转换
 */
export function buildTurnMessages(
  history: BaseMessage[],
  userInput: string,
): BaseMessage[] {
  const messages: BaseMessage[] = [];

  // 1. 系统消息
  messages.push(buildSystemMessage(PLACEHOLDER_SYSTEM_PROMPT));

  // 2. skills 占位（Phase 3 接入）
  messages.push(...buildSkillMessages());

  // 3. 历史消息（已经是 BaseMessage 实例）
  messages.push(...history);

  // 4. 当前用户输入
  messages.push(buildHumanMessage({ text: userInput }));

  return messages;
}
```

### 3.3 `src/lc/app.ts`（启动入口）

```typescript
#!/usr/bin/env node
// 基础对话链路启动入口
import { input } from '@inquirer/prompts';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { getModelConfig } from './config.js';
import { createChatModel, getMessageText } from './model.js';
import {
  saveMessagesToFile,
  loadMessagesFromFile,
  getSessionFilePath,
  type SessionMeta,
} from './session.js';
import { buildTurnMessages } from './prompts.js';

const SESSION_ID = 'default';

async function main() {
  // 1. 加载配置 + 会话
  const config = getModelConfig();
  const userId = config.userId;
  const filePath = getSessionFilePath(userId, SESSION_ID);

  const { meta, messages: history } = loadMessagesFromFile(filePath);
  const created_at = meta?.created_at ?? new Date().toISOString();
  console.log(`已加载会话: user=${userId}, session=${SESSION_ID}, 历史 ${history.length} 条`);

  // 2. 创建模型（Phase 1 走非流式，后续可改流式）
  const model = createChatModel({ temperature: 0.7 });

  // 3. 对话循环
  while (true) {
    const userInput = (await input({ message: '问：' })).trim();
    if (!userInput) continue;
    if (userInput === 'exit' || userInput === 'quit') break;

    // 拼装本轮消息（直接基于 BaseMessage[]，不再转 legacy 格式）
    const lcMessages = buildTurnMessages(history, userInput);

    // 调用模型
    const response = await model.invoke(lcMessages);
    const reply = getMessageText(response);

    console.log(`AI: ${reply}`);

    // 更新内存中的消息历史（追加本轮的 user + ai）
    history.push(new HumanMessage(userInput));
    history.push(new AIMessage(reply));

    // 落盘
    const metaToSave: SessionMeta = {
      user_id: userId,
      session_id: SESSION_ID,
      created_at,
    };
    saveMessagesToFile(filePath, history, metaToSave);
  }

  console.log('对话结束，会话已保存');
}

main().catch((e) => {
  console.error('运行出错:', e);
  process.exit(1);
});
```

---

## 四、执行清单（按顺序）

1. 新建 `src/lc/session.ts`
   - 导出：`SessionMeta`、`SessionFile`、`getSessionFilePath`、`saveMessagesToFile`、`loadMessagesFromFile`、`newSessionId`
   - 使用 `toDict()` / `coerceMessageLikeToMessage()` 原生序列化
2. 完善 `src/lc/prompts.ts`
   - 删除原占位注释
   - 实现 `buildTurnMessages(history: BaseMessage[], userInput: string)`
   - 保留 `buildSkillMessages()` 占位（返回空数组）
3. 新建 `src/lc/app.ts`
   - 加载会话 → inquirer 循环 → 调模型 → 追加消息 → 存会话
   - 退出命令：`exit` / `quit`
4. 在 `package.json` 加脚本：`"lc": "tsx ./src/lc/app.ts"`
5. 运行 `npm run typecheck` 确保 TS 编译通过
6. 运行 `npm run lc`，手动验证：
   - 输入「你好」→ 收到回复
   - 输入「exit」→ 退出
   - 检查 `.front/sessions/<user_id>/default.json` 已生成（messages 元素是 `{ type, data }` 格式）
   - 再次 `npm run lc` → 提示「历史 N 条」→ 接着聊能延续上下文
7. 跑一次 `npm run smoke` 确认未破坏现有自检

---

## 五、风险点与回滚

| 风险 | 应对 |
|------|------|
| `coerceMessageLikeToMessage` 对未知 type 抛错 | 解析失败整体兜底为 `[]`，不阻塞启动 |
| 老版本自定义格式 JSON 无法读取 | 现状没有旧数据；如果将来有，写一次迁移脚本把 `{ role, content }` 转 `{ type: "human"\|"ai", data: { content } }` |
| 多模态 content 数组过大 | 写入前不动 content，由 messages.ts 构建时控制；模型调用方按 token 上限自行处理 |
| `created_at` 在每次 save 被刷新 | 已通过 `created_at: meta.created_at ?? now` 避免覆盖，保持首创建时间 |

---

## 六、不在本次范围内

- 工具循环（`engine.ts`）→ 单独 Phase
- skills 摘要拼接 → 已在 `prompts.ts` 预留 `buildSkillMessages()` 占位
- 多模态图片 → `messages.ts` 的 `buildHumanMessage` 已支持，本次只在协议层支持落盘，不做交互
- 流式输出 → 第一版用非流式，简单稳
- RAG → 不动
- 与 `src/app.js` legacy 入口的切换 → 单独 Phase
- 旧版本自定义 JSON 格式迁移 → 当前无历史数据，未做迁移工具
