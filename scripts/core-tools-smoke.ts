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
  for (const name of TOOL_NAMES) {
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

  console.log('\n=== 5. 交互式工具（confirm / select）只验证注册，不实际触发 ===');
  // 这两个工具依赖 @inquirer/prompts 真实 TTY，自动化 smoke 中无法可靠触发
  // 只验证它们在 registry 里能被查到
  const { getTool } = await import('../src/lc/tools/registry.ts');
  check('confirm 在 registry 中可获取', getTool('confirm') !== undefined);
  check('select 在 registry 中可获取', getTool('select') !== undefined);

  console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('smoke 脚本异常:', e);
  process.exit(2);
});
