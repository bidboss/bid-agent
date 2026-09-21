// 启动入口：composedDriver 状态机 + 拼装消息 + 调模型（含工具循环） + 存会话 |
// 每次只需要在启动会话时加载一次 配置、模型、会话文件，后续每轮对话只需要拼装消息、调模型、存会话。
//
// 输入流（Cursor 风格）：
// - 用户敲入 / 立即弹指令候选，选中即执行
// - 用户敲入 @ / # 立即弹附件候选，选中追加到 buffer
// - 回车发送：拆为 text + attachments，attachments 作为独立 content block 传给模型

// 触发本地工具注册（导入会同步注册本地工具）
import { registerAllMcpTools } from './tools/index.ts';
import { listTools } from './tools/registry.ts';
import { chatWithTools } from './tools/engine.ts';
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
import { runHelpCommand } from './commands/help.ts';
import { runClearCommand } from './commands/clear.ts';
import { runContextCommand } from './commands/context.ts';
import { runCustomCommand } from './commands/custom.ts';
import {
  initFileCache,
  composedDriver,
  type ComposedInput,
} from './input.ts';

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

  // 初始化文件/设计图缓存（@ # 触发列表依赖）
  initFileCache();

  // 退出请求回调（inquirer prompt 被 ESC / Ctrl+C 取消时调用）
  let exiting = false;
  const requestExit = (): void => {
    if (exiting) return;
    exiting = true;
    Promise.resolve(disconnectAllMcp()).catch(() => {});
    // eslint-disable-next-line no-console
    console.log('\n对话结束，会话已保存');
    process.exit(0);
  };

  // 指令分派表：内置指令在此集中维护
  const commandHandlers: Record<string, () => Promise<void>> = {
    '/help':    async () => runHelpCommand(),
    '/clear':   async () => {
      runClearCommand();
      history.length = 0;
    },
    '/context': async () => runContextCommand(history, sessionFilePath),
    '/exit':    async () => requestExit(),
    '/quit':    async () => requestExit(),
    '/memory':  async () => { await runMemoryCommand(history); },
    '/vector':  async () => { await runVectorCommand(); },
  };

  const summarizer = await buildSummarizer();

  // 一轮普通对话：拼消息 → 调引擎 → 落库。被主循环与自定义指令 passthrough 共用。
  // input 既可以是 string（自定义指令 passthrough 路径），也可以是 ComposedInput（@ # 附件路径）。
  const runOneTurn = async (input: string | ComposedInput): Promise<void> => {
    // 每轮重新 bind，捕获 MCP 后续加载的工具
    const boundModel = model.bindTools(listTools());

    // 短期记忆窗口压缩（sendHistory 仅作临时变量，不覆盖 history）
    const { trimmed: sendHistory } = await trimMessages(history, {
      maxTokens: SHORT_TERM_TOKEN_BUDGET,
      summarizer,
    });

    // 拼装本轮消息（用 sendHistory，发给模型的上下文可含摘要）
    const sendMessages = await buildSendMessages(sendHistory, input);

    // eslint-disable-next-line no-console
    console.log('sendMessages 发送给模型的消息：', sendMessages);

    // 调用引擎（工具循环）
    const { newMessages, toolCallRecords } = await chatWithTools(boundModel, sendMessages);

    toolCallLog(toolCallRecords);
    aiReplyLog(newMessages);

    // 写入短期 history：用 buffer 回显（含 @[#] 标签，方便用户查看）
    const echoText = typeof input === 'string' ? input : input.buffer;
    history.push(new HumanMessage(echoText));

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
  };

  // 对话循环：composedDriver 返回 discriminated union，分派到对应路径
  while (!exiting) {
    const result = await composedDriver('问：');
    if (result.action === 'exit') {
      requestExit();
      break;
    }
    if (result.action === 'empty') continue;

    if (result.action === 'command') {
      // / 选中指令：立即执行
      const cmdName = result.command;
      if (commandHandlers[cmdName]) {
        try {
          await commandHandlers[cmdName]();
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn(`[${cmdName}] 执行失败: ${e.message ?? e}`);
        }
        continue;
      }
      // 自定义指令：拆 args（/ 选中后通常不带 args，自定义指令可为空 args）
      const customResult = runCustomCommand(cmdName, '');
      if (customResult) {
        if (customResult.kind === 'print') {
          // eslint-disable-next-line no-console
          console.log(customResult.content);
          continue;
        }
        // passthrough：把模板正文作为附加段走正常对话循环
        try {
          await runOneTurn(customResult.content);
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn(`[${cmdName}] 执行失败: ${e.message ?? e}`);
        }
        continue;
      }
      // eslint-disable-next-line no-console
      console.warn(`未找到指令: ${cmdName}`);
      continue;
    }

    // result.action === 'message'：附件路径
    try {
      await runOneTurn(result.input);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn(`[对话] 执行失败: ${e.message ?? e}`);
    }
  }
}

// 执行主函数
try {
  await main();
} catch (e) {
  console.error('运行出错:', e);
  await disconnectAllMcp().catch(() => {});
  process.exit(1);
}
