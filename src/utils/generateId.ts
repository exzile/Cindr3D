/** Generates a time-ordered unique ID, optionally with a semantic prefix. */
export function generateId(prefix?: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prefix ? `${prefix}-${suffix}` : suffix;
}
