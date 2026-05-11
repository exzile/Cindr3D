import { useEffect, useRef } from 'react';
import { DEFAULT_DOOR_SENSOR, useDoorSensorStore } from '../../../store/doorSensorStore';
import { useChamberControlStore } from '../../../store/chamberControlStore';
import { useIntegrationStore } from '../../../store/integrationStore';
import { usePrinterStore } from '../../../store/printerStore';
import { mqttPublisher } from '../../../services/integrations/mqttPublisher';
import { parseDoorPayload, resolveDoorOpenFromModel } from '../../../services/integrations/doorSensor';
import type { IntegrationEventType } from '../../../store/integrationStore';
import type { ToastType } from './useToastStack';

type AddToast = (type: ToastType, message: string) => void;
type DispatchEvent = (event: IntegrationEventType, statusOverride?: string) => void;

export function useDoorSensorIntegration(addToast: AddToast, dispatchIntegrationEvent: DispatchEvent) {
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const model = usePrinterStore((s) => s.model);
  const status = usePrinterStore((s) => s.model.state?.status);
  const pausePrint = usePrinterStore((s) => s.pausePrint);
  const mqtt = useIntegrationStore((s) => s.mqtt);
  const doorSensorPrinters = useDoorSensorStore((s) => s.printers);
  const doorSensor = (activePrinterId ? doorSensorPrinters[activePrinterId] : null) ?? DEFAULT_DOOR_SENSOR;
  const doorPauseSentRef = useRef(false);

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

  useEffect(() => {
    if (!doorSensor.enabled || !doorSensor.pauseOnOpen || !doorSensor.isOpen) {
      doorPauseSentRef.current = false;
      return;
    }
    if (status !== 'processing' || doorPauseSentRef.current) return;
    doorPauseSentRef.current = true;
    void pausePrint();
    addToast('error', 'Door open: active print paused');
    dispatchIntegrationEvent('PAUSED', 'door-open');
  }, [addToast, dispatchIntegrationEvent, doorSensor.enabled, doorSensor.isOpen, doorSensor.pauseOnOpen, status, pausePrint]);
}
