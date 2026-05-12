/**
 * Parses a numeric sensor value from an MQTT payload string.
 * Tries direct number conversion first, then JSON with field alias lookup.
 */
export function parseNumericPayload(payload: string, fieldAliases: string[]): number | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      for (const alias of fieldAliases) {
        const next = Number(record[alias]);
        if (Number.isFinite(next)) return next;
      }
    }
  } catch {
    return null;
  }

  return null;
}
