import { useState } from 'react';
import { X, Check } from 'lucide-react';

export interface FillParams {
  boundaryEdgeCount: number;
  continuityPerEdge: ('G0' | 'G1' | 'G2')[];
  operation: 'new-body' | 'join';
}

interface FillDialogProps {
  open: boolean;
  edgeCount: number;
  onOk: (params: FillParams) => void;
  onClose: () => void;
}

export function FillDialog({ open, edgeCount, onOk, onClose }: FillDialogProps) {
  const MAX_EDGES = 4;
  const count = Math.min(Math.max(edgeCount, 1), MAX_EDGES);

  const [continuityPerEdge, setContinuityPerEdge] = useState<('G0' | 'G1' | 'G2')[]>(
    Array.from({ length: MAX_EDGES }, () => 'G0'),
  );
  const [operation, setOperation] = useState<'new-body' | 'join'>('new-body');

  if (!open) return null;

  const setCont = (i: number, v: 'G0' | 'G1' | 'G2') => {
    setContinuityPerEdge((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  };

  const handleOK = () => {
    onOk({
      boundaryEdgeCount: count,
      continuityPerEdge: continuityPerEdge.slice(0, count),
      operation,
    });
  };

  return (
    <div className="tool-panel">
      <div className="tp-header">
        <div className="tp-header-icon" style={{ background: '#1aa04a' }} />
        <span className="tp-header-title">Fill Surface</span>
        <button className="tp-close" onClick={onClose} title="Cancel (Esc)"><X size={14} /></button>
      </div>

      <div className="tp-body">
        <div className="tp-section">
          <div className="tp-section-title">Boundary</div>
          <div className="tp-row">
            <span className="tp-label">Edges selected</span>
            <span className="tp-label" style={{ fontWeight: 600 }}>{count}</span>
          </div>
          <div className="tp-row" style={{ fontSize: '11px', color: 'var(--text-muted, #888)', gridColumn: '1/-1' }}>
            Pick boundary edges in the viewport, then click OK.
          </div>
        </div>

        {count > 0 && (
          <>
            <div className="tp-divider" />
            <div className="tp-section">
              <div className="tp-section-title">Continuity</div>
              {Array.from({ length: count }, (_, i) => (
                <div className="tp-row" key={i}>
                  <span className="tp-label">Edge {i + 1}</span>
                  <select className="tp-select" value={continuityPerEdge[i]}
                    onChange={(e) => setCont(i, e.target.value as 'G0' | 'G1' | 'G2')}>
                    <option value="G0">G0 (Position)</option>
                    <option value="G1">G1 (Tangent)</option>
                    <option value="G2">G2 (Curvature)</option>
                  </select>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="tp-divider" />
        <div className="tp-section">
          <div className="tp-section-title">Output</div>
          <div className="tp-row">
            <span className="tp-label">Operation</span>
            <select className="tp-select" value={operation}
              onChange={(e) => setOperation(e.target.value as 'new-body' | 'join')}>
              <option value="new-body">New Body</option>
              <option value="join">Join</option>
            </select>
          </div>
        </div>
      </div>

      <div className="tp-actions">
        <button className="tp-btn tp-btn-cancel" onClick={onClose}><X size={13} /> Cancel</button>
        <button className="tp-btn tp-btn-ok" onClick={handleOK}><Check size={13} /> OK</button>
      </div>
    </div>
  );
}
