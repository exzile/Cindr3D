/**
 * Helpers shared by the chat loop:
 *   • AI_SYSTEM_PROMPT — operator-mode prompt with the BYOK tool catalogue
 *     interpolated in so the model sees the same tool list the host hands it
 *   • dispatchTool — bridges a model-issued tool call to the local TOOL_HANDLERS,
 *     with a confirm() gate for destructive operations
 *   • buildApiMessages — translates our ChatMessage[] into provider-shaped
 *     request messages (tool results require a paired tool_use/tool_result)
 */
import { BYOK_TOOLS, DESTRUCTIVE_TOOLS } from '../../../services/mcp/tools/byokDefs';
import { TOOL_HANDLERS } from '../../../services/mcp/tools/index';
import { errorMessage } from '../../../utils/errorHandling';
import type { ChatMessage } from '../../../store/aiAssistantStore';
import type { ApiMessage } from './types';

export const AI_SYSTEM_PROMPT = `You are Cindr3D's in-app AI operator for CAD, slicing, printer monitoring, and physical printer control.

Use the available MCP tools when they are the safest way to inspect state or act. Before acting on printer hardware, prefer reading status first. For named printer requests, list printers and switch to the requested printer before running printer tools. Execute multi-step user requests as an explicit ordered plan using tool calls, then summarize what changed.

Safety rules:
- Never invent printer, file, object, or profile IDs. List or inspect first when uncertain.
- Ask for clarification instead of guessing when a command could affect the wrong printer, wrong file, or wrong temperature.
- Destructive or physical operations may be gated by the app and require user confirmation.
- Treat emergency stop, cancel print, file deletion, raw G-code, homing, jogging, extrusion, heater changes, fan changes, filament load/unload, macro runs, and starting/resuming prints as physical actions.

Available MCP tools:
${BYOK_TOOLS.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}`;

export async function dispatchTool(
  name: string,
  input: unknown,
  confirmDestructive: boolean,
): Promise<string> {
  if (confirmDestructive && DESTRUCTIVE_TOOLS.has(name)) {
    const ok = window.confirm(`The assistant wants to run "${name}". This can modify geometry, files, printer settings, or physical printer state. Proceed?`);
    if (!ok) return JSON.stringify({ error: 'User declined the operation.' });
  }
  const handler = TOOL_HANDLERS[name];
  if (!handler) return JSON.stringify({ error: `Unknown tool: ${name}` });
  try {
    const result = await handler(input as Record<string, unknown>);
    return JSON.stringify(result ?? { ok: true });
  } catch (err) {
    return JSON.stringify({ error: errorMessage(err, 'Unknown error') });
  }
}

export function buildApiMessages(messages: ChatMessage[]): ApiMessage[] {
  return [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    ...messages.flatMap((m): ApiMessage[] => {
      if (m.role === 'user') return [{ role: 'user', content: m.content }];
      if (m.role === 'assistant') return [{ role: 'assistant', content: m.content }];
      if (m.role === 'tool_result' && m.toolName) {
        return [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: m.id, name: m.toolName, input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: m.id, content: m.content }],
          },
        ];
      }
      return [];
    }),
  ];
}
