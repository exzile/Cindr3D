export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function getPos(positions: Float32Array, idx: number): [number, number, number] {
  return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
}

export function setPos(positions: Float32Array, idx: number, p: [number, number, number]): void {
  positions[idx * 3] = p[0];
  positions[idx * 3 + 1] = p[1];
  positions[idx * 3 + 2] = p[2];
}

export function avgPoints(pts: [number, number, number][]): [number, number, number] {
  const n = pts.length;
  if (n === 0) return [0, 0, 0];
  let x = 0; let y = 0; let z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / n, y / n, z / n];
}
