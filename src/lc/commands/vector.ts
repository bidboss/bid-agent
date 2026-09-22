// /vector 指令：扫描 .front/kb/ 目录并向量化入库
//
// 使用方式：在 REPL 中输入 /vector
// 行为：扫描用户级和项目级的 .front/kb/ 目录，将知识库文档切分、向量化后存入 LanceDB

import { indexAllKbDirectories } from '../rag/index.ts';

export async function runVectorCommand(): Promise<void> {
  console.log('正在扫描知识库目录...');

  try {
    const result = await indexAllKbDirectories();
    const total = result.user + result.project;

    if (total === 0) {
      console.log('未找到任何可索引的知识库文档。请在 ~/.front/kb/ 或 .front/kb/ 目录下放置 .md / .txt / .docx 文件。');
      return;
    }

    console.log(`索引完成：`);
    if (result.user > 0) console.log(`  用户级: ${result.user} 段`);
    if (result.project > 0) console.log(`  项目级: ${result.project} 段`);
    console.log(`  共计: ${total} 段`);
  } catch (e: any) {
    console.error(`/vector 执行失败: ${e.message ?? e}`);
  }
}
