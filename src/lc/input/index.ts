// 终端增强输入：在 readline 上接管 keypress，支持 / @ # 触发候选列表

import readline from 'readline';
import ansiEscapes from 'ansi-escapes';
import chalk from 'chalk';
import {
  scanProjectFiles,
  filterFiles,
  scanDesignImages,
  filterImages,
} from '../files/index.ts';

// 候选类型
type ListType = 'command' | 'file' | 'image';

// 单条候选
type Candidate = { name: string; description?: string } | string;

interface ListState {
  visible: boolean;
  type: ListType | null;
  items: Candidate[];
  selectedIndex: number;
  filterText: string;
  triggerPosition: number;
  lastRenderedCount: number;
}

const listState: ListState = {
  visible: false,
  type: null,
  items: [],
  selectedIndex: 0,
  filterText: '',
  triggerPosition: 0,
  lastRenderedCount: 0,
};

let rl: readline.Interface | null = null;
let currentLine = '';
let cursorPos = 0;
let allFiles: string[] = [];
let allImages: string[] = [];
let resolveInput: ((value: string) => void) | null = null;

// 退出请求回调（Ctrl+C 或 /exit 时调用）
let onExitRequest: (() => void) | null = null;
export function setOnExitRequest(cb: () => void): void {
  onExitRequest = cb;
}

// 内置指令候选源
function getBuiltinCommands(): { name: string; description: string }[] {
  return [
    { name: '/help',    description: '列出所有内置指令及其用法' },
    { name: '/clear',   description: '清空当前对话历史（磁盘文件保留）' },
    { name: '/context', description: '查看当前会话状态（消息数、token、文件路径）' },
    { name: '/exit',    description: '退出对话并保存会话' },
    { name: '/quit',    description: '同 /exit' },
    { name: '/memory',  description: '生成并保存长期记忆' },
    { name: '/vector',  description: '将 .front/kb 文档向量化并存入知识库' },
  ];
}

function filterBuiltinCommands(query: string): Candidate[] {
  const cmds = getBuiltinCommands();
  if (!query) return cmds;
  const lower = query.toLowerCase();
  return cmds.filter((c) => c.name.toLowerCase().startsWith('/' + lower));
}

// 初始化文件/图片缓存，应在 main 入口调用一次
export function initFileCache(): void {
  allFiles = scanProjectFiles();
  allImages = scanDesignImages();
}

// 接管 readline 的 keypress 监听，先调用 rl.input.removeAllListeners('keypress') 再装上自定义 handler
export function createEnhancedPrompt(interfaceInstance: readline.Interface): void {
  rl = interfaceInstance;
  const rawInput = (rl as unknown as { input: NodeJS.ReadableStream }).input;
  rawInput.removeAllListeners('keypress');
  rawInput.on('keypress', (char: unknown, key: unknown) => {
    handleKeyPress(typeof char === 'string' ? char : undefined, key as readline.Key | undefined);
  });
}

// 弹出一行输入，返回用户最终提交的内容，在循环中多次调用，每次都是一次独立的提问
export function enhancedQuestion(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    if (!rl) throw new Error('enhancedQuestion: readline 未初始化，请先调用 createEnhancedPrompt');
    resolveInput = resolve;
    currentLine = '';
    cursorPos = 0;
    listState.visible = false;
    listState.type = null;

    rl.setPrompt(prompt);
    rl.prompt(true);
  });
}

// keypress 入口：列表态 vs 正常态分派
function handleKeyPress(_char: string | undefined, key: readline.Key | undefined): void {
  if (!key) return;
  // Ctrl+C 全局拦截：在列表态与正常态都生效，触发退出回调
  if (key.ctrl && key.name === 'c') {
    if (onExitRequest) onExitRequest();
    return;
  }
  if (listState.visible) {
    handleListKey(_char, key);
  } else {
    handleNormalKey(_char, key);
  }
}

// 正常输入模式：方向键 / 退格 / 回车 / 字符
function handleNormalKey(_char: string | undefined, key: readline.Key): void {
  if (key.name === 'return') {
    submitInput();
    return;
  }

  if (key.name === 'backspace') {
    if (cursorPos > 0) {
      currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
      cursorPos--;
    }
    refreshLine();
    checkTrigger();
    return;
  }

  if (key.name === 'left') {
    if (cursorPos > 0) cursorPos--;
    refreshLine();
    return;
  }

  if (key.name === 'right') {
    if (cursorPos < currentLine.length) cursorPos++;
    refreshLine();
    return;
  }

  // 普通字符（非控制键）
  if (_char && !key.ctrl && !key.meta) {
    currentLine = currentLine.slice(0, cursorPos) + _char + currentLine.slice(cursorPos);
    cursorPos++;
    refreshLine();
    checkTrigger();
  }
}

// 检查是否触发 / @ # 候选列表，触发符前必须是空格或行首，触发符之后到光标位置不能含空格
function checkTrigger(): void {
  const textBeforeCursor = currentLine.slice(0, cursorPos);

  // / 指令
  const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
  if (lastSlashIndex !== -1) {
    const beforeSlash = textBeforeCursor[lastSlashIndex - 1];
    if (!beforeSlash || beforeSlash === ' ') {
      const filterText = textBeforeCursor.slice(lastSlashIndex + 1);
      if (!filterText.includes(' ')) {
        showList('command', filterText, lastSlashIndex);
        return;
      }
    }
  }

  // @ 文件
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');
  if (lastAtIndex !== -1) {
    const beforeAt = textBeforeCursor[lastAtIndex - 1];
    if (!beforeAt || beforeAt === ' ') {
      const filterText = textBeforeCursor.slice(lastAtIndex + 1);
      if (!filterText.includes(' ')) {
        showList('file', filterText, lastAtIndex);
        return;
      }
    }
  }

  // # 设计图
  const lastHashIndex = textBeforeCursor.lastIndexOf('#');
  if (lastHashIndex !== -1) {
    const beforeHash = textBeforeCursor[lastHashIndex - 1];
    if (!beforeHash || beforeHash === ' ') {
      const filterText = textBeforeCursor.slice(lastHashIndex + 1);
      if (!filterText.includes(' ')) {
        showList('image', filterText, lastHashIndex);
        return;
      }
    }
  }

  hideList();
}

// 弹出候选列表
function showList(type: ListType, filterText: string, triggerPosition: number): void {
  listState.type = type;
  listState.filterText = filterText;
  listState.triggerPosition = triggerPosition;
  listState.selectedIndex = 0;

  if (type === 'command') {
    listState.items = filterBuiltinCommands(filterText);
  } else if (type === 'image') {
    listState.items = filterImages(allImages, filterText);
  } else {
    listState.items = filterFiles(allFiles, filterText);
  }

  if (listState.items.length > 0) {
    listState.visible = true;
    renderList();
  } else {
    hideList();
  }
}

// 隐藏候选列表（带清理）
function hideList(): void {
  if (listState.visible) {
    clearList();
    listState.visible = false;
    listState.type = null;
    listState.lastRenderedCount = 0;
  }
}

// 列表态按键：ESC / Tab / ↑↓ / Enter / Backspace / 普通字符
function handleListKey(_char: string | undefined, key: readline.Key): void {
  if (key.name === 'escape') {
    hideList();
    return;
  }

  // Tab / ↓ 焦点跳到下一项；Shift+Tab / ↑ 跳到上一项
  // （合并 fzf 与 Cursor IDE 两种范式，给用户提供一致的快捷键体验）
  if (key.name === 'tab' || key.name === 'down') {
    if (listState.items.length > 0) {
      listState.selectedIndex = (listState.selectedIndex + 1) % listState.items.length;
      renderList();
    }
    return;
  }

  if (key.name === 'shift_tab' || key.name === 'back_tab' || key.name === 'up') {
    if (listState.items.length > 0) {
      listState.selectedIndex =
        (listState.selectedIndex - 1 + listState.items.length) % listState.items.length;
      renderList();
    }
    return;
  }

  // Enter = 确认当前焦点项（Cursor IDE 范式），不立即提交整行
  if (key.name === 'return') {
    confirmSelection();
    return;
  }

  if (key.name === 'backspace') {
    if (cursorPos > listState.triggerPosition + 1) {
      currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
      cursorPos--;
      refreshLine();
      checkTrigger();
    } else {
      hideList();
      handleNormalKey(_char, key);
    }
    return;
  }

  // 继续输入，更新筛选（空格不劫持，原生插入到 currentLine）
  if (_char && !key.ctrl && !key.meta) {
    currentLine = currentLine.slice(0, cursorPos) + _char + currentLine.slice(cursorPos);
    cursorPos++;
    refreshLine();
    checkTrigger();
  }
}

// 确认选择（Tab）：把候选写回 currentLine
function confirmSelection(): void {
  if (!listState.visible || listState.items.length === 0) return;

  const selected = listState.items[listState.selectedIndex];
  const before = currentLine.slice(0, listState.triggerPosition);
  const after = currentLine.slice(cursorPos);

  if (listState.type === 'command') {
    const cmdName = (selected as { name: string }).name;
    currentLine = before + cmdName + ' ' + after;
    cursorPos = before.length + cmdName.length + 1;
  } else if (listState.type === 'image') {
    const tag = `#[${selected as string}] `;
    currentLine = before + tag + after;
    cursorPos = before.length + tag.length;
  } else {
    const tag = `@[${selected as string}] `;
    currentLine = before + tag + after;
    cursorPos = before.length + tag.length;
  }

  hideList();
  refreshLine();
}

// 重绘输入行（保持光标位置）
function refreshLine(): void {
  if (!rl) return;
  process.stdout.write(ansiEscapes.cursorLeft + ansiEscapes.eraseLine);
  process.stdout.write(rl.getPrompt() + currentLine);
  const moveTo = currentLine.length - cursorPos;
  if (moveTo > 0) {
    process.stdout.write(ansiEscapes.cursorBackward(moveTo));
  }
}

// 在输入行下方渲染候选列表
function renderList(): void {
  if (listState.visible) {
    clearList();
  }
  if (!listState.visible) return;

  const maxItems = Math.min(listState.items.length, 8);
  listState.lastRenderedCount = maxItems;

  process.stdout.write('\n');

  for (let i = 0; i < maxItems; i++) {
    const item = listState.items[i];
    let lineText: string;
    if (listState.type === 'command') {
      const c = item as { name: string; description?: string };
      lineText = `  ${c.name} - ${c.description ?? ''}`;
    } else {
      lineText = `  ${item as string}`;
    }

    if (i === listState.selectedIndex) {
      process.stdout.write(chalk.bgBlue.white(lineText) + '\n');
    } else {
      process.stdout.write(lineText + '\n');
    }
  }

  process.stdout.write(ansiEscapes.cursorUp(maxItems + 1));
}

// 清除之前渲染的候选列表
function clearList(): void {
  const maxItems = listState.lastRenderedCount;
  if (!maxItems || maxItems <= 0) return;

  process.stdout.write(ansiEscapes.cursorDown(1));
  for (let i = 0; i < maxItems; i++) {
    process.stdout.write(ansiEscapes.eraseLine + ansiEscapes.cursorDown(1));
  }
  process.stdout.write(ansiEscapes.cursorUp(maxItems + 1));
  process.stdout.write(ansiEscapes.eraseLine);
}

// 提交当前行（Enter），回调 resolveInput
function submitInput(): void {
  hideList();
  process.stdout.write('\n');

  if (resolveInput) {
    const cb = resolveInput;
    resolveInput = null;
    cb(currentLine);
  }
}
