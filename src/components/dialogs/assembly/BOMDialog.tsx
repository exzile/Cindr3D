import { Download } from 'lucide-react';
import './BOMDialog.css';
import { DialogShell } from '../common/DialogShell';

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
    <DialogShell
      title="Bill of Materials"
      onClose={onClose}
      className="bom-dialog"
      footer={
        <div className="dialog-footer">
          <button className="btn btn-secondary bom-export-btn" onClick={onExportCSV}>
            <Download size={14} />
            Export CSV
          </button>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      }
    >
        <div className="bom-body">
          {entries.length === 0 ? (
            <p className="bom-empty">
              No components in assembly.
            </p>
          ) : (
            <table className="bom-table">
              <thead>
                <tr className="bom-thead-row">
                  {['#', 'Name', 'Qty', 'Material', 'Est. Mass', 'Description'].map((h) => (
                    <th key={h} className="bom-th">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((row, i) => (
                  <tr key={row.partNumber} className={i % 2 !== 0 ? 'bom-tr--odd' : ''}>
                    <td className="bom-td">{row.partNumber}</td>
                    <td className="bom-td">{row.name}</td>
                    <td className="bom-td bom-td--center">{row.quantity}</td>
                    <td className="bom-td">{row.material}</td>
                    <td className="bom-td bom-td--right">{row.estimatedMass}</td>
                    <td className="bom-td bom-td--muted">{row.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
    </DialogShell>
  );
}
