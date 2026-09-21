// select 工具：终端选项选择
// 使用 @inquirer/prompts 实现：
//  - ↑↓ 切换焦点（原生支持）
//  - Enter 确认
//  - ESC / Ctrl+C 通过 CancelPromptError / ExitPromptError 检测并返回 success=false
// stdin 由 inquirer.input/search/select/confirm 统一管理，避免与 readline 抢 stdin。
import { select } from '@inquirer/prompts';
import { CancelPromptError, ExitPromptError } from '@inquirer/core';
import { z } from 'zod';

const schema = z.object({
  message: z.string().describe('要显示给用户的选择提示文本'),
  choices: z.array(
    z.object({
      name: z.string().describe('选项在终端显示的文本'),
      value: z.string().describe('用户选择该选项后返回的值'),
    })
  ).describe('选项列表'),
});

async function execute(args: z.infer<typeof schema>) {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return { success: false, content: '', error: '参数校验失败: ' + parsed.error.message };
  }
  const { message, choices } = parsed.data;
  try {
    const answer = await select({
      message,
      choices: choices.map((c) => ({ name: c.name, value: c.value })),
    });
    return { success: true, content: `用户选择了: ${answer}` };
  } catch (e: any) {
    if (e instanceof CancelPromptError || e instanceof ExitPromptError) {
      return { success: false, content: '', error: '用户已取消' };
    }
    return { success: false, content: '', error: `选项选择失败: ${e.message ?? e}` };
  }
}

export default {
  name: 'select',
  description: '在终端展示一个选项列表，等待用户用方向键 + Enter 选择一项后返回。当用户需要从多个明确选项中做选择时使用。',
  schema,
  execute,
};