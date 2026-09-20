// 知识库检索：将 query 转为向量，在 kb_embeddings 表中检索 top-K
//
// 职责：
// - 将 query 转为向量
// - 在 kb_embeddings 表中检索 top-K
// - 返回检索结果
//
// 关键设计：
// - 兼容 LanceDB 不同版本返回值（Array / AsyncIterable / Iterable）
// - 无表 / 无 embedding 时返回空数组

import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import { getModelConfig } from '../config.ts';
import { getCurrentWorkingDir } from '../utils/pathUtils.ts';
import OpenAI from 'openai';
import type { KbHit } from './type.ts';

const TABLE = 'kb_embeddings';

function getDbPath(): string {
  return path.join(getCurrentWorkingDir(), '.front', 'lancedb-data');
}

// 调用 embedding 网关将文本转为向量；未配置时返回 null
async function getEmbedding(text: string): Promise<number[] | null> {
  const cfg = getModelConfig().embedding;
  if (!cfg) return null;
  try {
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
    const resp = await client.embeddings.create({ model: cfg.model, input: text });
    return resp.data[0].embedding;
  } catch (e: any) {
    console.warn(`[kb] embedding 调用失败: ${e.message ?? e}`);
    return null;
  }
}

// 兼容 LanceDB execute() 的三种返回值
async function executeQuery(q: any): Promise<any[]> {
  const result = await q.execute();
  if (Array.isArray(result)) return result;
  if (result && typeof result[Symbol.asyncIterator] === 'function') {
    const rows: any[] = [];
    for await (const r of result) rows.push(r);
    return rows;
  }
  if (result && typeof result[Symbol.iterator] === 'function') {
    return Array.from(result);
  }
  return [];
}

// 检索知识库
export async function searchKb(query: string, limit = 4): Promise<KbHit[]> {
  const vec = await getEmbedding(query);
  if (!vec) return [];

  const dbPath = getDbPath();
  const db = await lancedb.connect(dbPath);

  let table;
  try {
    table = await db.openTable(TABLE);
  } catch {
    return [];
  }

  const q = table.vectorSearch(vec).limit(limit);
  const rows = await executeQuery(q);

  return rows.map((r: any) => ({
    text: r.text ?? '',
    path: r.path ?? '',
    score: r._distance ?? 0,
  }));
}
