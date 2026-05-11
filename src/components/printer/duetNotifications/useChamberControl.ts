import { useEffect, useRef } from 'react';
import { useChamberControlStore } from '../../../store/chamberControlStore';
import { useIntegrationStore } from '../../../store/integrationStore';
import { mqttPublisher } from '../../../services/integrations/mqttPublisher';
import { parseChamberTemperaturePayload, computeChamberRampCommand } from '../../../services/integrations/chamberControl';
import type { ToastType } from './useToastStack';

type AddToast = (type: ToastType, message: string) => void;

export function useChamberControl(addToast: AddToast, setChamberTemp: (temp: number) => void) {
  const chamberControl = useChamberControlStore();
  const mqtt = useIntegrationStore((s) => s.mqtt);
  const doorOpenCooldownSentRef = useRef(false);

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
}
