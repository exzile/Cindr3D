import { usePrinterStore } from '../../store/printerStore';
import './PrinterAlerts.css';

export default function PrinterAlerts() {
  const alerts = usePrinterStore((s) => s.printerAlerts);
  const dismissAlert = usePrinterStore((s) => s.dismissAlert);

  if (alerts.length === 0) return null;

  return (
    <div className="printer-alerts" role="alert" aria-live="assertive">
      {alerts.map((alert) => (
        <div key={alert.id} className={`printer-alert printer-alert--${alert.level}`}>
          <span className="printer-alert__icon">
            {alert.level === 'error' ? '⚠' : 'ℹ'}
          </span>
          <span className="printer-alert__message">{alert.message}</span>
          <button
            className="printer-alert__dismiss"
            aria-label="Dismiss alert"
            onClick={() => dismissAlert(alert.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
