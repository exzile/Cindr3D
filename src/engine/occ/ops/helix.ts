/**
 * OCC-15.5 — Helical wire construction and coil sweep.
 * Builds a polyline-approximated helix TopoDS_Wire, then sweeps a circle (or any
 * SketchProfile) along it via BRepOffsetAPI_MakePipe to produce a solid BRepBody.
 *
 * The helix rises along the +Y axis by default (matching GeometryEngine.coilGeometry).
 * Right-hand thread: angle increases counter-clockwise when viewed from +Y.
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';
import type { BRepBody } from '../brepBody';
import { createOccPlaneFrame } from '../plane';
import { type SketchProfile } from './sketchToWire';
import { occSweepFromPathWireWithInstance } from './sweep';

const SEGMENTS_PER_TURN = 32; // polyline resolution; more is smoother but heavier

/**
 * Build an open TopoDS_Wire polyline approximating a helix.
 *
 * Helix center axis = +Y.  At t=0 the path starts at (radius, 0, 0).
 * rightHand = true  → angle increases (CCW from top = right-hand screw).
 * rightHand = false → angle decreases (CW = left-hand screw).
 *
 * Returns null if construction fails (degenerate params or OCC wire error).
 * Caller owns the returned wire and must call .delete() on it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildHelixWire(
  oc: OcctRaw,
  radius: number,
  pitch: number,
  turns: number,
  rightHand = true,
): { delete: () => void } | null {
  if (radius <= 0 || pitch <= 0 || turns <= 0) return null;

  const totalFrames = Math.max(64, Math.round(turns * SEGMENTS_PER_TURN));
  const sign = rightHand ? 1 : -1;
  const points: THREE.Vector3[] = [];

  for (let i = 0; i <= totalFrames; i++) {
    const t = i / totalFrames;
    const angle = sign * t * turns * Math.PI * 2;
    const y = t * turns * pitch;
    points.push(new THREE.Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle)));
  }

  // Build open polyline wire — same pattern as buildOpenPolylineWire in pipe.ts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wireMaker: any = new (oc as any).BRepBuilderAPI_MakeWire_1();
  let edgeCount = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a.distanceToSquared(b) < 1e-12) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pa = new (oc as any).gp_Pnt_3(a.x, a.y, a.z);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pb = new (oc as any).gp_Pnt_3(b.x, b.y, b.z);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgeMk = new (oc as any).BRepBuilderAPI_MakeEdge_3(pa, pb);
    pa.delete();
    pb.delete();

    if (!edgeMk.IsDone()) { edgeMk.delete(); continue; }
    wireMaker.Add_1(edgeMk.Edge());
    edgeMk.delete();
    edgeCount++;
  }

  if (edgeCount < 1 || !wireMaker.IsDone()) {
    wireMaker.delete();
    return null;
  }

  const wire = wireMaker.Wire();
  wireMaker.delete();
  return wire;
}

/**
 * Circle profile for coil cross-section (CCW, 24 segments).
 * UV coords — caller provides the plane frame that maps these to world space.
 */
function circleSketchProfile(radius: number, segments = 24): SketchProfile {
  const outer: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    outer.push(new THREE.Vector2(Math.cos(theta) * radius, Math.sin(theta) * radius));
  }
  return { outer, holes: [] };
}

export interface OccCoilOptions {
  id?: string;
  sourceFeatureId?: string;
  /** Whether the helix is right-handed (default: true). */
  rightHand?: boolean;
}

/**
 * Build a solid coil BRepBody by sweeping a circular profile along a helix.
 *
 * @param outerRadius  Radius of the helix centre-line (mm)
 * @param wireRadius   Radius of the swept circular cross-section (mm)
 * @param pitch        Height per revolution (mm)
 * @param turns        Number of revolutions
 */
export function occCoilWithInstance(
  oc: OcctRaw,
  outerRadius: number,
  wireRadius: number,
  pitch: number,
  turns: number,
  options: OccCoilOptions = {},
): BRepBody {
  const rightHand = options.rightHand ?? true;

  const helixWire = buildHelixWire(oc, outerRadius, pitch, turns, rightHand);
  if (!helixWire) throw new Error('[occCoil] failed to build helix wire — check radius/pitch/turns');

  try {
    // Profile frame: origin at helix start, normal = helix tangent there.
    // The circle profile is rotationally symmetric so uDir/vDir don't matter.
    const startPt = new THREE.Vector3(outerRadius, 0, 0);
    // Approximate tangent: from first to second helix point
    const dAngle = (2 * Math.PI * turns) / Math.max(64, Math.round(turns * SEGMENTS_PER_TURN));
    const nextPt = new THREE.Vector3(
      outerRadius * Math.cos((rightHand ? 1 : -1) * dAngle),
      pitch * turns / Math.max(64, Math.round(turns * SEGMENTS_PER_TURN)),
      outerRadius * Math.sin((rightHand ? 1 : -1) * dAngle),
    );
    const tangent = nextPt.clone().sub(startPt).normalize();
    const frame = createOccPlaneFrame(startPt, tangent);

    const profile = circleSketchProfile(wireRadius);
    const body = occSweepFromPathWireWithInstance(oc, profile, frame, helixWire, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
    });
    return body;
  } finally {
    helixWire.delete();
  }
}

/**
 * Build a helical thread-groove BRepBody for modeled threads.
 * Profile: circle approximation of thread cross-section.
 * The solid can be subtracted from a cylinder to cut real thread geometry.
 *
 * @param radius   Thread major radius (half of diameter, mm)
 * @param pitch    Thread pitch (mm per revolution)
 * @param length   Thread length (mm) — determines turns = length / pitch
 * @param rightHand Whether the thread is right-hand (default: true)
 */
export function occModeledThreadWithInstance(
  oc: OcctRaw,
  radius: number,
  pitch: number,
  length: number,
  options: OccCoilOptions = {},
): BRepBody {
  const turns = Math.max(0.25, length / pitch);
  // Thread groove cross-section: circle of ~half the ISO thread depth
  // ISO 68-1: H = pitch * sqrt(3)/2 ≈ 0.866 * pitch; useful depth ≈ 0.6134 * pitch
  // Use radius ≈ 0.32 * pitch for the swept circle (fits within the groove depth)
  const grooveRadius = Math.max(0.05, pitch * 0.32);

  // The helix path is centred at the major radius; the circle is swept around it.
  return occCoilWithInstance(oc, radius, grooveRadius, pitch, turns, options);
}
