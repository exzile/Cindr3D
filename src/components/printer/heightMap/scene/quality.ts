/** RMS -> quality bucket used by height-map summaries. */
export function getBedQuality(rms: number): { label: string; color: string } {
  if (rms < 0.05) return { label: 'Excellent', color: '#22c55e' };
  if (rms < 0.1) return { label: 'Good', color: '#4ade80' };
  if (rms < 0.2) return { label: 'Fair', color: '#f59e0b' };
  return { label: 'Poor', color: '#ef4444' };
}
