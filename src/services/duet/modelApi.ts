import type { DuetConfig, DuetObjectModel } from '../../types/duet';
import { deepMerge } from './modelMerge';

type RequestFn = <T = unknown>(url: string, init?: RequestInit) => Promise<T>;

export function applyModelPatch(
  current: Partial<DuetObjectModel>,
  patch: Record<string, unknown>,
): Partial<DuetObjectModel> {
  return deepMerge(
    current as Record<string, unknown>,
    patch,
  ) as Partial<DuetObjectModel>;
}

export async function getObjectModelRequest(
  config: DuetConfig,
  baseUrl: string,
  request: RequestFn,
  key?: string,
  flags?: string,
): Promise<Partial<DuetObjectModel>> {
  if (config.mode === 'sbc') {
    const url = key
      ? `${baseUrl}/machine/model/${encodeURIComponent(key)}`
      : `${baseUrl}/machine/model`;
    return request<Partial<DuetObjectModel>>(url);
  }

  const params = new URLSearchParams();
  if (key) params.set('key', key);
  params.set('flags', flags ?? 'd99fn');
  const url = `${baseUrl}/rr_model?${params.toString()}`;
  const response = await request<{ key: string; result: Partial<DuetObjectModel> }>(url);
  return response.result ?? response as unknown as Partial<DuetObjectModel>;
}

export async function fetchConfigSnapshot(
  getObjectModel: (key?: string, flags?: string) => Promise<Partial<DuetObjectModel>>,
  applyPatch: (patch: Record<string, unknown>) => void,
): Promise<void> {
  const sections = ['tools', 'heat', 'fans', 'move', 'boards', 'sensors', 'state'] as const;
  const results = await Promise.allSettled(
    sections.map((section) => getObjectModel(section, 'd99vn')),
  );
  for (let i = 0; i < sections.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      applyPatch({ [sections[i]]: result.value });
    }
  }
}
