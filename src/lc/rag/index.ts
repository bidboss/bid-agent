// RAG 模块对外统一出口
// 业务代码只 import 此文件，不直接依赖子模块内部实现

export { indexKbDirectory, indexKbFile, indexAllKbDirectories } from './kb.ts';
export { searchKb } from './search.ts';
export { renderKbRagTemplate } from './template.ts';
export type { KbHit } from './type.ts';
