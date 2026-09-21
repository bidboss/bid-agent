// 项目文件与设计图扫描、筛选、标签解析、内容附件

import fs from 'fs';
import path from 'path';
import { getCurrentWorkingDir } from '../utils/pathUtils.ts';
import type { ContentItem } from '../messages.ts';

const excludeDirs = ['node_modules', '.git', '.front', '.claude', 'dist', 'build'];
const excludeFiles = ['.DS_Store', 'Thumbs.db'];
const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];

// 递归扫描目录获取所有文件（相对路径，使用正斜杠）
export function scanProjectFiles(dir: string = getCurrentWorkingDir(), baseDir: string | null = null): string[] {
  if (!baseDir) baseDir = dir;
  const results: string[] = [];

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      if (excludeDirs.includes(item.name)) continue;
      if (excludeFiles.includes(item.name)) continue;

      const fullPath = path.join(dir, item.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (item.isDirectory()) {
        results.push(...scanProjectFiles(fullPath, baseDir));
      } else {
        results.push(relativePath.replace(/\\/g, '/'));
      }
    }
  } catch {
    // 忽略无法访问的目录
  }

  return results;
}

// 模糊筛选文件列表（忽略大小写）
export function filterFiles(files: string[], query: string): string[] {
  if (!query) return files;
  const lowerQuery = query.toLowerCase();
  return files.filter((file) => file.toLowerCase().includes(lowerQuery));
}

// 读取文件内容；读取失败返回占位字符串以避免阻塞流程
export function readFileContent(filepath: string): string {
  try {
    const fullPath = path.resolve(getCurrentWorkingDir(), filepath);
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return `[无法读取文件: ${filepath}]`;
  }
}

// 解析输入中的 @[filename] 标记，返回文件名列表
export function parseFileTags(input: string): string[] {
  const tagRegex = /@\[([^\]]+)\]/g;
  const files: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(input)) !== null) {
    files.push(match[1]);
  }
  return files;
}

// 把 @[file] 标记的文件内容追加到消息末尾
export function attachFilesToMessage(input: string): string {
  const files = parseFileTags(input);
  if (files.length === 0) return input;

  let result = input;
  result += '\n\n--- 附加文件内容 ---';

  for (const file of files) {
    const content = readFileContent(file);
    result += `\n\n## ${file}\n\`\`\`\n${content}\n\`\`\``;
  }

  return result;
}

// 扫描 .front/design 目录下的图片文件名列表
export function scanDesignImages(): string[] {
  const designDir = path.join(getCurrentWorkingDir(), '.front', 'design');
  if (!fs.existsSync(designDir)) return [];

  try {
    return fs
      .readdirSync(designDir, { withFileTypes: true })
      .filter((item) => item.isFile() && imageExts.includes(path.extname(item.name).toLowerCase()))
      .map((item) => item.name);
  } catch {
    return [];
  }
}

// 模糊筛选图片列表（忽略大小写）
export function filterImages(images: string[], query: string): string[] {
  if (!query) return images;
  const lowerQuery = query.toLowerCase();
  return images.filter((img) => img.toLowerCase().includes(lowerQuery));
}

// 解析输入中的 #[filename] 图片标记，返回图片文件名列表
export function parseImageTags(input: string): string[] {
  const tagRegex = /#\[([^\]]+)\]/g;
  const images: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(input)) !== null) {
    images.push(match[1]);
  }
  return images;
}

// 移除输入中的 #[filename] 图片标记（保留其他文字）
export function removeImageTags(input: string): string {
  return input.replace(/#\[([^\]]+)\]\s?/g, '').trim();
}

// 根据图片文件名获取 .front/design 下的绝对路径
export function getDesignImagePath(imageName: string): string {
  return path.join(getCurrentWorkingDir(), '.front', 'design', imageName);
}

// mime 类型推断（基于扩展名）
function inferMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

// 把输入中的 #[img] 标记展开为：
// - text：剥离图片标记后的纯文本
// - images：data:image/...;base64,... URL 列表（每张图一个），缺失文件时返回空数组
// 与 attachFilesToMessage 不同：图片走 vision 通道，必须以 image_url 形式传给模型。
export function attachImagesToMessage(input: string): { text: string; images: string[] } {
  const tags = parseImageTags(input);
  const text = removeImageTags(input);
  const images: string[] = [];

  for (const tag of tags) {
    const abs = getDesignImagePath(tag);
    if (!fs.existsSync(abs)) continue;
    try {
      const buf = fs.readFileSync(abs);
      const mime = inferMimeType(tag);
      images.push(`data:${mime};base64,${buf.toString('base64')}`);
    } catch {
      // 单张图片读取失败不影响整体
    }
  }

  return { text, images };
}

/**
 * 把多个附件文件路径展开为多个独立的 text content block。
 * 每个文件一个 block（## filename + 代码块），与图片 attachment 的独立 block 风格一致。
 * 用于 prompts.buildSendMessages：让附件以多 content block 形式传给模型，而不是
 * 把所有文件拼到一个 text 里。
 */
export function buildFileContentBlocks(filePaths: string[]): ContentItem[] {
  const blocks: ContentItem[] = [];
  for (const file of filePaths) {
    const content = readFileContent(file);
    blocks.push({ type: 'text', text: `## ${file}\n\`\`\`\n${content}\n\`\`\`` });
  }
  return blocks;
}
