// 6 个核心前端工具的 smoke 测试
// 验证：注册成功 → execute 调用 → ToolResult 格式正确

import { listTools, executeTool } from '../src/lc/tools/registry.ts';

const TOOL_NAMES = ['bash', 'write_file', 'grep', 'glob', 'confirm', 'select'];

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    fail++;
  }
}

async function main() {
  // 1. 触发工具注册（导入即注册）
  await import('../src/lc/tools/index.ts');

  console.log('=== 1. 注册检查 ===');
  const all = listTools().map(t => t.function.name);
  for (const name of TOOL_NAMES) {
    check(`${name} 已注册`, all.includes(name), `已注册: ${all.join(', ')}`);
  }

  console.log('\n=== 2. executeTool 返回 ToolResult 格式 ===');
  for (const name of ['bash', 'write_file', 'grep', 'glob']) {
    const r = await executeTool(name, {});
    check(
      `${name} 返回 {success, content, error?}`,
      typeof r === 'object' && r !== null && typeof r.success === 'boolean' && typeof r.content === 'string',
      JSON.stringify(r),
    );
  }

  console.log('\n=== 3. 未知工具 ===');
  const unknown = await executeTool('not_a_tool', {});
  check('未知工具返回 success=false', unknown.success === false && typeof unknown.error === 'string');

  console.log('\n=== 4. write_file / glob 集成（无副作用端到端）===');
  const tmpFile = '.front/smoke/_smoke_test.txt';
  // 写
  const w = await executeTool('write_file', {
    file_path: tmpFile,
    content: 'hello from smoke\nline2\nline3',
  });
  check('write_file 成功', w.success === true, w.error);

  // glob 找
  const g = await executeTool('glob', { pattern: '*.txt', search_path: '.front/smoke' });
  check('glob 找到 smoke 目录的 txt', g.success === true && g.content.includes('_smoke_test.txt'), g.content);

  // grep 搜
  const grepRes = await executeTool('grep', {
    pattern: 'hello',
    path: '.front/smoke',
    glob: '*.txt',
    output_mode: 'content',
  });
  check('grep 命中 hello', grepRes.success === true && grepRes.content.includes('hello'), grepRes.content);

  // bash 跑 echo
  const bashRes = await executeTool('bash', { command: 'echo smoke-ok' });
  check('bash 执行 echo 成功', bashRes.success === true, bashRes.content);
  check('bash 输出包含 smoke-ok', bashRes.content.includes('smoke-ok'), bashRes.content);

  console.log('\n=== 5. 交互式工具（confirm / select）schema 校验 + 注册检查 ===');
  // 这两个工具依赖终端 stdin，自动化 smoke 中无法实际触发
  // 验证：schema 注册正确 + 调用时缺失参数会返回 success=false
  const confirmMissing = await executeTool('confirm', {});
  check('confirm 缺参数返回 success=false', confirmMissing.success === false);

  const selectMissing = await executeTool('select', {});
  check('select 缺参数返回 success=false', selectMissing.success === false);

  const selectWrongType = await executeTool('select', { message: '?', choices: 'not-an-array' });
  check('select choices 类型错误返回 success=false', selectWrongType.success === false);

  const { getTool } = await import('../src/lc/tools/registry.ts');
  check('confirm 在 registry 中可获取', getTool('confirm') !== undefined);
  check('select 在 registry 中可获取', getTool('select') !== undefined);

  console.log('\n=== 6. 输入层（input.ts）单元校验 ===');
  // 这些函数依赖 inquirer 全栈 prompt，自动化时无法实跑（会卡在 stdin）
  // 验证：模块可加载、纯函数 formatSelection 行为正确、缓存初始化不抛错
  const inputModule = await import('../src/lc/input.ts');
  check('input.ts 可加载', typeof inputModule.promptUser === 'function');
  check('input.ts 导出 searchCandidate', typeof inputModule.searchCandidate === 'function');
  check('input.ts 导出 formatSelection', typeof inputModule.formatSelection === 'function');
  check('input.ts 导出 initFileCache', typeof inputModule.initFileCache === 'function');

  // formatSelection 纯函数行为
  const cmdJoined = inputModule.formatSelection('/', '/help', '');
  check('/ 触发：拼成 "/help "', cmdJoined === '/help ');

  const fileJoined = inputModule.formatSelection('@', 'src/app.ts', '');
  check('@ 触发：包成 @[src/app.ts]', fileJoined === '@[src/app.ts] ');

  const imgJoined = inputModule.formatSelection('#', 'mockup.png', '');
  check('# 触发：包成 #[mockup.png]', imgJoined === '#[mockup.png] ');

  // 保留 baseInput（如 "帮我看 " + "@[file] "）
  const withBase = inputModule.formatSelection('@', 'src/app.ts', '帮我看 ');
  check('formatSelection 保留 baseInput', withBase === '帮我看 @[src/app.ts] ');

  // initFileCache 不抛错（不验证具体值）
  try {
    inputModule.initFileCache();
    check('initFileCache 执行无异常', true);
  } catch (e: any) {
    check('initFileCache 执行无异常', false, e.message);
  }

  console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('smoke 脚本异常:', e);
  process.exit(2);
});
