// PoC driver：自动喂入按键序列验证 input() 行为
// 运行：node --import tsx scripts/poc-driver.ts
// 行为：
//   1. 启动 cursor-input-poc.ts 子进程
//   2. 喂 "hello" → 验证文本回显（修复 Bug 1）
//   3. 回车 → 验证能进入下一轮（修复 Bug 2）
//   4. 喂 "@" + 回车 → 验证触发符候选弹窗
//   5. ESC → 验证取消候选后能回到下一轮
//   6. Ctrl+C 退出

import { spawn } from 'node:child_process';
import { join } from 'node:path';

const cwd = process.cwd();
const child = spawn(
  process.execPath,
  ['--import', 'tsx/esm', join(cwd, 'scripts/cursor-input-poc.ts')],
  {
    cwd,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, FORCE_COLOR: '0' },
  },
);

const writes: Array<{ ms: number; data: string; note: string }> = [
  { ms: 500, data: 'hello', note: '输入 hello（验证回显）' },
  { ms: 1500, data: '\r', note: '回车（验证进入下一轮）' },
  { ms: 2500, data: '@', note: '输入 @（准备触发候选）' },
  { ms: 3500, data: '\r', note: '回车（行末 @ 触发候选弹窗）' },
  { ms: 5500, data: '\x1b', note: 'ESC 取消候选' },
  { ms: 6500, data: '\x03', note: 'Ctrl+C 退出' },
];

for (const w of writes) {
  setTimeout(() => {
    try {
      child.stdin!.write(w.data);
      console.log(`\n[driver] +${w.ms}ms wrote: ${JSON.stringify(w.data)} — ${w.note}`);
    } catch (e) {
      console.error('[driver] write error', e);
    }
  }, w.ms);
}

child.on('exit', (code, sig) => {
  console.log(`\n[driver] child exited code=${code} sig=${sig}`);
  process.exit(0);
});

setTimeout(() => {
  console.log('[driver] timeout 10s, killing');
  child.kill();
}, 10000);
