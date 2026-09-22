// 记忆的获取 和 写入

import fs from 'fs';
import path from 'path';
import { getCurrentWorkingDir, getUserHomeDir } from '../utils/pathUtils.ts';

function getMemoryPath(scope: 'project' | 'user'): string {
  const base = scope === 'project' ? getCurrentWorkingDir() : getUserHomeDir();
  const dir = path.join(base, '.front', 'memory');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'memory.md');
}

export function loadMemory(scope: 'project' | 'user'): string {
  const p = getMemoryPath(scope);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf-8').replace(/^\uFEFF/, '');
}

export function saveMemory(scope: 'project' | 'user', content: string): void {
  const p = getMemoryPath(scope);
  fs.writeFileSync(p, content, 'utf-8');
}

export function appendMemorySection(
  scope: 'project' | 'user',
  section: string,
  body: string,
): void {
  const existing = loadMemory(scope);
  const block = `\n${section}\n${body}\n`;
  saveMemory(scope, existing + block);
}

export function loadAllMemory() {
  return { project: loadMemory('project'), user: loadMemory('user') };
}