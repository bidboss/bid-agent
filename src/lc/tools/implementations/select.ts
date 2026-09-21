// select 工具：终端下拉选项选择
import { select } from '@inquirer/prompts';
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
  const { message, choices } = args;

  try {
    const answer = await select({ message, choices });
    return {
      success: true,
      content: `用户选择了: ${answer}`,
    };
  } catch (e: any) {
    // inquirer 在非 TTY 环境可能抛异常
    return { success: false, content: '', error: `选项选择失败: ${e.message}` };
  }
}

export default {
  name: 'select',
  description: '在终端展示一个选项列表，等待用户用方向键 + Enter 选择一项后返回。当用户需要从多个明确选项中做选择时使用。',
  schema,
  execute,
};
