export type OccOperationSeverity = 'info' | 'warning' | 'error';

export interface OccOperationMessage {
  severity: OccOperationSeverity;
  code: string;
  message: string;
}

export type OccOperationResult<TValue> =
  | { ok: true; value: TValue; messages: OccOperationMessage[] }
  | { ok: false; value?: undefined; messages: OccOperationMessage[] };

export function occOk<TValue>(value: TValue, messages: OccOperationMessage[] = []): OccOperationResult<TValue> {
  return { ok: true, value, messages };
}

export function occErr<TValue = never>(message: OccOperationMessage): OccOperationResult<TValue> {
  return { ok: false, messages: [message] };
}

export function occMessage(
  severity: OccOperationSeverity,
  code: string,
  message: string,
): OccOperationMessage {
  return { severity, code, message };
}
