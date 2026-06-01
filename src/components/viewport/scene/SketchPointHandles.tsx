/**
 * SketchPointHandles
 *
 * Screen-constant "white dot, black ring" handles at every defining point of
 * every editable entity in the active sketch (Fusion-style). These are HTML
 * overlays so they stay a fixed pixel size at any zoom — the old 0.35-unit
 * SphereGeometry meshes vanished on large sketches.
 *
 * PURELY VISUAL for dragging: the dots are `pointerEvents:none`, so a canvas
 * pointerdown still reaches useSketchInteractionEvents, which finds the nearest
 * point by world coordinate and drags it (dragSketchPoint → live solve). The
 * arc-centre dot is the exception — it's interactive (click to edit the fillet
 * radius) and is gated on the Constraints visibility toggle.
 *
 * Coverage (handle at each entry in entity.points):
 *  - line / construction-line / centerline → both endpoints
 *  - rectangle / polygon (committed as individual line entities) → corners/verts
 *  - circle / ellipse / elliptical-arc → centre point
 *  - arc → centre, rendered as the fillet radius dot + faint circle
 *  - point → the point; spline → every control point
 * Excluded: isoparametric + fixed-spline (frozen) and linked/projected entities.
 */

import React, { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { SketchEntity } from '../../../types/cad';

// Entity types that expose point handles. Must stay in sync with
// DRAGGABLE_TYPES in useSketchInteractionEvents so every visible handle is pickable.
const HANDLE_ENTITY_TYPES = new Set<SketchEntity['type']>([
  'line',
  'construction-line',
  'centerline',
  'rectangle',
  'polygon',
  'slot',
  'circle',
  'arc',
  'ellipse',
  'elliptical-arc',
  'point',
  'spline',
]);

// White dot with a near-black ring — the shared handle look.
const POINT_DOT_STYLE: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.68)',
  border: '1.5px solid rgba(26,26,26,0.55)',
  boxShadow: '0 0 2px rgba(0,0,0,0.35)',
  pointerEvents: 'none', // dragging is handled on the canvas by coordinate pick
};

export default function SketchPointHandles() {
  const activeTool       = useCADStore((s) => s.activeTool);
  const activeSketch     = useCADStore((s) => s.activeSketch);
  const editingArcId     = useCADStore((s) => s.sketchEditingArcId);
  const showConstraints  = useCADStore((s) => s.showSketchConstraints);
  const setEditingArcId  = useCADStore((s) => s.setSketchEditingArcId);

  const editableEntities = useMemo(() => {
    if (!activeSketch) return [];
    return activeSketch.entities.filter(
      // Text glyph strokes (textGroupId) are excluded — Fusion shows no point
      // handles on text, only a bounding box.
      (e) => HANDLE_ENTITY_TYPES.has(e.type) && !e.linked && !e.textGroupId,
    );
  }, [activeSketch]);

  // Quaternion that rotates a local-XY ringGeometry into the sketch plane, so
  // the fillet circle lies flat on-plane (normal = t1 × t2).
  const sketchPlaneQuat = useMemo(() => {
    if (!activeSketch) return null;
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const normal = t1.clone().cross(t2).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  }, [activeSketch]);

  if (!activeSketch || editableEntities.length === 0) return null;

  // Draggable point dots show in select mode. Arc/fillet dots are constraints,
  // so they show in any tool but obey the Constraints visibility toggle.
  const showDragHandles = activeTool === 'select';
  const showArcDots = showConstraints;
  if (!showDragHandles && !showArcDots) return null;

  const handles: React.ReactElement[] = [];

  for (const entity of editableEntities) {
    const isArc = entity.type === 'arc';
    for (let pi = 0; pi < entity.points.length; pi++) {
      const pt   = entity.points[pi];
      const eid  = entity.id;

      // Arc centre → fillet radius dot + faint circle (constraint, interactive).
      if (isArc && pi === 0 && typeof entity.radius === 'number') {
        if (!showArcDots) continue;
        const r = entity.radius;
        const isEditingThis = editingArcId === eid;
        handles.push(
          <group
            key={`arc-ring-${eid}`}
            position={[pt.x, pt.y, pt.z]}
            quaternion={sketchPlaneQuat ?? undefined}
          >
            <mesh renderOrder={98} raycast={() => []}>
              <ringGeometry args={[Math.max(0.001, r * 0.94), r, 64]} />
              <meshBasicMaterial
                color={isEditingThis ? 0x66ccff : 0x8888aa}
                transparent opacity={isEditingThis ? 0.55 : 0.35}
                depthTest={false}
              />
            </mesh>
          </group>,
        );
        handles.push(
          <Html key={`arc-dot-${eid}`} position={[pt.x, pt.y, pt.z]} center zIndexRange={[99, 0]} style={{ pointerEvents: 'none' }}>
            <div
              title="Edit radius"
              style={{
                width: 10, height: 10, borderRadius: '50%',
                background: isEditingThis ? '#66ccff' : '#ffffff',
                border: `1.5px solid ${isEditingThis ? '#0066aa' : '#1a1a1a'}`,
                boxShadow: '0 0 3px rgba(0,0,0,0.5)',
                cursor: 'pointer',
                pointerEvents: 'auto',
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setEditingArcId(editingArcId === eid ? null : eid);
              }}
            />
          </Html>,
        );
        continue;
      }

      // Every other defining point → screen-constant white/black drag dot.
      if (!showDragHandles) continue;
      handles.push(
        <Html key={`${eid}-${pi}`} position={[pt.x, pt.y, pt.z]} center zIndexRange={[95, 0]} style={{ pointerEvents: 'none' }}>
          <div style={POINT_DOT_STYLE} />
        </Html>,
      );
    }
  }

  return <>{handles}</>;
}
