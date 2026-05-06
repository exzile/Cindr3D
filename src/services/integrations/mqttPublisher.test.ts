import { describe, expect, it } from 'vitest';
import { encodeConnectPacket, encodePublishPacket, mqttTopic } from './mqttPublisher';
import type { MqttIntegrationConfig } from '../../store/integrationStore';

const mqttConfig: MqttIntegrationConfig = {
  enabled: true,
  brokerUrl: 'ws://broker.test:9001/mqtt',
  topicPrefix: 'shop/printers',
  username: 'user',
  password: 'secret',
  clientId: 'cindr3d-test',
  publishRateMs: 5000,
  includeEvents: true,
  includeTelemetry: true,
};

describe('mqtt publisher helpers', () => {
  it('builds stable printer topics from the configured prefix', () => {
    expect(mqttTopic('shop/', {
      printerId: 'Voron 2.4',
      printerName: 'Voron',
      status: 'processing',
    }, 'telemetry')).toBe('shop/printers/voron-2-4/telemetry');
  });

  it('encodes MQTT connect and publish packets', () => {
    const connect = encodeConnectPacket(mqttConfig);
    const publish = encodePublishPacket('shop/printers/p1/events/done', { ok: true });

    expect(connect[0]).toBe(0x10);
    expect(publish[0]).toBe(0x30);
    expect(new TextDecoder().decode(publish)).toContain('shop/printers/p1/events/done');
    expect(new TextDecoder().decode(publish)).toContain('"ok":true');
  });
});
