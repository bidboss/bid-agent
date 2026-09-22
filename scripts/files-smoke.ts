// files 模块离线单元测试：纯函数 + 文件 I/O，不依赖模型/MCP
import {
  parseFileTags,
  parseImageTags,
  removeImageTags,
  filterFiles,
  filterImages,
  attachFilesToMessage,
  attachImagesToMessage,
  scanDesignImages,
  readFileContent,
} from '../src/lc/files/index.ts';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

console.log('\n[1] parseFileTags');
{
  const r = parseFileTags('看看 @[src/lc/app.ts] 和 @[package.json] 这两个');
  assert(r.length === 2 && r[0] === 'src/lc/app.ts' && r[1] === 'package.json', '两个标签解析正确');
}

console.log('\n[2] parseImageTags + removeImageTags');
{
  const tags = parseImageTags('参考 #[mock.png] 与 #[home.jpg] 的布局');
  assert(tags.length === 2 && tags[0] === 'mock.png' && tags[1] === 'home.jpg', '两个图片标签解析正确');
  const text = removeImageTags('参考 #[mock.png] 与 #[home.jpg] 的布局');
  assert(!text.includes('#[mock.png]'), '移除后不含图片标签');
}

console.log('\n[3] filterFiles 模糊匹配');
{
  const files = ['src/lc/app.ts', 'src/lc/files/index.ts', 'src/lc/input/index.ts', 'package.json'];
  const r = filterFiles(files, 'app');
  assert(r.length === 1 && r[0] === 'src/lc/app.ts', 'app 匹配到唯一项');
  const r2 = filterFiles(files, 'index');
  assert(r2.length === 2, 'index 匹配两项');
}

console.log('\n[4] filterImages 模糊匹配');
{
  const imgs = ['home.png', 'detail.jpg', 'icon.webp'];
  const r = filterImages(imgs, '.pn');
  assert(r.length === 1 && r[0] === 'home.png', '扩展名筛选正确');
}

console.log('\n[5] attachFilesToMessage 真实文件');
{
  const out = attachFilesToMessage('请阅读 @[package.json]');
  assert(out.includes('## package.json'), '追加 ## package.json');
  assert(out.includes('"name": "frontcode"'), '内容里含 name 字段');
}

console.log('\n[6] attachImagesToMessage 真实图片');
{
  // 在临时目录构造一个 .front/design
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frontcode-test-'));
  const designDir = path.join(tmp, '.front', 'design');
  fs.mkdirSync(designDir, { recursive: true });
  // 准备 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  fs.writeFileSync(path.join(designDir, 'pixel.png'), png);

  // 切到 tmp 工作目录
  const prevCwd = process.cwd();
  process.chdir(tmp);
  try {
    const imgs = scanDesignImages();
    assert(imgs.includes('pixel.png'), 'scanDesignImages 找到 pixel.png');

    const { text, images } = attachImagesToMessage('参考 #[pixel.png] 布局');
    assert(!text.includes('#[pixel.png]'), 'text 中图片标签被剥离');
    assert(images.length === 1, 'images 数组长度=1');
    assert(images[0].startsWith('data:image/png;base64,'), 'images[0] 是 base64 png');
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n[7] readFileContent 错误处理');
{
  const c = readFileContent('not-exists-xxxxxxxx.txt');
  assert(c.startsWith('[无法读取文件:'), '缺失文件返回占位');
}

console.log('\n[8] 边界：attachFilesToMessage 无标签');
{
  const out = attachFilesToMessage('普通文本');
  assert(out === '普通文本', '无标签时原样返回');
}

console.log(`\n--- 总结: ${passed} passed, ${failed} failed ---`);
process.exit(failed === 0 ? 0 : 1);
