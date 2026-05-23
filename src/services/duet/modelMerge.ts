export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (Array.isArray(srcVal) && Array.isArray(tgtVal)) {
      output[key] = srcVal.map((sv, index) => {
        // RRF diff mode sends null at an array index to mean "unchanged" — keep existing.
        if (sv === null || sv === undefined) return tgtVal[index];
        const tv = tgtVal[index];
        if (typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
          return deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
        }
        return sv;
      });
    } else if (
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      output[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      output[key] = srcVal;
    }
  }
  return output;
}
