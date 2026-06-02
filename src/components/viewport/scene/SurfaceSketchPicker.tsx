/**
 * SurfaceSketchPicker — in-canvas sketch selection for Surface CREATE tools.
 * When Sweep/Loft/Patch/Ruled Surface is active, renders each available sketch
 * as a hover-highlightable line group. Clicking a sketch fills the next empty
 * input field in the active tool's panel.
 *
 * This replaces the sketch-name dropdown UX with Fusion-style click-to-select.
 * The dropdown fallback still works for users who prefer it.
 */

import { useMemo, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import type { Sketch } from '../../../types/cad';

// Module-level materials — never disposed
const _normalMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 1, transparent: true, opacity: 0.5 });
const _hoverMat  = new THREE.LineBasicMaterial({ color: 0x06b6d4, linewidth: 2, transparent: true, opacity: 0.95 });
const _selectedMat = new THREE.LineBasicMaterial({ color: 0x0284c7, linewidth: 2, transparent: true, opacity: 1.0 });
_normalMat.userData['shared'] = true;
_hoverMat.userData['shared'] = true;
_selectedMat.userData['shared'] = true;

function buildSketchLineGeometry(sketch: Sketch): THREE.BufferGeometry | null {
  const pts: number[] = [];
  for (const entity of sketch.entities) {
    for (let i = 0; i + 1 < entity.points.length; i++) {
      const a = entity.points[i];
      const b = entity.points[i + 1];
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    // Close loop for closed entities
    if (entity.points.length > 2) {
      const first = entity.points[0];
      const last  = entity.points[entity.points.length - 1];
      pts.push(last.x, last.y, last.z, first.x, first.y, first.z);
    }
  }
  if (pts.length === 0) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geom;
}

/** Determine what the next click should set for the active tool. Returns null when all inputs are filled. */
function getNextPickTarget(tool: string, state: ReturnType<typeof useCADStore.getState>): string | null {
  switch (tool) {
    case 'sweep': {
      if (!state.sweepProfileSketchId) return 'sweep-profile';
      if (!state.sweepPathSketchId)    return 'sweep-path';
      return null;
    }
    case 'loft': {
      const emptyIdx = state.loftProfileSketchIds.findIndex((id) => !id);
      if (emptyIdx >= 0) return `loft-profile-${emptyIdx}`;
      return null;
    }
    case 'patch':
      return state.patchSelectedSketchId ? null : 'patch-profile';
    case 'ruled-surface': {
      const mode = state.ruledMode;
      if (mode === 'extend-edge') return state.ruledSketchAId ? null : 'ruled-a';
      if (!state.ruledSketchAId) return 'ruled-a';
      if (!state.ruledSketchBId) return 'ruled-b';
      return null;
    }
    default: return null;
  }
}

function dispatchPick(sketchId: string, target: string) {
  const s = useCADStore.getState();
  if (target === 'sweep-profile') { s.setSweepProfileSketchId(sketchId); return; }
  if (target === 'sweep-path')    { s.setSweepPathSketchId(sketchId); return; }
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

/** Returns the set of sketch IDs currently selected by the active tool. */
function getSelectedIds(tool: string, state: ReturnType<typeof useCADStore.getState>): Set<string> {
  const ids = new Set<string>();
  switch (tool) {
    case 'sweep':
      if (state.sweepProfileSketchId) ids.add(state.sweepProfileSketchId);
      if (state.sweepPathSketchId)    ids.add(state.sweepPathSketchId);
      break;
    case 'loft':
      for (const id of state.loftProfileSketchIds) if (id) ids.add(id);
      break;
    case 'patch':
      if (state.patchSelectedSketchId) ids.add(state.patchSelectedSketchId);
      break;
    case 'ruled-surface':
      if (state.ruledSketchAId) ids.add(state.ruledSketchAId);
      if (state.ruledSketchBId) ids.add(state.ruledSketchBId);
      break;
  }
  return ids;
}

const ACTIVE_TOOLS = new Set(['sweep', 'loft', 'patch', 'ruled-surface']);

function SketchPickLine({ sketch, onPick }: { sketch: Sketch; onPick: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const activeTool = useCADStore((s) => s.activeTool);
  const lineRef = useRef<THREE.LineSegments>(null);
  const { invalidate } = useThree();

  const isSelected = useCADStore((s) => {
    const state = useCADStore.getState();
    return getSelectedIds(activeTool, state).has(sketch.id);
  });

  const geom = useMemo(() => buildSketchLineGeometry(sketch), [sketch]);

  useEffect(() => {
    return () => { geom?.dispose(); };
  }, [geom]);

  // Force a frame when hover/select state changes (frameloop="demand")
  useFrame(() => {
    if (lineRef.current) {
      const mat = isSelected ? _selectedMat : hovered ? _hoverMat : _normalMat;
      if (lineRef.current.material !== mat) {
        lineRef.current.material = mat;
        invalidate();
      }
    }
  });

  if (!geom) return null;

  return (
    <lineSegments
      ref={lineRef}
      geometry={geom}
      material={_normalMat}
      onPointerEnter={(e) => { e.stopPropagation(); setHovered(true); invalidate(); }}
      onPointerLeave={() => { setHovered(false); invalidate(); }}
      onPointerDown={(e) => {
        e.stopPropagation();
        const target = getNextPickTarget(activeTool, useCADStore.getState());
        if (target) { dispatchPick(sketch.id, target); invalidate(); }
      }}
    />
  );
}

export function SurfaceSketchPicker() {
  const activeTool = useCADStore((s) => s.activeTool);
  const sketches   = useCADStore((s) => s.sketches);

  if (!ACTIVE_TOOLS.has(activeTool)) return null;

  const available = sketches.filter((s) => s.entities.length > 0);
  if (available.length === 0) return null;

  return (
    <>
      {available.map((sketch) => (
        <SketchPickLine
          key={sketch.id}
          sketch={sketch}
          onPick={(id) => {
            const target = getNextPickTarget(activeTool, useCADStore.getState());
            if (target) dispatchPick(id, target);
          }}
        />
      ))}
    </>
  );
}
