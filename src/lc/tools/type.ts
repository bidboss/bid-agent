// 工具参数 Schema
export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  items?: ToolParameterSchema;
  enum?: string[];
}

// 工具定义
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolParameterSchema;
}

// 执行结果
export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

// 工具执行函数
export type ToolExecutor = (
  args: Record<string, unknown>
) => Promise<ToolResult>;