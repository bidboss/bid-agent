// bash 工具：跨平台 shell 命令执行
// Windows 走 PowerShell，其他系统直接执行
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { z } from 'zod';

const execAsync = promisify(exec);

const schema = z.object({
  command: z.string().describe('要执行的完整 shell 命令，Windows 下自动用 PowerShell 执行'),
});

function isWindows() {
  return os.platform() === 'win32';
}

async function execute(args: z.infer<typeof schema>) {
  const { command } = args;

  if (isWindows()) {
    // PowerShell 执行，UTF-8 编码
    const finalCommand = `chcp 65001 >nul && powershell -Command "${command.replace(/"/g, '\\"')}"`;
    try {
      const { stdout, stderr } = await execAsync(finalCommand, { encoding: 'utf8', timeout: 120_000 });
      const out = stdout + (stderr ? '\n' + stderr : '');
      return { success: true, content: out || '(命令执行完成，无输出)' };
    } catch (e: any) {
      // PowerShell 错误输出在 stderr，但成功时也可能写 stderr
      const msg = e.stdout ?? e.message ?? String(e);
      return { success: false, content: msg, error: e.message };
    }
  } else {
    try {
      const { stdout, stderr } = await execAsync(command, { encoding: 'utf8', timeout: 120_000 });
      const out = stdout + (stderr ? '\n' + stderr : '');
      return { success: true, content: out || '(命令执行完成，无输出)' };
    } catch (e: any) {
      return { success: false, content: e.stdout ?? '', error: e.message };
    }
  }
}

export default { name: 'bash', description: '执行 shell 命令（Windows 用 PowerShell，其他系统直接执行）。仅用于没有专用工具的场景，如 npm install、git 操作、运行脚本等。', schema, execute };
