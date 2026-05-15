import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import { X } from 'lucide-react';
import { useToastStack, TOAST_COLORS } from './duetNotifications/useToastStack';
import { useIntegrationEventDispatch } from './duetNotifications/useIntegrationEventDispatch';
import { useMqttConnector } from './duetNotifications/useMqttConnector';
import { useChamberControl } from './duetNotifications/useChamberControl';
import { useAirQualityMonitoring } from './duetNotifications/useAirQualityMonitoring';
import { useDoorSensorIntegration } from './duetNotifications/useDoorSensorIntegration';
import { usePrintRecovery } from './duetNotifications/usePrintRecovery';
import { useStatusTransitions } from './duetNotifications/useStatusTransitions';
import { useHomeAssistantCommandPoller } from './duetNotifications/useHomeAssistantCommandPoller';
import { usePrintCompletionScore } from '../../hooks/usePrintCompletionScore';
import { useLayerFailureSampler } from '../../hooks/useLayerFailureSampler';
import { usePrinterStore } from '../../store/printerStore';

export default function DuetNotifications() {
  const setChamberTemp = usePrinterStore((s) => s.setChamberTemp);

  const { toasts, addToast, removeToast } = useToastStack();
  const { buildSnapshot, dispatchIntegrationEvent } = useIntegrationEventDispatch(addToast);

  useMqttConnector();
  useChamberControl(addToast, setChamberTemp);
  useAirQualityMonitoring(addToast, dispatchIntegrationEvent);
  useDoorSensorIntegration(addToast, dispatchIntegrationEvent);
  useStatusTransitions(addToast, dispatchIntegrationEvent);
  useHomeAssistantCommandPoller(buildSnapshot);
  usePrintCompletionScore();
  // Layer-by-layer proactive failure detection — runs the vision detector
  // every N layers of a live print, records results to useVisionStore, and
  // (optionally) auto-pauses on high-confidence failures.
  useLayerFailureSampler({ layerStep: 5 });

  const { recoverySnapshot, recoveryBusy, handleResumeRecovery, dismissRecoverySnapshot } = usePrintRecovery(addToast);

  if (toasts.length === 0 && !recoverySnapshot) return null;

  return createPortal(
    <div className="duet-toast-stack">
      {recoverySnapshot && (
        <div className="duet-toast duet-toast--recovery">
          <span className="duet-toast-message">
            Interrupted print detected: {recoverySnapshot.fileName}
            {recoverySnapshot.z !== null ? ` at Z${recoverySnapshot.z.toFixed(2)}` : ''}. Resume will wait for saved bed/tool temperatures first.
          </span>
          <button
            onClick={() => void handleResumeRecovery()}
            className="duet-toast-action"
            disabled={recoveryBusy}
            title="Preheat and resume from saved file position"
          >
            {recoveryBusy ? 'Waiting...' : 'Preheat & Resume'}
          </button>
          <button
            onClick={() => dismissRecoverySnapshot(recoverySnapshot.printerId)}
            className="duet-toast-close"
            title="Dismiss recovery"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {toasts.map((toast) => {
        const colors = TOAST_COLORS[toast.type];
        const toastVars = {
          '--duet-toast-bg': colors.bg,
          '--duet-toast-border': colors.border,
          '--duet-toast-text': colors.text,
        } as CSSProperties;

        return (
          <div key={toast.id} className="duet-toast" style={toastVars}>
            <span className="duet-toast-message">{toast.message}</span>
            <button onClick={() => removeToast(toast.id)} className="duet-toast-close" title="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
