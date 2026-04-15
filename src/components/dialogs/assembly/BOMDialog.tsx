import { X, Download } from 'lucide-react';

export interface BOMEntry {
  partNumber: number;
  name: string;
  quantity: number;
  material: string;
  estimatedMass: string;
  description: string;
}

interface Props {
  open: boolean;
  entries: BOMEntry[];
  onExportCSV: () => void;
  onClose: () => void;
}

export function BOMDialog({ open, entries, onExportCSV, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="dialog-overlay">
      <div className="dialog" style={{ minWidth: 600, maxWidth: 800 }}>
        <div className="dialog-header">
          <h3>Bill of Materials</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body" style={{ padding: 0, maxHeight: 400, overflowY: 'auto' }}>
          {entries.length === 0 ? (
            <p style={{ padding: 16, margin: 0, color: 'var(--text-secondary, #aaa)' }}>
              No components in assembly.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary, #2a2a2a)', position: 'sticky', top: 0 }}>
                  {['#', 'Name', 'Qty', 'Material', 'Est. Mass', 'Description'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border, #444)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((row, i) => (
                  <tr key={row.partNumber} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg-tertiary, #1e1e1e)' }}>
                    <td style={{ padding: '6px 12px' }}>{row.partNumber}</td>
                    <td style={{ padding: '6px 12px' }}>{row.name}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'center' }}>{row.quantity}</td>
                    <td style={{ padding: '6px 12px' }}>{row.material}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right' }}>{row.estimatedMass}</td>
                    <td style={{ padding: '6px 12px', color: 'var(--text-secondary, #aaa)' }}>{row.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onExportCSV} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Download size={14} />
            Export CSV
          </button>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
