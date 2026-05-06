import { useIntegrationStore, type IntegrationEventType, type IntegrationRule, type IntegrationTarget } from '../../store/integrationStore';
import { mqttPublisher } from './mqttPublisher';

export interface IntegrationPrinterSnapshot {
  printerId: string | null;
  printerName: string;
  status: string;
  fileName?: string;
  layer?: number;
  progress?: number;
  temperatures?: Record<string, number | null>;
  position?: Record<string, number | null>;
}

export interface IntegrationNotificationPayload {
  event: IntegrationEventType;
  occurredAt: string;
  printer: IntegrationPrinterSnapshot;
  message: string;
}

export interface IntegrationSendResult {
  targetId: string;
  ok: boolean;
  error?: string;
}

const EVENT_LABELS: Record<IntegrationEventType, string> = {
  PRINT_START: 'Print started',
  LAYER_CHANGE: 'Layer changed',
  PAUSED: 'Print paused',
  FAILED: 'Print failed',
  DONE: 'Print complete',
};

function compactSnapshot(value: IntegrationPrinterSnapshot): IntegrationPrinterSnapshot {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null)) as unknown as IntegrationPrinterSnapshot;
}

export function buildIntegrationPayload(event: IntegrationEventType, snapshot: IntegrationPrinterSnapshot): IntegrationNotificationPayload {
  const layerText = typeof snapshot.layer === 'number' ? ` layer ${snapshot.layer}` : '';
  const fileText = snapshot.fileName ? `: ${snapshot.fileName}` : '';
  return {
    event,
    occurredAt: new Date().toISOString(),
    printer: compactSnapshot(snapshot),
    message: `${EVENT_LABELS[event]} on ${snapshot.printerName}${layerText}${fileText}`,
  };
}

function webhookBody(target: IntegrationTarget, payload: IntegrationNotificationPayload) {
  if (target.type === 'discord') {
    return {
      content: payload.message,
      embeds: [{
        title: EVENT_LABELS[payload.event],
        description: payload.printer.fileName ?? payload.printer.status,
        timestamp: payload.occurredAt,
        fields: [
          { name: 'Printer', value: payload.printer.printerName, inline: true },
          { name: 'Status', value: payload.printer.status, inline: true },
          ...(typeof payload.printer.layer === 'number' ? [{ name: 'Layer', value: String(payload.printer.layer), inline: true }] : []),
        ],
      }],
    };
  }
  if (target.type === 'slack') {
    return {
      text: payload.message,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${EVENT_LABELS[payload.event]}*\n${payload.message}` } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `Printer: ${payload.printer.printerName} - Status: ${payload.printer.status}` }] },
      ],
    };
  }
  return payload;
}

function targetUrl(target: IntegrationTarget): string {
  if (target.type === 'telegram') {
    const token = target.token.trim();
    return token ? `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage` : target.url;
  }
  return target.url;
}

function targetBody(target: IntegrationTarget, payload: IntegrationNotificationPayload) {
  if (target.type === 'telegram') {
    return {
      chat_id: target.chatId,
      text: payload.message,
      disable_web_page_preview: true,
    };
  }
  return webhookBody(target, payload);
}

async function sendToTarget(target: IntegrationTarget, payload: IntegrationNotificationPayload): Promise<IntegrationSendResult> {
  if (!target.enabled) return { targetId: target.id, ok: true };
  const url = targetUrl(target);
  if (!url.trim()) return { targetId: target.id, ok: false, error: 'Missing integration URL' };
  if (target.type === 'telegram' && !target.chatId.trim()) return { targetId: target.id, ok: false, error: 'Missing Telegram chat ID' };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(targetBody(target, payload)),
    });
    if (!response.ok) {
      return { targetId: target.id, ok: false, error: `${response.status} ${response.statusText}`.trim() };
    }
    return { targetId: target.id, ok: true };
  } catch (error) {
    return { targetId: target.id, ok: false, error: error instanceof Error ? error.message : 'Unable to send integration notification' };
  }
}

function ruleTargets(rule: IntegrationRule, targets: IntegrationTarget[]): IntegrationTarget[] {
  const lookup = new Map(targets.map((target) => [target.id, target]));
  return rule.targetIds.map((id) => lookup.get(id)).filter((target): target is IntegrationTarget => Boolean(target));
}

export async function sendIntegrationEvent(event: IntegrationEventType, snapshot: IntegrationPrinterSnapshot): Promise<IntegrationSendResult[]> {
  const state = useIntegrationStore.getState();
  const payload = buildIntegrationPayload(event, snapshot);
  mqttPublisher.configure(state.mqtt);
  mqttPublisher.publishEvent(payload);
  const rules = state.matchingRules(event, snapshot.printerId);
  if (rules.length === 0) return [];
  const targets = new Map<string, IntegrationTarget>();
  for (const rule of rules) {
    for (const target of ruleTargets(rule, state.targets)) {
      targets.set(target.id, target);
    }
  }
  return Promise.all([...targets.values()].map((target) => sendToTarget(target, payload)));
}
