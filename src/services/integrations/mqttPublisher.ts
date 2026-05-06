import type { IntegrationEventType, MqttIntegrationConfig } from '../../store/integrationStore';
import type { IntegrationPrinterSnapshot, IntegrationNotificationPayload } from './notificationSender';

type PublishItem = {
  topic: string;
  payload: unknown;
};

const MQTT_PROTOCOL_NAME = 'MQTT';
const MQTT_PROTOCOL_LEVEL = 4;
const DEFAULT_KEEPALIVE_SECONDS = 30;

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function mqttString(value: string): Uint8Array {
  const bytes = textBytes(value);
  return concatBytes(new Uint8Array([bytes.length >> 8, bytes.length & 0xff]), bytes);
}

function encodeRemainingLength(length: number): Uint8Array {
  const encoded: number[] = [];
  let remaining = length;
  do {
    let digit = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) digit |= 0x80;
    encoded.push(digit);
  } while (remaining > 0);
  return new Uint8Array(encoded);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function packet(typeAndFlags: number, body: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([typeAndFlags]), encodeRemainingLength(body.length), body);
}

function sendableBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function defaultClientId(): string {
  return `cindr3d-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizedTopicPrefix(prefix: string): string {
  return (prefix.trim() || 'cindr3d').replace(/^\/+|\/+$/g, '');
}

function printerTopicPart(snapshot: IntegrationPrinterSnapshot): string {
  return (snapshot.printerId || snapshot.printerName || 'printer')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'printer';
}

function eventTopicPart(event: IntegrationEventType): string {
  return event.toLowerCase().replace(/_/g, '-');
}

export function mqttTopic(prefix: string, snapshot: IntegrationPrinterSnapshot, suffix: string): string {
  return `${normalizedTopicPrefix(prefix)}/printers/${printerTopicPart(snapshot)}/${suffix}`;
}

export function encodeConnectPacket(config: MqttIntegrationConfig): Uint8Array {
  const clientId = config.clientId.trim() || defaultClientId();
  let flags = 0x02;
  const payloadParts = [mqttString(clientId)];
  if (config.username.trim()) {
    flags |= 0x80;
    payloadParts.push(mqttString(config.username.trim()));
  }
  if (config.password) {
    flags |= 0x40;
    payloadParts.push(mqttString(config.password));
  }

  const variableHeader = concatBytes(
    mqttString(MQTT_PROTOCOL_NAME),
    new Uint8Array([MQTT_PROTOCOL_LEVEL, flags, DEFAULT_KEEPALIVE_SECONDS >> 8, DEFAULT_KEEPALIVE_SECONDS & 0xff]),
  );
  return packet(0x10, concatBytes(variableHeader, ...payloadParts));
}

export function encodePublishPacket(topic: string, payload: unknown): Uint8Array {
  const body = concatBytes(mqttString(topic), textBytes(JSON.stringify(payload)));
  return packet(0x30, body);
}

class MqttPublisher {
  private config: MqttIntegrationConfig | null = null;
  private ws: WebSocket | null = null;
  private queue: PublishItem[] = [];
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private reconnectDelayMs = 1000;

  configure(config: MqttIntegrationConfig): void {
    this.config = config;
    if (!config.enabled || !config.brokerUrl.trim()) {
      this.disconnect();
      return;
    }
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.connect();
    }
  }

  publishEvent(payload: IntegrationNotificationPayload): void {
    const config = this.config;
    if (!config?.enabled || !config.includeEvents) return;
    this.enqueue({
      topic: mqttTopic(config.topicPrefix, payload.printer, `events/${eventTopicPart(payload.event)}`),
      payload,
    });
  }

  publishTelemetry(snapshot: IntegrationPrinterSnapshot): void {
    const config = this.config;
    if (!config?.enabled || !config.includeTelemetry) return;
    this.enqueue({
      topic: mqttTopic(config.topicPrefix, snapshot, 'telemetry'),
      payload: {
        occurredAt: new Date().toISOString(),
        printer: snapshot,
      },
    });
  }

  disconnect(): void {
    this.clearTimers();
    const socket = this.ws;
    this.ws = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1000, 'disabled');
    }
  }

  private enqueue(item: PublishItem): void {
    this.queue.push(item);
    if (this.queue.length > 25) this.queue.shift();
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.connect();
      return;
    }
    this.flush();
  }

  private connect(): void {
    const config = this.config;
    if (!config?.enabled || !config.brokerUrl.trim() || this.ws?.readyState === WebSocket.CONNECTING) return;
    this.clearReconnectTimer();

    try {
      const socket = new WebSocket(config.brokerUrl.trim(), ['mqtt']);
      socket.binaryType = 'arraybuffer';
      this.ws = socket;

      socket.addEventListener('open', () => {
        socket.send(sendableBuffer(encodeConnectPacket(config)));
      });
      socket.addEventListener('message', (event) => {
        const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array();
        if (data[0] === 0x20 && data[3] === 0) {
          this.reconnectDelayMs = 1000;
          this.startPing();
          this.flush();
        }
      });
      socket.addEventListener('close', () => this.scheduleReconnect());
      socket.addEventListener('error', () => {
        if (socket.readyState === WebSocket.OPEN) socket.close();
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private flush(): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const items = this.queue.splice(0);
    for (const item of items) {
      socket.send(sendableBuffer(encodePublishPacket(item.topic, item.payload)));
    }
  }

  private startPing(): void {
    this.clearPingTimer();
    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(sendableBuffer(new Uint8Array([0xc0, 0x00])));
      }
    }, (DEFAULT_KEEPALIVE_SECONDS * 1000) / 2);
  }

  private scheduleReconnect(): void {
    this.clearPingTimer();
    const config = this.config;
    if (!config?.enabled || !config.brokerUrl.trim()) return;
    this.clearReconnectTimer();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 1.8, 15000);
      this.connect();
    }, this.reconnectDelayMs);
  }

  private clearTimers(): void {
    this.clearReconnectTimer();
    this.clearPingTimer();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}

export const mqttPublisher = new MqttPublisher();
