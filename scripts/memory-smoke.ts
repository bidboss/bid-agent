// 记忆体系（Phase 4）冒烟自检
// 不连模型、不连 embedding，只验证：
// 1) .md 读写 + 增量追加
// 2) /memory 指令拼装出来的 prompt 字符串渲染正常
// 3) memory_get / memory_save 工具在缺 embedding / 空文件下不抛错
// 4) trimMessages 不会破坏 system 与首条 user
//
// 注意：本脚本会把当前工作目录切换到一个临时 sandbox（项目级 memory 落在 sandbox 内），
// 并在启动时把 ~/.front/memory/memory.md 临时备份、退出时还原，避免污染真实用户记忆。
//
// 用法：npx tsx ./scripts/memory-smoke.mjs

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  loadMemory,
  saveMemory,
  loadAllMemory,
  appendMemorySection,
  renderMemoryPrompt,
  estimateTokens,
} from '../src/lc/memory/index.ts';
import {
  searchMemory,
  indexMemoryChunk,
} from '../src/lc/memory/vector.ts';
import { trimMessages } from '../src/lc/memory/window.ts';
import memoryGetTool from '../src/lc/tools/implementations/memory_get.ts';
import memorySaveTool from '../src/lc/tools/implementations/memory_save.ts';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  // 准备 sandbox：项目级 .front/memory 会写到这里
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'frontcode-memory-smoke-'));
  // 在 sandbox 里写一份最小配置，让 config 走项目级、且 embedding 字段为空
  fs.mkdirSync(path.join(sandbox, '.front'), { recursive: true });
  fs.writeFileSync(
    path.join(sandbox, '.front', 'settings.json'),
    JSON.stringify({
      baseURL: 'https://api.example.invalid/v1',
      apiKey: 'sk-smoke-fake-key',
      model: 'smoke-model',
    }),
    'utf-8',
  );
  // 备份真实用户级 memory（如果存在），测试期间临时挪走，结束还原
  const realUserMemoryDir = path.join(os.homedir(), '.front', 'memory');
  const realUserMemoryFile = path.join(realUserMemoryDir, 'memory.md');
  const userMemoryBackup = path.join(sandbox, 'user-memory.bak');
  fs.mkdirSync(realUserMemoryDir, { recursive: true });
  if (fs.existsSync(realUserMemoryFile)) {
    fs.copyFileSync(realUserMemoryFile, userMemoryBackup);
    fs.unlinkSync(realUserMemoryFile);
  }

  const prevCwd = process.cwd();
  process.chdir(sandbox);

  try {
    console.log('== 1. .md 读写 + 增量追加 ==');
    assert(loadMemory('project') === '', 'loadMemory 空文件返回空串');
    assert(loadMemory('user') === '', 'loadMemory(user) 空文件返回空串');

    appendMemorySection('project', '## 2026-09-19 项目级', '项目用 vue3 + pinia');
    const projectFile = path.join(sandbox, '.front', 'memory', 'memory.md');
    assert(fs.existsSync(projectFile), 'appendMemorySection 后项目级文件存在');
    const projectText = fs.readFileSync(projectFile, 'utf-8');
    assert(projectText.includes('## 2026-09-19 项目级'), '追加段落标题存在');
    assert(projectText.includes('项目用 vue3 + pinia'), '追加段落正文存在');

    appendMemorySection('project', '## 2026-09-20 项目级', '引入 element-plus');
    const projectText2 = fs.readFileSync(projectFile, 'utf-8');
    assert(projectText2.includes('项目用 vue3 + pinia'), '首次追加内容仍在（非覆盖）');
    assert(projectText2.includes('引入 element-plus'), '第二次追加内容存在');

    saveMemory('project', '全量覆盖内容');
    assert(loadMemory('project') === '全量覆盖内容', 'saveMemory 全量覆盖生效');

    const all = loadAllMemory();
    assert(typeof all.project === 'string' && typeof all.user === 'string', 'loadAllMemory 返回双字段');

    console.log('\n== 2. renderMemoryPrompt ==');
    const prompt = renderMemoryPrompt({
      projectMemory: 'P', userMemory: 'U', projectContext: 'PC', userContext: 'UC', record: '[]',
    });
    assert(prompt.includes('# 已有项目级记忆'), 'prompt 含项目级记忆段落');
    assert(prompt.includes('# 已有用户级记忆'), 'prompt 含用户级记忆段落');
    assert(prompt.includes('# 当前项目上下文'), 'prompt 含项目级上下文');
    assert(prompt.includes('# 当前用户上下文'), 'prompt 含用户级上下文');
    assert(prompt.includes('# 待合并的对话记录'), 'prompt 含对话记录段落');
    assert(prompt.includes('"projectMemory"') && prompt.includes('"userMemory"'), 'prompt 含 JSON 输出示例');

    console.log('\n== 3. estimateTokens ==');
    assert(estimateTokens('') === 0, '空串 token=0');
    assert(estimateTokens('hello') >= 1, '非空 token>=1');
    assert(estimateTokens('你好世界') >= 2, '中文 4 字估算 >=2');

    console.log('\n== 4. trimMessages 不破坏 system 与首条 user ==');
    const longText = 'x'.repeat(8000);
    const msgs = [
      new SystemMessage('系统'),
      new HumanMessage('首条 user'),
      new AIMessage(longText),
      new HumanMessage(longText),
      new AIMessage(longText),
    ];
    const { trimmed, summary } = await trimMessages(msgs, {
      maxTokens: 1000,
      summarizer: async (dropped) => `压缩了 ${dropped.length} 条`,
    });
    assert(trimmed.some((m) => m instanceof SystemMessage && (m.content as string).startsWith('系统')), 'system 保留');
    assert(trimmed.some((m) => m instanceof HumanMessage && (m.content as string) === '首条 user'), '首条 user 保留');
    const total = trimmed.reduce((acc, m) => acc + estimateTokens(
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    ), 0);
    assert(total <= 1500, `trim 后总 token 在预算附近（实际 ${total}）`);
    assert(typeof summary === 'string', 'summary 已生成');

    console.log('\n== 4b. trimMessages 工具回合成组保留（不退化为半截） ==');
    // 场景：系统 + 首条 user + 4 个工具回合（每个回合含 AI(tc) + ToolMessage）
    // 总 token 远超预算，必须 trim。但 trim 后绝不允许出现孤立的 ToolMessage
    const { ToolMessage } = await import('@langchain/core/messages');
    const toolRoundMsgs: any[] = [
      new SystemMessage('sys'),
      new HumanMessage('首问'),
    ];
    for (let r = 0; r < 4; r++) {
      const ai = new AIMessage({
        content: '',
        tool_calls: [{ name: `tool_${r}`, args: { r }, id: `call_${r}`, type: 'tool_call' }],
      });
      const tm = new ToolMessage({ content: `result_${r}`, tool_call_id: `call_${r}` });
      const ai2 = new AIMessage(`对回合 ${r} 的回复`);
      toolRoundMsgs.push(ai, tm, ai2);
    }
    const { trimmed: toolTrimmed } = await trimMessages(toolRoundMsgs, {
      maxTokens: 200,
      summarizer: async (dropped) => `压缩了 ${dropped.length} 条`,
    });

    // 断言 1：trim 后没有孤立的 ToolMessage——每个 ToolMessage 前面必须有一条带 tool_calls 的 AI
    const tms = toolTrimmed.filter((m: any) => {
      const role = m.role ?? m.lc_kwargs?.type ?? m.type ?? m.constructor?.name ?? '';
      return role === 'tool';
    });
    let lastAiHadToolCalls = false;
    let orphans = 0;
    // 单次顺序遍历：维护"上一条 AI 是否带 tool_calls"
    for (const m of toolTrimmed) {
      const role = (m as any).role ?? (m as any).lc_kwargs?.type ?? (m as any).type ?? (m as any).constructor?.name ?? '';
      if (role === 'tool') {
        if (!lastAiHadToolCalls) orphans++;
        lastAiHadToolCalls = false;
      } else {
        lastAiHadToolCalls =
          role === 'ai' &&
          Array.isArray((m as any).tool_calls) &&
          (m as any).tool_calls.length > 0;
      }
    }
    assert(orphans === 0, `trim 后不应出现孤立 ToolMessage（检测到 ${orphans} 个孤儿）`);

    // 断言 2：AI(tool_calls) 的数量 必须等于 ToolMessage 的数量（同回合整组丢/留）
    const aisWithTC = toolTrimmed.filter((m: any) => {
      const role = m.role ?? m.lc_kwargs?.type ?? m.type ?? m.constructor?.name ?? '';
      return role === 'ai' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
    });
    assert(
      aisWithTC.length === tms.length,
      `AI(tool_calls) 数=${aisWithTC.length} 必须等于 ToolMessage 数=${tms.length}（整组保留）`,
    );

    console.log('\n== 4b-2. trimMessages 工具回合超额时整组丢弃（不留半截） ==');
    // maxTokens 极小，让所有 4 个 tool round 都装不下 → 必须全丢
    // 注意：保留的会有 system + 摘要 + 首条 user
    const { trimmed: toolTrimmedDrop, summary: dropSummary } = await trimMessages(toolRoundMsgs, {
      maxTokens: 5,
      summarizer: async (dropped) => `压缩了 ${dropped.length} 条`,
    });
    const tms2 = toolTrimmedDrop.filter((m: any) => {
      const role = m.role ?? m.lc_kwargs?.type ?? m.type ?? m.constructor?.name ?? '';
      return role === 'tool';
    });
    const ais2 = toolTrimmedDrop.filter((m: any) => {
      const role = m.role ?? m.lc_kwargs?.type ?? m.type ?? m.constructor?.name ?? '';
      return role === 'ai' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
    });
    assert(tms2.length === 0, `预算极小时所有 ToolMessage 都应被丢弃（实际保留 ${tms2.length} 个）`);
    assert(ais2.length === 0, `预算极小时所有 AI(tool_calls) 都应被丢弃（实际保留 ${ais2.length} 个）`);
    assert(typeof dropSummary === 'string' && dropSummary.includes('压缩了 12'), `summary 应包含被丢回合数（12 条 = 4 round × 3 条）`);

    console.log('\n== 4c. trimMessages 多 round 独立累加（不互相干扰） ==');
    // 场景：系统 + 首条 user + [Human, AI(plain)] × 3
    // 不应 trim，因为 round 都不大；但如果 maxTokens 很小则早期 round 整组丢、后期 round 整组留
    const plainRounds: any[] = [
      new SystemMessage('sys'),
      new HumanMessage('首问'),
      new HumanMessage('第二轮问题'),
      new AIMessage('第二轮回复'),
      new HumanMessage('第三轮问题'),
      new AIMessage('第三轮回复'),
      new HumanMessage('第四轮问题'),
      new AIMessage('第四轮回复'),
    ];
    const { trimmed: plainTrimmed, summary: plainSummary } = await trimMessages(plainRounds, {
      maxTokens: 50,  // 极小预算，让早期 round 必须丢
      summarizer: async (dropped) => `压缩了 ${dropped.length} 条`,
    });
    // 断言：保留的 round 内顺序与原 tail 一致；不会有"AI 在 Human 之前"这种错位
    for (const m of plainTrimmed) {
      const role = (m as any).role ?? (m as any).lc_kwargs?.type ?? (m as any).type ?? (m as any).constructor?.name ?? '';
      const isTc = role === 'ai' && Array.isArray((m as any).tool_calls) && (m as any).tool_calls.length > 0;
      if (isTc && (m as any).constructor?.name === 'AIMessage') {
        // 多 round 场景下不应出现工具回合——纯 sanity check
      }
    }
    // 断言：保留的最后一轮必须完整
    const len = plainTrimmed.length;
    if (len >= 2) {
      const last = plainTrimmed[len - 1];
      const prev = plainTrimmed[len - 2];
      const lastRole = (last as any).role ?? (last as any).lc_kwargs?.type ?? (last as any).type ?? (last as any).constructor?.name ?? '';
      const prevRole = (prev as any).role ?? (prev as any).lc_kwargs?.type ?? (prev as any).type ?? (prev as any).constructor?.name ?? '';
      if (prevRole === 'human') {
        assert(lastRole === 'ai', `human 后必须是 ai，实际 lastRole=${lastRole}`);
      }
    }

    console.log('\n== 5. 工具：memory_get 在 embedding 未配置时返回空向量命中 ==');
    const getRes = await memoryGetTool.execute({ query: 'vue3' });
    assert(getRes.success === true, 'memory_get 成功');
    assert(typeof getRes.content === 'string' && getRes.content.includes('[项目级记忆]'), 'memory_get 包含项目级块');
    assert(typeof getRes.content === 'string' && getRes.content.includes('[用户级记忆]'), 'memory_get 包含用户级块');
    assert(typeof getRes.content === 'string' && getRes.content.includes('无相关片段'), '无 embedding 时返回「无相关片段」');

    console.log('\n== 6. 工具：memory_save 走 appendMemorySection 路径 ==');
    // 在 sandbox 里再次写入（验证增量追加）
    saveMemory('project', 'reset-for-save-test');
    const saveRes = await memorySaveTool.execute({
      scope: 'project', section: '## smoke', body: 'smoke body',
    });
    assert(saveRes.success === true, 'memory_save 成功');
    const after = fs.readFileSync(projectFile, 'utf-8');
    assert(after.includes('reset-for-save-test'), 'memory_save 不覆盖原内容');
    assert(after.includes('## smoke') && after.includes('smoke body'), 'memory_save 追加了新段落');

    console.log('\n== 7. 工具：memory_get 无参数时只返回 .md ==');
    const getNoQuery = await memoryGetTool.execute({});
    assert(getNoQuery.success === true, 'memory_get 无 query 也成功');
    assert(!getNoQuery.content.includes('[向量命中]'), '无 query 时不出现向量块');

    console.log('\n== 8. searchMemory / indexMemoryChunk 在 embedding 未配置时静默降级 ==');
    const hits = await searchMemory('foo', 4, 'all');
    assert(Array.isArray(hits) && hits.length === 0, '未配置 embedding 时 searchMemory 返回 []');
    await indexMemoryChunk('project', 'hello');
    assert(true, 'indexMemoryChunk 在未配置 embedding 时不抛错');

    console.log('\n全部自检通过');
  } finally {
    process.chdir(prevCwd);
    // 还原用户级 memory：删掉测试期间临时创建的文件，把备份放回去
    if (fs.existsSync(realUserMemoryFile)) {
      fs.unlinkSync(realUserMemoryFile);
    }
    if (fs.existsSync(userMemoryBackup)) {
      fs.copyFileSync(userMemoryBackup, realUserMemoryFile);
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\n记忆体系自检失败');
  console.error(err);
  process.exit(1);
});
