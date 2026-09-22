// grep 工具：全局搜索文件内容，支持正则 / glob 过滤 / 上下文输出
import fs from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';
import { z } from 'zod';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_MATCHES = 100;
const MAX_FILES = 500;

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', '.next', '.nuxt',
  'coverage', '.cache', '.output',
]);

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.woff', '.woff2', '.ttf', '.eot',
  '.lock', '.sum',
]);

function isTextFile(filePath: string): boolean {
  return !BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const schema = z.object({
  pattern: z.string().describe('搜索的正则表达式或普通字符串（非法正则自动按字面量转义）'),
  path: z.string().optional().describe('搜索根目录，默认为当前工作目录'),
  glob: z.string().optional().describe("文件过滤模式，如 '*.js'、'src/**/*.ts'"),
  output_mode: z.enum(['files_with_matches', 'content']).optional().default('content')
    .describe("files_with_matches: 仅返回文件路径；content: 返回匹配行及上下文（默认）"),
});

async function execute(args: z.infer<typeof schema>) {
  const { pattern, path: searchPath, glob, output_mode = 'content' } = args;
  const root = searchPath ? path.resolve(searchPath) : process.cwd();

  if (!fs.existsSync(root)) {
    return { success: false, content: '', error: `搜索路径不存在: ${root}` };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'gm');
  } catch {
    regex = new RegExp(escapeRegExp(pattern), 'gm');
  }

  const matches: Array<{ file: string; lines: Array<{ line: number; context: string }> }> = [];
  let filesScanned = 0;

  try {
    for (const filePath of walkDir(root)) {
      if (filesScanned >= MAX_FILES) break;

      if (!isTextFile(filePath)) continue;
      if (glob && !minimatch(filePath, glob, { matchBase: true })) continue;

      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) continue;

      filesScanned++;
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(root, filePath);

      if (output_mode === 'files_with_matches') {
        regex.lastIndex = 0;
        if (regex.test(content)) {
          matches.push({ file: relativePath, lines: [] });
          if (matches.length >= MAX_MATCHES) break;
        }
      } else {
        const lines = content.split(/\r?\n/);
        const matchedLines: Array<{ line: number; context: string }> = [];
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            const start = Math.max(0, i - 1);
            const end = Math.min(lines.length, i + 2);
            matchedLines.push({
              line: i + 1,
              context: lines.slice(start, end).join('\n'),
            });
          }
        }
        if (matchedLines.length > 0) {
          matches.push({ file: relativePath, lines: matchedLines });
          if (matches.length >= MAX_MATCHES) break;
        }
      }
    }
  } catch (e: any) {
    return { success: false, content: '', error: `搜索出错: ${e.message}` };
  }

  if (matches.length === 0) {
    return { success: true, content: `未找到匹配项（已扫描 ${filesScanned} 个文件）。` };
  }

  if (output_mode === 'files_with_matches') {
    return {
      success: true,
      content: `找到 ${matches.length} 个匹配文件（已扫描 ${filesScanned} 个文件）：\n${matches.map(m => m.file).join('\n')}`,
    };
  }

  const parts: string[] = [`找到 ${matches.length} 个文件包含匹配（已扫描 ${filesScanned} 个文件）：`];
  for (const m of matches) {
    parts.push(`\n--- ${m.file} ---`);
    for (const l of m.lines) {
      parts.push(`第 ${l.line} 行:`);
      parts.push(l.context);
    }
  }
  return { success: true, content: parts.join('\n') };
}

export default {
  name: 'grep',
  description: '在项目中全局搜索文件内容，支持正则或字符串匹配，可按 glob 过滤文件类型，自动跳过 node_modules、二进制文件等。进行代码搜索必须使用此工具，禁止用 bash 工具替代。',
  schema,
  execute,
};
