import { useCallback, useState } from 'react';
import type { ChatMessage } from '../../../store/aiAssistantStore';
import { dispatchTool } from './chatHelpers';
import type { DiagnosisToolResult } from './types';

/** Chat message renderer — dispatches diagnosis tool-results to a richer view. */
export function MessageBubble({ msg }: { msg: ChatMessage }) {
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
