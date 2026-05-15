/** Shared types for the AI Assistant panel + its tabs. */

export type ApiContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export type ApiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ApiContent[] }
  | { role: 'assistant'; content: string | ApiContent[] };

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'done'; stop_reason: string };

export type PanelGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type DiagnosisToolResult = {
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
