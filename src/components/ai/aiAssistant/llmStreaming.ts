/**
 * Provider-specific SSE streaming for the AI Assistant chat:
 *   • readSSE       — generic Server-Sent Events reader
 *   • streamAnthropic — Anthropic Messages API
 *   • streamOpenAI    — OpenAI / OpenRouter chat-completions
 *   • getEndpoint     — picks the right URL for the configured provider
 *
 * Both stream functions yield a normalised `StreamEvent` so the chat loop
 * doesn't care which provider answered.
 */
import { BYOK_TOOLS, toAnthropic, toOpenAI } from '../../../services/mcp/tools/byokDefs';
import type { AiProvider } from '../../../store/aiAssistantStore';
import type { ApiMessage, StreamEvent } from './types';

async function* readSSE(response: Response): AsyncGenerator<{ event?: string; data: string }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let currentEvent: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data && data !== '[DONE]') {
          yield { event: currentEvent, data };
          currentEvent = undefined;
        }
      }
    }
  }
}

export async function* streamAnthropic(
  model: string,
  apiKey: string,
  messages: ApiMessage[],
  systemPrompt: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const tools = BYOK_TOOLS.map(toAnthropic);
  const apiMessages = messages.filter((message) => message.role !== 'system');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, system: systemPrompt, messages: apiMessages, tools, stream: true, max_tokens: 4096 }),
    signal,
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);

  let stopReason = 'end_turn';
  const toolBlocks: Record<number, { id: string; name: string; jsonAccum: string }> = {};

  for await (const { event, data } of readSSE(res)) {
    const obj = JSON.parse(data) as Record<string, unknown>;
    if (event === 'content_block_start') {
      const cb = obj.content_block as Record<string, unknown>;
      const idx = obj.index as number;
      if (cb.type === 'tool_use') {
        toolBlocks[idx] = { id: cb.id as string, name: cb.name as string, jsonAccum: '' };
      }
    } else if (event === 'content_block_delta') {
      const delta = obj.delta as Record<string, unknown>;
      const idx = obj.index as number;
      if (delta.type === 'text_delta') yield { type: 'text', delta: delta.text as string };
      else if (delta.type === 'input_json_delta' && toolBlocks[idx]) {
        toolBlocks[idx].jsonAccum += delta.partial_json as string;
      }
    } else if (event === 'content_block_stop') {
      const idx = obj.index as number;
      if (toolBlocks[idx]) {
        const tb = toolBlocks[idx];
        let input: unknown = {};
        try { input = JSON.parse(tb.jsonAccum || '{}'); } catch { /* empty input */ }
        yield { type: 'tool_call', id: tb.id, name: tb.name, input };
        delete toolBlocks[idx];
      }
    } else if (event === 'message_delta') {
      const delta = obj.delta as Record<string, unknown>;
      if (delta.stop_reason) stopReason = delta.stop_reason as string;
    }
  }
  yield { type: 'done', stop_reason: stopReason };
}

export async function* streamOpenAI(
  endpoint: string,
  model: string,
  apiKey: string,
  messages: ApiMessage[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const tools = BYOK_TOOLS.map(toOpenAI);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, tools, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

  const toolAccum: Record<number, { id: string; name: string; args: string }> = {};
  let stopReason = 'stop';

  for await (const { data } of readSSE(res)) {
    const obj = JSON.parse(data) as Record<string, unknown>;
    const choices = (obj.choices as unknown[]) ?? [];
    for (const choice of choices) {
      const c = choice as Record<string, unknown>;
      const delta = c.delta as Record<string, unknown> | undefined;
      if (!delta) continue;
      if (delta.content) yield { type: 'text', delta: delta.content as string };
      const toolCalls = (delta.tool_calls as unknown[]) ?? [];
      for (const tc of toolCalls) {
        const t = tc as Record<string, unknown>;
        const idx = t.index as number;
        const fn = t.function as Record<string, unknown> | undefined;
        if (t.id) toolAccum[idx] = { id: t.id as string, name: (fn?.name as string) ?? '', args: (fn?.arguments as string) ?? '' };
        else if (toolAccum[idx]) {
          toolAccum[idx].name ||= (fn?.name as string) ?? '';
          toolAccum[idx].args += (fn?.arguments as string) ?? '';
        }
      }
      if (c.finish_reason) stopReason = c.finish_reason as string;
    }
  }

  for (const tb of Object.values(toolAccum)) {
    let input: unknown = {};
    try { input = JSON.parse(tb.args || '{}'); } catch { /* empty */ }
    yield { type: 'tool_call', id: tb.id, name: tb.name, input };
  }
  yield { type: 'done', stop_reason: stopReason };
}

export function getEndpoint(provider: AiProvider): string {
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
  return 'https://api.openai.com/v1/chat/completions';
}
