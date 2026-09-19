// 长期记忆的向量存储
// LanceDB 同库不同表：memory_embeddings 与 Phase 5 文档库的 doc_embeddings 共用
// .front/lancedb-data/，但表名隔离
//
// 设计要点：
// - 嵌入未配置时（embedding 为 null）所有写入与检索静默降级为 no-op
// - first write 自动 createTable
// - searchMemory 缺表时返回空数组，不抛错

import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import { getCurrentWorkingDir } from '../utils/pathUtils.ts';
import { getModelConfig } from '../config.ts';
import OpenAI from 'openai';

const TABLE = 'memory_embeddings';

function getDbPath() {
  return path.join(getCurrentWorkingDir(), '.front', 'lancedb-data');
}

// 调用模型把文本转成向量；未配置时返回 null（不抛错）
async function getEmbedding(text: string): Promise<number[] | null> {
  const cfg = getModelConfig().embedding;
  if (!cfg) return null;
  try {
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
    const resp = await client.embeddings.create({ model: cfg.model, input: text });
    return resp.data[0].embedding;
  } catch (e: any) {
    console.warn(`[memory] embedding 调用失败: ${e.message ?? e}`);
    return null;
  }
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function indexMemoryChunk(
  scope: 'project' | 'user',
  text: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const vec = await getEmbedding(text);
  if (!vec) return;
  const db = await lancedb.connect(getDbPath());
  const record = { id: genId(), scope, text, vector: vec, ...metadata };
  try {
    const table = await db.openTable(TABLE);
    await table.add([record]);
  } catch {
    // 表不存在则创建
    await db.createTable(TABLE, [record]);
  }
}

export async function searchMemory(
  query: string,
  limit = 4,
  scope: 'project' | 'user' | 'all' = 'all',
): Promise<{ text: string; score: number; scope: string }[]> {
  const vec = await getEmbedding(query);
  if (!vec) return [];

  const db = await lancedb.connect(getDbPath());
  let table;
  try {
    table = await db.openTable(TABLE);
  } catch {
    return [];
  }

  let q: any = table.vectorSearch(vec).limit(limit);
  if (scope !== 'all') q = q.where(`scope = '${scope}'`);

  // LanceDB 的 execute() 在不同版本里可能返回 Array 或 AsyncIterable
  // 兼容三种情况：直接数组 / AsyncIterable / Iterable
  const result: any = await (q as any).execute();
  let rows: any[] = [];
  if (Array.isArray(result)) {
    rows = result;
  } else if (result && typeof result[Symbol.asyncIterator] === 'function') {
    for await (const r of result) rows.push(r);
  } else if (result && typeof result[Symbol.iterator] === 'function') {
    for (const r of result) rows.push(r);
  } else {
    return [];
  }

  return rows.map((r: any) => ({
    text: r.text ?? '',
    score: r._distance ?? 0,
    scope: r.scope,
  }));
}
