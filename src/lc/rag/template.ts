// RAG 模板渲染：将检索结果格式化
//
// 使用现有 src/docs/ragTemplate.md 模板，将检索结果格式化

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { KbHit } from './type.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 默认模板
const DEFAULT_TEMPLATE = `用户有如下参考资料提供到
\${ragContent}`;

// 渲染 RAG 模板
export function renderKbRagTemplate(hits: KbHit[]): string {
  if (hits.length === 0) return '';

  // 尝试读取现有模板
  const templatePath = path.join(__dirname, '../..', 'docs', 'ragTemplate.md');
  let template = DEFAULT_TEMPLATE;

  if (fs.existsSync(templatePath)) {
    try {
      template = fs.readFileSync(templatePath, 'utf-8').replace(/^\uFEFF/, '');
    } catch {
      // 使用默认模板
    }
  }

  // 格式化检索结果
  const ragContent = hits
    .map((h, i) => `[知识库${i + 1}] (来源: ${h.path}, 相似度: ${(1 - h.score).toFixed(4)})\n${h.text}`)
    .join('\n\n---\n\n');

  return template.replace('\${ragContent}', ragContent);
}
