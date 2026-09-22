import { runHelpCommand } from '../src/lc/commands/help.ts';
import { runClearCommand } from '../src/lc/commands/clear.ts';
import { runContextCommand } from '../src/lc/commands/context.ts';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';

console.log('--- runHelpCommand ---');
runHelpCommand();

console.log('--- runClearCommand ---');
runClearCommand();

console.log('--- runContextCommand ---');
const history = [
  new HumanMessage('你好'),
  new AIMessage('你好，有什么可以帮你？'),
  new ToolMessage({ tool_call_id: '1', content: 'tool result' }),
  new AIMessage('完成。'),
];
runContextCommand(history, '.front/sessions/lxh/default.json');

console.log('--- OK ---');
