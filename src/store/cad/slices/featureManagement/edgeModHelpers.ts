import * as THREE from 'three';
import type { BRepBody } from '../../../../engine/occ/brepBody';
import { getOccSync } from '../../../../engine/occ/loader';
import { collectTangentChainEdges } from '../../../../engine/occ/ops/adjacency';
import type { OccFilletEdgeSet } from '../../../../engine/occ/ops/fillet';

export const DEFAULT_FILLET_RADIUS = 2;
export const DEFAULT_CHAMFER_DISTANCE = 2;

export function resolveOccFilletOptions(params?: Record<string, unknown>): {
  continuity?: 'G1' | 'G2';
  tangencyWeight?: number;
} {
  const continuity: 'G1' | 'G2' = params?.isG2 === true ? 'G2' : 'G1';
  const tangencyWeight = (continuity === 'G2' && typeof params?.tangencyWeight === 'number')
    ? params.tangencyWeight
    : undefined;
  return { continuity, tangencyWeight };
}

export function propagateTangentEdges(
  oc: ReturnType<typeof getOccSync>,
  body: BRepBody,
  seedEdgeIds: number[],
): number[] {
  if (!oc) return seedEdgeIds;
  try {
    return collectTangentChainEdges(oc.oc, body, seedEdgeIds);
  } catch (err) {
    console.warn('[edgeMod.propagate] tangent-chain walk failed:', err);
    return seedEdgeIds;
  }
}

export function resolveOccFilletEdgeSets(
  numericEdgeIds: number[],
  srcBody: BRepBody,
  params?: Record<string, unknown>,
  fallbackRadius = DEFAULT_FILLET_RADIUS,
): OccFilletEdgeSet[] {
  if (!params) return [{ edgeIds: numericEdgeIds, radius: fallbackRadius }];

  const shouldPropagate = params.propagate === true;
  const occ = shouldPropagate ? getOccSync() : null;
  const expand = (edgeIds: number[]): number[] => {
    if (!shouldPropagate || !occ || edgeIds.length === 0) return edgeIds;
    try {
      const expanded = collectTangentChainEdges(occ.oc, srcBody, edgeIds);
      return expanded.length > edgeIds.length ? expanded : edgeIds;
    } catch (err) {
      console.warn('[fillet.propagate] tangent-chain walk failed:', err);
      return edgeIds;
    }
  };

  if (Array.isArray(params.edgeSets) && (params.edgeSets as unknown[]).length > 0) {
    const sets: OccFilletEdgeSet[] = [];
    for (const s of params.edgeSets as Record<string, unknown>[]) {
      const rawIds = Array.isArray(s.edgeIds) ? (s.edgeIds as string[]) : [];
      const setNumericIds = rawIds
        .map((id) => {
          const parts = String(id).split(':');
          if (parts[0] !== 'occ' || !parts[2]) return null;
          const n = Number(parts[2]);
          return Number.isInteger(n) && srcBody.edgeIds.has(n) ? n : null;
        })
        .filter((n): n is number => n !== null);
      if (setNumericIds.length === 0) continue;
      const expandedIds = expand(setNumericIds);
      if (s.type === 'chord-length' && typeof s.chordLength === 'number') {
        sets.push({ edgeIds: expandedIds, chordLength: s.chordLength });
      } else if (s.type === 'variable' && typeof s.radius === 'number' && typeof s.endRadius === 'number') {
        sets.push({ edgeIds: expandedIds, startRadius: s.radius, endRadius: s.endRadius });
      } else if (s.type === 'asymmetric') {
        let r1 = typeof s.offsetOne === 'number' ? Math.max(s.offsetOne, 0.001) : (params.radius as number) ?? DEFAULT_FILLET_RADIUS;
        let r2 = typeof s.offsetTwo === 'number' ? Math.max(s.offsetTwo, 0.001) : r1;
        if (s.isFlipped === true) [r1, r2] = [r2, r1];
        sets.push({ edgeIds: expandedIds, startRadius: r1, endRadius: r2, isAsymmetric: true });
      } else {
        sets.push({ edgeIds: expandedIds, radius: typeof s.radius === 'number' ? s.radius : (params.radius as number) ?? DEFAULT_FILLET_RADIUS });
      }
    }
    if (sets.length > 0) return sets;
  }

  const mode = typeof params.mode === 'string' ? params.mode : 'constant';
  const fallbackR = typeof params.radius === 'number' ? params.radius : fallbackRadius;
  const expandedTopLevelIds = expand(numericEdgeIds);

  if (mode === 'asymmetric') {
    let r1 = typeof params.offsetOne === 'number' ? Math.max(params.offsetOne, 0.001) : fallbackR;
    let r2 = typeof params.offsetTwo === 'number' ? Math.max(params.offsetTwo, 0.001) : r1;
    if (params.isFlipped === true) [r1, r2] = [r2, r1];
    return [{ edgeIds: expandedTopLevelIds, startRadius: r1, endRadius: r2, isAsymmetric: true }];
  }
  if (mode === 'chord-length') {
    const chord = typeof params.chordLength === 'number' ? params.chordLength : fallbackR;
    return [{ edgeIds: expandedTopLevelIds, chordLength: chord }];
  }
  if (mode === 'variable') {
    const start = typeof params.startRadius === 'number' ? params.startRadius : fallbackR;
    const end = typeof params.endRadius === 'number' ? params.endRadius : start;
    return [{ edgeIds: expandedTopLevelIds, startRadius: start, endRadius: end }];
  }
  return [{ edgeIds: expandedTopLevelIds, radius: fallbackR }];
}

export function resolveOccChamferDistances(params: Record<string, unknown>): [number, number] {
  const distance = typeof params.distance === 'number' ? params.distance : DEFAULT_CHAMFER_DISTANCE;
  const mode = typeof params.mode === 'string' ? params.mode : 'equal-dist';
  let distance2 = typeof params.distance2 === 'number' ? params.distance2 : distance;
  if (mode === 'dist-angle') {
    const angle = typeof params.angle === 'number' ? params.angle : 45;
    distance2 = Math.max(
      0.01,
      distance * Math.tan((THREE.MathUtils.clamp(angle, 1, 89) * Math.PI) / 180),
    );
  } else if (mode !== 'two-dist') {
    distance2 = distance;
  }
  return params.isFlipped ? [distance2, distance] : [distance, distance2];
}
