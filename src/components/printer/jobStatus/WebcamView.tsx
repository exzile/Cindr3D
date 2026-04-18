import { Video } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { getDuetPrefs } from '../../../utils/duetPrefs';
import '../DuetJobStatus.css';

export function WebcamView() {
  const service = usePrinterStore((s) => s.service);

  if (!service) return null;

  const prefs = getDuetPrefs();
  const webcamUrl = prefs.webcamUrl?.trim() || service.getWebcamUrl();

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Video size={14} /> Webcam
      </div>
      <div style={{
        borderRadius: 6, overflow: 'hidden', background: '#000', border: '1px solid #2a2a4a',
      }}>
        <img
          src={webcamUrl}
          alt="Printer webcam"
          style={{ width: '100%', display: 'block' }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    </div>
  );
}
