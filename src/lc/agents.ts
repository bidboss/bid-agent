import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { BaseMessage } from '@langchain/core/messages';
import { getCurrentWorkingDir } from './utils/pathUtils.ts';

export interface AgentsMeta {
  userId: string;
  name: string;
  version: string;
  tools: string[];
}

export interface AgentsDoc {
  meta: AgentsMeta;
  content: string;        // markdown 正文，含 {变量名} 占位符
  template: ChatPromptTemplate;
}

export function loadAgentsDoc(): AgentsDoc {
  let meta: AgentsMeta = { userId: '', name: 'AI 助手', version: '1.0', tools: [] };
  let content = '你是一个友好的 AI 助手。当前用户: {userName}，工作目录: {cwd}。';

  const filePath = path.join(getCurrentWorkingDir(), '.front', 'AGENTS.md');
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    const { data, content: mdContent } = matter(raw);
    meta = {
      userId: data.userId ?? '',
      name: data.name ?? 'AI 助手',
      version: data.version ?? '1.0',
      tools: Array.isArray(data.tools) ? data.tools : [],
    };
    content = mdContent.trim();
    if (!content) content = '你是一个友好的 AI 助手。当前用户: {userName}，工作目录: {cwd}。';
  }

  const template = ChatPromptTemplate.fromMessages([['system', content]]);
  return { meta, content, template };
}

// 渲染 agent 提示模板为 BaseMessage[]
export async function renderAgentPrompt(
  variables: Record<string, string> = {},
): Promise<{ meta: AgentsMeta; messages: BaseMessage[] }> {
  const doc = loadAgentsDoc();

  // 默认注入一些常用变量
  const vars: Record<string, string> = {
    userName: doc.meta.userId || 'unknown',
    cwd: getCurrentWorkingDir(),
    agentName: doc.meta.name,
    agentVersion: doc.meta.version,
    tools: doc.meta.tools.join(', ') || '无',
    ...variables,
  };

  const messages = await doc.template.formatMessages(vars);
  return { meta: doc.meta, messages };
}