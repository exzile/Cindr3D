import type { IntegrationPrinterSnapshot } from './notificationSender';

export type HomeAssistantAction = 'pause' | 'resume' | 'cancel';

export interface HomeAssistantCommand {
  id: string;
  printerId: string | null;
  action: HomeAssistantAction;
  createdAt: string;
}

export interface HomeAssistantSnapshot extends IntegrationPrinterSnapshot {
  updatedAt: string;
}

export function buildHomeAssistantSnapshot(snapshot: IntegrationPrinterSnapshot): HomeAssistantSnapshot {
  return {
    ...snapshot,
    updatedAt: new Date().toISOString(),
  };
}

export async function publishHomeAssistantSnapshot(snapshot: IntegrationPrinterSnapshot): Promise<void> {
  await fetch('/home-assistant-bridge/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildHomeAssistantSnapshot(snapshot)),
  }).catch((err: unknown) => {
    console.warn('[HA bridge] publishHomeAssistantSnapshot failed:', err instanceof Error ? err.message : String(err));
  });
}

export async function fetchHomeAssistantCommands(printerId: string | null): Promise<HomeAssistantCommand[]> {
  if (!printerId) return [];
  try {
    const response = await fetch(`/home-assistant-bridge/commands?printerId=${encodeURIComponent(printerId)}`);
    if (!response.ok) return [];
    const body = await response.json() as { commands?: HomeAssistantCommand[] };
    return Array.isArray(body.commands) ? body.commands : [];
  } catch {
    return [];
  }
}
