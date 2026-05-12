import { useEffect } from 'react';
import { useIntegrationStore } from '../../../store/integrationStore';
import { mqttPublisher } from '../../../services/integrations/mqttPublisher';

export function useMqttConnector() {
  const mqtt = useIntegrationStore((s) => s.mqtt);
  useEffect(() => {
    mqttPublisher.configure(mqtt);
    return () => {
      if (!mqtt.enabled) mqttPublisher.disconnect();
    };
  }, [mqtt]);
}
