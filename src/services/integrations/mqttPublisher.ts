import type { IntegrationEventType, MqttIntegrationConfig } from '../../store/integrationStore';
import type { IntegrationPrinterSnapshot, IntegrationNotificationPayload } from './notificationSender';

type PublishItem = {
  topic: string;
  payload: unknown;
};

type SubscriptionHandler = (payload: string, topic: string) => void;

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

function connectionConfigKey(config: MqttIntegrationConfig): string {
  return [
    config.brokerUrl.trim(),
    config.clientId.trim(),
    config.username.trim(),
    config.password,
  ].join('\u001f');
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

export function encodeSubscribePacket(topic: string, packetId: number): Uint8Array {
  const body = concatBytes(
    new Uint8Array([packetId >> 8, packetId & 0xff]),
    mqttString(topic),
    new Uint8Array([0x00]),
  );
  return packet(0x82, body);
}

export function decodePublishPacket(bytes: Uint8Array): { topic: string; payload: string } | null {
  if ((bytes[0] & 0xf0) !== 0x30) return null;
  let multiplier = 1;
  let remaining = 0;
  let offset = 1;
  let digit = 0;
  do {
    digit = bytes[offset++];
    remaining += (digit & 127) * multiplier;
    multiplier *= 128;
  } while ((digit & 128) !== 0 && offset < bytes.length);

  if (remaining <= 2 || offset + remaining > bytes.length) return null;
  const topicLength = (bytes[offset] << 8) + bytes[offset + 1];
  offset += 2;
  if (offset + topicLength > bytes.length) return null;
  const topic = new TextDecoder().decode(bytes.slice(offset, offset + topicLength));
  offset += topicLength;
  const payload = new TextDecoder().decode(bytes.slice(offset, offset + remaining - topicLength - 2));
  return { topic, payload };
}

class MqttPublisher {
  private config: MqttIntegrationConfig | null = null;
  private ws: WebSocket | null = null;
  private queue: PublishItem[] = [];
  private subscriptions = new Map<string, Set<SubscriptionHandler>>();
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private reconnectDelayMs = 1000;
  private nextPacketId = 1;
  private activeConnectionKey: string | null = null;
  private sessionEstablished = false;

  configure(config: MqttIntegrationConfig): void {
    const nextConnectionKey = connectionConfigKey(config);
    const connectionChanged = this.activeConnectionKey !== null && this.activeConnectionKey !== nextConnectionKey;
    this.config = config;
    if (!config.enabled || !config.brokerUrl.trim()) {
      this.disconnect();
      return;
    }
    if (connectionChanged) this.disconnect();
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

  subscribe(topic: string, handler: SubscriptionHandler): () => void {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) return () => undefined;
    const handlers = this.subscriptions.get(normalizedTopic) ?? new Set<SubscriptionHandler>();
    handlers.add(handler);
    this.subscriptions.set(normalizedTopic, handlers);
    this.subscribeSocket(normalizedTopic);
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.connect();
    }

    return () => {
      const currentHandlers = this.subscriptions.get(normalizedTopic);
      currentHandlers?.delete(handler);
      if (currentHandlers?.size === 0) this.subscriptions.delete(normalizedTopic);
    };
  }

  disconnect(): void {
    this.clearTimers();
    const socket = this.ws;
    this.ws = null;
    this.sessionEstablished = false;
    this.activeConnectionKey = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
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
      this.activeConnectionKey = connectionConfigKey(config);
      this.sessionEstablished = false;

      socket.addEventListener('open', () => {
        socket.send(sendableBuffer(encodeConnectPacket(config)));
      });
      socket.addEventListener('message', (event) => {
        if (this.ws !== socket) return;
        const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array();
        if (data[0] === 0x20 && data[3] === 0) {
          this.sessionEstablished = true;
          this.reconnectDelayMs = 1000;
          this.startPing();
          this.resubscribe();
          this.flush();
        } else {
          this.handlePublish(data);
        }
      });
      socket.addEventListener('close', () => {
        if (this.ws !== socket) return;
        this.sessionEstablished = false;
        this.ws = null;
        this.scheduleReconnect();
      });
      socket.addEventListener('error', () => {
        if (socket.readyState === WebSocket.OPEN) socket.close();
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private flush(): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.sessionEstablished) return;
    const items = this.queue.splice(0);
    for (const item of items) {
      socket.send(sendableBuffer(encodePublishPacket(item.topic, item.payload)));
    }
  }

  private subscribeSocket(topic: string): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.sessionEstablished) return;
    socket.send(sendableBuffer(encodeSubscribePacket(topic, this.allocatePacketId())));
  }

  private resubscribe(): void {
    for (const topic of this.subscriptions.keys()) {
      this.subscribeSocket(topic);
    }
  }

  private handlePublish(data: Uint8Array): void {
    const packetData = decodePublishPacket(data);
    if (!packetData) return;
    const handlers = this.subscriptions.get(packetData.topic);
    if (!handlers) return;
    handlers.forEach((handler) => {
      try { handler(packetData.payload, packetData.topic); }
      catch (err) { console.error('[MQTT] subscriber threw:', err); }
    });
  }

  private allocatePacketId(): number {
    const packetId = this.nextPacketId;
    this.nextPacketId = this.nextPacketId >= 65535 ? 1 : this.nextPacketId + 1;
    return packetId;
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
