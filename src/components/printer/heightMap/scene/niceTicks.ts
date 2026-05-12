/** Pick a "nice" step so there are roughly targetCount ticks in [min, max]. */
export function computeNiceTicks(min: number, max: number, targetCount = 6): number[] {
  const range = max - min;
  if (range < 1e-6) return [parseFloat(((min + max) / 2).toFixed(6))];

  const rawStep = range / targetCount;
  const mag     = Math.pow(10, Math.floor(Math.log10(rawStep)));
  let   step    = mag;
  for (const f of [1, 2, 2.5, 5, 10]) {
    step = f * mag;
    if (range / step <= targetCount + 1) break;
  }

  const ticks: number[] = [];
  let t = Math.floor(min / step) * step;
  while (t <= max + step * 0.001) {
    const v = Math.round(t / step) * step; // eliminate floating-point drift
    if (v >= min - step * 0.001 && v <= max + step * 0.001) ticks.push(v);
    t += step;
  }

  // Always include 0 when the range straddles the flat reference.
  if (min < 0 && max > 0 && !ticks.some((v) => Math.abs(v) < step * 0.01)) {
    ticks.push(0);
    ticks.sort((a, b) => a - b);
  }

  return ticks;
}
