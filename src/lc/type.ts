
// Embedding 配置
export interface EmbeddingConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

// 模型配置
export interface ModelConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  userId: string;
  embedding: EmbeddingConfig | null;
  mcpServer: Record<string, Record<string, unknown>>;
  source: string | null;
  raw: Record<string, unknown>;
}

// 创建模型实例选项
export interface CreateChatModelOptions {
  model?: string;
  temperature?: number;
  streaming?: boolean;
  streamUsage?: boolean;
  maxTokens?: number;
  timeout?: number;
  maxRetries?: number;
  modelKwargs?: Record<string, unknown>;
}
