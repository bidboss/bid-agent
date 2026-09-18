import type {ToolCallTurn} from './tools/engine.ts';

export function toolCallLog(toolCallRecords: ToolCallTurn[]) {
  // 打印工具调用记录（仅日志用）
  if (toolCallRecords.length > 0) {
    console.log('\n[工具调用记录]');
    for (const tc of toolCallRecords) {
      console.log(`  ${tc.toolName}(${JSON.stringify(tc.args)})`);
      console.log(`    → ${tc.success ? tc.result.slice(0, 200) : '[失败] ' + tc.result}`);
    }
    console.log();
  }
}