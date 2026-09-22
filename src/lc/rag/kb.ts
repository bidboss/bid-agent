// 知识库索引：扫描 .front/kb/ 目录，切分文本，向量化后存入 LanceDB

import fs from 'fs';
import path from 'path';
import * as lancedb from '@lancedb/lancedb';
import mammoth from 'mammoth';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getModelConfig } from '../config.ts';
import { getUserHomeDir, getCurrentWorkingDir } from '../utils/pathUtils.ts';
import OpenAI from 'openai';

const TABLE = 'kb_embeddings';

const ALLOWED_EXTENSIONS = ['.md', '.txt', '.docx'];

function getFilesFromDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => ALLOWED_EXTENSIONS.includes(path.extname(name).toLowerCase()))
    .map((name) => path.join(dir, name));
}

// 读取文件内容
async function readFileContent(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  return fs.readFileSync(filePath, 'utf-8');
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

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 获取 LanceDB 数据目录
function getDbPath(): string {
  return path.join(getCurrentWorkingDir(), '.front', 'lancedb-data');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 索引单个文件
export async function indexKbFile(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    console.warn(`[kb] 文件不存在: ${filePath}`);
    return 0;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    console.warn(`[kb] 不支持的文件类型: ${ext}`);
    return 0;
  }

  const dbPath = getDbPath();
  const content = await readFileContent(filePath);
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 80 });
  const chunks = await splitter.splitText(content);

  if (chunks.length === 0) return 0;

  const embeddings = await Promise.all(chunks.map((c) => getEmbedding(c)));
  const records: { id: string; text: string; path: string; vector: number[] }[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const vec = embeddings[i];
    if (vec) {
      records.push({ id: genId(), text: chunks[i], path: filePath, vector: vec });
    }
  }

  if (records.length === 0) return 0;

  ensureDir(dbPath);
  const db = await lancedb.connect(dbPath);
  const tableNames = await db.tableNames();

  try {
    if (tableNames.includes(TABLE)) {
      const table = await db.openTable(TABLE);
      await table.add(records);
    } else {
      await db.createTable(TABLE, records);
    }
  } catch (e: any) {
    console.error(`[kb] LanceDB 入库失败: ${e.message ?? e}`);
    return 0;
  }

  return records.length;
}

// 索引单个目录下面所有的文件，返回索引的 chunk 数量
export async function indexKbDirectory(dir: string, dbPath: string): Promise<number> {
  const files = getFilesFromDir(dir);
  if (files.length === 0) return 0;

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 80,
  });

  const fileContents = await Promise.all(
    files.map(async (filePath) => {
      const content = await readFileContent(filePath);
      return { path: filePath, content };
    }),
  );

  // 切分所有文档
  const allChunks: { text: string; path: string }[] = [];
  for (const file of fileContents) {
    const chunks = await splitter.splitText(file.content);
    for (const chunk of chunks) {
      allChunks.push({ text: chunk, path: file.path });
    }
  }

  if (allChunks.length === 0) return 0;

  // 并行获取所有 embedding
  const embeddings = await Promise.all(allChunks.map((c) => getEmbedding(c.text)));

  // 过滤掉获取失败的（返回 null 的）
  const records: { id: string; text: string; path: string; vector: number[] }[] = [];
  for (let i = 0; i < allChunks.length; i++) {
    const vec = embeddings[i];
    if (vec) {
      records.push({ id: genId(), text: allChunks[i].text, path: allChunks[i].path, vector: vec });
    }
  }

  if (records.length === 0) {
    console.warn(`[kb] 未能生成任何有效的 embedding，跳过入库`);
    return 0;
  }

  // 存储到 LanceDB
  ensureDir(dbPath);
  const db = await lancedb.connect(dbPath);
  const tableNames = await db.tableNames();

  try {
    if (tableNames.includes(TABLE)) {
      const table = await db.openTable(TABLE);
      await table.add(records);
    } else {
      await db.createTable(TABLE, records);
    }
  } catch (e: any) {
    console.error(`[kb] LanceDB 入库失败: ${e.message ?? e}`);
    return 0;
  }

  return records.length;
}

// 索引所有知识库目录（用户级 + 项目级）
export async function indexAllKbDirectories(): Promise<{ user: number; project: number }> {
  const userHomeDir = getUserHomeDir();
  const currentDir = getCurrentWorkingDir();
  const dbPath = getDbPath();

  const userKbDir = path.join(userHomeDir, '.front', 'kb');
  const projectKbDir = path.join(currentDir, '.front', 'kb');

  const [userCount, projectCount] = await Promise.all([
    indexKbDirectory(userKbDir, dbPath),
    indexKbDirectory(projectKbDir, dbPath),
  ]);

  return { user: userCount, project: projectCount };
}