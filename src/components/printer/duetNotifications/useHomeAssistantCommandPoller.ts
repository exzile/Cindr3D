import { useEffect, useRef } from 'react';
import { usePrinterStore } from '../../../store/printerStore';
import { useIntegrationStore } from '../../../store/integrationStore';
import { mqttPublisher } from '../../../services/integrations/mqttPublisher';
import { fetchHomeAssistantCommands, publishHomeAssistantSnapshot } from '../../../services/integrations/homeAssistantBridge';
import type { IntegrationPrinterSnapshot } from '../../../services/integrations/notificationSender';

type BuildSnapshot = (statusOverride?: string) => IntegrationPrinterSnapshot;

export function useHomeAssistantCommandPoller(buildSnapshot: BuildSnapshot) {
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const connected = usePrinterStore((s) => s.connected);
  const model = usePrinterStore((s) => s.model);
  const pausePrint = usePrinterStore((s) => s.pausePrint);
  const resumePrint = usePrinterStore((s) => s.resumePrint);
  const cancelPrint = usePrinterStore((s) => s.cancelPrint);
  const mqtt = useIntegrationStore((s) => s.mqtt);
  const lastMqttTelemetryRef = useRef(0);

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
}
