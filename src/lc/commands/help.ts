// /help 指令：打印所有内置指令与按键规范

const HELP_TEXT = [
  '【内置指令】',
  '  /help      列出本帮助',
  '  /clear     清空当前对话历史（磁盘文件保留）',
  '  /context   查看当前会话状态',
  '  /exit      退出对话并保存会话（Ctrl+C 等价）',
  '  /quit      同 /exit',
  '  /memory    生成并保存长期记忆',
  '  /vector    将 .front/kb 文档向量化并存入知识库',
  '',
  '【触发符】',
  '  / + <模糊>  弹出指令候选（Enter 确认、Tab 焦点跳转）',
  '  @ + <模糊>  弹出项目文件候选，选中后追加 @[path] 内容',
  '  # + <模糊>  弹出 .front/design 图片候选，选中后以 image_url 注入',
  '',
  '【候选列表按键】',
  '  ↑ / ↓          切换焦点',
  '  Tab / Shift+Tab 焦点跳转 / 反向跳转',
  '  Enter          确认当前焦点项（不回车提交整行）',
  '  Esc            关闭候选，不修改输入',
  '  Space          不劫持，原生插入空格到输入行',
  '',
  '【通用按键】',
  '  Ctrl+C         退出对话（与 /exit 等价）',
].join('\n');

export function runHelpCommand(): void {
  // eslint-disable-next-line no-console
  console.log(HELP_TEXT);
}
