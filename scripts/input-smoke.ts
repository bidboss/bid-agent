// input 层纯函数冒烟测试：extractAttachments / buildFileContentBlocks
// 不依赖 stdin、不发模型请求，可独立运行。
// 运行：node --import tsx scripts/input-smoke.ts

import { extractAttachments } from '../src/lc/input.ts';
import { buildFileContentBlocks } from '../src/lc/files/index.ts';

let passed = 0;
let failed = 0;

function eq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}`);
    console.log(`    实际: ${a}`);
    console.log(`    期望: ${e}`);
    failed += 1;
  }
}

function ok(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}`);
    failed += 1;
  }
}

console.log('== extractAttachments ==');

// 单个 @
eq(extractAttachments('@[src/app.ts]'),
  { text: '', attachments: [{ type: '@', path: 'src/app.ts' }] },
  '单个 @[path]');

// @ 两侧有文本
eq(extractAttachments('hello @[src/app.ts] world'),
  { text: 'hello world', attachments: [{ type: '@', path: 'src/app.ts' }] },
  '@ 两侧有文本');

// 多个附件混合顺序
eq(extractAttachments('a @[x.ts] b #[y.png] c'),
  { text: 'a b c', attachments: [{ type: '@', path: 'x.ts' }, { type: '#', path: 'y.png' }] },
  '@ 和 # 混合，顺序保留');

// 多个同类型
eq(extractAttachments('start @[a.ts] mid @[b.ts] end'),
  { text: 'start mid end', attachments: [{ type: '@', path: 'a.ts' }, { type: '@', path: 'b.ts' }] },
  '多个 @ 顺序保留');

// 无附件
eq(extractAttachments('plain text'),
  { text: 'plain text', attachments: [] },
  '无附件');

// 空字符串
eq(extractAttachments(''),
  { text: '', attachments: [] },
  '空字符串');

// 只含附件但 text 全部由附件字符组成
eq(extractAttachments('@[a.ts]#[b.png]'),
  { text: '', attachments: [{ type: '@', path: 'a.ts' }, { type: '#', path: 'b.png' }] },
  'text 全由附件字符组成 → text 为空');

console.log('\n== buildFileContentBlocks ==');

// 空数组
eq(buildFileContentBlocks([]), [], '空数组');

// 单个文件
const blocks = buildFileContentBlocks(['package.json']);
ok(blocks.length === 1, '单文件 → 1 个 block');
ok(blocks[0].type === 'text', 'block 是 text 类型');
ok(blocks[0].text.startsWith('## package.json'), 'text 以 ## filename 开头');
ok(blocks[0].text.includes('```'), 'text 含代码块标记');

console.log('\n== 总结 ==');
console.log(`通过: ${passed}, 失败: ${failed}`);
if (failed > 0) {
  console.error('测试未通过');
  process.exit(1);
}
console.log('全部通过');
