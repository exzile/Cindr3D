import { FileText } from 'lucide-react';
import '../DuetJobStatus.css';

export function NoJobMessage() {
  return (
    <div className="duet-job__no-job">
      <FileText size={48} strokeWidth={1} />
      <p className="duet-job__no-job-primary">No print job active</p>
      <p className="duet-job__no-job-secondary">
        Start a print from the Files tab to monitor progress here.
      </p>
    </div>
  );
}
