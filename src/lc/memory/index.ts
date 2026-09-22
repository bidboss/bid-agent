// 记忆模块对外统一出口
// 业务代码只 import 此文件，不直接依赖子模块内部实现

export {
  loadMemory,
  saveMemory,
  loadAllMemory,
  appendMemorySection,
} from './store.ts';
export type { LongTermMemory, MemoryScope, MergedMemory } from './type.ts';

export {
  indexMemoryChunk,
  searchMemory,
} from './vector.ts';
export type { MemoryHit } from './type.ts';

export { renderMemoryPrompt } from './prompt.ts';

export { trimMessages, estimateTokens } from './window.ts';
export type { TrimOptions } from './type.ts';
