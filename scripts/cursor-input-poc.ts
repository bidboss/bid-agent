// PoC：验证"行末触发符弹候选，@ # 选中回填 buffer 继续编辑，/ 选中立即执行"的最小可运行演示
// 与 src/lc/input.ts 中的 composedDriver 行为一致。
//
// 运行：npx tsx scripts/cursor-input-poc.ts
// 手动验证项：
//   - 输入 "hello" → 提示符能正常显示输入字符
//   - 输入 "hello" + 回车 → 应进入下一轮
//   - 输入 "hello @" + 回车 → 弹文件候选 → 选中 → 输入框出现 "hello @[xxx.ts] " 预填
//     → 继续打字 + 回车 → 整条发送（buffer = "hello @[xxx.ts] 你好"）
//   - 输入 "@" 单独回车 → 弹候选 → ESC → 回到输入框（空 buffer）
//   - 输入 "/" + 回车 → 弹指令列表 → 选中 /help → 立即执行
//   - Ctrl+C → 应抛出 CancelPromptError 并正常退出

import { input, search, select } from '@inquirer/prompts';
import { CancelPromptError, ExitPromptError } from '@inquirer/core';

type DriverResult =
  | { action: 'command'; command: string }
  | { action: 'message'; input: { text: string; buffer: string } }
  | { action: 'empty' }
  | { action: 'exit' };

const MOCK_FILES = ['src/app.ts', 'src/index.ts', 'README.md', 'package.json'];
const MOCK_IMAGES = ['mockup.png', 'design-v2.png', 'home.png'];
const MOCK_COMMANDS = ['/help', '/clear', '/context', '/exit', '/memory'];

async function searchCandidate(
  trigger: '/' | '@' | '#',
): Promise<string | null> {
  if (trigger === '/') {
    try {
      return await select({
        message: '[PoC] 选指令（ESC 取消）',
        choices: MOCK_COMMANDS.map((c) => ({ name: c, value: c })),
      });
    } catch (e) {
      if (e instanceof CancelPromptError || e instanceof ExitPromptError) return null;
      throw e;
    }
  }
  const items = trigger === '@' ? MOCK_FILES : MOCK_IMAGES;
  try {
    return await search({
      message: `[PoC] 选${trigger}候选（ESC 取消）`,
      source: async (term) => {
        const q = (term ?? '').toLowerCase();
        return items
          .filter((x) => x.toLowerCase().includes(q))
          .map((x) => ({ name: x, value: x }));
      },
    });
  } catch (e) {
    if (e instanceof CancelPromptError || e instanceof ExitPromptError) return null;
    throw e;
  }
}

async function composedDriver(message: string): Promise<DriverResult> {
  let buffer = '';
  while (true) {
    let line: string;
    try {
      line = await input({ message, default: buffer || undefined, prefill: 'editable' });
    } catch (e) {
      if (e instanceof CancelPromptError || e instanceof ExitPromptError) {
        return { action: 'exit' };
      }
      throw e;
    }

    const trimmed = line.trimEnd();
    if (!trimmed) return { action: 'empty' };

    const lastChar = trimmed[trimmed.length - 1];
    if (lastChar === '@' || lastChar === '#' || lastChar === '/') {
      const trigger = lastChar as '/' | '@' | '#';
      const prefix = trimmed.slice(0, -1);
      const selected = await searchCandidate(trigger);
      if (selected === null) {
        buffer = prefix;
        continue;
      }
      if (trigger === '/') {
        return { action: 'command', command: selected };
      }
      const tag = `${trigger}[${selected}] `;
      buffer = `${prefix}${tag}`;
      continue;
    }

    return { action: 'message', input: { text: trimmed, buffer: trimmed } };
  }
}

async function main() {
  let round = 0;
  console.log('=== PoC 启动（while 循环 + 行末触发符）===');
  console.log('  操作：输入 "hello @" + 回车 → 弹候选 → 选中 → 回到输入框继续打字 + 回车');
  console.log('  操作：输入 "/" + 回车 → 弹指令列表 → 选中 /help → 立即执行');

  while (true) {
    round += 1;
    console.log(`\n[第 ${round} 轮]`);
    const r = await composedDriver('问：');
    if (r.action === 'exit') {
      console.log('\n[PoC] 收到 exit，正常退出');
      return;
    }
    if (r.action === 'empty') {
      console.log('  [PoC] 空 buffer → 跳过本轮');
      continue;
    }
    if (r.action === 'command') {
      console.log(`  [PoC] 指令: ${r.command}`);
      if (!MOCK_COMMANDS.includes(r.command)) {
        console.log(`  [PoC] (未识别的指令，本 PoC 不模拟指令分派)`);
      } else {
        console.log(`  [PoC] (内置指令命中，模拟已执行)`);
      }
      continue;
    }
    console.log(`  [PoC] 消息 text="${r.input.text}" buffer="${r.input.buffer}"`);
  }
}

main().catch((e) => {
  if (e instanceof CancelPromptError || e instanceof ExitPromptError) {
    console.log('\n[PoC] 正常退出');
    process.exit(0);
  }
  console.error('[PoC] 异常:', e);
  process.exit(1);
});
