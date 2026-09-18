import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const schema = z.object({
  file_path: z.string().describe('要读取的文件路径'),
  offset: z.number().int().min(1).optional().default(1).describe('起始行号，从1开始'),
  limit: z.number().int().positive().optional().describe('最多读取行数'),
});

const MAX_READ_SIZE = 1024 * 1024; // 1MB

async function execute(args: z.infer<typeof schema>) {
  const { file_path, offset = 1, limit } = args;
  const resolvedPath = path.resolve(file_path);

  if (!fs.existsSync(resolvedPath)) {
    return { success: false, content: '', error: `文件不存在: ${resolvedPath}` };
  }
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    return { success: false, content: '', error: `路径不是文件: ${resolvedPath}` };
  }
  if (stat.size > MAX_READ_SIZE) {
    return { success: false, content: '', error: `文件超过 ${MAX_READ_SIZE} 字节限制` };
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const startIdx = Math.max(0, offset - 1);
    const endIdx = limit ? Math.min(lines.length, startIdx + limit) : lines.length;
    const selected = lines.slice(startIdx, endIdx);
    const result = selected.map((line, i) => `${offset + i}: ${line}`).join('\n');
    return { success: true, content: result };
  } catch (e: any) {
    return { success: false, content: '', error: e.message };
  }
}

export default { name: 'read_file', description: '读取本地文件内容，支持 offset/limit 分段读取', schema, execute };