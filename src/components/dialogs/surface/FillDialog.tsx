import { useState } from 'react';
import { X } from 'lucide-react';

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
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Fill Surface</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Boundary Edges</label>
            <span className="dialog-info">{count} edge{count !== 1 ? 's' : ''} selected</span>
          </div>
          {Array.from({ length: count }, (_, i) => (
            <div className="form-group" key={i}>
              <label>Edge {i + 1} Continuity</label>
              <select
                value={continuityPerEdge[i]}
                onChange={(e) => setCont(i, e.target.value as 'G0' | 'G1' | 'G2')}
              >
                <option value="G0">G0 (Position)</option>
                <option value="G1">G1 (Tangent)</option>
                <option value="G2">G2 (Curvature)</option>
              </select>
            </div>
          ))}
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as 'new-body' | 'join')}>
              <option value="new-body">New Body</option>
              <option value="join">Join</option>
            </select>
          </div>
          <p className="dialog-hint">Select boundary edges/curves in the viewport, then click OK.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}
