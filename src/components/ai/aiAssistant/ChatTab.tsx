import { Bot, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAiAssistantStore } from '../../../store/aiAssistantStore';
import { errorMessage } from '../../../utils/errorHandling';
import { AI_SYSTEM_PROMPT, buildApiMessages, dispatchTool } from './chatHelpers';
import { getEndpoint, streamAnthropic, streamOpenAI } from './llmStreaming';
import { MessageBubble } from './MessageBubble';

/**
 * Chat tab — owns the streaming chat loop, including tool-use round-trips.
 * When `useClaudeCode` is on, this becomes a static hint pointing the user
 * to the MCP tab instead (Claude Code drives the conversation externally).
 */
export function ChatTab() {
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
            // OpenAI tool result format — bypass the union type since the
            // OpenAI Chat Completions API recognises a `tool` role that our
            // Anthropic-shaped ApiMessage union doesn't model.
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
