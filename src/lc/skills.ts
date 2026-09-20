// Skill 体系：扫描 .front/skills/*/SKILL.md，构造摘要 / 全文
// 设计要点：
// - 启动时调用 scanSkills()，注入摘要到 system 末尾（tier=1）
// - 模型按需通过 loadSkillFull(name) 加载完整内容
// - 用户级 skills 与项目级 skills 同时扫描，项目级同名覆盖用户级
//
// SKILL.md 格式：
// ---
// name: <skill 名>
// preamble-tier: 1
// version: 1.0.0
// description: 一句话描述
// triggers:
//   - 触发关键词
// allowed-tools:
//   - 工具名
// ---
// 正文…

import fs from 'fs';
import path from 'path';
import { getCurrentWorkingDir, getUserHomeDir } from './utils/pathUtils.ts';

/**
 * Skill 摘要注入模板（与 legacy 的 skillTemplate.md 等价）
 * 模型按需调用 skill_load 工具加载完整内容
 */
const SKILL_INJECTION_TEMPLATE = `当前有如下 skill，当用户的提问需要使用某个 skill 时，使用 skill 工具加载 skill 的详情
${'${skillcontent}'}`;

export interface SkillSummary {
  /** 唯一标识（对应 frontmatter 的 name 字段） */
  name: string;
  /** 版本号（frontmatter 的 version） */
  version: string;
  /** 一句话描述 */
  description: string;
  /** 摘要注入层级：1 = 默认注入，>1 = 按需加载 */
  preambleTier: number;
  /** 触发关键词列表（frontmatter 的 triggers） */
  triggers: string[];
  /** 允许使用的工具列表（frontmatter 的 allowed-tools） */
  allowedTools: string[];
  /** SKILL.md 的绝对路径，便于模型按需加载全文 */
  filePath: string;
  /** 来源：user（~/.front/skills）或 project（.front/skills） */
  source: 'user' | 'project';
}

/** 解析 SKILL.md 顶部的 YAML frontmatter（仅支持本项目用到的扁平字段） */
function parseFrontmatter(content: string): Record<string, string | string[]> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!match) return {};

  const raw = match[1];
  const result: Record<string, string | string[]> = {};

  // 单行标量字段：key: value
  const scalarRegex = /^([A-Za-z_-][A-Za-z0-9_-]*):\s*(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  const arrayKeys = new Set<string>();
  const arrayRegex = /^([A-Za-z_-][A-Za-z0-9_-]*):\s*$/gm;

  while ((m = scalarRegex.exec(raw)) !== null) {
    const key = m[1];
    const value = m[2];
    result[key] = value;
  }

  while ((m = arrayRegex.exec(raw)) !== null) {
    arrayKeys.add(m[1]);
    delete result[m[1]];
  }

  // 数组字段：key:\n  - item
  for (const key of arrayKeys) {
    const arrayBlockRegex = new RegExp(
      `^${key}:\\s*\\n((?:\\s*-\\s*.+\\n?)+)`,
      'gm',
    );
    const blockMatch = arrayBlockRegex.exec(raw);
    if (blockMatch) {
      const items = blockMatch[1]
        .split('\n')
        .map((line) => line.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean);
      result[key] = items;
    }
  }

  return result;
}

/** 从指定目录下扫描所有 *\/SKILL.md，返回该层级的 skills 列表 */
function loadSkillsFromDir(dirPath: string, source: 'user' | 'project'): SkillSummary[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath);
  const out: SkillSummary[] = [];

  for (const entry of entries) {
    const dirEntry = path.join(dirPath, entry);
    let stat;
    try {
      stat = fs.statSync(dirEntry);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const skillMdPath = path.join(dirEntry, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(skillMdPath, 'utf-8');
    } catch (e: any) {
      console.warn(`[skills] 读取失败: ${skillMdPath}（${e.message ?? e}）`);
      continue;
    }

    const fm = parseFrontmatter(content);
    const name = typeof fm.name === 'string' ? fm.name : entry;
    const version = typeof fm.version === 'string' ? fm.version : '0.0.0';
    const description = typeof fm.description === 'string' ? fm.description : '';
    const preambleTier = typeof fm['preamble-tier'] === 'string'
      ? Number(fm['preamble-tier']) || 1
      : 1;
    const triggers = Array.isArray(fm.triggers) ? fm.triggers : [];
    const allowedTools = Array.isArray(fm['allowed-tools']) ? fm['allowed-tools'] : [];

    out.push({
      name,
      version,
      description,
      preambleTier,
      triggers,
      allowedTools,
      filePath: skillMdPath,
      source,
    });
  }

  return out;
}

/**
 * 扫描 user + project 两层 skills 目录，返回全量 skill 摘要列表
 * 同名 skill：project 覆盖 user
 * @returns 全量 SkillSummary 列表
 */
export function scanSkills(): SkillSummary[] {
  const userDir = path.join(getUserHomeDir(), '.front', 'skills');
  const projectDir = path.join(getCurrentWorkingDir(), '.front', 'skills');

  const userSkills = loadSkillsFromDir(userDir, 'user');
  const projectSkills = loadSkillsFromDir(projectDir, 'project');

  const merged: SkillSummary[] = [...userSkills];
  const projectNames = new Set(projectSkills.map((s) => s.name));
  for (const ps of projectSkills) {
    const idx = merged.findIndex((s) => s.name === ps.name);
    if (idx >= 0) merged[idx] = ps;
    else merged.push(ps);
  }
  void projectNames; // 保留命名以表达扫描意图
  return merged;
}

/**
 * 按 name 加载某个 skill 的完整 SKILL.md 内容
 * @param name skill 名（对应 frontmatter 的 name 字段）
 * @returns 完整文件内容；找不到返回 null
 */
export function loadSkillFull(name: string): string | null {
  const projectDir = path.join(getCurrentWorkingDir(), '.front', 'skills');
  const userDir = path.join(getUserHomeDir(), '.front', 'skills');

  // 项目级优先
  const projectHit = findSkillFile(projectDir, name);
  if (projectHit) return fs.readFileSync(projectHit, 'utf-8');

  const userHit = findSkillFile(userDir, name);
  if (userHit) return fs.readFileSync(userHit, 'utf-8');

  return null;
}

function findSkillFile(dirPath: string, name: string): string | null {
  if (!fs.existsSync(dirPath)) return null;
  const entries = fs.readdirSync(dirPath);
  for (const entry of entries) {
    const dirEntry = path.join(dirPath, entry);
    let stat;
    try {
      stat = fs.statSync(dirEntry);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const skillMdPath = path.join(dirEntry, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;
    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const fm = parseFrontmatter(content);
      const fmName = typeof fm.name === 'string' ? fm.name : entry;
      if (fmName === name) return skillMdPath;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 用 skillTemplate.md 渲染 skill 摘要列表（与 legacy getSkillHeaders() 行为对齐）
 * 默认只注入 tier=1 的 skill 摘要
 * @param tier 摘要层级阈值，默认 1
 * @returns 渲染后的摘要字符串（无 skill 时返回空串）
 */
export function getSkillSummaryText(tier = 1): string {
  const all = scanSkills();
  const filtered = all.filter((s) => s.preambleTier <= tier);
  if (filtered.length === 0) return '';

  const blocks = filtered
    .map((s) => {
      const triggers = s.triggers.length > 0 ? s.triggers.join('、') : '（无）';
      return [
        `### Skill[${s.name}]`,
        `- 文件地址: ${s.filePath}`,
        `- version: ${s.version}`,
        `- description: ${s.description}`,
        `- triggers: ${triggers}`,
        `- allowed-tools: ${s.allowedTools.join(', ') || '（无）'}`,
        '',
        '> 当用户提问命中触发词时，调用 skill_load 工具加载此 skill 的完整内容。',
      ].join('\n');
    })
    .join('\n\n');

  return SKILL_INJECTION_TEMPLATE.replace('${skillcontent}', blocks);
}
