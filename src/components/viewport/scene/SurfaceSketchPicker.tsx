/**
 * SurfaceSketchPicker — in-canvas profile/curve selection for Surface CREATE tools.
 *
 * Fusion-style: the ACTIVE input determines what is pickable.
 *  - When the tool wants a PROFILE (Sweep profile, Patch, Loft sections), each
 *    sketch with a closed region renders a translucent FILL mesh — click a face
 *    (e.g. a circle) to select it. Solid meshes raycast reliably.
 *  - When the tool wants a CURVE/PATH (Sweep path/guide, Ruled curves), each
 *    sketch renders a clickable TUBE following its tessellated curve — so open
 *    curves like an arc can be picked (thin lines barely raycast).
 *
 * Clicking fills the next empty input field on the active tool.
 */

import { useMemo, useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { Sketch } from '../../../types/cad';

// Module-level singleton materials — never disposed.
const _fillIdle = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
const _fillHover = new THREE.MeshBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
const _curveIdle = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 });
const _curveHover = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
[_fillIdle, _fillHover, _curveIdle, _curveHover].forEach((m) => { m.userData['shared'] = true; });

type PickKind = 'profile' | 'curve';

const ACTIVE_TOOLS = new Set(['sweep', 'loft', 'patch', 'ruled-surface']);

/** What does the next click set, and is it a profile or a curve? null = all inputs filled. */
function nextPick(tool: string, s: ReturnType<typeof useCADStore.getState>): { target: string; kind: PickKind } | null {
  switch (tool) {
    case 'sweep': {
      // An explicitly-activated input (clicked in the panel) takes priority.
      const a = s.sweepActiveInput;
      if (a === 'profile1') return { target: 'sweep-profile', kind: 'profile' };
      if (a === 'profile2') return { target: 'sweep-profile2', kind: 'profile' };
      if (a === 'path') return { target: 'sweep-path', kind: 'curve' };
      if (a === 'guide') return { target: 'sweep-guide', kind: 'curve' };
      // Auto-advance: Profile 1 → Path → Guide. Profile 2 is optional and only
      // picked when its row is explicitly activated.
      if (!s.sweepProfileSketchId) return { target: 'sweep-profile', kind: 'profile' };
      if (!s.sweepPathSketchId) return { target: 'sweep-path', kind: 'curve' };
      if (s.sweepType === 'guide-rail' && !s.sweepGuideRailId) return { target: 'sweep-guide', kind: 'curve' };
      return null;
    }
    case 'loft': {
      const i = s.loftProfileSketchIds.findIndex((id) => !id);
      return i >= 0 ? { target: `loft-profile-${i}`, kind: 'profile' } : null;
    }
    case 'patch':
      return s.patchSelectedSketchId ? null : { target: 'patch-profile', kind: 'profile' };
    case 'ruled-surface':
      if (!s.ruledSketchAId) return { target: 'ruled-a', kind: 'curve' };
      if (s.ruledMode !== 'extend-edge' && !s.ruledSketchBId) return { target: 'ruled-b', kind: 'curve' };
      return null;
    default:
      return null;
  }
}

function dispatchPick(sketchId: string, target: string) {
  const s = useCADStore.getState();
  // Clear the explicit active input after a pick so auto-advance resumes.
  if (target.startsWith('sweep-')) s.setSweepActiveInput(null);
  if (target === 'sweep-profile') { s.setSweepProfileSketchId(sketchId); return; }
  if (target === 'sweep-profile2') { s.setSweepProfileSketchId2(sketchId); return; }
  if (target === 'sweep-path') { s.setSweepPathSketchId(sketchId); return; }
  if (target === 'sweep-guide') { s.setSweepGuideRailId(sketchId); return; }
  if (target.startsWith('loft-profile-')) {
    const idx = Number(target.split('-')[2]);
    const ids = [...s.loftProfileSketchIds];
    if (idx >= ids.length) ids.push(sketchId); else ids[idx] = sketchId;
    s.setLoftProfileSketchIds(ids);
    return;
  }
  if (target === 'patch-profile') { s.setPatchSelectedSketchId(sketchId); return; }
  if (target === 'ruled-a') { s.setRuledSketchAId(sketchId); return; }
  if (target === 'ruled-b') { s.setRuledSketchBId(sketchId); return; }
}

/** Tessellated world-space points for a sketch's curve (reuses the renderer's tessellation). */
function sketchWorldPoints(sketch: Sketch): THREE.Vector3[] {
  const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
  const pts: THREE.Vector3[] = [];
  for (const entity of sketch.entities) {
    if (entity.type === 'construction-line' || entity.type === 'centerline' || entity.type === 'point') continue;
    const obj = GeometryEngine.createEntityGeometry(entity, sketch.plane, { t1, t2 });
    if (!obj) continue;
    obj.traverse((child) => {
      const geom = (child as THREE.Line).geometry as THREE.BufferGeometry | undefined;
      const pos = geom?.getAttribute?.('position') as THREE.BufferAttribute | undefined;
      if (pos) {
        for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      }
      geom?.dispose?.(); // dispose the throwaway geometry; materials are shared singletons
    });
  }
  return pts;
}

// ── Profile fill (clickable solid region) ──────────────────────────────────────
function ProfileFill({ sketch, onPick }: { sketch: Sketch; onPick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const { invalidate } = useThree();
  const mesh = useMemo(() => GeometryEngine.createSketchProfileMesh(sketch, _fillIdle), [sketch]);

  useEffect(() => () => { mesh?.geometry.dispose(); }, [mesh]);
  useFrame(() => {
    if (mesh) {
      const want = hovered ? _fillHover : _fillIdle;
      if (mesh.material !== want) { mesh.material = want; invalidate(); }
    }
  });
  if (!mesh) return null;
  return (
    <primitive
      object={mesh}
      renderOrder={1000}
      onPointerOver={(e: { stopPropagation: () => void }) => { e.stopPropagation(); setHovered(true); invalidate(); }}
      onPointerOut={() => { setHovered(false); invalidate(); }}
      onPointerDown={(e: { stopPropagation: () => void }) => { e.stopPropagation(); onPick(); invalidate(); }}
    />
  );
}

// ── Curve tube (clickable open/closed curve) ───────────────────────────────────
function CurveTube({ sketch, onPick }: { sketch: Sketch; onPick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const { invalidate } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);

  const geom = useMemo(() => {
    const raw = sketchWorldPoints(sketch);
    // Dedupe consecutive coincident points (CatmullRom rejects zero-length spans)
    const pts: THREE.Vector3[] = [];
    for (const p of raw) {
      if (pts.length === 0 || pts[pts.length - 1].distanceToSquared(p) > 1e-8) pts.push(p);
    }
    if (pts.length < 2) return null;
    try {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0);
      return new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), 0.6, 5, false);
    } catch {
      return null;
    }
  }, [sketch]);

  useEffect(() => () => { geom?.dispose(); }, [geom]);
  useFrame(() => {
    if (meshRef.current) {
      const want = hovered ? _curveHover : _curveIdle;
      if (meshRef.current.material !== want) { meshRef.current.material = want; invalidate(); }
    }
  });
  if (!geom) return null;
  return (
    <mesh
      ref={meshRef}
      geometry={geom}
      material={_curveIdle}
      renderOrder={1001}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); invalidate(); }}
      onPointerOut={() => { setHovered(false); invalidate(); }}
      onPointerDown={(e) => { e.stopPropagation(); onPick(); invalidate(); }}
    />
  );
}

export function SurfaceSketchPicker() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches = useCADStore((s) => s.sketches);
  // Subscribe to all selection fields so the active pick target recomputes on change.
  const sweepP1 = useCADStore((s) => s.sweepProfileSketchId);
  const sweepP2 = useCADStore((s) => s.sweepProfileSketchId2);
  const sweepPath = useCADStore((s) => s.sweepPathSketchId);
  const sweepGuide = useCADStore((s) => s.sweepGuideRailId);
  useCADStore((s) => s.sweepActiveInput);
  useCADStore((s) => s.sweepType);
  const loftIds = useCADStore((s) => s.loftProfileSketchIds);
  const patchId = useCADStore((s) => s.patchSelectedSketchId);
  const ruledA = useCADStore((s) => s.ruledSketchAId);
  const ruledB = useCADStore((s) => s.ruledSketchBId);
  useCADStore((s) => s.ruledMode);

  if (!ACTIVE_TOOLS.has(activeTool)) return null;

  const state = useCADStore.getState();
  const pick = nextPick(activeTool, state);
  if (!pick) return null;

  // Sketches already assigned to OTHER inputs of the active tool — exclude them so
  // the same profile/curve can't be picked twice in-canvas.
  const usedElsewhere = new Set<string>();
  if (activeTool === 'sweep') {
    const own = pick.target === 'sweep-profile' ? sweepP1
      : pick.target === 'sweep-profile2' ? sweepP2
      : pick.target === 'sweep-path' ? sweepPath
      : sweepGuide;
    for (const id of [sweepP1, sweepP2, sweepPath, sweepGuide]) {
      if (id && id !== own) usedElsewhere.add(id);
    }
  } else if (activeTool === 'loft') {
    for (const id of loftIds) if (id) usedElsewhere.add(id);
  } else if (activeTool === 'ruled-surface') {
    const own = pick.target === 'ruled-a' ? ruledA : ruledB;
    for (const id of [ruledA, ruledB]) if (id && id !== own) usedElsewhere.add(id);
  } else if (activeTool === 'patch' && patchId) {
    usedElsewhere.add(patchId);
  }

  const available = sketches.filter((s) => s.entities.length > 0 && !usedElsewhere.has(s.id));
  if (available.length === 0) return null;

  return (
    <>
      {available.map((sketch) =>
        pick.kind === 'profile'
          ? <ProfileFill key={sketch.id} sketch={sketch} onPick={() => dispatchPick(sketch.id, pick.target)} />
          : <CurveTube key={sketch.id} sketch={sketch} onPick={() => dispatchPick(sketch.id, pick.target)} />,
      )}
    </>
  );
}
