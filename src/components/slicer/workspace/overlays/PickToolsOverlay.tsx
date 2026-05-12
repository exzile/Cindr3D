import { useEffect, useMemo } from 'react';
import { AlignEndHorizontal, Box, Paintbrush, Ruler, X } from 'lucide-react';
import * as THREE from 'three';
import type { PaintedZSeamHint } from '../../../../types/slicer/profiles/print';
import { useSlicerStore } from '../../../../store/slicerStore';
import { normalizeRotationDegreesToRadians, normalizeScale } from '../../../../utils/slicerTransforms';
import './PickToolsOverlay.css';

/**
 * Floating "pick-mode" toolbar shown in the upper centre of the viewport
 * when the user has triggered a tool that needs a click on the 3D scene
 * (face-pick lay-flat, measurement). Includes a status hint and a cancel
 * button so the user is never stuck in a mode.
 */
export function PickToolsOverlay() {
  const pickMode = useSlicerStore((s) => s.viewportPickMode);
  const measurePoints = useSlicerStore((s) => s.measurePoints);
  const setPickMode = useSlicerStore((s) => s.setViewportPickMode);
  const clearMeasure = useSlicerStore((s) => s.clearMeasurePoints);
  const selectedId = useSlicerStore((s) => s.selectedPlateObjectId);

  const distance = useMemo(() => {
    if (measurePoints.length < 2) return null;
    const a = new THREE.Vector3(measurePoints[0].x, measurePoints[0].y, measurePoints[0].z);
    const b = new THREE.Vector3(measurePoints[1].x, measurePoints[1].y, measurePoints[1].z);
    const d = a.distanceTo(b);
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    const dz = Math.abs(a.z - b.z);
    return { d, dx, dy, dz };
  }, [measurePoints]);

  return (
    <div className="slicer-pick-tools" role="toolbar">
      <button
        type="button"
        title="Lay flat (click a face)"
        className={`slicer-pick-tools__btn${pickMode === 'lay-flat' ? ' is-active' : ''}`}
        onClick={() => setPickMode(pickMode === 'lay-flat' ? 'none' : 'lay-flat')}
        disabled={!selectedId}
      >
        <AlignEndHorizontal size={14} /> Lay Flat (face)
      </button>
      <button
        type="button"
        title="Measurement tool — click two points"
        className={`slicer-pick-tools__btn${pickMode === 'measure' ? ' is-active' : ''}`}
        onClick={() => setPickMode(pickMode === 'measure' ? 'none' : 'measure')}
      >
        <Ruler size={14} /> Measure
      </button>
      <button
        type="button"
        title="Paint Z seam hints on the selected object"
        className={`slicer-pick-tools__btn${pickMode === 'seam-paint' ? ' is-active' : ''}`}
        onClick={() => setPickMode(pickMode === 'seam-paint' ? 'none' : 'seam-paint')}
        disabled={!selectedId}
      >
        <Paintbrush size={14} /> Seam
      </button>
      <button
        type="button"
        title="Paint modifier mesh regions on the selected object"
        className={`slicer-pick-tools__btn${pickMode === 'modifier-paint' ? ' is-active' : ''}`}
        onClick={() => setPickMode(pickMode === 'modifier-paint' ? 'none' : 'modifier-paint')}
        disabled={!selectedId}
      >
        <Box size={14} /> Modifier
      </button>

      {pickMode === 'lay-flat' && (
        <span className="slicer-pick-tools__hint">
          Click a face on the selected object…
          <button onClick={() => setPickMode('none')} title="Cancel" className="slicer-pick-tools__cancel"><X size={11} /></button>
        </span>
      )}
      {pickMode === 'measure' && (
        <span className="slicer-pick-tools__hint">
          {measurePoints.length === 0 && 'Click point A'}
          {measurePoints.length === 1 && 'Click point B'}
          {measurePoints.length >= 2 && distance && (
            <>
              {distance.d.toFixed(2)} mm
              {' '}<span style={{ color: 'var(--text-muted)' }}>
                (Δx {distance.dx.toFixed(1)}, Δy {distance.dy.toFixed(1)}, Δz {distance.dz.toFixed(1)})
              </span>
            </>
          )}
          <button onClick={() => { clearMeasure(); setPickMode('none'); }} title="Done" className="slicer-pick-tools__cancel"><X size={11} /></button>
        </span>
      )}
      {pickMode === 'seam-paint' && (
        <span className="slicer-pick-tools__hint">
          Click the selected model to add seam hints
          <button onClick={() => setPickMode('none')} title="Done" className="slicer-pick-tools__cancel"><X size={11} /></button>
        </span>
      )}
      {pickMode === 'modifier-paint' && (
        <span className="slicer-pick-tools__hint">
          Click the selected model to create modifier volumes
          <button onClick={() => setPickMode('none')} title="Done" className="slicer-pick-tools__cancel"><X size={11} /></button>
        </span>
      )}
    </div>
  );
}

export function MeasurementMarkers() {
  const measurePoints = useSlicerStore((s) => s.measurePoints);

  // Build the connecting-line geometry once per pair of points. Inline
  // `<bufferAttribute args={[new Float32Array([...])]}>` reallocated on every
  // render and R3F rebuilt the GPU buffer each time (see memory/r3f_critical_patterns.md).
  const lineGeo = useMemo(() => {
    if (measurePoints.length < 2) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array([
      measurePoints[0].x, measurePoints[0].y, measurePoints[0].z,
      measurePoints[1].x, measurePoints[1].y, measurePoints[1].z,
    ]), 3));
    return g;
  }, [measurePoints]);

  useEffect(() => () => { lineGeo?.dispose(); }, [lineGeo]);

  if (measurePoints.length === 0) return null;
  return (
    <group>
      {measurePoints.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[0.6, 12, 12]} />
          <meshBasicMaterial color={i === 0 ? '#ff8a4c' : '#2f80ed'} />
        </mesh>
      ))}
      {lineGeo && (
        <lineSegments geometry={lineGeo}>
          <lineBasicMaterial color="#ffaa44" />
        </lineSegments>
      )}
    </group>
  );
}

function isPaintedZSeamHint(value: unknown): value is PaintedZSeamHint {
  return !!value
    && typeof value === 'object'
    && Number.isFinite((value as PaintedZSeamHint).x)
    && Number.isFinite((value as PaintedZSeamHint).y);
}

function seamHintWorldPoint(obj: { position: { x: number; y: number; z?: number }; rotation?: unknown; scale?: unknown; mirrorX?: boolean; mirrorY?: boolean; mirrorZ?: boolean }, hint: PaintedZSeamHint): THREE.Vector3 {
  const point = new THREE.Vector3(hint.x, hint.y, hint.z ?? 0);
  if (hint.coordinateSpace !== 'object') return point;
  const rot = normalizeRotationDegreesToRadians(obj.rotation);
  const rawScale = normalizeScale(obj.scale);
  const scale = new THREE.Vector3(
    rawScale.x * (obj.mirrorX ? -1 : 1),
    rawScale.y * (obj.mirrorY ? -1 : 1),
    rawScale.z * (obj.mirrorZ ? -1 : 1),
  );
  return point.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z)),
    scale,
  ));
}

export function SeamPaintMarkers() {
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const markers = useMemo(() => {
    const out: Array<{ key: string; point: THREE.Vector3 }> = [];
    for (const obj of plateObjects) {
      const hints = (obj.perObjectSettings as { zSeamPaintHints?: unknown[] } | undefined)?.zSeamPaintHints ?? [];
      hints.forEach((hint, index) => {
        if (isPaintedZSeamHint(hint)) out.push({ key: `${obj.id}:${index}`, point: seamHintWorldPoint(obj, hint) });
      });
    }
    return out;
  }, [plateObjects]);
  if (markers.length === 0) return null;
  return (
    <group>
      {markers.map(({ key, point }) => (
        <mesh key={key} position={[point.x, point.y, point.z + 0.8]}>
          <sphereGeometry args={[0.75, 12, 12]} />
          <meshBasicMaterial color="#e85d75" depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}
