// 记忆体系类型定义

export type MemoryScope = 'project' | 'user';

export interface LongTermMemory {
  project: string;
  user: string;
}

// 向量记忆命中
export interface MemoryHit {
  text: string;
  score: number;
  scope: MemoryScope;
}

// /memory 合并后的产物
export interface MergedMemory {
  projectMemory: string;
  userMemory: string;
}

// memory_save 工具入参
export interface SaveMemoryArgs {
  scope: MemoryScope;
  section: string;
  body: string;
}

// memory_get 工具入参
export interface GetMemoryArgs {
  query?: string;
}

// 短期记忆窗口配置
export interface TrimOptions {
  maxTokens: number;
  summarizer: (messages: Array<{ role: string; content: string }>) => Promise<string>;
}
