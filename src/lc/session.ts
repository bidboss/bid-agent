import fs from 'fs';
import path from 'path';
import {
  BaseMessage,
  type StoredMessage,
  coerceMessageLikeToMessage,
} from '@langchain/core/messages';
import { getCurrentWorkingDir } from './utils/pathUtils.js';

export interface SessionMeta {
  user_id: string;
  session_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface SessionFile {
  user_id: string;
  session_id: string;
  created_at?: string;
  updated_at?: string;
  messages: StoredMessage[];
}

function getSessionRoot(): string {
  return path.join(getCurrentWorkingDir(), '.front', 'sessions');
}

export function getSessionFilePath(userId: string, sessionId: string): string {
  return path.join(getSessionRoot(), userId, `${sessionId}.json`);
}

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
    // 逐条还原：toDict() 输出 { type, data }，coerceMessageLikeToMessage 要求扁平格式，
    // 所以把 data 展开到顶层，再用 coerceMessageLikeToMessage 还原为正确的 LangChain 消息实例
    const messages = (sessionFile.messages ?? []).map((stored) => {
      const flat = { type: stored.type, ...(stored.data ?? {}) };
      return coerceMessageLikeToMessage(flat as Parameters<typeof coerceMessageLikeToMessage>[0]);
    });
    return { meta, messages };
  } catch (e: any) {
    console.warn(`会话文件解析失败: ${filePath}（${e.message}），按空会话处理`);
    return { meta: null, messages: [] };
  }
}

// 生成新的 session_id
export function newSessionId(): string {
  return `s_${Date.now()}`;
}
