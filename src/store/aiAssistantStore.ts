import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AiProvider = 'anthropic' | 'openai' | 'openrouter';
export type AiPanelTab = 'mcp' | 'chat';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_result';
  content: string;
  toolName?: string;
  toolResult?: unknown;
  timestamp: number;
  error?: boolean;
}

export interface AiAssistantState {
  // Panel
  panelOpen: boolean;
  activeTab: AiPanelTab;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setActiveTab: (tab: AiPanelTab) => void;

  // BYOK settings (persisted)
  provider: AiProvider;
  model: string;
  apiKey: string;
  useClaudeCode: boolean;
  confirmDestructive: boolean;
  setProvider: (p: AiProvider) => void;
  setModel: (m: string) => void;
  setApiKey: (k: string) => void;
  setUseClaudeCode: (v: boolean) => void;
  setConfirmDestructive: (v: boolean) => void;

  // Chat session (not persisted between reloads)
  messages: ChatMessage[];
  streaming: boolean;
  addMessage: (msg: ChatMessage) => void;
  appendToLast: (delta: string) => void;
  setStreaming: (v: boolean) => void;
  clearMessages: () => void;
}

const PROVIDER_DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  openrouter: 'anthropic/claude-sonnet-4-5',
};

export const useAiAssistantStore = create<AiAssistantState>()(
  persist(
    (set) => ({
      panelOpen: false,
      activeTab: 'mcp',
      setPanelOpen: (open) => set({ panelOpen: open }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      setActiveTab: (tab) => set({ activeTab: tab }),

      provider: 'anthropic',
      model: PROVIDER_DEFAULT_MODELS.anthropic,
      apiKey: '',
      useClaudeCode: false,
      confirmDestructive: true,
      setProvider: (p) => set((s) => ({ provider: p, model: s.provider === p ? s.model : PROVIDER_DEFAULT_MODELS[p] })),
      setModel: (m) => set({ model: m }),
      setApiKey: (k) => set({ apiKey: k }),
      setUseClaudeCode: (v) => set({ useClaudeCode: v }),
      setConfirmDestructive: (v) => set({ confirmDestructive: v }),

      messages: [],
      streaming: false,
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      appendToLast: (delta) => set((s) => {
        if (s.messages.length === 0) return {};
        const msgs = [...s.messages];
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: msgs[msgs.length - 1].content + delta };
        return { messages: msgs };
      }),
      setStreaming: (v) => set({ streaming: v }),
      clearMessages: () => set({ messages: [] }),
    }),
    {
      name: 'cindr3d-ai-assistant',
      // SECURITY: apiKey is intentionally NOT persisted. localStorage is
      // readable by any script on the same origin (and by browser extensions),
      // so persisting Anthropic / OpenAI / OpenRouter keys would leak them on
      // the public Azure demo. Users re-enter the key per session.
      partialize: (s) => ({
        provider: s.provider,
        model: s.model,
        useClaudeCode: s.useClaudeCode,
        confirmDestructive: s.confirmDestructive,
        activeTab: s.activeTab,
      }),
    },
  ),
);

export const PROVIDER_MODELS: Record<AiProvider, string[]> = {
  anthropic: [
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini'],
  openrouter: [
    'anthropic/claude-sonnet-4-5',
    'openai/gpt-4o',
    'google/gemini-2.5-flash-preview',
    'mistralai/mistral-large',
  ],
};
