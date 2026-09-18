import fs from 'fs';
import path from 'path';
import {
  BaseMessage,
  type StoredMessage,
  coerceMessageLikeToMessage,
} from '@langchain/core/messages';
import { getCurrentWorkingDir } from './utils/pathUtils.js';

/** 会话元数据（持久化到 JSON 头部） */
export interface SessionMeta {
  user_id: string;
  session_id: string;
  created_at?: string;
  updated_at?: string;
}

/** 会话文件完整结构（磁盘上的形态） */
export interface SessionFile {
  user_id: string;
  session_id: string;
  created_at?: string;
  updated_at?: string;
  // JSON 序列化层用 unknown[]；写入前是 StoredMessage[]，读出后逐项断言成 BaseMessageLike
  messages: StoredMessage[];
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
    const sessionFile = JSON.parse(raw) as SessionFile;
    const meta: SessionMeta = {
      user_id: sessionFile.user_id,
      session_id: sessionFile.session_id,
      created_at: sessionFile.created_at,
      updated_at: sessionFile.updated_at,
    };
    // JSON 反序列化后类型退化为对象，断言成 BaseMessageLike 喂给 coerceMessageLikeToMessage
    const messages = (sessionFile.messages ?? []).map((m) =>
      coerceMessageLikeToMessage(m as unknown as Parameters<typeof coerceMessageLikeToMessage>[0]),
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
