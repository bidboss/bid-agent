// write_file 工具：写入文件内容，支持自动创建目录
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const schema = z.object({
  file_path: z.string().describe('目标文件路径（绝对或相对路径）'),
  content: z.string().describe('要写入的完整内容'),
});

async function execute(args: z.infer<typeof schema>) {
  const { file_path, content } = args;
  const resolvedPath = path.resolve(file_path);

  try {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, content, 'utf-8');
    return { success: true, content: `文件写入成功: ${resolvedPath}` };
  } catch (e: any) {
    return { success: false, content: '', error: `文件写入失败: ${e.message}` };
  }
}

export default {
  name: 'write_file',
  description: '将 content 写入 file_path。如果目录不存在则自动递归创建，如果文件已存在则覆盖。',
  schema,
  execute,
};
