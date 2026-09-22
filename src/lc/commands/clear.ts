// /clear 指令：仅清空内存中的对话历史，磁盘会话文件保留
//
// 由 app.ts 主循环在调用本函数后清空 history 引用数组：
//   await runClearCommand();
//   history.length = 0;

export function runClearCommand(): void {
  // eslint-disable-next-line no-console
  console.log('当前对话历史已清空（磁盘会话文件保留，重启可恢复）');
}
