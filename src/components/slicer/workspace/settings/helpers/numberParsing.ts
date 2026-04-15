export function parseNumberOr(input: string, fallback: number): number {
  const parsed = Number.parseFloat(input);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseIntOr(input: string, fallback: number): number {
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
