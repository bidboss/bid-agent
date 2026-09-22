// 自定义指令模块冒烟测试（LC 引擎）
//
// 覆盖：
//  1. 扫描临时目录加载指令
//  2. frontmatter 解析（含退化）
//  3. passthrough 行为分支
//  4. {{args}} 占位符替换
//  5. 项目级覆盖用户级
//  6. 非法 frontmatter 降级（warn 但不抛错）
//  7. mtime 触发的重新加载
//  8. argsText 为空时占位符替换为空串

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadAllCustomCommands,
  runCustomCommand,
  listCustomCommands,
  clearCustomCommandCache,
} from '../src/lc/commands/custom.ts';

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL  ${msg}`);
  }
}

// 测试用：临时把 cwd 重定向到 tmpdir，便于控制"项目级"位置
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'frontcode-cmd-smoke-'));
const projectCwd = path.join(TMP, 'project');
const userHome = path.join(TMP, 'home');

fs.mkdirSync(path.join(userHome, '.front', 'commands', 'review'), { recursive: true });
fs.mkdirSync(path.join(userHome, '.front', 'commands', 'broken'), { recursive: true });
fs.mkdirSync(path.join(projectCwd, '.front', 'commands', 'review'), { recursive: true });
fs.mkdirSync(path.join(projectCwd, '.front', 'commands', 'tools'), { recursive: true });

// 用户级 review/pr.md（项目级会覆盖）
fs.writeFileSync(
  path.join(userHome, '.front', 'commands', 'review', 'pr.md'),
  '---\ndescription: USER LEVEL DESC\npassthrough: false\n---\nUSER BODY\n',
  'utf-8',
);

// 项目级 review/pr.md（应覆盖用户级）
fs.writeFileSync(
  path.join(projectCwd, '.front', 'commands', 'review', 'pr.md'),
  '---\ndescription: PROJECT LEVEL DESC\npassthrough: true\n---\nProject body for {{args}}\n',
  'utf-8',
);

// 无 frontmatter 的指令
fs.writeFileSync(
  path.join(projectCwd, '.front', 'commands', 'tools', 'lint.md'),
  '# Lint 代码\n请运行 npm run lint 并修复所有 warning。\n',
  'utf-8',
);

// 非法 frontmatter（缺闭合 ---），应降级处理
fs.writeFileSync(
  path.join(userHome, '.front', 'commands', 'broken', 'no-close.md'),
  '---\ndescription: missing close\nThis is body without closing fence\n',
  'utf-8',
);

// 用 HOME 与 cwd 环境变量影响 pathUtils
process.env.HOME = userHome;
process.env.USERPROFILE = userHome;
const originalCwd = process.cwd();
process.chdir(projectCwd);

try {
  // ========== 用例 1：基础加载 + 项目级覆盖 ==========
  console.log('--- 用例 1: 项目级覆盖用户级 ---');
  clearCustomCommandCache();
  const all = loadAllCustomCommands();
  const pr = all.get('/review:pr');
  assert(!!pr, '/review:pr 存在');
  assert(pr?.meta.description === 'PROJECT LEVEL DESC', 'description 取自项目级');
  assert(pr?.meta.passthrough === true, 'passthrough 取自项目级');

  // ========== 用例 2：frontmatter 退化（首行 #） ==========
  console.log('--- 用例 2: 无 frontmatter 时退化 ---');
  clearCustomCommandCache();
  const list = listCustomCommands();
  const lint = list.find((c) => c.name === '/tools:lint');
  assert(!!lint, '/tools:lint 被加载');
  assert(lint?.description === 'Lint 代码', '首行 # 标题被识别为 description');
  assert(lint?.passthrough === false, '缺省 passthrough 为 false');

  // ========== 用例 3：passthrough=true 注入分支 ==========
  console.log('--- 用例 3: passthrough=true 时 runCustomCommand 返回 kind=passthrough ---');
  const r1 = runCustomCommand('/review:pr', '重点看错误处理');
  assert(r1?.kind === 'passthrough', 'kind 为 passthrough');
  assert(r1 && (r1 as any).content.includes('重点看错误处理'), '{{args}} 被替换');

  // ========== 用例 4：passthrough=false 阻断分支 ==========
  console.log('--- 用例 4: passthrough=false 时 kind=print ---');
  // 临时构造：写一个 passthrough=false 的指令
  fs.writeFileSync(
    path.join(projectCwd, '.front', 'commands', 'review', 'show.md'),
    '---\ndescription: just print\npassthrough: false\n---\nPRINT CONTENT {{args}}\n',
    'utf-8',
  );
  clearCustomCommandCache();
  const r2 = runCustomCommand('/review:show', 'hello');
  assert(r2?.kind === 'print', 'kind 为 print');
  assert(r2 && (r2 as any).content.includes('hello'), '占位符仍被替换');
  assert(r2 && (r2 as any).content.startsWith('PRINT CONTENT'), '内容来自正文');

  // ========== 用例 5：非法 frontmatter 降级 ==========
  console.log('--- 用例 5: 非法 frontmatter 降级 ---');
  clearCustomCommandCache();
  const all5 = loadAllCustomCommands();
  const broken = all5.get('/broken:no-close');
  assert(!!broken, '/broken:no-close 仍被加载（降级而非抛错）');
  // 非法 frontmatter（缺闭合 ---）走纯文本兜底：
  // 首行 `---\n` 不以 # 开头，extractTitleFromBody 返回空，最终 description 退化为 fullName
  assert(
    broken?.meta.description === '/broken:no-close',
    '非法 frontmatter 降级：description 退化为指令名',
  );
  // body 应包含完整的原始文本（去 BOM 与首部空白），供占位符替换
  assert(
    broken?.content.includes('This is body without closing fence'),
    '降级时 body 仍包含完整正文',
  );

  // ========== 用例 6：mtime 触发重新读取 ==========
  console.log('--- 用例 6: mtime 修改后自动重读 ---');
  clearCustomCommandCache();
  const before = runCustomCommand('/review:pr', '');
  const beforeContent = before && (before as any).content;
  // 修改文件
  const target = path.join(projectCwd, '.front', 'commands', 'review', 'pr.md');
  fs.writeFileSync(
    target,
    '---\ndescription: UPDATED\npassthrough: true\n---\nUpdated body\n',
    'utf-8',
  );
  // 强制 mtime 推进
  const future = Date.now() + 2000;
  fs.utimesSync(target, future / 1000, future / 1000);
  const after = runCustomCommand('/review:pr', '');
  const afterContent = after && (after as any).content;
  assert(beforeContent !== afterContent, '内容已更新（mtime 触发重读）');
  assert(afterContent?.includes('Updated body'), '读到新正文');

  // ========== 用例 7：argsText 为空时占位符替换为空串 ==========
  console.log('--- 用例 7: argsText 为空 ---');
  fs.writeFileSync(
    path.join(projectCwd, '.front', 'commands', 'review', 'pr.md'),
    '---\ndescription: PR review\npassthrough: true\n---\nbody{{args}}end\n',
    'utf-8',
  );
  const future2 = Date.now() + 4000;
  fs.utimesSync(target, future2 / 1000, future2 / 1000);
  clearCustomCommandCache();
  const r3 = runCustomCommand('/review:pr', '');
  assert(r3 && (r3 as any).content.trim() === 'bodyend', '{{args}} 空时替换为空串');

  // ========== 用例 8：未找到的指令返回 null ==========
  console.log('--- 用例 8: 不存在的指令 ---');
  const r4 = runCustomCommand('/no:such', '');
  assert(r4 === null, '未找到时返回 null');
} finally {
  process.chdir(originalCwd);
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
