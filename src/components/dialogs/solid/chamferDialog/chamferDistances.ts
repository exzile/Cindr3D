/**
 * Shared chamfer distance resolution — used by both ChamferDialog (commit) and
 * useChamferDialogState (live validity probe) so the previewed value and the
 * committed value are always computed identically.
 */
import type { ChamferParams } from "./types";

export function resolveChamferDistance2(
  p: Pick<ChamferParams, "mode" | "distance" | "distance2" | "angle">,
): number {
  if (p.mode === "two-dist") return p.distance2 ?? p.distance;
  if (p.mode === "dist-angle") {
    const angle = Math.max(1, Math.min(89, p.angle ?? 45));
    return Math.max(0.01, p.distance * Math.tan((angle * Math.PI) / 180));
  }
  return p.distance;
}

export function resolveChamferDistances(
  p: Pick<ChamferParams, "mode" | "distance" | "distance2" | "angle" | "isFlipped">,
): [number, number] {
  const d1 = p.distance;
  const d2 = resolveChamferDistance2(p);
  return p.isFlipped ? [d2, d1] : [d1, d2];
}
