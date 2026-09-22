import { z } from 'zod';
import { loadSkillFull } from '../../skills.ts';

const schema = z.object({
  name: z.string().describe('skill 的 name 字段（来自 SKILL.md frontmatter 的 name）'),
});

const MAX_BODY_BYTES = 64 * 1024; // 64KB：单次返回正文的大小保护

async function execute(args: z.infer<typeof schema>) {
  const { name } = args;
  const content = loadSkillFull(name);
  if (content === null) {
    return {
      success: false,
      content: '',
      error: `未找到名为 "${name}" 的 skill。请先调用 scanSkills / getSkillSummaryText 确认可用列表，或检查 SKILL.md frontmatter 的 name 字段。`,
    };
  }
  if (content.length > MAX_BODY_BYTES) {
    return {
      success: true,
      content: `${content.slice(0, MAX_BODY_BYTES)}\n\n…（已截断，原始正文 ${content.length} 字节）`,
    };
  }
  return { success: true, content };
}

export default {
  name: 'skill_load',
  description:
    '加载指定 skill 的完整 SKILL.md 内容（含正文）。仅当用户提问命中某 skill 的 triggers 时调用，返回的正文会进入模型上下文。',
  schema,
  execute,
};
