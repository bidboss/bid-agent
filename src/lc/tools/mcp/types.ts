// MCP 服务器配置类型
// 支持三种传输协议：stdio / sse / streamableHTTP
// 配置来源：.front/settings.json 的 mcpServer 字段

/** stdio 传输：本地进程 */
export interface McpStdioConfig {
  type?: 'stdio'; // 可省略，字段推断时识别
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/** SSE 传输：远程 Server-Sent Events（已 deprecated，但仍需兼容） */
export interface McpSseConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

/** streamableHTTP 传输：现代远程 MCP 协议 */
export interface McpHttpConfig {
  type: 'streamable-http';
  url: string;
  headers?: Record<string, string>;
}

/** 配置联合类型 */
export type McpServerConfig = McpStdioConfig | McpSseConfig | McpHttpConfig;

/**
 * 字段特征推断传输类型
 * stdio：有 command 字段
 * sse：type=sse
 * streamable-http：type=streamable-http 或 url 字段无 type
 */
export function inferTransportType(raw: Record<string, unknown>): 'stdio' | 'sse' | 'streamable-http' {
  const t = raw.type as string | undefined;
  if (t === 'stdio' || raw.command) return 'stdio';
  if (t === 'sse') return 'sse';
  return 'streamable-http';
}

/**
 * 归一化配置：将原始对象转成对应类型
 */
export function normalizeMcpConfig(name: string, raw: Record<string, unknown>): McpServerConfig {
  const transport = inferTransportType(raw);

  if (transport === 'stdio') {
    if (!raw.command) throw new Error(`MCP server "${name}" (stdio) 缺少 command 字段`);
    return {
      type: 'stdio',
      command: raw.command as string,
      args: (raw.args as string[]) ?? [],
      env: raw.env as Record<string, string> | undefined,
      cwd: raw.cwd as string | undefined,
    };
  }

  if (!raw.url) throw new Error(`MCP server "${name}" (${transport}) 缺少 url 字段`);

  if (transport === 'sse') {
    return {
      type: 'sse',
      url: raw.url as string,
      headers: raw.headers as Record<string, string> | undefined,
    };
  }

  return {
    type: 'streamable-http',
    url: raw.url as string,
    headers: raw.headers as Record<string, string> | undefined,
  };
}
