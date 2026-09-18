// 启动入口：inquirer 循环 + 拼装消息 + 调模型 + 存会话 |
// 每次只需要在启动会话时加载一次 配置、模型、会话文件，后续每轮对话只需要拼装消息、调模型、存会话。

import { input } from '@inquirer/prompts';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { getModelConfig } from './config.ts';
import { createChatModel, getMessageText } from './model.ts';
import {
  saveMessagesToFile,
  loadMessagesFromFile,
  getSessionFilePath,
  type SessionMeta,
} from './session.ts';
import { buildSendMessages } from './prompts.ts';
const SESSION_ID = 'default';

async function main() {
  // 1. 加载配置 + 会话
  const config = getModelConfig();
  const userId = config.userId;
  const sessionFilePath = getSessionFilePath(userId, SESSION_ID);

  const { meta, messages: history } = loadMessagesFromFile(sessionFilePath);
  const created_at = meta?.created_at ?? new Date().toISOString();
  console.log(`已加载会话: user=${userId}, session=${SESSION_ID}, 历史 ${history.length} 条`);

  // 2. 创建模型
  const model = createChatModel({ temperature: 0.7 });

  // 3. 对话循环
  while (true) {
    const userInput = (await input({ message: '问：' })).trim();
    if (!userInput) continue;
    if (userInput === 'exit' || userInput === 'quit') break;

    // 拼装本轮消息
    const sendMessages = buildSendMessages(history, userInput);

    // 调用模型
    const response = await model.invoke(sendMessages);
    const reply = getMessageText(response);

    // 更新内存中的消息历史（追加本轮的 user + ai）
    history.push(new HumanMessage(userInput));
    history.push(new AIMessage(reply));

    // 落盘
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