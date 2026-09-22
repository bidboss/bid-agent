export function renderMemoryPrompt(args: {
  projectMemory: string;
  userMemory: string;
  projectContext: string;
  userContext: string;
  record: string;
}): string {
  return `你是一个记忆管理助手。基于【已有记忆】+【上下文】+【对话记录】，增量合并生成新的项目级/用户级记忆。

# 已有项目级记忆
${args.projectMemory || '(空)'}

# 已有用户级记忆
${args.userMemory || '(空)'}

# 当前项目上下文
${args.projectContext || '(空)'}

# 当前用户上下文
${args.userContext || '(空)'}

# 待合并的对话记录
${args.record}

# 输出要求（严格 JSON，无多余文本）
{
  "projectMemory": "合并后的项目级记忆全文",
  "userMemory": "合并后的用户级记忆全文"
}

# 合并规则
1. 自维护、非覆盖：保留已有记忆中仍然有效的内容
2. 新信息追加到对应分类末尾
3. 冲突时以新信息为准
4. 与技术无关的内容忽略
5. 谨慎记忆，差别不大则保留原状
`;
}

export {};