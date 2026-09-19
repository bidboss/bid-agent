import { z } from 'zod';
import { loadAllMemory } from '../../memory/store.ts';
import { searchMemory } from '../../memory/vector.ts';

const schema = z.object({
  query: z.string().optional().describe('可选，按 query 检索向量记忆'),
});

async function execute(args: z.infer<typeof schema>) {
  const { project, user } = loadAllMemory();
  const lines: string[] = [
    `[项目级记忆]\n${project || '(空)'}`,
    `[用户级记忆]\n${user || '(空)'}`,
  ];

  if (args.query) {
    try {
      const hits = await searchMemory(args.query, 4, 'all');
      if (hits.length > 0) {
        const hitText = hits
          .map((h, i) => `${i + 1}. (scope=${h.scope}, score=${h.score.toFixed(4)})\n${h.text}`)
          .join('\n\n');
        lines.push(`[向量命中] (${hits.length})\n${hitText}`);
      } else {
        lines.push('[向量命中] 无相关片段');
      }
    } catch (e: any) {
      lines.push(`[向量命中] 检索失败: ${e.message ?? e}`);
    }
  }

  return { success: true, content: lines.join('\n\n---\n\n') };
}

export default {
  name: 'memoryGet',
  description: '读取项目级和用户级长期记忆；传 query 时同时检索向量记忆',
  schema,
  execute,
};
