/**
 * 配置文件读取，返回配置对象
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import {getUserHomeDir, getCurrentWorkingDir} from './utils/pathUtils';
import { type ModelConfig,type EmbeddingConfig } from './type';
const DEFAULT_MODEL = 'deepseek-flash';

// 缓存配置
let cachedConfig: ModelConfig | null = null;

const CONFIG_DIR_NAME = '.front';
const CONFIG_FILE_NAMES = 'settings.json';

// 配置文件候选路径列表
export function getConfigSearchPaths() {
  const rootDirs = [getCurrentWorkingDir(), getUserHomeDir()];
  const searchPaths = [];
  for (const rootDir of rootDirs) {
    searchPaths.push(path.join(rootDir, CONFIG_DIR_NAME, CONFIG_FILE_NAMES));
  }
  return searchPaths;
}

function loadFirstConfig() {
  for (const configPath of getConfigSearchPaths()) {
    if (!fs.existsSync(configPath)) continue;
    try {
      // 去掉 BOM，避免 Windows 下手动编辑过的 json 解析失败
      const content = fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '');
      if (!content.trim()) {
        console.warn(`配置文件内容为空，已跳过: ${configPath}`);
        continue;
      }
      return { config: JSON.parse(content), configPath };
    } catch (error: any) {
      console.warn(`配置文件解析失败，已跳过: ${configPath}（${error.message}）`);
    }
  }
  return null;
}

export function resolveConfigPath() {
  const found = loadFirstConfig();
  return found ? found.configPath : null;
}

// 读取配置文件
export function readConfig() {
  const found = loadFirstConfig();
  if (found) return found.config;
  console.warn('配置文件不存在，请在项目目录或用户目录下创建 .front/settings.json 文件');
  return {};
}

// 归一化 embedding 配置
function normalizeEmbedding(rawConfig: Record<string, unknown>): EmbeddingConfig | null {
  const embedding = rawConfig.embedding as Record<string, unknown> | undefined;
  if (!embedding || typeof embedding !== 'object') return null;
  // embedding 可以只写 model，此时复用主配置的 baseURL / apiKey
  const baseURL = (embedding.baseURL as string) || (rawConfig.baseURL as string);
  const apiKey = (embedding.apiKey as string) || (rawConfig.apiKey as string);
  const model = embedding.model as string;
  if (!baseURL || !apiKey || !model) return null;
  return { baseURL, apiKey, model };
}

function resolveUserId(rawConfig: Record<string, unknown>): string {
  if (rawConfig.userId) return String(rawConfig.userId);
  return os.userInfo().username || 'default';
}

export function getModelConfig(forceReload = false): ModelConfig {
  if (cachedConfig && !forceReload) return cachedConfig;// 优先使用缓存

  const rawConfig = readConfig();
  if (!rawConfig.apiKey) {
    throw new Error(
      `配置里缺少 apiKey，请在 ${resolveConfigPath()} 中补上 apiKey 字段\n` +
        '配置示例: {"baseURL":"https://api.deepseek.com/v1","apiKey":"sk-xxx","model":"deepseek-flash"}'
    );
  }

  cachedConfig = {
    baseURL: rawConfig.baseURL as string,
    apiKey: rawConfig.apiKey as string,
    model: (rawConfig.model as string) || DEFAULT_MODEL,
    userId: resolveUserId(rawConfig),
    embedding: normalizeEmbedding(rawConfig),
    mcpServer: (rawConfig.mcpServer as Record<string, unknown>) || {},
    source: resolveConfigPath(),
    raw: rawConfig,
  };
  return cachedConfig;
}
