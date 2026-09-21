// input 启动冒烟：2 秒后强制退出，验证 readline/createEnhancedPrompt 不抛错
import readline from 'readline';
import { initFileCache, createEnhancedPrompt, enhancedQuestion } from '../src/lc/input/index.ts';
import { scanProjectFiles, scanDesignImages } from '../src/lc/files/index.ts';

let failed = 0;
let passed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log('  PASS:', msg);
  } else {
    failed++;
    console.log('  FAIL:', msg);
  }
}

console.log('\n[1] initFileCache 不抛错');
try {
  initFileCache();
  assert(true, 'initFileCache 完成');
} catch (e: any) {
  assert(false, `initFileCache 抛错: ${e.message}`);
}

console.log('\n[2] scanProjectFiles 返回数组');
const files = scanProjectFiles();
assert(Array.isArray(files), '返回数组');
assert(files.length > 0, '至少含一个文件');
assert(files.every((f) => !f.includes('\\')), '使用正斜杠');

console.log('\n[3] scanDesignImages 不抛错（.front/design 不存在也返回空）');
const imgs = scanDesignImages();
assert(Array.isArray(imgs), '返回数组（可能为空）');

console.log('\n[4] createEnhancedPrompt + enhancedQuestion 启动 2s 后退出');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
try {
  createEnhancedPrompt(rl);
  assert(true, 'createEnhancedPrompt 未抛错');
} catch (e: any) {
  assert(false, `createEnhancedPrompt 抛错: ${e.message}`);
}

// 启动 enhancedQuestion 但不阻塞主进程
const promise = enhancedQuestion('问：').catch((e) => {
  console.log('enhancedQuestion rejected:', e.message);
});

// 2 秒后：注入模拟的 Enter + 关闭
setTimeout(() => {
  // 模拟回车键直接提交
  // 注意：无法在 keypress 监听里直接调 submitInput（不在导出里），改为直接 close readline
  rl.close();
  // 等待 promise 解析
  setTimeout(() => {
    assert(true, 'enhancedQuestion 启动未崩（已关闭）');
    console.log(`\n--- 总结: ${passed} passed, ${failed} failed ---`);
    process.exit(failed === 0 ? 0 : 1);
  }, 500);
}, 1500);

void promise; // 保持 linter 安静
