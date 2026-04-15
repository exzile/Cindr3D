/**
 * ReplaceFacePanel — floating panel overlay for the Replace Face dialog (D171).
 *
 * Shown when activeDialog === 'replace-face'.
 * Step 1: click source face. Step 2: click target face. OK commits.
 */

import { X, Check } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import './ReplaceFacePanel.css';

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
    <div className="replace-face-panel">
      {/* Header */}
      <div className="replace-face-panel__header">
        <span className="replace-face-panel__title">Replace Face</span>
        <button className="replace-face-panel__close" onClick={() => setActiveDialog(null)} title="Close">
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="replace-face-panel__body">
        <div className={`replace-face-panel__step${step === 1 ? ' replace-face-panel__step--source-active' : ''}`}>
          {replaceFaceSourceId ? (
            <Check size={14} className="replace-face-panel__check--source" />
          ) : (
            <span className="replace-face-panel__step-dot replace-face-panel__step-dot--source" />
          )}
          <span>{replaceFaceSourceId ? 'Source face selected' : 'Step 1: Click source face'}</span>
        </div>

        <div
          className={[
            'replace-face-panel__step',
            'replace-face-panel__step--last',
            step === 2 ? 'replace-face-panel__step--target-active' : '',
            replaceFaceSourceId === null ? 'replace-face-panel__step--disabled' : '',
          ].filter(Boolean).join(' ')}
        >
          {replaceFaceTargetId ? (
            <Check size={14} className="replace-face-panel__check--target" />
          ) : (
            <span className="replace-face-panel__step-dot replace-face-panel__step-dot--target" />
          )}
          <span>{replaceFaceTargetId ? 'Target face selected' : 'Step 2: Click target face'}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="replace-face-panel__footer">
        <button className="replace-face-panel__btn-cancel" onClick={() => setActiveDialog(null)}>Cancel</button>
        <button className="replace-face-panel__btn-ok" onClick={commitReplaceFace} disabled={!canCommit}>OK</button>
      </div>
    </div>
  );
}
