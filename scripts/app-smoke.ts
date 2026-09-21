// LC 引擎端到端启动冒烟：启动 + 2 秒后 SIGTERM 退出
// 验证 readline + 文件扫描 + initFileCache 不抛错
import { spawn } from 'child_process';
import path from 'path';

const cwd = path.resolve('d:/web_study/Web_develop/agent/frontAgent');
const child = spawn('npx', ['tsx', './src/lc/app.ts'], {
  cwd,
  env: { ...process.env, NODE_ENV: 'test' },
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,
});

let stdout = '';
let stderr = '';
let resolved = false;

child.stdout.on('data', (b) => { stdout += b.toString(); });
child.stderr.on('data', (b) => { stderr += b.toString(); });

child.on('error', (e) => {
  console.log('spawn error:', e.message);
  if (!resolved) { resolved = true; process.exit(1); }
});

setTimeout(() => {
  // 注入退出命令
  child.stdin.write('exit\n');
}, 1500);

setTimeout(() => {
  if (!resolved) {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // 输出检查
        const ok = !stderr.includes('TypeError') && !stderr.includes('Error') && !stderr.includes('Cannot find');
        console.log('--- LC 引擎启动冒烟 ---');
        console.log('STDOUT 摘要:', stdout.slice(0, 500));
        console.log('STDERR 摘要:', stderr.slice(0, 500));
        console.log(ok ? 'PASS: 无类型错误' : 'FAIL: 含错误');
        process.exit(ok ? 0 : 1);
      }
    }, 500);
  }
}, 3000);

child.on('exit', (code) => {
  if (!resolved) {
    resolved = true;
    console.log(`LC 引擎退出，code=${code}`);
    process.exit(code ?? 0);
  }
});
