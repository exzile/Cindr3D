import { useEffect, useRef } from 'react';
import { usePrinterStore } from '../../../store/printerStore';
import { usePrintRecoveryStore } from '../../../store/printRecoveryStore';
import { useChamberControlStore } from '../../../store/chamberControlStore';
import { DEFAULT_DOOR_SENSOR, useDoorSensorStore } from '../../../store/doorSensorStore';
import type { IntegrationEventType } from '../../../store/integrationStore';
import type { ToastType } from './useToastStack';

type AddToast = (type: ToastType, message: string) => void;
type DispatchEvent = (event: IntegrationEventType, statusOverride?: string) => void;

export function useStatusTransitions(addToast: AddToast, dispatchIntegrationEvent: DispatchEvent) {
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const model = usePrinterStore((s) => s.model);
  const connected = usePrinterStore((s) => s.connected);
  const pausePrint = usePrinterStore((s) => s.pausePrint);
  const setChamberTemp = usePrinterStore((s) => s.setChamberTemp);
  const chamberControl = useChamberControlStore();
  const doorSensorPrinters = useDoorSensorStore((s) => s.printers);
  const doorSensor = (activePrinterId ? doorSensorPrinters[activePrinterId] : null) ?? DEFAULT_DOOR_SENSOR;

  const prevStatusRef = useRef<string>('');
  const prevConnectedRef = useRef<boolean>(false);
  const prevBeepRef = useRef<{ duration: number; frequency: number } | undefined>(undefined);
  const prevDisplayMessageRef = useRef<string>('');
  const prevLayerRef = useRef<number | undefined>(undefined);
  const prevHeaterStatesRef = useRef<string[]>([]);

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
      if (prev === 'processing' && status === 'idle') {
        addToast('success', 'Print completed successfully');
        dispatchIntegrationEvent('DONE');
        if (activePrinterId) {
          usePrintRecoveryStore.getState().clearSnapshot(activePrinterId);
        }
        if (chamberControl.enabled && chamberControl.cooldownOnDone) {
          void setChamberTemp(0);
          useChamberControlStore.getState().stopRamp();
          addToast('info', 'Chamber cooldown started');
        }
      }
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
  }, [activePrinterId, addToast, chamberControl, dispatchIntegrationEvent, doorSensor, model.state?.status, pausePrint, setChamberTemp]);

  useEffect(() => {
    if (prevConnectedRef.current && !connected) {
      addToast('error', 'Connection lost to printer');
    }
    prevConnectedRef.current = connected;
  }, [connected, addToast]);

  useEffect(() => {
    const beep = model.state?.beep;
    if (beep && (beep.frequency !== prevBeepRef.current?.frequency || beep.duration !== prevBeepRef.current?.duration)) {
      playBeep(beep.frequency, beep.duration);
    }
    prevBeepRef.current = beep;
  }, [model.state?.beep]);

  useEffect(() => {
    const msg = model.state?.displayMessage ?? '';
    if (msg && msg !== prevDisplayMessageRef.current) {
      addToast('info', msg);
    }
    prevDisplayMessageRef.current = msg;
  }, [model.state?.displayMessage, addToast]);

  useEffect(() => {
    const status = model.state?.status ?? 'disconnected';
    const layer = model.job?.layer;
    const prevLayer = prevLayerRef.current;
    if (status === 'processing' && typeof layer === 'number' && typeof prevLayer === 'number' && prevLayer !== layer) {
      dispatchIntegrationEvent('LAYER_CHANGE');
    }
    prevLayerRef.current = typeof layer === 'number' ? layer : undefined;
  }, [model.job?.layer, model.state?.status, dispatchIntegrationEvent]);

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
}

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
    const endTime = audioCtx.currentTime + durationMs / 1000;
    gainNode.gain.exponentialRampToValueAtTime(0.001, endTime);
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(endTime);
    oscillator.onended = () => {
      oscillator.disconnect();
      gainNode.disconnect();
      audioCtx.close();
    };
  } catch {
    // Web Audio unavailable
  }
}
