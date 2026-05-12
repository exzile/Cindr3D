import { Bot, ChevronDown, ChevronRight, Copy, GripHorizontal, List, RefreshCw, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cindr3dMcpClient, type Cindr3dMcpAuditEntry, type Cindr3dMcpStatus } from '../../services/mcp/client';
import { BYOK_TOOLS, DESTRUCTIVE_TOOLS, toAnthropic, toOpenAI } from '../../services/mcp/tools/byokDefs';
import { errorMessage } from '../../utils/errorHandling';
import { TOOL_HANDLERS } from '../../services/mcp/tools/index';
import { useAiAssistantStore, type AiProvider, type ChatMessage } from '../../store/aiAssistantStore';
import './AiAssistantPanel.css';

// ── SSE stream helpers ────────────────────────────────────────────────────────

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

// ── Message types for API calls ───────────────────────────────────────────────

type ApiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ApiContent[] }
  | { role: 'assistant'; content: string | ApiContent[] };

type ApiContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type PanelGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type DiagnosisToolResult = {
  result?: {
    summary?: string;
    rankedCauses?: Array<{
      title?: string;
      rationale?: string;
      confidence?: number;
      settingTweaks?: Array<{ tool: string; args: Record<string, unknown>; label: string }>;
    }>;
    immediateActions?: string[];
  };
};

const PANEL_GEOMETRY_KEY = 'cindr3d-ai-assistant-geometry';
const PANEL_MIN_WIDTH = 360;
const PANEL_MIN_HEIGHT = 380;
const PANEL_EDGE_GAP = 8;

const AI_SYSTEM_PROMPT = `You are Cindr3D's in-app AI operator for CAD, slicing, printer monitoring, and physical printer control.

Use the available MCP tools when they are the safest way to inspect state or act. Before acting on printer hardware, prefer reading status first. For named printer requests, list printers and switch to the requested printer before running printer tools. Execute multi-step user requests as an explicit ordered plan using tool calls, then summarize what changed.

Safety rules:
- Never invent printer, file, object, or profile IDs. List or inspect first when uncertain.
- Ask for clarification instead of guessing when a command could affect the wrong printer, wrong file, or wrong temperature.
- Destructive or physical operations may be gated by the app and require user confirmation.
- Treat emergency stop, cancel print, file deletion, raw G-code, homing, jogging, extrusion, heater changes, fan changes, filament load/unload, macro runs, and starting/resuming prints as physical actions.

Available MCP tools:
${BYOK_TOOLS.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}`;

function defaultPanelGeometry(): PanelGeometry {
  const width = Math.min(440, Math.max(PANEL_MIN_WIDTH, window.innerWidth - 32));
  const height = Math.min(620, Math.max(PANEL_MIN_HEIGHT, window.innerHeight - 88));
  return {
    left: Math.max(PANEL_EDGE_GAP, window.innerWidth - width - 16),
    top: 48,
    width,
    height,
  };
}

function clampPanelGeometry(next: PanelGeometry): PanelGeometry {
  const maxWidth = Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_EDGE_GAP * 2);
  const maxHeight = Math.max(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_EDGE_GAP * 2);
  const width = Math.min(Math.max(next.width, PANEL_MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(next.height, PANEL_MIN_HEIGHT), maxHeight);
  const maxLeft = Math.max(PANEL_EDGE_GAP, window.innerWidth - width - PANEL_EDGE_GAP);
  const maxTop = Math.max(PANEL_EDGE_GAP, window.innerHeight - height - PANEL_EDGE_GAP);
  return {
    width,
    height,
    left: Math.min(Math.max(next.left, PANEL_EDGE_GAP), maxLeft),
    top: Math.min(Math.max(next.top, PANEL_EDGE_GAP), maxTop),
  };
}

function loadPanelGeometry(): PanelGeometry {
  try {
    const raw = localStorage.getItem(PANEL_GEOMETRY_KEY);
    if (!raw) return defaultPanelGeometry();
    const parsed = JSON.parse(raw) as Partial<PanelGeometry>;
    if (
      typeof parsed.left === 'number' &&
      typeof parsed.top === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return clampPanelGeometry(parsed as PanelGeometry);
    }
  } catch {
    // Fall through to a fresh placement when persisted geometry is invalid.
  }
  return defaultPanelGeometry();
}

// ── Streaming logic ───────────────────────────────────────────────────────────

type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'done'; stop_reason: string };

async function* streamAnthropic(
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

async function* streamOpenAI(
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

function getEndpoint(provider: AiProvider): string {
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
  return 'https://api.openai.com/v1/chat/completions';
}

// ── Dispatch tool call ────────────────────────────────────────────────────────

async function dispatchTool(
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

// ── Convert our ChatMessage[] to API messages ─────────────────────────────────

function buildApiMessages(messages: ChatMessage[]): ApiMessage[] {
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

// ── Sub-components ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'tool_result') {
    if (msg.toolName === 'diagnose_print') return <DiagnosisResultBubble msg={msg} />;
    return (
      <div className="ai-msg ai-msg-tool">
        <span className="ai-msg-tool-name">{msg.toolName}</span>
        <span className="ai-msg-tool-result">{msg.content}</span>
      </div>
    );
  }
  return (
    <div className={`ai-msg ai-msg-${msg.role} ${msg.error ? 'ai-msg-error' : ''}`}>
      <div className="ai-msg-content">{msg.content || <span className="ai-msg-thinking">…</span>}</div>
    </div>
  );
}

function DiagnosisResultBubble({ msg }: { msg: ChatMessage }) {
  const [applying, setApplying] = useState<string | null>(null);
  let parsed: DiagnosisToolResult | null = null;
  try {
    parsed = JSON.parse(msg.content) as DiagnosisToolResult;
  } catch {
    parsed = null;
  }
  const diagnosis = parsed?.result;
  const causes = diagnosis?.rankedCauses ?? [];
  const actions = diagnosis?.immediateActions ?? [];
  const tweaks = causes.flatMap((cause) => cause.settingTweaks ?? []);

  const applyTweak = useCallback(async (tweak: { tool: string; args: Record<string, unknown>; label: string }) => {
    setApplying(tweak.label);
    try {
      await dispatchTool(tweak.tool, tweak.args, true);
    } finally {
      setApplying(null);
    }
  }, []);

  if (!diagnosis) {
    return (
      <div className="ai-msg ai-msg-tool">
        <span className="ai-msg-tool-name">{msg.toolName}</span>
        <span className="ai-msg-tool-result">{msg.content}</span>
      </div>
    );
  }

  return (
    <div className="ai-msg ai-msg-tool ai-diagnosis">
      <span className="ai-msg-tool-name">diagnose_print</span>
      <div className="ai-diagnosis-summary">{diagnosis.summary}</div>
      {causes.length > 0 && (
        <div className="ai-diagnosis-causes">
          {causes.slice(0, 3).map((cause, index) => (
            <div key={`${cause.title}-${index}`} className="ai-diagnosis-cause">
              <span>{cause.title ?? 'Possible cause'}</span>
              {typeof cause.confidence === 'number' && <span>{Math.round(cause.confidence * 100)}%</span>}
            </div>
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <div className="ai-diagnosis-actions">
          {actions.slice(0, 3).map((action, index) => <span key={`${action}-${index}`}>{action}</span>)}
        </div>
      )}
      {tweaks.length > 0 && (
        <div className="ai-diagnosis-tweaks">
          {tweaks.slice(0, 4).map((tweak, index) => (
            <button
              key={`${tweak.tool}-${tweak.label}-${index}`}
              type="button"
              className="ai-diagnosis-tweak"
              disabled={applying !== null}
              onClick={() => void applyTweak(tweak)}
              title={tweak.tool}
            >
              {applying === tweak.label ? 'Applying...' : tweak.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function McpTab() {
  const [status, setStatus] = useState<Cindr3dMcpStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEntries, setAuditEntries] = useState<Cindr3dMcpAuditEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    cindr3dMcpClient.heartbeat().then(setStatus).catch((e) => setErr(errorMessage(e, 'Unknown error')));
  }, []);

  const copy = useCallback(async () => {
    if (!status) return;
    await navigator.clipboard.writeText(status.pairingLine);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [status]);

  const rotate = useCallback(async () => {
    try { setStatus(await cindr3dMcpClient.rotateToken()); setErr(null); }
    catch (e) { setErr(errorMessage(e, 'Unknown error')); }
  }, []);

  const toggleAudit = useCallback(async () => {
    const next = !auditOpen;
    setAuditOpen(next);
    if (!next) return;
    try {
      const { entries } = await cindr3dMcpClient.audit();
      setAuditEntries(entries);
      setErr(null);
    } catch (e) { setErr(errorMessage(e, 'Unknown error')); }
  }, [auditOpen]);

  const clearAudit = useCallback(async () => {
    try { await cindr3dMcpClient.clearAudit(); setAuditEntries([]); } catch { /* ignore */ }
  }, []);

  return (
    <div className="ai-tab-content">
      <div className="ai-mcp-status">
        <span className={`ai-mcp-dot ${status?.running ? 'ai-mcp-dot-on' : ''}`} />
        <span>{status?.running ? 'MCP Server Running' : 'MCP Server Starting…'}</span>
        {status && (
          <span className="ai-mcp-port">:{status.port}</span>
        )}
      </div>

      {err && <div className="ai-error">{err}</div>}

      {status && (
        <>
          <div className="ai-section-label">Claude Code Config</div>
          <div className="ai-code-block">
            <pre>{status.pairingLine}</pre>
            <div className="ai-code-actions">
              <button type="button" className="ai-icon-btn" onClick={copy} title="Copy" aria-label="Copy Claude Code MCP config">
                <Copy size={12} />
                {copied && <span className="ai-copied-label">Copied</span>}
              </button>
              <button type="button" className="ai-icon-btn" onClick={rotate} title="Rotate token" aria-label="Rotate Claude Code MCP pairing token">
                <RefreshCw size={12} />
              </button>
            </div>
          </div>
          <p className="ai-hint">
            Add the config above to your Claude Code MCP settings (Settings → MCP Servers), then chat in your terminal — geometry updates appear here instantly.
          </p>
        </>
      )}

      <div className="ai-audit-header">
        <button type="button" className="ai-collapse-btn" onClick={toggleAudit} aria-expanded={auditOpen} aria-controls="ai-mcp-audit-list">
          {auditOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span>Recent Tool Calls</span>
          <List size={11} />
        </button>
        {auditOpen && (
          <button type="button" className="ai-icon-btn" onClick={clearAudit} title="Clear" aria-label="Clear recent MCP tool calls">
            <X size={11} />
          </button>
        )}
      </div>

      {auditOpen && (
        <div className="ai-audit-list" id="ai-mcp-audit-list">
          {auditEntries.length === 0 && <div className="ai-audit-empty">No tool calls yet</div>}
          {auditEntries.slice(0, 12).map((e) => (
            <div key={`${e.callId}-${e.timestamp}`} className={`ai-audit-row ai-audit-${e.status}`}>
              <span className="ai-audit-tool">{e.tool}</span>
              <span className="ai-audit-status">{e.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatTab() {
  const provider = useAiAssistantStore((s) => s.provider);
  const model = useAiAssistantStore((s) => s.model);
  const apiKey = useAiAssistantStore((s) => s.apiKey);
  const useClaudeCode = useAiAssistantStore((s) => s.useClaudeCode);
  const confirmDestructive = useAiAssistantStore((s) => s.confirmDestructive);
  const messages = useAiAssistantStore((s) => s.messages);
  const streaming = useAiAssistantStore((s) => s.streaming);
  const addMessage = useAiAssistantStore((s) => s.addMessage);
  const appendToLast = useAiAssistantStore((s) => s.appendToLast);
  const setStreaming = useAiAssistantStore((s) => s.setStreaming);
  const clearMessages = useAiAssistantStore((s) => s.clearMessages);

  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    addMessage({ id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now() });
    setStreaming(true);
    setInput('');

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const history = [...useAiAssistantStore.getState().messages];
    const apiMessages = buildApiMessages(history);

    let continueLoop = true;
    while (continueLoop) {
      if (controller.signal.aborted) break;
      const assistantId = crypto.randomUUID();
      addMessage({ id: assistantId, role: 'assistant', content: '', timestamp: Date.now() });

      try {
        const stream = provider === 'anthropic'
          ? streamAnthropic(model, apiKey, apiMessages, AI_SYSTEM_PROMPT, controller.signal)
          : streamOpenAI(getEndpoint(provider), model, apiKey, apiMessages, controller.signal);

        let lastAssistantContent = '';
        const pendingToolCalls: Array<{ id: string; name: string; input: unknown }> = [];

        for await (const evt of stream) {
          if (evt.type === 'text') {
            appendToLast(evt.delta);
            lastAssistantContent += evt.delta;
          } else if (evt.type === 'tool_call') {
            pendingToolCalls.push(evt);
          } else if (evt.type === 'done') {
            continueLoop = (evt.stop_reason === 'tool_use' || evt.stop_reason === 'tool_calls') && pendingToolCalls.length > 0;
          }
        }

        if (lastAssistantContent) {
          apiMessages.push({ role: 'assistant', content: lastAssistantContent });
        }

        // Execute tool calls sequentially
        for (const tc of pendingToolCalls) {
          const resultStr = await dispatchTool(tc.name, tc.input, confirmDestructive);
          addMessage({ id: tc.id, role: 'tool_result', toolName: tc.name, content: resultStr, timestamp: Date.now() });

          // Build tool_use + tool_result into API messages
          if (provider === 'anthropic') {
            apiMessages.push({ role: 'assistant', content: [{ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input }] });
            apiMessages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tc.id, content: resultStr }] });
          } else {
            // OpenAI tool result format
            (apiMessages as unknown as Record<string, unknown>[]).push({
              role: 'tool',
              tool_call_id: tc.id,
              content: resultStr,
            });
          }
        }

        if (pendingToolCalls.length === 0) continueLoop = false;
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          continueLoop = false;
          break;
        }
        const msg = errorMessage(err, 'Unknown error');
        addMessage({ id: crypto.randomUUID(), role: 'assistant', content: `Error: ${msg}`, error: true, timestamp: Date.now() });
        continueLoop = false;
      }
    }

    if (abortRef.current === controller) abortRef.current = null;
    setStreaming(false);
  }, [streaming, provider, model, apiKey, confirmDestructive, addMessage, appendToLast, setStreaming]);

  const runDiagnosis = useCallback(async () => {
    if (streaming || !apiKey) return;
    setStreaming(true);
    addMessage({ id: crypto.randomUUID(), role: 'user', content: "What's wrong with my print?", timestamp: Date.now() });
    try {
      const resultStr = await dispatchTool('diagnose_print', { frameCount: 3 }, confirmDestructive);
      addMessage({ id: crypto.randomUUID(), role: 'tool_result', toolName: 'diagnose_print', content: resultStr, timestamp: Date.now() });
    } catch (err) {
      addMessage({ id: crypto.randomUUID(), role: 'assistant', content: `Error: ${errorMessage(err, 'Unknown error')}`, error: true, timestamp: Date.now() });
    } finally {
      setStreaming(false);
    }
  }, [streaming, apiKey, confirmDestructive, addMessage, setStreaming]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, [setStreaming]);

  if (useClaudeCode) {
    return (
      <div className="ai-tab-content">
        <div className="ai-claude-code-hint">
          <Bot size={20} className="ai-cc-icon" />
          <p>Chat in your terminal via Claude Code — geometry updates appear here live.</p>
          <p className="ai-hint">Use the top-right Global Settings menu to switch chat providers or add an API key.</p>
          <p className="ai-hint">Switch to the MCP tab for your connection config.</p>
        </div>
      </div>
    );
  }

  const canSend = !!apiKey && !streaming;

  return (
    <div className="ai-chat-root">
      <div className="ai-messages">
        {messages.length === 0 && (
          <div className="ai-empty">
            <Bot size={24} />
            <p>Ask me to create geometry, run booleans, or set up your design.</p>
            {!apiKey && <p>Set your provider and API key in Global Settings to enable chat.</p>}
          </div>
        )}
        {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
        <div ref={bottomRef} />
      </div>
      <div className="ai-quick-actions">
        <button type="button" className="ai-quick-action" disabled={!apiKey || streaming} onClick={() => void runDiagnosis()}>
          Diagnose print
        </button>
      </div>
      <div className="ai-input-row">
        <textarea
          className="ai-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={apiKey ? 'Message Cindr3D AI…' : 'Set an API key in Global Settings to start chatting'}
          aria-label="Message Cindr3D AI"
          rows={2}
          disabled={!apiKey}
        />
        <div className="ai-input-actions">
          {streaming
            ? <button type="button" className="ai-send-btn ai-stop-btn" onClick={stop} title="Stop" aria-label="Stop AI response"><X size={14} /></button>
            : <button type="button" className="ai-send-btn" disabled={!canSend || !input.trim()} onClick={() => void sendMessage(input)} title="Send (Enter)" aria-label="Send AI message"><Send size={14} /></button>
          }
          {messages.length > 0 && !streaming && (
            <button type="button" className="ai-clear-btn" onClick={clearMessages} title="Clear chat" aria-label="Clear AI chat">
              <X size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AiAssistantPanel() {
  const panelOpen = useAiAssistantStore((s) => s.panelOpen);
  const activeTab = useAiAssistantStore((s) => s.activeTab);
  const setPanelOpen = useAiAssistantStore((s) => s.setPanelOpen);
  const setActiveTab = useAiAssistantStore((s) => s.setActiveTab);
  const [geometry, setGeometry] = useState<PanelGeometry>(() => loadPanelGeometry());

  // Holds an in-flight drag/resize cleanup so we can flush it on unmount, on
  // pointercancel (alt-tab, system interrupt), or when a new gesture starts —
  // otherwise window listeners that only unhook on pointerup leak forever if
  // the up event never arrives.
  const activeGestureCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!panelOpen) return;
    localStorage.setItem(PANEL_GEOMETRY_KEY, JSON.stringify(geometry));
  }, [geometry, panelOpen]);

  useEffect(() => {
    const handleResize = () => setGeometry((g) => clampPanelGeometry(g));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => () => {
    activeGestureCleanupRef.current?.();
    activeGestureCleanupRef.current = null;
  }, []);

  const beginMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activeGestureCleanupRef.current?.();

    const startX = event.clientX;
    const startY = event.clientY;
    const start = geometry;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setGeometry(clampPanelGeometry({
        ...start,
        left: start.left + moveEvent.clientX - startX,
        top: start.top + moveEvent.clientY - startY,
      }));
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      if (activeGestureCleanupRef.current === cleanup) activeGestureCleanupRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    activeGestureCleanupRef.current = cleanup;
  }, [geometry]);

  const beginResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activeGestureCleanupRef.current?.();

    const startX = event.clientX;
    const startY = event.clientY;
    const start = geometry;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setGeometry(clampPanelGeometry({
        ...start,
        width: start.width + moveEvent.clientX - startX,
        height: start.height + moveEvent.clientY - startY,
      }));
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      if (activeGestureCleanupRef.current === cleanup) activeGestureCleanupRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    activeGestureCleanupRef.current = cleanup;
  }, [geometry]);

  if (!panelOpen) return null;

  return (
    <div
      className="ai-panel"
      style={{
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
      }}
    >
      <div className="ai-panel-header">
        <div className="ai-panel-drag-region" onPointerDown={beginMove} title="Drag AI Assistant">
          <Bot size={15} className="ai-panel-icon" />
          <span className="ai-panel-title">AI Assistant</span>
          <GripHorizontal size={14} className="ai-panel-grip" />
        </div>
        <div className="ai-panel-tabs" role="tablist" aria-label="AI assistant sections">
          <button
            type="button"
            className={`ai-tab-btn ${activeTab === 'mcp' ? 'active' : ''}`}
            onClick={() => setActiveTab('mcp')}
            role="tab"
            aria-selected={activeTab === 'mcp'}
          >
            MCP
          </button>
          <button
            type="button"
            className={`ai-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
            role="tab"
            aria-selected={activeTab === 'chat'}
          >
            Chat
          </button>
        </div>
        <button type="button" className="ai-panel-close" onClick={() => setPanelOpen(false)} title="Close" aria-label="Close AI Assistant">
          <X size={14} />
        </button>
      </div>

      {activeTab === 'mcp' ? <McpTab /> : <ChatTab />}
      <button
        type="button"
        className="ai-panel-resize"
        onPointerDown={beginResize}
        title="Resize AI Assistant"
        aria-label="Resize AI Assistant"
      />
    </div>
  );
}
