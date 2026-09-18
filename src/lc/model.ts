// 创建模型实例
import { ChatOpenAI } from '@langchain/openai';
import { getModelConfig } from './config';
import { type CreateChatModelOptions } from './type';
import { AIMessage } from '@langchain/core/messages';
const DEFAULT_TEMPERATURE = 0.7;

// 创建模型实例
export function createChatModel(options: CreateChatModelOptions = {}): ChatOpenAI {
  const {
    model,
    temperature = DEFAULT_TEMPERATURE,
    streaming = false,
    streamUsage,
    maxTokens,
    timeout,
    maxRetries,
    modelKwargs,
  } = options;

  const config = getModelConfig();

  const fields: ConstructorParameters<typeof ChatOpenAI>[0] = {
    model: model || config.model,
    apiKey: config.apiKey,
    temperature,
    streaming,
  }
  //  覆盖默认openAI网关地址
  if (config.baseURL) {
    fields.configuration = { baseURL: config.baseURL };
  }
  if (streamUsage !== undefined) fields.streamUsage = streamUsage;
  if (maxTokens !== undefined) fields.maxTokens = maxTokens;
  if (timeout !== undefined) fields.timeout = timeout;
  if (maxRetries !== undefined) fields.maxRetries = maxRetries;
  if (modelKwargs !== undefined) fields.modelKwargs = modelKwargs;

  return new ChatOpenAI(fields);
}

// 获取模型返回的文本
export function getMessageText(message: AIMessage): string {
  return message.content as string;
}