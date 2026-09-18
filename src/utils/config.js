import fs from 'fs';
import path from 'path';
import { getUserHomeDir, getCurrentWorkingDir } from './pathUtils.js';

// 配置目录名（当前项目目录与用户目录下各有一个 .front）
const CONFIG_DIR_NAME = '.front';
// 支持的配置文件名：settings.json 为当前写法，setting.json 为历史写法，两者都兼容
const CONFIG_FILE_NAMES = ['settings.json', 'setting.json'];

/**
 * 列出所有会被读取的配置文件的候选路径（当前项目目录优先，其次是用户目录）
 * @returns {string[]} 配置文件候选路径列表（按优先级排序）
 */
export function getConfigSearchPaths() {
  const rootDirs = [getCurrentWorkingDir(), getUserHomeDir()];
  const searchPaths = [];
  for (const rootDir of rootDirs) {
    for (const fileName of CONFIG_FILE_NAMES) {
      searchPaths.push(path.join(rootDir, CONFIG_DIR_NAME, fileName));
    }
  }
  return searchPaths;
}

/**
 * 读取并解析第一个存在的配置文件（内部方法）
 * @returns {{config: Object, configPath: string}|null} 解析结果，全部失败时返回 null
 */
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
    } catch (error) {
      console.warn(`配置文件解析失败，已跳过: ${configPath}（${error.message}）`);
    }
  }
  return null;
}

/**
 * 拼装"找不到配置"的提示，直接告诉用户该怎么建文件
 * @returns {string} 提示文案
 */
function buildMissingConfigMessage() {
  const lines = ['读取配置为空，请在以下任意位置创建配置文件：'];
  for (const searchPath of getConfigSearchPaths()) {
    lines.push(`  - ${searchPath}`);
  }
  lines.push('配置示例: {"baseURL":"https://api.deepseek.com/v1","apiKey":"sk-xxx","model":"deepseek-flash"}');
  return lines.join('\n');
}

/**
 * 返回实际生效的配置文件路径
 * @returns {string|null} 生效的配置文件路径，全部不存在时返回 null
 */
export function resolveConfigPath() {
  const found = loadFirstConfig();
  return found ? found.configPath : null;
}

/**
 * 读取配置文件（兼容旧调用方：读不到时只告警并返回空对象，不抛异常）
 * 优先读取当前终端目录下的 .front/settings.json，其次是用户目录下的
 * @returns {Object} 配置对象；未找到或解析失败时返回空对象
 */
export function readConfig() {
  const found = loadFirstConfig();
  if (found) return found.config;
  console.warn(buildMissingConfigMessage());
  return {};
}

/**
 * 读取配置文件（强校验：读不到时抛出可直接照做的中文错误）
 * 新代码（src/lc 下的 LangChain 引擎）建议用它，避免出现 Missing credentials 这类难定位的报错
 * @returns {Object} 配置对象
 */
export function requireConfig() {
  const found = loadFirstConfig();
  if (found) return found.config;
  throw new Error(buildMissingConfigMessage());
}
