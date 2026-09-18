import OpenAI from 'openai';
import fs from 'fs';
import { readConfig } from '../utils/config.js';
import chalk from 'chalk';
import { transformToOpenAi } from '../tools/util.js';
import { excuteTool } from '../tools/index.js';

// 读取到的配置（模型配置、MCP配置）
const config = readConfig();

// 创建 OpenAI 客户端
export function createOpenAIClient() {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}

// 读取用户的 会话历史（通过 userid 和 sessionid 获取）
// 将用户的问题 添加到 消息列表中
// 将用户的问题 humanMessage 传给大模型
// 得到回答 AIMessage
// 检查 AIMessage 中是否有 tool_calls
// 如果有，生成 toolMessage
// 添加到消息列表中
// 循环...

// 调用 OpenAI API 获取回复
export async function getAIResponse(questionObj) {
  const { messages, openai, model, toolResult, contextMessageList, spinner } = questionObj;
  fs.writeFileSync('./record.json', JSON.stringify(messages));
  try {
    // 添加用户消息到历史
    let response = await openai.chat.completions.create({
      model: model || config.model || 'qwen3.6-plus',
      messages: [...contextMessageList, ...messages],
      temperature: 0.7,
      //给入前根据协议转化
      tools: transformToOpenAi(toolResult.tools),
    });

    let aiMessage = response.choices[0].message;
    //ai回复插入到messages里
    messages.push(aiMessage);
    // 检查是否有工具调用
    if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      // 有交互式工具时先停止 spinner，避免顶掉终端输入
      if (spinner) {
        spinner.stop();
      }

      // 执行所有工具调用
      for (const toolCall of aiMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);
        //通知用户开始执行某个工具
        console.log(chalk.green('开始执行工具:' + functionName));
        //自己调用太麻烦，直接用excuteTool

        const excuteResult = await excuteTool(functionName, functionArgs);
        // 添加工具响应到消息
        messages.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          content: excuteResult,
        });
      }
      //因为引用类型的特点，messages我们通过push 修改，已经改变，可以直接传递再次调用
      await getAIResponse(questionObj);
    }
    //直接返回整个消息
    return messages;
  } catch (error) {
    console.error('\n调用 OpenAI API 出错:', error.message);
    if (error.response) {
      console.error('错误详情:', error.response.data);
    }
    messages.push({ role: 'assistant', content: '抱歉，我暂时无法回答您的问题，请检查 API 配置或网络连接。' });
    return messages;
  }
}
