import { useEffect, useRef, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { X } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { fetchHomeAssistantCommands, publishHomeAssistantSnapshot } from '../../services/integrations/homeAssistantBridge';
import { sendIntegrationEvent, type IntegrationPrinterSnapshot } from '../../services/integrations/notificationSender';
import { mqttPublisher } from '../../services/integrations/mqttPublisher';
import { useIntegrationStore, type IntegrationEventType } from '../../store/integrationStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastType = 'info' | 'warning' | 'error' | 'success';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  info:    { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.4)',  text: 'var(--info)' },
  warning: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)', text: 'var(--warning)' },
  error:   { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.4)',  text: 'var(--error)' },
  success: { bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.4)',  text: 'var(--success)' },
};

const AUTO_DISMISS_MS = 5000;

// ---------------------------------------------------------------------------
// Web Audio beep helper
// ---------------------------------------------------------------------------

function playBeep(frequency: number, durationMs: number) {
  try {
    const win = window as Window & { webkitAudioContext?: typeof AudioContext };
    const AudioCtxCtor = window.AudioContext ?? win.webkitAudioContext;
    if (!AudioCtxCtor) return;

    const audioCtx = new AudioCtxCtor();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);

    // Fade out at end to avoid clicks
    const endTime = audioCtx.currentTime + durationMs / 1000;
    gainNode.gain.exponentialRampToValueAtTime(0.001, endTime);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(endTime);

    // Clean up after done
    oscillator.onended = () => {
      oscillator.disconnect();
      gainNode.disconnect();
      audioCtx.close();
    };
  } catch {
    // Silently fail if Web Audio is unavailable
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

let nextToastId = 1;

export default function DuetNotifications() {
  const model = usePrinterStore((s) => s.model);
  const connected = usePrinterStore((s) => s.connected);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const printers = usePrinterStore((s) => s.printers);
  const pausePrint = usePrinterStore((s) => s.pausePrint);
  const resumePrint = usePrinterStore((s) => s.resumePrint);
  const cancelPrint = usePrinterStore((s) => s.cancelPrint);
  const mqtt = useIntegrationStore((s) => s.mqtt);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Track previous values for change detection
  const prevBeepRef = useRef<{ duration: number; frequency: number } | undefined>(undefined);
  const prevDisplayMessageRef = useRef<string>('');
  const prevStatusRef = useRef<string>('');
  const prevConnectedRef = useRef<boolean>(false);
  const prevHeaterStatesRef = useRef<string[]>([]);
  const prevLayerRef = useRef<number | undefined>(undefined);
  const lastMqttTelemetryRef = useRef(0);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, type, message, timestamp: Date.now() }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const buildSnapshot = useCallback((statusOverride?: string): IntegrationPrinterSnapshot => {
    const activePrinter = printers.find((printer) => printer.id === activePrinterId);
    const temperatures = Object.fromEntries(
      (model.heat?.heaters ?? []).map((heater, index) => [`heater${index}`, heater?.current ?? null]),
    );
    const position = Object.fromEntries(
      (model.move?.axes ?? []).map((axis) => [axis.letter, axis.userPosition ?? axis.machinePosition ?? null]),
    );

    return {
      printerId: activePrinterId,
      printerName: activePrinter?.name ?? model.network?.name ?? 'Printer',
      status: statusOverride ?? model.state?.status ?? (connected ? 'connected' : 'disconnected'),
      fileName: model.job?.file?.fileName ?? model.job?.lastFileName,
      layer: model.job?.layer,
      progress: model.job?.file?.size ? Math.round((model.job.filePosition / model.job.file.size) * 100) : undefined,
      temperatures,
      position,
    };
  }, [activePrinterId, connected, model.heat?.heaters, model.job, model.move?.axes, model.network?.name, model.state?.status, printers]);

  const dispatchIntegrationEvent = useCallback((event: IntegrationEventType, statusOverride?: string) => {
    void sendIntegrationEvent(event, buildSnapshot(statusOverride)).then((results) => {
      const failed = results.find((result) => !result.ok);
      if (failed) {
        addToast('warning', `Integration notification failed: ${failed.error ?? 'unknown error'}`);
      }
    });
  }, [addToast, buildSnapshot]);

  useEffect(() => {
    mqttPublisher.configure(mqtt);
    return () => {
      if (!mqtt.enabled) mqttPublisher.disconnect();
    };
  }, [mqtt]);

  // Auto-dismiss timer (single-shot to next expiry; avoids constant interval work)
  useEffect(() => {
    if (toasts.length === 0) return;

    const now = Date.now();
    const nextExpiry = Math.min(...toasts.map((t) => t.timestamp + AUTO_DISMISS_MS));
    const delayMs = Math.max(0, nextExpiry - now) + 10;

    const timeout = window.setTimeout(() => {
      const cutoff = Date.now() - AUTO_DISMISS_MS;
      setToasts((prev) => prev.filter((t) => t.timestamp > cutoff));
    }, delayMs);

    return () => clearTimeout(timeout);
  }, [toasts]);

  // Watch for beep
  useEffect(() => {
    const beep = model.state?.beep;
    if (beep && (beep.frequency !== prevBeepRef.current?.frequency || beep.duration !== prevBeepRef.current?.duration)) {
      playBeep(beep.frequency, beep.duration);
    }
    prevBeepRef.current = beep;
  }, [model.state?.beep]);

  // Watch for display message changes
  useEffect(() => {
    const msg = model.state?.displayMessage ?? '';
    if (msg && msg !== prevDisplayMessageRef.current) {
      addToast('info', msg);
    }
    prevDisplayMessageRef.current = msg;
  }, [model.state?.displayMessage, addToast]);

  // Watch for status transitions
  useEffect(() => {
    const status = model.state?.status ?? 'disconnected';
    const prev = prevStatusRef.current;

    if (prev && prev !== status) {
      if (prev !== 'processing' && status === 'processing') {
        dispatchIntegrationEvent('PRINT_START');
      }
      // Print completed
      if (prev === 'processing' && status === 'idle') {
        addToast('success', 'Print completed successfully');
        dispatchIntegrationEvent('DONE');
      }
      // Print paused
      if (status === 'paused' && prev !== 'paused') {
        addToast('warning', 'Print paused - requires attention');
        dispatchIntegrationEvent('PAUSED');
      }
      if (status === 'halted' && prev !== 'halted') {
        addToast('error', 'Printer halted');
        dispatchIntegrationEvent('FAILED');
      }
    }

    prevStatusRef.current = status;
  }, [model.state?.status, addToast, dispatchIntegrationEvent]);

  // Watch for layer changes during active prints
  useEffect(() => {
    const status = model.state?.status ?? 'disconnected';
    const layer = model.job?.layer;
    const prevLayer = prevLayerRef.current;

    if (status === 'processing' && typeof layer === 'number' && typeof prevLayer === 'number' && prevLayer !== layer) {
      dispatchIntegrationEvent('LAYER_CHANGE');
    }

    prevLayerRef.current = typeof layer === 'number' ? layer : undefined;
  }, [model.job?.layer, model.state?.status, dispatchIntegrationEvent]);

  // Watch for connection lost
  useEffect(() => {
    if (prevConnectedRef.current && !connected) {
      addToast('error', 'Connection lost to printer');
    }
    prevConnectedRef.current = connected;
  }, [connected, addToast]);

  // Publish MQTT telemetry at the configured cadence as the object model updates.
  useEffect(() => {
    if (!connected) return;
    const now = Date.now();
    const publishRateMs = mqtt.enabled && mqtt.includeTelemetry ? mqtt.publishRateMs : 5000;
    if (now - lastMqttTelemetryRef.current < publishRateMs) return;
    lastMqttTelemetryRef.current = now;
    const snapshot = buildSnapshot();
    if (mqtt.enabled && mqtt.includeTelemetry) {
      mqttPublisher.configure(mqtt);
      mqttPublisher.publishTelemetry(snapshot);
    }
    void publishHomeAssistantSnapshot(snapshot);
  }, [
    connected,
    mqtt,
    buildSnapshot,
    model.heat?.heaters,
    model.job?.filePosition,
    model.job?.layer,
    model.move?.axes,
    model.state?.status,
  ]);

  useEffect(() => {
    if (!connected || !activePrinterId) return;
    const interval = window.setInterval(() => {
      void fetchHomeAssistantCommands(activePrinterId).then((commands) => {
        for (const command of commands) {
          if (command.action === 'pause') void pausePrint();
          if (command.action === 'resume') void resumePrint();
          if (command.action === 'cancel') void cancelPrint();
        }
      });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [activePrinterId, cancelPrint, connected, pausePrint, resumePrint]);

  // Watch for heater faults
  useEffect(() => {
    const heaters = model.heat?.heaters ?? [];
    const currentStates = heaters.map((h) => h?.state ?? 'off');
    const prevStates = prevHeaterStatesRef.current;

    if (prevStates.length > 0) {
      currentStates.forEach((state, i) => {
        if (state === 'fault' && prevStates[i] !== 'fault') {
          addToast('error', `Heater ${i} fault detected`);
          dispatchIntegrationEvent('FAILED', `heater-${i}-fault`);
        }
      });
    }

    prevHeaterStatesRef.current = currentStates;
  }, [model.heat?.heaters, addToast, dispatchIntegrationEvent]);

  if (toasts.length === 0) return null;

  return (
    <div className="duet-toast-stack">
      {toasts.map((toast) => {
        const colors = TOAST_COLORS[toast.type];
        const toastVars = {
          '--duet-toast-bg': colors.bg,
          '--duet-toast-border': colors.border,
          '--duet-toast-text': colors.text,
        } as CSSProperties;

        return (
          <div
            key={toast.id}
            className="duet-toast"
            style={toastVars}
          >
            <span className="duet-toast-message">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="duet-toast-close"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
