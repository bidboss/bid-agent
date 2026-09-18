// LangChain 引擎（src/lc）的冒烟自检脚本：验证「配置文件读取 → LC 配置归一化 → ChatOpenAI 连通 → 流式输出」
// 用法：npm run smoke   或者   node ./scripts/smoke-lc.mjs
import { getConfigSearchPaths, resolveConfigPath } from '../src/utils/config.js';
import { getModelConfig } from '../src/lc/config.js';
import { createChatModel, getMessageText, smokeTestModel } from '../src/lc/model.js';

/**
 * 给 apiKey 打码，避免自检日志泄露密钥
 * @param {string} apiKey 原始密钥
 * @returns {string} 打码后的字符串
 */
function maskApiKey(apiKey) {
    if (!apiKey) return '(空)';
    if (apiKey.length <= 8) return '***';
    return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`;
}

async function main() {
    console.log('== 1. 配置文件 ==');
    console.log('候选路径（按优先级）:');
    for (const configPath of getConfigSearchPaths()) {
        console.log(`  - ${configPath}`);
    }
    console.log(`实际生效: ${resolveConfigPath()}`);

    console.log('\n== 2. 归一化配置 ==');
    const config = getModelConfig();
    console.log(`baseURL: ${config.baseURL}`);
    console.log(`model: ${config.model}`);
    console.log(`userId: ${config.userId}`);
    console.log(`apiKey: ${maskApiKey(config.apiKey)}`);
    console.log(`embedding: ${config.embedding ? config.embedding.model : '(未配置，RAG 能力需降级)'}`);

    console.log('\n== 3. 普通调用 ==');
    const result = await smokeTestModel();
    console.log(`回复: ${result.text}`);

    console.log('\n== 4. 流式调用 ==');
    const streamModel = createChatModel({ streaming: true });
    let streamedText = '';
    for await (const chunk of await streamModel.stream('请只回复 OK')) {
        streamedText += getMessageText(chunk);
    }
    console.log(`流式回复: ${streamedText}`);

    console.log('\n自检全部通过');
}

main().catch((error) => {
    console.error('\n自检失败');
    console.error(error.message);
    process.exit(1);
});
