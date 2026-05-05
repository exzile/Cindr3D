export interface ArrangeBedMesh {
  points: number[][];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  profileName?: string;
  updatedAt?: number;
  source?: 'klipper' | 'duet' | 'manual';
}

export interface BedMeshRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sampleBedMesh(mesh: ArrangeBedMesh, x: number, y: number): number | null {
  const rows = mesh.points.length;
  const cols = mesh.points[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return null;
  if (mesh.maxX <= mesh.minX || mesh.maxY <= mesh.minY) return null;

  const tx = clamp((x - mesh.minX) / (mesh.maxX - mesh.minX), 0, 1) * (cols - 1);
  const ty = clamp((y - mesh.minY) / (mesh.maxY - mesh.minY), 0, 1) * (rows - 1);
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const fx = tx - x0;
  const fy = ty - y0;
  const a = mesh.points[y0]?.[x0];
  const b = mesh.points[y0]?.[x1];
  const c = mesh.points[y1]?.[x0];
  const d = mesh.points[y1]?.[x1];
  if (![a, b, c, d].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  const top = a * (1 - fx) + b * fx;
  const bottom = c * (1 - fx) + d * fx;
  return top * (1 - fy) + bottom * fy;
}

export function scoreBedMeshPlacement(mesh: ArrangeBedMesh | null, rect: BedMeshRect): number {
  if (!mesh) return 0;
  const samples: number[] = [];
  const xs = [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
  const ys = [rect.y, rect.y + rect.h / 2, rect.y + rect.h];
  for (const x of xs) {
    for (const y of ys) {
      const sample = sampleBedMesh(mesh, x, y);
      if (sample !== null) samples.push(sample);
    }
  }
  if (samples.length === 0) return 0;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = max - min;
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length);
  const maxAbs = Math.max(...samples.map((value) => Math.abs(value)));
  const deadSpotPenalty = maxAbs > 0.35 || range > 0.25 ? 10000 : 0;
  return deadSpotPenalty + range * 1000 + rms * 500 + maxAbs * 50;
}
