import { z } from 'zod';
import { appendMemorySection } from '../../memory/store.ts';
import { indexMemoryChunk } from '../../memory/vector.ts';

const schema = z.object({
  scope: z.enum(['project', 'user']).describe('项目级或用户级'),
  section: z.string().describe('段落标题，例如 "## 2026-09-19 用户偏好"'),
  body: z.string().describe('段落正文'),
});

const MAX_FILE_BYTES = 1024 * 1024; // 1MB 保护

async function execute(args: z.infer<typeof schema>) {
  // 大小保护
  const fs = await import('fs');
  const path = await import('path');
  const { getCurrentWorkingDir, getUserHomeDir } = await import('../../utils/pathUtils.ts');
  const filePath = path.join(
    args.scope === 'project' ? getCurrentWorkingDir() : getUserHomeDir(),
    '.front', 'memory', 'memory.md',
  );
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      return { success: false, content: '', error: `记忆文件超过 1MB 上限 (${filePath})，请先归档或拆分` };
    }
  } catch {
    // 文件不存在，appendMemorySection 会负责创建
  }

  try {
    appendMemorySection(args.scope, args.section, args.body);
  } catch (e: any) {
    return { success: false, content: '', error: `写入 .md 失败: ${e.message ?? e}` };
  }

  // 向量记忆：嵌入未配置时静默跳过
  try {
    await indexMemoryChunk(args.scope, `${args.section}\n${args.body}`, {
      section: args.section,
      ts: new Date().toISOString(),
    });
  } catch (e: any) {
    // 不阻塞主流程，只在 ToolResult 里附带告警
    return {
      success: true,
      content: `已追加 ${args.scope} 记忆：${args.section}\n（向量索引失败: ${e.message ?? e}）`,
    };
  }

  return { success: true, content: `已追加 ${args.scope} 记忆：${args.section}` };
}

export default {
  name: 'memorySave',
  description: '以追加方式写入项目级或用户级记忆（不覆盖），并写入向量记忆',
  schema,
  execute,
};
