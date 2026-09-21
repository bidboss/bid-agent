// confirm 工具：终端二元确认提问
// 使用 @inquirer/prompts 实现，stdin 由 inquirer 统一管理。
import { confirm } from '@inquirer/prompts';
import { CancelPromptError, ExitPromptError } from '@inquirer/core';
import { z } from 'zod';

const schema = z.object({
  message: z.string().describe('要显示给用户的确认提示文本'),
  default: z.boolean().optional().default(false)
    .describe('默认选项，true 表示回车默认选 yes，false 表示默认选 no'),
});

async function execute(args: z.infer<typeof schema>) {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return { success: false, content: '', error: '参数校验失败: ' + parsed.error.message };
  }
  const { message, default: defaultValue = false } = parsed.data;
  try {
    const answer = await confirm({ message, default: defaultValue });
    return {
      success: true,
      content: answer ? '用户已确认 (yes)' : '用户已取消 (no)',
    };
  } catch (e: any) {
    if (e instanceof CancelPromptError || e instanceof ExitPromptError) {
      return { success: false, content: '', error: '用户已取消' };
    }
    return { success: false, content: '', error: `确认提问失败: ${e.message ?? e}` };
  }
}

export default {
  name: 'confirm',
  description: '在终端向用户发起一个 Yes/No 确认提问，等待用户按键后返回结果。任何有副作用的操作（删除、覆盖、执行危险命令）前应先调用此工具。',
  schema,
  execute,
};
