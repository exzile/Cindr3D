/**
 * Tuning-tower visualisation: a translucent horizontal plane at every Z height
 * where a tuning-tower post-processor will inject a G-code change (temperature
 * step, PA step, fan step, etc.). Hover any plane to surface its before/after
 * value via the parent's `onHoverChange` callback.
 *
 * Extracted from StepSlicePreview.tsx as the only R3F sub-components in that
 * file; keeping them here lets the host file focus on slicer state + DOM
 * panels.
 */
import { useEffect, useMemo, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { LayerProcessor } from '../../../types/slicer/profiles/print';
import { computeTuningSteps, type PlaneHoverInfo } from './stepSlicePreviewHelpers';

function TuningPlane({
  z,
  cx,
  cy,
  planeW,
  planeD,
  value,
  prevValue,
  param,
  onHoverChange,
}: {
  z: number;
  cx: number;
  cy: number;
  planeW: number;
  planeD: number;
  value: number;
  prevValue: number | null;
  param: string | undefined;
  onHoverChange: (info: PlaneHoverInfo | null) => void;
}) {
  const { invalidate } = useThree();
  const [hovered, setHovered] = useState(false);

  const fillGeo = useMemo(() => new THREE.PlaneGeometry(planeW, planeD), [planeW, planeD]);

  const outlineGeo = useMemo(() => {
    const hw = planeW / 2;
    const hd = planeD / 2;
    const pts = new Float32Array([
      -hw, -hd, 0,
       hw, -hd, 0,
       hw,  hd, 0,
      -hw,  hd, 0,
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    return g;
  }, [planeW, planeD]);

  useEffect(() => () => {
    fillGeo.dispose();
    outlineGeo.dispose();
  }, [fillGeo, outlineGeo]);

  const handleEnter = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    invalidate();
    onHoverChange({ z, value, prevValue, param });
  };

  const handleLeave = () => {
    setHovered(false);
    invalidate();
    onHoverChange(null);
  };

  return (
    <group position={[cx, cy, z]}>
      {/* Translucent fill — brighter on hover */}
      <mesh
        geometry={fillGeo}
        renderOrder={2}
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
      >
        <meshBasicMaterial
          color="#f97316"
          transparent
          opacity={hovered ? 0.22 : 0.08}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Perimeter outline — stronger on hover */}
      <lineLoop geometry={outlineGeo} renderOrder={3}>
        <lineBasicMaterial
          color="#f97316"
          transparent
          opacity={hovered ? 1.0 : 0.6}
          depthWrite={false}
        />
      </lineLoop>
    </group>
  );
}

export function TuningPlaneMarkers({
  processors,
  cx,
  cy,
  planeW,
  planeD,
  onHoverChange,
}: {
  processors: LayerProcessor[];
  cx: number;
  cy: number;
  planeW: number;
  planeD: number;
  onHoverChange: (info: PlaneHoverInfo | null) => void;
}) {
  const { invalidate } = useThree();

  // Build per-Z metadata: value at this step, value at the previous step, and param type.
  const steps = useMemo(() => {
    const zMap = new Map<number, { value: number; prevValue: number | null; param: string | undefined }>();
    for (const proc of processors) {
      if (!proc.enabled || proc.kind !== 'tuning-tower') continue;
      const procSteps = computeTuningSteps(proc);
      procSteps.forEach((s, i) => {
        if (!zMap.has(s.z)) {
          zMap.set(s.z, {
            value: s.value,
            prevValue: i > 0 ? procSteps[i - 1].value : null,
            param: proc.tuningParameter,
          });
        }
      });
    }
    return Array.from(zMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([z, info]) => ({ z, ...info }));
  }, [processors]);

  // Demand-mode canvas won't repaint automatically when the plane list changes —
  // kick it so the new planes appear immediately without needing a user gesture.
  useEffect(() => { invalidate(); }, [steps, invalidate]);

  if (steps.length === 0) return null;

  return (
    <>
      {steps.map((s) => (
        <TuningPlane
          key={s.z}
          z={s.z}
          cx={cx}
          cy={cy}
          planeW={planeW}
          planeD={planeD}
          value={s.value}
          prevValue={s.prevValue}
          param={s.param}
          onHoverChange={onHoverChange}
        />
      ))}
    </>
  );
}
