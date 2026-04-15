/**
 * ReplaceFacePanel — floating panel overlay for the Replace Face dialog (D171).
 *
 * Shown when activeDialog === 'replace-face'.
 * Step 1: click source face. Step 2: click target face. OK commits.
 */

import { X, Check } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';

export default function ReplaceFacePanel() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const replaceFaceSourceId = useCADStore((s) => s.replaceFaceSourceId);
  const replaceFaceTargetId = useCADStore((s) => s.replaceFaceTargetId);
  const commitReplaceFace = useCADStore((s) => s.commitReplaceFace);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);

  if (activeDialog !== 'replace-face') return null;

  const step = replaceFaceSourceId === null ? 1 : replaceFaceTargetId === null ? 2 : 3;
  const canCommit = replaceFaceSourceId !== null && replaceFaceTargetId !== null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: 260,
        background: 'var(--panel-bg, #1e1e2e)',
        color: 'var(--panel-text, #cdd6f4)',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        fontFamily: 'inherit',
        fontSize: 13,
        zIndex: 50,
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px 8px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>Replace Face</span>
        <button
          onClick={() => setActiveDialog(null)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1 }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px' }}>
        {/* Step indicator */}
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            background: step === 1 ? 'rgba(33,150,243,0.18)' : 'rgba(255,255,255,0.06)',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {replaceFaceSourceId ? (
            <Check size={14} style={{ color: '#ff6600', flexShrink: 0 }} />
          ) : (
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#2196f3', flexShrink: 0, display: 'inline-block' }} />
          )}
          <span>
            {replaceFaceSourceId ? 'Source face selected' : 'Step 1: Click source face'}
          </span>
        </div>

        <div
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            background: step === 2 ? 'rgba(76,175,80,0.18)' : 'rgba(255,255,255,0.06)',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            opacity: replaceFaceSourceId === null ? 0.45 : 1,
          }}
        >
          {replaceFaceTargetId ? (
            <Check size={14} style={{ color: '#4caf50', flexShrink: 0 }} />
          ) : (
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#4caf50', flexShrink: 0, display: 'inline-block' }} />
          )}
          <span>
            {replaceFaceTargetId ? 'Target face selected' : 'Step 2: Click target face'}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '0 14px 12px',
          justifyContent: 'flex-end',
        }}
      >
        <button
          onClick={() => setActiveDialog(null)}
          style={{
            padding: '6px 14px',
            borderRadius: 5,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Cancel
        </button>
        <button
          onClick={commitReplaceFace}
          disabled={!canCommit}
          style={{
            padding: '6px 14px',
            borderRadius: 5,
            border: 'none',
            background: canCommit ? '#2196f3' : 'rgba(255,255,255,0.1)',
            color: canCommit ? '#fff' : 'rgba(255,255,255,0.35)',
            cursor: canCommit ? 'pointer' : 'not-allowed',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
