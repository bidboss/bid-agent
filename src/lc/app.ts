// 启动入口：inquirer 循环 + 拼装消息 + 调模型（含工具循环） + 存会话 |
// 每次只需要在启动会话时加载一次 配置、模型、会话文件，后续每轮对话只需要拼装消息、调模型、存会话。

// 触发工具注册（导入 tools/index.ts 会自动注册所有工具）
import './tools/index.ts';
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
  const boundModel = model.bindTools(listTools());// 模型绑定工具

  // 对话循环
  while (true) {
    const userInput = (await input({ message: '问：' })).trim();
    if (!userInput) continue;
    if (userInput === 'exit' || userInput === 'quit') break;

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

  console.log('对话结束，会话已保存');
}

// 执行主函数
try {
  await main();
} catch (e) {
  console.error('运行出错:', e);
  process.exit(1);
}
