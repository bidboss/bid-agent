// 启动入口：inquirer 循环 + 拼装消息 + 调模型（含工具循环） + 存会话 |
// 每次只需要在启动会话时加载一次 配置、模型、会话文件，后续每轮对话只需要拼装消息、调模型、存会话。

// 触发本地工具注册（导入会同步注册本地工具）
import { registerAllMcpTools } from './tools/index.ts';
import { listTools } from './tools/registry.ts';
import { chatWithTools } from './tools/engine.ts';
import { input } from '@inquirer/prompts';
import { HumanMessage } from '@langchain/core/messages';
import { getModelConfig } from './config.ts';
import { createChatModel } from './model.ts';
import {
  saveMessagesToFile,
  loadMessagesFromFile,
  getSessionFilePath,
  type SessionMeta,
} from './session.ts';
import { buildSendMessages } from './prompts.ts';
import { toolCallLog, aiReplyLog } from './log.ts';
import { disconnectAllMcp } from './tools/mcp/loader.ts';
import { trimMessages } from './memory/window.ts';
import { runMemoryCommand } from './commands/memory.ts';
import { runVectorCommand } from './commands/vector.ts';

const SESSION_ID = 'default';

// 短期记忆窗口：超过此 token 数就压缩
const SHORT_TERM_TOKEN_BUDGET = 400;

// summarize 用的模型（同主对话模型即可，temperature 调低）
async function buildSummarizer() {
  const model = createChatModel({ temperature: 0.2 });
  return async (dropped: Array<{ role: string; content: string }>): Promise<string> => {
    const transcript = dropped
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');
    const resp = await model.invoke(
      `请把以下早期对话压缩为不超过 200 字的客观摘要，保留关键事实、用户偏好、待办与决策。\n\n${transcript}`,
    );
    return typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
  };
}

async function main() {
  // 加载配置 + 会话
  const config = getModelConfig();
  const userId = config.userId;
  const sessionFilePath = getSessionFilePath(userId, SESSION_ID);

  const { meta, messages: initialHistory } = loadMessagesFromFile(sessionFilePath);
  const created_at = meta?.created_at ?? new Date().toISOString();
  let history = initialHistory;

  const model = createChatModel({ temperature: 0.7 });
  // bindTools改为每轮对话时重新 bind，保证新增 MCP 工具及时可用

  try {
    await registerAllMcpTools(config.mcpServer);
  } catch (error: any) {
    console.warn(`[MCP] 加载出错: ${error.message}`);
  }

  // summarizer 在循环外创建，避免每轮重复初始化模型
  const summarizer = await buildSummarizer();

  // 对话循环
  while (true) {
    const userInput = (await input({ message: '问：' })).trim();
    if (!userInput) continue;
    if (userInput === 'exit' || userInput === 'quit') break;

    // 内置指令：/memory
    if (userInput === '/memory') {
      try {
        await runMemoryCommand(history);
      } catch (e: any) {
        console.warn(`[/memory] 执行失败: ${e.message ?? e}`);
      }
      continue;
    }

    // 内置指令：/vector
    if (userInput === '/vector') {
      try {
        await runVectorCommand();
      } catch (e: any) {
        console.warn(`[/vector] 执行失败: ${e.message ?? e}`);
      }
      continue;
    }

    // 每轮重新 bind，捕获 MCP 后续加载的工具
    const boundModel = model.bindTools(listTools());

    // 短期记忆窗口压缩（sendHistory 仅作临时变量，不覆盖 history）
    const { trimmed: sendHistory } = await trimMessages(history, {
      maxTokens: SHORT_TERM_TOKEN_BUDGET,
      summarizer,
    });

    // 拼装本轮消息（用 sendHistory，发给模型的上下文可含摘要）
    const sendMessages = await buildSendMessages(sendHistory, userInput);

    console.log('sendMessages 发送给模型的消息：', sendMessages);

    // 调用引擎（工具循环）
    const { newMessages, toolCallRecords } = await chatWithTools(boundModel, sendMessages);

    toolCallLog(toolCallRecords);
    aiReplyLog(newMessages);

    history.push(new HumanMessage(userInput));

    for (const msg of newMessages) {
      history.push(msg);
    }

    // 对话落库
    const metaToSave: SessionMeta = {
      user_id: userId,
      session_id: SESSION_ID,
      created_at,
    };
    saveMessagesToFile(sessionFilePath, history, metaToSave);
  }

  await disconnectAllMcp();
  console.log('对话结束，会话已保存');
}

// Ctrl+C 优雅关闭：避免 stdio MCP 子进程残留
process.on('SIGINT', async () => {
  await disconnectAllMcp().catch(() => {});
  process.exit(0);
});

// 执行主函数
try {
  await main();
} catch (e) {
  console.error('运行出错:', e);
  await disconnectAllMcp().catch(() => {});
  process.exit(1);
}
