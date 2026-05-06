import { useEffect, useRef, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { X } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { usePrintRecoveryStore, type PrintRecoverySnapshot } from '../../store/printRecoveryStore';
import { useChamberControlStore } from '../../store/chamberControlStore';
import { AIR_QUALITY_SENSOR_LABELS, useAirQualityStore, type AirQualitySensorKey } from '../../store/airQualityStore';
import { useDoorSensorStore } from '../../store/doorSensorStore';
import { fetchHomeAssistantCommands, publishHomeAssistantSnapshot } from '../../services/integrations/homeAssistantBridge';
import { evaluateAirQuality, parseAirQualityPayload } from '../../services/integrations/airQuality';
import { computeChamberRampCommand, parseChamberTemperaturePayload } from '../../services/integrations/chamberControl';
import { parseDoorPayload, resolveDoorOpenFromModel } from '../../services/integrations/doorSensor';
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
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const setChamberTemp = usePrinterStore((s) => s.setChamberTemp);
  const mqtt = useIntegrationStore((s) => s.mqtt);
  const chamberControl = useChamberControlStore();
  const airQuality = useAirQualityStore((s) => s.getPrinterAirQuality(activePrinterId));
  const doorSensor = useDoorSensorStore((s) => s.getDoorSensor(activePrinterId));
  const saveRecoverySnapshot = usePrintRecoveryStore((s) => s.saveSnapshot);
  const clearRecoverySnapshot = usePrintRecoveryStore((s) => s.clearSnapshot);
  const dismissRecoverySnapshot = usePrintRecoveryStore((s) => s.dismissSnapshot);
  const getRecoverableSnapshot = usePrintRecoveryStore((s) => s.getRecoverableSnapshot);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  // Track previous values for change detection
  const prevBeepRef = useRef<{ duration: number; frequency: number } | undefined>(undefined);
  const prevDisplayMessageRef = useRef<string>('');
  const prevStatusRef = useRef<string>('');
  const prevConnectedRef = useRef<boolean>(false);
  const prevHeaterStatesRef = useRef<string[]>([]);
  const prevLayerRef = useRef<number | undefined>(undefined);
  const lastMqttTelemetryRef = useRef(0);
  const lastRecoverySnapshotRef = useRef(0);
  const doorOpenCooldownSentRef = useRef(false);
  const lastAirQualityAlertRef = useRef('');
  const doorPauseSentRef = useRef(false);

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

  const recoverySnapshot = getRecoverableSnapshot(activePrinterId, model.state?.status ?? 'disconnected');

  const buildRecoverySnapshot = useCallback((): PrintRecoverySnapshot | null => {
    const activePrinter = printers.find((printer) => printer.id === activePrinterId);
    const fileName = model.job?.file?.fileName ?? model.job?.lastFileName;
    const filePosition = model.job?.filePosition ?? 0;
    if (!activePrinterId || !fileName || filePosition <= 0) return null;
    const bedHeater = model.heat?.bedHeaters?.[0];
    const toolHeater = model.tools?.[model.state?.currentTool ?? 0]?.heaters?.[0];
    const zAxis = model.move?.axes?.find((axis) => axis.letter.toUpperCase() === 'Z');
    return {
      printerId: activePrinterId,
      printerName: activePrinter?.name ?? model.network?.name ?? 'Printer',
      fileName,
      filePosition,
      z: typeof zAxis?.userPosition === 'number' ? zAxis.userPosition : null,
      layer: typeof model.job?.layer === 'number' ? model.job.layer : null,
      bedTemp: typeof bedHeater === 'number' ? model.heat?.heaters?.[bedHeater]?.active ?? null : null,
      toolTemp: typeof toolHeater === 'number' ? model.heat?.heaters?.[toolHeater]?.active ?? null : null,
      status: model.state?.status ?? 'disconnected',
      updatedAt: Date.now(),
    };
  }, [activePrinterId, model.heat?.bedHeaters, model.heat?.heaters, model.job, model.move?.axes, model.network?.name, model.state?.currentTool, model.state?.status, model.tools, printers]);

  const handleResumeRecovery = useCallback(async () => {
    if (!recoverySnapshot) return;
    setRecoveryBusy(true);
    try {
      if (recoverySnapshot.bedTemp && recoverySnapshot.bedTemp > 0) await sendGCode(`M190 S${recoverySnapshot.bedTemp}`);
      if (recoverySnapshot.toolTemp && recoverySnapshot.toolTemp > 0) await sendGCode(`M109 S${recoverySnapshot.toolTemp}`);
      if (recoverySnapshot.z !== null) await sendGCode(`G92 Z${recoverySnapshot.z.toFixed(3)}`);
      await sendGCode(`M24 S${Math.max(0, Math.floor(recoverySnapshot.filePosition))}`);
      clearRecoverySnapshot(recoverySnapshot.printerId);
      addToast('success', 'Recovery preheat and resume commands sent');
    } catch (error) {
      addToast('error', `Recovery resume failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setRecoveryBusy(false);
    }
  }, [addToast, clearRecoverySnapshot, recoverySnapshot, sendGCode]);

  useEffect(() => {
    mqttPublisher.configure(mqtt);
    return () => {
      if (!mqtt.enabled) mqttPublisher.disconnect();
    };
  }, [mqtt]);

  useEffect(() => {
    if (!mqtt.enabled || !chamberControl.enabled || !chamberControl.mqttTopic.trim()) return;
    mqttPublisher.configure(mqtt);
    return mqttPublisher.subscribe(chamberControl.mqttTopic, (payload) => {
      const temperatureC = parseChamberTemperaturePayload(payload);
      if (temperatureC === null) return;
      useChamberControlStore.getState().setExternalTemperature(temperatureC);
    });
  }, [chamberControl.enabled, chamberControl.mqttTopic, mqtt]);

  useEffect(() => {
    if (!activePrinterId || !mqtt.enabled || !airQuality.enabled) return;
    mqttPublisher.configure(mqtt);
    const cleanups = (Object.keys(airQuality.sensors) as AirQualitySensorKey[])
      .flatMap((sensor) => {
        const topic = airQuality.sensors[sensor].topic.trim();
        if (!topic) return [];
        return [
          mqttPublisher.subscribe(topic, (payload) => {
            const value = parseAirQualityPayload(payload, sensor);
            if (value === null) return;
            useAirQualityStore.getState().setAirQualityReading(activePrinterId, sensor, value);
          }),
        ];
      });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [activePrinterId, airQuality.enabled, airQuality.sensors, mqtt]);

  useEffect(() => {
    if (!activePrinterId || !mqtt.enabled || !doorSensor.enabled || doorSensor.source !== 'mqtt' || !doorSensor.mqttTopic.trim()) return;
    mqttPublisher.configure(mqtt);
    return mqttPublisher.subscribe(doorSensor.mqttTopic, (payload) => {
      const isOpen = parseDoorPayload(payload, useDoorSensorStore.getState().getDoorSensor(activePrinterId));
      if (isOpen === null) return;
      useDoorSensorStore.getState().setDoorOpen(activePrinterId, isOpen);
      useChamberControlStore.getState().updateChamberControl({ doorOpen: isOpen });
    });
  }, [activePrinterId, doorSensor.enabled, doorSensor.mqttTopic, doorSensor.source, mqtt]);

  useEffect(() => {
    if (!activePrinterId || !doorSensor.enabled || (doorSensor.source !== 'rrf' && doorSensor.source !== 'klipper')) return;
    const isOpen = resolveDoorOpenFromModel(model, doorSensor);
    if (isOpen === null || isOpen === doorSensor.isOpen) return;
    useDoorSensorStore.getState().setDoorOpen(activePrinterId, isOpen);
    useChamberControlStore.getState().updateChamberControl({ doorOpen: isOpen });
  }, [activePrinterId, doorSensor, model]);

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
        if (doorSensor.enabled && doorSensor.preventPrintStart && doorSensor.isOpen) {
          void pausePrint();
          addToast('error', 'Door open: print start paused by enclosure safety lock');
          dispatchIntegrationEvent('PAUSED', 'door-open-start-lock');
        }
        if (chamberControl.enabled && chamberControl.preheatBeforePrint && chamberControl.targetTemperatureC > 0) {
          void setChamberTemp(chamberControl.targetTemperatureC);
          addToast('info', `Chamber preheat target set to ${chamberControl.targetTemperatureC}C`);
        }
      }
      // Print completed
      if (prev === 'processing' && status === 'idle') {
        addToast('success', 'Print completed successfully');
        dispatchIntegrationEvent('DONE');
        if (activePrinterId) clearRecoverySnapshot(activePrinterId);
        if (chamberControl.enabled && chamberControl.cooldownOnDone) {
          void setChamberTemp(0);
          useChamberControlStore.getState().stopRamp();
          addToast('info', 'Chamber cooldown started');
        }
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
  }, [activePrinterId, addToast, chamberControl.cooldownOnDone, chamberControl.enabled, chamberControl.preheatBeforePrint, chamberControl.targetTemperatureC, clearRecoverySnapshot, dispatchIntegrationEvent, doorSensor.enabled, doorSensor.isOpen, doorSensor.preventPrintStart, model.state?.status, pausePrint, setChamberTemp]);

  useEffect(() => {
    if (!chamberControl.rampActive) return;
    const applyRampStep = () => {
      const latest = useChamberControlStore.getState();
      const command = computeChamberRampCommand(latest, Date.now());
      if (!command) return;
      void setChamberTemp(command.targetC);
      useChamberControlStore.getState().updateChamberControl({
        rampLastCommandedC: command.targetC,
        rampActive: !command.done,
        rampStartedAt: command.done ? null : latest.rampStartedAt,
      });
      addToast('info', `Chamber ramp target set to ${command.targetC}C`);
    };

    applyRampStep();
    const interval = window.setInterval(applyRampStep, 15000);
    return () => window.clearInterval(interval);
  }, [addToast, chamberControl.rampActive, setChamberTemp]);

  useEffect(() => {
    if (!chamberControl.enabled || !chamberControl.cooldownOnDoorOpen || !chamberControl.doorOpen) {
      doorOpenCooldownSentRef.current = false;
      return;
    }
    if (doorOpenCooldownSentRef.current) return;
    doorOpenCooldownSentRef.current = true;
    void setChamberTemp(0);
    useChamberControlStore.getState().stopRamp();
    addToast('warning', 'Door open: chamber heater cooling down');
  }, [addToast, chamberControl.cooldownOnDoorOpen, chamberControl.doorOpen, chamberControl.enabled, setChamberTemp]);

  useEffect(() => {
    if (!doorSensor.enabled || !doorSensor.pauseOnOpen || !doorSensor.isOpen) {
      doorPauseSentRef.current = false;
      return;
    }
    if (model.state?.status !== 'processing' || doorPauseSentRef.current) return;
    doorPauseSentRef.current = true;
    void pausePrint();
    addToast('error', 'Door open: active print paused');
    dispatchIntegrationEvent('PAUSED', 'door-open');
  }, [addToast, dispatchIntegrationEvent, doorSensor.enabled, doorSensor.isOpen, doorSensor.pauseOnOpen, model.state?.status, pausePrint]);

  useEffect(() => {
    if (!activePrinterId || !airQuality.enabled) return;
    const status = evaluateAirQuality(airQuality);
    if (status.level === 'ok') {
      lastAirQualityAlertRef.current = '';
      return;
    }

    const newestUpdatedAt = Math.max(
      0,
      ...status.exceeded.map((item) => airQuality.readings[item.sensor].updatedAt ?? 0),
    );
    const alertKey = `${status.level}:${status.message}:${newestUpdatedAt}`;
    if (alertKey === lastAirQualityAlertRef.current) return;
    lastAirQualityAlertRef.current = alertKey;

    if (status.level === 'warn') {
      addToast('warning', `Air quality warning: ${status.message}`);
      return;
    }

    addToast('error', `Air quality critical: ${status.message}`);
    if (airQuality.pauseOnCritical && model.state?.status === 'processing') {
      void pausePrint();
      const names = status.exceeded.map((item) => AIR_QUALITY_SENSOR_LABELS[item.sensor]).join(', ');
      dispatchIntegrationEvent('PAUSED', `air-quality-${names.toLowerCase()}`);
    }
  }, [activePrinterId, addToast, airQuality, dispatchIntegrationEvent, model.state?.status, pausePrint]);

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
    if (model.state?.status !== 'processing') return;
    const now = Date.now();
    if (now - lastRecoverySnapshotRef.current < 5000) return;
    const snapshot = buildRecoverySnapshot();
    if (!snapshot) return;
    lastRecoverySnapshotRef.current = now;
    saveRecoverySnapshot(snapshot);
  }, [buildRecoverySnapshot, model.job?.filePosition, model.job?.layer, model.state?.status, saveRecoverySnapshot]);

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

  if (toasts.length === 0 && !recoverySnapshot) return null;

  return (
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
