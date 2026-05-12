import { useEffect, useRef } from 'react';
import { AIR_QUALITY_SENSOR_LABELS, DEFAULT_AIR_QUALITY_CONFIG, useAirQualityStore, type AirQualitySensorKey } from '../../../store/airQualityStore';
import { useIntegrationStore } from '../../../store/integrationStore';
import { usePrinterStore } from '../../../store/printerStore';
import { mqttPublisher } from '../../../services/integrations/mqttPublisher';
import { evaluateAirQuality, parseAirQualityPayload } from '../../../services/integrations/airQuality';
import type { IntegrationEventType } from '../../../store/integrationStore';
import type { ToastType } from './useToastStack';

type AddToast = (type: ToastType, message: string) => void;
type DispatchEvent = (event: IntegrationEventType, statusOverride?: string) => void;

export function useAirQualityMonitoring(addToast: AddToast, dispatchIntegrationEvent: DispatchEvent) {
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const status = usePrinterStore((s) => s.model.state?.status);
  const pausePrint = usePrinterStore((s) => s.pausePrint);
  const mqtt = useIntegrationStore((s) => s.mqtt);
  const airQualityPrinters = useAirQualityStore((s) => s.printers);
  const airQuality = (activePrinterId ? airQualityPrinters[activePrinterId] : null) ?? DEFAULT_AIR_QUALITY_CONFIG;
  const lastAirQualityAlertRef = useRef('');

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
    if (!activePrinterId || !airQuality.enabled) return;
    const evalResult = evaluateAirQuality(airQuality);
    if (evalResult.level === 'ok') {
      lastAirQualityAlertRef.current = '';
      return;
    }
    const newestUpdatedAt = Math.max(
      0,
      ...evalResult.exceeded.map((item) => airQuality.readings[item.sensor].updatedAt ?? 0),
    );
    const alertKey = `${evalResult.level}:${evalResult.message}:${newestUpdatedAt}`;
    if (alertKey === lastAirQualityAlertRef.current) return;
    lastAirQualityAlertRef.current = alertKey;

    if (evalResult.level === 'warn') {
      addToast('warning', `Air quality warning: ${evalResult.message}`);
      return;
    }

    addToast('error', `Air quality critical: ${evalResult.message}`);
    if (airQuality.pauseOnCritical && status === 'processing') {
      void pausePrint();
      const names = evalResult.exceeded.map((item) => AIR_QUALITY_SENSOR_LABELS[item.sensor]).join(', ');
      dispatchIntegrationEvent('PAUSED', `air-quality-${names.toLowerCase()}`);
    }
  }, [activePrinterId, addToast, airQuality, dispatchIntegrationEvent, status, pausePrint]);
}
