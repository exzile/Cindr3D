import { FileText } from 'lucide-react';
import '../DuetJobStatus.css';

export function NoJobMessage() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '48px 24px', color: '#666680',
    }}>
      <FileText size={48} strokeWidth={1} />
      <p style={{ margin: 0, fontSize: 16 }}>No print job active</p>
      <p style={{ margin: 0, fontSize: 12, color: '#555' }}>
        Start a print from the Files tab to monitor progress here.
      </p>
    </div>
  );
}
