import { useState, useCallback } from 'react';
import { Zap, Plus, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import {
  compactIconOnlyButtonStyle,
  compactActionButtonStyle as iconBtn,
  panelInputStyle as inputStyle,
  panelStyle,
  primaryActionButtonStyle,
  sectionTitleStyle as sectionTitle,
} from '../../utils/printerPanelStyles';
import {
  getDuetPrefs, updateDuetPrefs, type CustomButton,
} from '../../utils/duetPrefs';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DuetCustomButtons() {
  const connected = usePrinterStore((s) => s.connected);
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const [buttons, setButtons] = useState<CustomButton[]>(() => getDuetPrefs().customButtons);
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftGcode, setDraftGcode] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const persist = useCallback((next: CustomButton[]) => {
    updateDuetPrefs({ customButtons: next });
    setButtons(next);
  }, []);

  const handleRun = useCallback(async (btn: CustomButton) => {
    if (!connected) return;
    setRunning(btn.id);
    try {
      // Support multi-line G-code by sending each non-empty line in order
      for (const line of btn.gcode.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        await sendGCode(line);
      }
    } finally {
      setRunning(null);
    }
  }, [connected, sendGCode]);

  const handleStartEdit = useCallback((btn?: CustomButton) => {
    setDraftId(btn?.id ?? null);
    setDraftLabel(btn?.label ?? '');
    setDraftGcode(btn?.gcode ?? '');
  }, []);

  const handleSaveDraft = useCallback(() => {
    const label = draftLabel.trim();
    const gcode = draftGcode.trim();
    if (!label || !gcode) return;
    if (draftId) {
      persist(buttons.map((b) => (b.id === draftId ? { ...b, label, gcode } : b)));
    } else {
      persist([...buttons, { id: `cb-${Date.now()}`, label, gcode }]);
    }
    setDraftId(null);
    setDraftLabel('');
    setDraftGcode('');
  }, [buttons, draftId, draftLabel, draftGcode, persist]);

  const handleCancelDraft = useCallback(() => {
    setDraftId(null);
    setDraftLabel('');
    setDraftGcode('');
  }, []);

  const handleDelete = useCallback((id: string) => {
    persist(buttons.filter((b) => b.id !== id));
  }, [buttons, persist]);

  const isDraftValid = draftLabel.trim().length > 0 && draftGcode.trim().length > 0;

  return (
    <div style={panelStyle()}>
      <div className="duet-custom-header">
        <div style={sectionTitle()}><Zap size={14} /> Custom Buttons</div>
        <button
          style={iconBtn()}
          onClick={() => {
            setEditing((v) => !v);
            handleCancelDraft();
          }}
          title={editing ? 'Done editing' : 'Edit buttons'}
        >
          {editing ? <Check size={12} /> : <Pencil size={12} />}
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {buttons.length === 0 && !editing && (
        <div className="duet-custom-empty">
          No custom buttons yet. Click <strong>Edit</strong> to add some.
        </div>
      )}

      {buttons.length > 0 && (
        <div className="duet-custom-grid">
          {buttons.map((btn) => {
            const isRunning = running === btn.id;
            return (
              <div key={btn.id} className="duet-custom-item">
                <button
                  className="duet-custom-btn"
                  onClick={() => handleRun(btn)}
                  disabled={!connected || isRunning}
                  title={btn.gcode}
                >
                  {isRunning ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
                  <span className="duet-custom-btn-label">{btn.label}</span>
                </button>
                {editing && (
                  <div className="duet-custom-overlay-actions">
                    <button
                      style={compactIconOnlyButtonStyle()}
                      onClick={() => handleStartEdit(btn)}
                      title="Edit"
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      style={compactIconOnlyButtonStyle({ color: 'var(--error)' })}
                      onClick={() => handleDelete(btn.id)}
                      title="Delete"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="duet-custom-editor">
          <div style={sectionTitle({ marginBottom: 10 })}>
            {draftId ? 'Edit button' : <><Plus size={12} /> New button</>}
          </div>
          <div className="duet-custom-fields">
            <input
              style={inputStyle()}
              type="text"
              placeholder="Label (e.g. Preheat PLA)"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              maxLength={40}
            />
            <textarea
              style={inputStyle({ fontFamily: 'monospace', minHeight: 60, resize: 'vertical' })}
              placeholder={'G-code (one command per line)\nM104 S200\nM140 S60'}
              value={draftGcode}
              onChange={(e) => setDraftGcode(e.target.value)}
            />
            <div className="duet-custom-field-actions">
              {draftId && (
                <button style={iconBtn()} onClick={handleCancelDraft}>
                  <X size={12} /> Cancel
                </button>
              )}
              <button
                style={primaryActionButtonStyle(isDraftValid)}
                onClick={handleSaveDraft}
                disabled={!isDraftValid}
              >
                {draftId ? <><Check size={12} /> Save</> : <><Plus size={12} /> Add</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
