// glob 工具：按 glob 模式查找文件路径
import fs from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';
import { z } from 'zod';

const MAX_RESULTS = 1000;

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', '.next', '.nuxt',
  'coverage', '.cache', '.output',
]);

function* walkDir(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        yield* walkDir(path.join(dir, entry.name));
      }
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name);
    }
  }
}

const schema = z.object({
  pattern: z.string().describe("glob 匹配模式，如 '*.js'、'src/**/*.ts'"),
  search_path: z.string().optional().describe('搜索根目录，默认为当前工作目录'),
});

async function execute(args: z.infer<typeof schema>) {
  const { pattern, search_path } = args;
  const root = search_path ? path.resolve(search_path) : process.cwd();

  if (!fs.existsSync(root)) {
    return { success: false, content: '', error: `搜索路径不存在: ${root}` };
  }
  if (!fs.statSync(root).isDirectory()) {
    return { success: false, content: '', error: `搜索路径不是目录: ${root}` };
  }

  const matches: string[] = [];
  try {
    for (const filePath of walkDir(root)) {
      const relativePath = path.relative(root, filePath);
      if (minimatch(relativePath, pattern, { matchBase: true })) {
        matches.push(relativePath);
        if (matches.length >= MAX_RESULTS) break;
      }
    }
  } catch (e: any) {
    return { success: false, content: '', error: `搜索出错: ${e.message}` };
  }

  if (matches.length === 0) {
    return { success: true, content: `未找到匹配 '${pattern}' 的文件。` };
  }

  const truncated = matches.length >= MAX_RESULTS
    ? `（结果已截断，最多返回 ${MAX_RESULTS} 条）`
    : '';
  return { success: true, content: `找到 ${matches.length} 个匹配文件${truncated}：\n${matches.join('\n')}` };
}

export default {
  name: 'glob',
  description: "根据 glob 模式查找文件路径列表。当需要查看项目结构、寻找相关文件时使用此工具，不要用 bash 工具替代。",
  schema,
  execute,
};
