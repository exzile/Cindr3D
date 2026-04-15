import { useState } from 'react';
import { X, CheckCircle, XCircle } from 'lucide-react';
import type { InterferenceResult } from '../../../types/cad';

interface Props {
  open: boolean;
  onClose: () => void;
  onRun: () => InterferenceResult[];
}

export function InterferenceDialog({ open, onClose, onRun }: Props) {
  const [results, setResults] = useState<InterferenceResult[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [createBodies, setCreateBodies] = useState(false);

  if (!open) return null;

  const handleCompute = () => {
    const r = onRun();
    setResults(r);
    setHasRun(true);
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel" style={{ minWidth: 380 }}>
        <div className="dialog-header">
          <span className="dialog-title">Interference</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginBottom: 8 }}>
            Detects overlapping volumes between solid bodies using AABB pre-filter and mesh intersection.
          </p>
          {hasRun && results.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', padding: '8px 0' }}>
              No solid body pairs found to test.
            </div>
          )}
          {hasRun && results.length > 0 && (
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border, #333)', borderRadius: 4 }}>
              {results.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    borderBottom: i < results.length - 1 ? '1px solid var(--border, #333)' : undefined,
                    fontSize: 12,
                  }}
                >
                  {r.hasInterference
                    ? <XCircle size={14} color="#ef4444" />
                    : <CheckCircle size={14} color="#22c55e" />}
                  <span style={{ flex: 1 }}>
                    <strong>{r.bodyAName}</strong> ↔ <strong>{r.bodyBName}</strong>
                  </span>
                  {r.hasInterference && (
                    <span style={{ color: '#ef4444', fontSize: 11 }}>
                      {r.intersectionCurveCount} curve{r.intersectionCurveCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="dialog-field" style={{ marginTop: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'not-allowed', opacity: 0.5 }}>
              <input
                type="checkbox"
                checked={createBodies}
                onChange={(e) => setCreateBodies(e.target.checked)}
                disabled
              />
              Create Interference Bodies (deferred)
            </label>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={handleCompute}>Compute</button>
        </div>
      </div>
    </div>
  );
}
