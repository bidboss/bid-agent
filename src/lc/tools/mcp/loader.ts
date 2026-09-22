// MCP 服务器加载器
// 把 settings.json 里的 mcpServer 配置 → 实例化 Client + Transport → 连接 → 缓存
// 不注册工具（那是 adapter.ts 的职责）

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  normalizeMcpConfig,
  type McpServerConfig,
  type McpHttpConfig,
} from './types.ts';

export interface McpConnection {
  name: string;
  client: Client;
  config: McpServerConfig;
}

/** 所有活跃连接；key = server 名 */
const connectionStore = new Map<string, McpConnection>();

/**
 * 根据配置创建 Transport
 */
function createTransport(config: McpServerConfig) {
  if (config.type === 'stdio') {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
    });
  }
  if (config.type === 'sse') {
    return new SSEClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    });
  }
  // streamable-http
  return new StreamableHTTPClientTransport(new URL((config as McpHttpConfig).url), {
    requestInit: { headers: (config as McpHttpConfig).headers },
  });
}

/**
 * 加载并连接单个 MCP 服务器
 * - 任意环节失败：warn 后返回 null，不抛出
 */
export async function connectMcpServer(
  name: string,
  raw: Record<string, unknown>,
): Promise<McpConnection | null> {
  let config: McpServerConfig;
  try {
    config = normalizeMcpConfig(name, raw);
  } catch (e: any) {
    console.warn(`[MCP] 配置解析失败 "${name}": ${e.message}`);
    return null;
  }

  try {
    const client = new Client(
      { name: 'frontcode-client', version: '1.0.0' },
      { capabilities: {} },
    );
    const transport = createTransport(config);
    await client.connect(transport);

    const conn: McpConnection = { name, client, config };
    connectionStore.set(name, conn);
    console.log(`[MCP] 已连接: ${name} (${config.type})`);
    return conn;
  } catch (e: any) {
    console.warn(`[MCP] 连接失败 "${name}": ${e.message}`);
    return null;
  }
}

/**
 * 批量加载所有 MCP 服务器
 * 并发连接，任一失败不影响其他
 */
export async function loadMcpServers(
  servers: Record<string, Record<string, unknown>>,
): Promise<McpConnection[]> {
  const entries = Object.entries(servers);
  if (entries.length === 0) return [];

  const results = await Promise.all(
    entries.map(([name, raw]) => connectMcpServer(name, raw)),
  );
  return results.filter((r): r is McpConnection => r !== null);
}

/**
 * 关闭所有 MCP 连接
 */
export async function disconnectAllMcp(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [name, conn] of connectionStore.entries()) {
    promises.push(
      conn.client.close().catch((e: any) => {
        console.warn(`[MCP] 关闭失败 "${name}": ${e.message}`);
      }),
    );
  }
  await Promise.all(promises);
  connectionStore.clear();
}

/**
 * 获取已注册的连接（供 adapter 使用）
 */
export function getMcpConnections(): McpConnection[] {
  return Array.from(connectionStore.values());
}
