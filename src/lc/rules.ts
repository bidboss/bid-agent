// Rules 体系：扫描 .front/rules/*.md，按 paths 匹配注入提示词

import fs from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';
import { getCurrentWorkingDir, getUserHomeDir } from './utils/pathUtils.ts';

export interface RuleDoc {
  id: string;
  patterns: string[];
  content: string;
  body: string;
  filePath: string;
  source: 'user' | 'project';
}

// 解析 Rule.md 顶部 frontmatter，提取 paths 数组
function parsePaths(content: string): string[] {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!match) return [];
  const fmBlock = match[1];

  const pathsBlockMatch = fmBlock.match(/^paths:\s*\n((?:\s*-\s*.+\n?)+)/m);
  if (!pathsBlockMatch) return [];

  const items: string[] = [];
  const lineRegex = /^\s*-\s*["']?([^"'\n]+)["']?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(pathsBlockMatch[1])) !== null) {
    items.push(m[1].trim());
  }
  return items;
}

// 去掉 frontmatter 后剩下的正文
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  if (!match) return content;
  return content.slice(match[0].length);
}

// 从指定目录下扫描规则文件
function loadRulesFromDir(dirPath: string, source: 'user' | 'project'): RuleDoc[] {
  if (!fs.existsSync(dirPath)) return [];
  const out: RuleDoc[] = [];
  const entries = fs.readdirSync(dirPath);

  for (const entry of entries) {
    const filePath = path.join(dirPath, entry);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (!/\.(md|markdown)$/i.test(entry)) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (e: any) {
      console.warn(`[rules] 读取失败: ${filePath}（${e.message ?? e}）`);
      continue;
    }

    out.push({
      id: entry,
      patterns: parsePaths(content),
      content,
      body: stripFrontmatter(content),
      filePath,
      source,
    });
  }

  return out;
}

// 扫描 user + project 两层 rules 目录，返回全量 rule 列表
export function scanRules(): RuleDoc[] {
  const userDir = path.join(getUserHomeDir(), '.front', 'rules');
  const projectDir = path.join(getCurrentWorkingDir(), '.front', 'rules');

  const userRules = loadRulesFromDir(userDir, 'user');
  const projectRules = loadRulesFromDir(projectDir, 'project');

  const merged: RuleDoc[] = [...userRules];
  for (const pr of projectRules) {
    const idx = merged.findIndex((r) => r.id === pr.id);
    if (idx >= 0) merged[idx] = pr;
    else merged.push(pr);
  }
  return merged;
}

// 从用户输入文本中提取的被@的文件列表
export function parseFileTagsFromInput(input: string): string[] {
  const tagRegex = /@\[([^\]]+)\]/g;
  const files: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(input)) !== null) {
    files.push(m[1]);
  }
  return files;
}

// 根据文件列表（被@的文件）匹配对应的规则，将所有规则拼接成字符串后返回
export function matchRulesForFiles(files: string[], rules?: RuleDoc[]): string {
  if (files.length === 0) return '';
  const ruleDocs = rules ?? scanRules();

  const matched: { body: string; filePath: string }[] = [];
  const usedIds = new Set<string>();

  for (const file of files) {
    for (const doc of ruleDocs) {
      if (usedIds.has(doc.id)) continue;
      const hit = doc.patterns.some((pattern) => minimatch(file, pattern));
      if (hit) {
        matched.push({ body: doc.body, filePath: doc.filePath });
        usedIds.add(doc.id);
        break;
      }
    }
  }

  if (matched.length === 0) return '';

  return matched
    .map((m) => `<!-- rule file: ${m.filePath} -->\n${m.body.trim()}`)
    .join('\n\n');
}
