// /memory 指令的 LC 引擎实现
// 1) 加载已有记忆 + 上下文(.front.md) + 历史对话记录
// 2) 调一次模型，让它做记忆的增量合并
// 3) 把合并结果写回 memory.md + 入向量库

import fs from 'fs';
import path from 'path';
import { AIMessage, BaseMessage, SystemMessage } from '@langchain/core/messages';
import { createChatModel } from '../model.ts';
import {
  loadAllMemory,
  saveMemory,
} from '../memory/store.ts';
import { indexMemoryChunk } from '../memory/vector.ts';
import { renderMemoryPrompt } from '../memory/prompt.ts';
import { getCurrentWorkingDir, getUserHomeDir } from '../utils/pathUtils.ts';

// 工具函数：文件不存在返回空串
function readOptionalFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
}

function extractJson(raw: string): { projectMemory: string; userMemory: string } {
  if (!raw) throw new Error('模型返回为空');

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    return JSON.parse(fence[1].trim());
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return JSON.parse(raw.slice(first, last + 1));
  }

  throw new Error('模型返回中未找到 JSON');
}

/**
 * 把合并后的记忆写回 .md 并入向量库
 */
export async function runMemoryCommand(history: BaseMessage[]): Promise<void> {
  const { project, user } = loadAllMemory();
  const projectCtx = readOptionalFile(path.join(getCurrentWorkingDir(), '.front.md'));
  const userCtx = readOptionalFile(path.join(getUserHomeDir(), '.front', '.front.md'));
  const record = JSON.stringify(
    history.map((m) => {
      const c: any = (m as any).content;
      const text = typeof c === 'string'
        ? c
        : Array.isArray(c)
          ? c.map((b: any) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n')
          : '';
      return {
        role: (m as any).role ?? (m as any).type ?? 'unknown',
        content: text,
      };
    }),
    null,
    2,
  );

  const prompt = renderMemoryPrompt({
    projectMemory: project,
    userMemory: user,
    projectContext: projectCtx,
    userContext: userCtx,
    record,
  });

  // 告诉模型「只用 JSON 回答」会降低自由发挥的概率
  const system = new SystemMessage(
    '你是 frontcode 的记忆管理助手，严格输出 JSON，不要包含任何解释、Markdown 代码块标记或额外文本。',
  );

  const model = createChatModel({ temperature: 0.3 });
  const resp: AIMessage = await model.invoke([system, new (await import('@langchain/core/messages')).HumanMessage(prompt)]);
  const json = extractJson(resp.content as string);

  if (typeof json.projectMemory !== 'string' || typeof json.userMemory !== 'string') {
    throw new Error('模型返回的 JSON 缺少 projectMemory / userMemory 字段');
  }

  // 写 .md
  saveMemory('project', json.projectMemory.trim() + '\n');
  saveMemory('user', json.userMemory.trim() + '\n');

  // 入向量库（嵌入未配置时静默跳过）
  await Promise.allSettled([
    indexMemoryChunk('project', json.projectMemory),
    indexMemoryChunk('user', json.userMemory),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[memory] 已更新
  - 项目级: ${path.join(getCurrentWorkingDir(), '.front', 'memory', 'memory.md')}
  - 用户级: ${path.join(getUserHomeDir(), '.front', 'memory', 'memory.md')}`);
}
