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
import { toolCallLog } from './log.ts';
import { disconnectAllMcp } from './tools/mcp/loader.ts';

const SESSION_ID = 'default';

async function main() {
  // 加载配置 + 会话
  const config = getModelConfig();
  const userId = config.userId;
  const sessionFilePath = getSessionFilePath(userId, SESSION_ID);

  const { meta, messages: history } = loadMessagesFromFile(sessionFilePath);
  const created_at = meta?.created_at ?? new Date().toISOString();
  console.log(`已加载会话: user=${userId}, session=${SESSION_ID}, 历史 ${history.length} 条`);

  const model = createChatModel({ temperature: 0.7 });
  // bindTools改为每轮对话时重新 bind，保证新增 MCP 工具及时可用

  try {
    const n = await registerAllMcpTools(config.mcpServer);
    if (n > 0) console.log(`[MCP] 共注册 ${n} 个第三方工具（已合并到对话中）`);
  } catch (error: any) {
    console.warn(`[MCP] 加载出错: ${error.message}`);
  }

  // 对话循环
  while (true) {
    const userInput = (await input({ message: '问：' })).trim();
    if (!userInput) continue;
    if (userInput === 'exit' || userInput === 'quit') break;

    // 每轮重新 bind，捕获 MCP 后续加载的工具
    const boundModel = model.bindTools(listTools());

    // 拼装本轮消息
    const sendMessages = await buildSendMessages(history, userInput);

    // 调用引擎（工具循环）
    const { newMessages, toolCallRecords } = await chatWithTools(boundModel, sendMessages);

    toolCallLog(toolCallRecords);

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
