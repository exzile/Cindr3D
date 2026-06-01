import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useThemeStore } from '../../../store/themeStore';
import { useComponentStore } from '../../../store/componentStore';
import { BODY_MATERIAL, DIM_MATERIAL, componentColorMaterial } from './bodyMaterial';
import { isComponentVisible } from './componentVisibility';
import { getOcc, getOccSync } from '../../../engine/occ/loader';
import { occBoxWithInstance } from '../../../engine/occ/ops/box';
import { occCylinderWithInstance } from '../../../engine/occ/ops/cylinder';
import { occSphereWithInstance } from '../../../engine/occ/ops/sphere';
import { occTorusWithInstance } from '../../../engine/occ/ops/torus';
import { tessellationToGeometry, tessellate } from '../../../engine/occ/tessellate';
import { attachTessellationToMesh } from '../../../engine/occ/picking';
import { globalBRepBodyRegistry } from '../../../engine/occ/globalRegistry';
import { parseOccEdgeSelection, storedEdgeIds } from '../../../utils/occEdgeUtils';
import type { BRepBody } from '../../../engine/occ/brepBody';
import type { OcctRaw } from '../../../engine/occ/types';
import type { Feature } from '../../../types/cad';
import { emitCylinderPrimitiveDrag } from '../../../utils/primitivePreviewEvents';
import {
  CYLINDER_HEIGHT_ARROW_LINE_MATERIAL,
  CYLINDER_HEIGHT_ARROW_MATERIAL,
  CYLINDER_RADIUS_ARROW_LINE_MATERIAL,
  CYLINDER_RADIUS_ARROW_MATERIAL,
} from '../gizmos/arrowMaterials';
import { setGizmoDragging } from './gizmoDragGuard';

/** Primitive solid bodies — Box / Cylinder / Sphere / Torus
 *
 * Each primitive is backed by an OCC BRep body so the fillet / chamfer edge
 * picker can resolve hovered edges to exact OCC edgeIds. The OCC body's
 * tessellation is also used as the rendered geometry so visual + pick lines
 * align perfectly. Tapered cylinders (radiusTop ≠ radius) are not yet
 * supported by the OCC primitives and fall back to plain THREE.js geometry
 * without edge-pick support.
 */

interface PrimitiveSpec {
  featureId: string;
  componentId?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  kind: 'box' | 'cylinder' | 'sphere' | 'torus';
  // Param hash so the OCC body is rebuilt when the user edits the primitive.
  paramKey: string;
  // Build the OCC body. May throw — caller must handle.
  build: (oc: OcctRaw) => BRepBody;
  // Fallback THREE geometry (used when OCC fails or a tapered cylinder).
  fallbackGeometry: () => THREE.BufferGeometry;
}

function buildPrimitiveSpec(feature: Feature): PrimitiveSpec | null {
  const kind = feature.params.kind as 'box' | 'cylinder' | 'sphere' | 'torus';
  const featureId = feature.id;

  if (kind === 'box') {
    const w = (feature.params.width as number) || 20;
    const h = (feature.params.height as number) || 20;
    const d = (feature.params.depth as number) || 20;
    // OCC box is anchored at the origin (0..w, 0..h, 0..d). Translate to
    // match the centered-at-origin convention of THREE.BoxGeometry so the
    // mesh position / rotation continues to behave the same way.
    const transform = new THREE.Matrix4().makeTranslation(-w / 2, -h / 2, -d / 2);
    return {
      featureId,
      componentId: feature.componentId,
      position: getPos(feature),
      rotation: getRot(feature),
      kind,
      paramKey: `box:${w}:${h}:${d}`,
      build: (oc) => occBoxWithInstance(oc, w, h, d, { transform, sourceFeatureId: featureId }),
      fallbackGeometry: () => new THREE.BoxGeometry(w, h, d),
    };
  }

  if (kind === 'cylinder') {
    const radius = (feature.params.radius as number) || 10;
    const radiusTop = (feature.params.radiusTop as number) ?? radius;
    const height = (feature.params.height as number) || 20;
    const tapered = Math.abs(radius - radiusTop) > 1e-6;
    // OCC cylinder axis is +Z, base at z=0. THREE.CylinderGeometry axis is +Y,
    // centered at origin. Rotate −90° around X then translate to match.
    const rotation = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const translation = new THREE.Matrix4().makeTranslation(0, -height / 2, 0);
    const transform = translation.multiply(rotation);
    return {
      featureId,
      componentId: feature.componentId,
      position: getPos(feature),
      rotation: getRot(feature),
      kind,
      paramKey: `cyl:${radius}:${radiusTop}:${height}:${tapered}`,
      // BRepPrimAPI_MakeCylinder does not support taper — fall through to
      // the THREE fallback for tapered cylinders. Visual rendering still
      // works; just the edge picker is degraded for this niche case.
      build: tapered
        ? () => { throw new Error('tapered cylinder: OCC primitive not supported, falling back'); }
        : (oc) => occCylinderWithInstance(oc, radius, height, { transform, sourceFeatureId: featureId }),
      fallbackGeometry: () => new THREE.CylinderGeometry(radiusTop, radius, height, 48),
    };
  }

  if (kind === 'sphere') {
    const radius = (feature.params.radius as number) || 10;
    return {
      featureId,
      componentId: feature.componentId,
      position: getPos(feature),
      rotation: getRot(feature),
      kind,
      paramKey: `sph:${radius}`,
      build: (oc) => occSphereWithInstance(oc, radius, { sourceFeatureId: featureId }),
      fallbackGeometry: () => new THREE.SphereGeometry(radius, 48, 32),
    };
  }

  if (kind === 'torus') {
    const radius = (feature.params.radius as number) || 15;
    const tubeRadius = (feature.params.tubeRadius as number) || 3;
    // THREE.TorusGeometry sits in the XY plane (axis +Z) — same as OCC's
    // BRepPrimAPI_MakeTorus, so no rotation is needed.
    return {
      featureId,
      componentId: feature.componentId,
      position: getPos(feature),
      rotation: getRot(feature),
      kind,
      paramKey: `tor:${radius}:${tubeRadius}`,
      build: (oc) => occTorusWithInstance(oc, radius, tubeRadius, { sourceFeatureId: featureId }),
      fallbackGeometry: () => new THREE.TorusGeometry(radius, tubeRadius, 24, 48),
    };
  }

  return null;
}

function getPos(feature: Feature): [number, number, number] {
  return [
    (feature.params.x as number) || 0,
    (feature.params.y as number) || 0,
    (feature.params.z as number) || 0,
  ];
}
function getRot(feature: Feature): [number, number, number] {
  return [
    THREE.MathUtils.degToRad((feature.params.rx as number) || 0),
    THREE.MathUtils.degToRad((feature.params.ry as number) || 0),
    THREE.MathUtils.degToRad((feature.params.rz as number) || 0),
  ];
}

interface OccPrimitiveBuildResult {
  geometry: THREE.BufferGeometry;
  bodyId: string | null;
  body: BRepBody | null;
}

function buildOccPrimitive(spec: PrimitiveSpec, oc: OcctRaw): OccPrimitiveBuildResult | null {
  try {
    const body = spec.build(oc);
    const tess = tessellate(oc, body);
    const geometry = tessellationToGeometry(tess);
    globalBRepBodyRegistry.add(body);
    return { geometry, bodyId: body.id, body };
  } catch (e) {
    console.warn(`[PrimitiveBodies] OCC build failed for ${spec.kind} (${spec.featureId}); using THREE fallback:`, e);
    return null;
  }
}

function disposeOccPrimitiveBuild(result: OccPrimitiveBuildResult): void {
  result.geometry.dispose();
  if (result.bodyId) {
    const deleted = globalBRepBodyRegistry.delete(result.bodyId);
    if (!deleted) result.body?.dispose();
  } else {
    result.body?.dispose();
  }
}

function disposeOccPrimitiveBuildDeferred(result: OccPrimitiveBuildResult): void {
  setTimeout(() => disposeOccPrimitiveBuild(result), 0);
}

const _primitiveNdc = new THREE.Vector2();
const _primitiveRay = new THREE.Ray();
const _primitiveW0 = new THREE.Vector3();
const _primitiveConeUp = new THREE.Vector3(0, 1, 0);

type CylinderHandleKind = 'height' | 'radius';

interface CylinderDimensionHandleProps {
  kind: CylinderHandleKind;
  center: THREE.Vector3;
  radius: number;
  height: number;
  onChange: (next: { radius?: number; height?: number }) => void;
}

function CylinderDimensionHandle({ kind, center, radius, height, onChange }: CylinderDimensionHandleProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls as { enabled: boolean } | null);
  const themeColors = useThemeStore((s) => s.colors);
  const colorCss = kind === 'height' ? '#00d4ff' : '#ff8a00';
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);
  const latestValueRef = useRef(kind === 'height' ? height : radius);
  const [inputValue, setInputValue] = useState(() =>
    (kind === 'height' ? height : radius * 2).toFixed(2),
  );

  useEffect(() => {
    latestValueRef.current = kind === 'height' ? height : radius;
  }, [height, kind, radius]);

  // Sync label from props when not dragging (e.g. user typed in the panel dialog)
  useEffect(() => {
    if (draggingRef.current) return;
    setInputValue((kind === 'height' ? height : radius * 2).toFixed(2));
  }, [height, kind, radius]);

  const axis = useMemo(
    () => kind === 'height' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0),
    [kind],
  );

  const lineMat = useMemo(
    () => kind === 'height' ? CYLINDER_HEIGHT_ARROW_LINE_MATERIAL : CYLINDER_RADIUS_ARROW_LINE_MATERIAL,
    [kind],
  );
  const handleMat = useMemo(
    () => kind === 'height' ? CYLINDER_HEIGHT_ARROW_MATERIAL : CYLINDER_RADIUS_ARROW_MATERIAL,
    [kind],
  );
  const handleScale = useMemo(
    () => kind === 'height' ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(1.08, 1.08, 1.08),
    [kind],
  );

  const scalar = kind === 'height' ? height / 2 : radius;
  const handleGap = kind === 'height' ? 4 : 4.5;
  const tip = useMemo(() => center.clone().add(axis.clone().multiplyScalar(scalar + handleGap)), [axis, center, handleGap, scalar]);
  const lineGeometry = useMemo(() => {
    const start = center.clone().add(axis.clone().multiplyScalar(kind === 'height' ? height / 2 : 0));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      start.x, start.y, start.z,
      tip.x, tip.y, tip.z,
    ], 3));
    return geometry;
  }, [axis, center, height, kind, tip]);
  useEffect(() => () => { lineGeometry.dispose(); }, [lineGeometry]);
  const lineObj = useMemo(() => new THREE.Line(lineGeometry, lineMat), [lineGeometry, lineMat]);
  const handleQuaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(_primitiveConeUp, axis), [axis]);

  const rayToAxis = useCallback((ndc: THREE.Vector2): number | null => {
    _primitiveRay.origin.setFromMatrixPosition(camera.matrixWorld);
    _primitiveRay.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(_primitiveRay.origin).normalize();
    const w0 = _primitiveW0.copy(_primitiveRay.origin).sub(center);
    const b = _primitiveRay.direction.dot(axis);
    const d = _primitiveRay.direction.dot(w0);
    const e = axis.dot(w0);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-4) return null;
    return (e - b * d) / denom;
  }, [axis, camera, center]);

  const updateNdc = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = gl.domElement.getBoundingClientRect();
    _primitiveNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }, [gl]);

  const commitValue = useCallback((axisScalar: number) => {
    if (kind === 'height') {
      const nextHeight = Math.max(0.1, Math.round(Math.abs(axisScalar) * 200) / 100);
      latestValueRef.current = nextHeight;
      setInputValue(nextHeight.toFixed(2));
      onChange({ height: nextHeight });
      return;
    }
    const nextRadius = Math.max(0.05, Math.round(Math.abs(axisScalar) * 100) / 100);
    latestValueRef.current = nextRadius;
    setInputValue((nextRadius * 2).toFixed(2));
    onChange({ radius: nextRadius });
  }, [kind, onChange]);

  const handleInputCommit = useCallback((raw: string) => {
    const v = parseFloat(raw);
    if (Number.isNaN(v) || v <= 0) return;
    if (kind === 'height') {
      onChange({ height: Math.max(0.1, v) });
    } else {
      onChange({ radius: Math.max(0.05, v / 2) });
    }
  }, [kind, onChange]);

  const handlePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    event.nativeEvent.stopPropagation();
    updateNdc(event);
    const axisScalar = rayToAxis(_primitiveNdc);
    if (axisScalar === null) return;
    draggingRef.current = true;
    setGizmoDragging(true);
    dragOffsetRef.current = scalar - axisScalar;
    if (controls) controls.enabled = false;
    gl.domElement.style.cursor = kind === 'height' ? 'ns-resize' : 'ew-resize';
  }, [controls, gl, kind, rayToAxis, scalar, updateNdc]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      updateNdc(event);
      const axisScalar = rayToAxis(_primitiveNdc);
      if (axisScalar === null) return;
      commitValue(axisScalar + dragOffsetRef.current);
    };

    const finishDrag = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (controls) controls.enabled = true;
      gl.domElement.style.cursor = '';
      window.setTimeout(() => setGizmoDragging(false), 0);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      if (!draggingRef.current) return;
      if (controls) controls.enabled = true;
      gl.domElement.style.cursor = '';
    };
  }, [commitValue, controls, gl, rayToAxis, updateNdc]);

  useEffect(() => () => {
    if (controls) controls.enabled = true;
    gl.domElement.style.cursor = '';
    setGizmoDragging(false);
  }, [controls, gl]);

  return (
    <group renderOrder={1500}>
      <primitive object={lineObj} />
      <mesh
        position={tip}
        quaternion={handleQuaternion}
        scale={handleScale}
        onPointerDown={handlePointerDown}
        onPointerOver={() => { gl.domElement.style.cursor = kind === 'height' ? 'ns-resize' : 'ew-resize'; }}
        onPointerOut={() => { if (!draggingRef.current) gl.domElement.style.cursor = ''; }}
      >
        <coneGeometry args={[1.1, 3.4, 18]} />
        <primitive object={handleMat} attach="material" />
      </mesh>
      <Html position={tip} zIndexRange={[600, 0]} style={{ pointerEvents: 'none', overflow: 'visible' }}>
        <div style={{ position: 'relative', width: 0, height: 0 }}>
          <div
            style={{ position: 'absolute', left: 8, top: -14, pointerEvents: 'auto' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              padding: '2px 6px 2px 5px',
              background: themeColors.bgPanel,
              border: `1.5px solid ${colorCss}`,
              borderRadius: '3px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
              whiteSpace: 'nowrap',
              fontFamily: 'system-ui,-apple-system,"Segoe UI",sans-serif',
              fontSize: '11px',
              fontWeight: 600,
              color: themeColors.textPrimary,
              userSelect: 'none',
            }}>
              {kind === 'radius' && (
                <span style={{ color: colorCss, fontSize: '11px', fontWeight: 700, marginRight: '1px' }}>Ø</span>
              )}
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  handleInputCommit(e.target.value);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
                }}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  width: '52px',
                  fontSize: '11px',
                  fontWeight: 600,
                  textAlign: 'right',
                  color: themeColors.textPrimary,
                  background: 'transparent',
                  border: 'none',
                  padding: '1px 0',
                  outline: 'none',
                  pointerEvents: 'auto',
                  MozAppearance: 'textfield',
                }}
              />
              <span style={{ color: themeColors.textSecondary, fontSize: '10px', marginLeft: '1px' }}>mm</span>
            </div>
          </div>
        </div>
      </Html>
    </group>
  );
}

interface PrimitiveMeshProps {
  spec: PrimitiveSpec;
  isDimmed: boolean;
  componentMaterial: THREE.Material;
  hidden: boolean;
}

function PrimitiveMesh({ spec, isDimmed, componentMaterial, hidden }: PrimitiveMeshProps) {
  const [state, setState] = useState<OccPrimitiveBuildResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    let current: OccPrimitiveBuildResult | null = null;

    const install = (next: OccPrimitiveBuildResult): void => {
      if (cancelled) {
        disposeOccPrimitiveBuild(next);
        return;
      }
      if (current) disposeOccPrimitiveBuildDeferred(current);
      current = next;
      setState(next);
    };
    const cleanupCurrent = (): void => {
      cancelled = true;
      if (current) {
        disposeOccPrimitiveBuildDeferred(current);
        current = null;
      }
    };

    const occ = getOccSync();
    if (occ) {
      const built = buildOccPrimitive(spec, occ.oc);
      if (built) {
        install(built);
        return cleanupCurrent;
      }
    }

    install({ geometry: spec.fallbackGeometry(), bodyId: null, body: null });

    if (occ) {
      return cleanupCurrent;
    }

    getOcc()
      .then(({ oc }) => {
        if (cancelled) return;
        const built = buildOccPrimitive(spec, oc);
        if (!built) return;
        if (cancelled) {
          disposeOccPrimitiveBuild(built);
          return;
        }
        install(built);
      })
      .catch(() => { /* OCC unavailable - keep fallback */ });
    return cleanupCurrent;
  // Only depend on identity + geometry params. Position/rotation/visibility are
  // applied as mesh props and do not require rebuilding OCC geometry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.featureId, spec.paramKey]);

  if (!state) return null;

  const material = isDimmed ? DIM_MATERIAL : componentMaterial;

  return (
    <mesh
      geometry={state.geometry}
      material={material}
      position={spec.position}
      rotation={spec.rotation}
      castShadow
      receiveShadow
      // When a downstream fillet/chamfer has produced a result mesh, the
      // filleted body is rendered via ExtrudedBodies' stored-mesh path.
      // Hide the original primitive mesh so the rounded edges show through,
      // but keep the component mounted so the OCC body stays in the registry
      // for fillet replay.
      visible={!hidden}
      onUpdate={(m) => {
        m.userData.pickable = !hidden;
        m.userData.featureId = spec.featureId;
        if (state.bodyId && state.body?._tessellation) {
          attachTessellationToMesh(m, state.body._tessellation, state.bodyId);
        }
      }}
    />
  );
}

/** PRIM-8: Ghost mesh shown while a primitive dialog is open. */
export function PrimitivePreview() {
  const preview = useCADStore((s) => s.primitivePreviewParams);
  const setPrimitivePreview = useCADStore((s) => s.setPrimitivePreview);
  const ghostMaterial = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x5b9bd5,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return m;
  }, []);
  useEffect(() => () => ghostMaterial.dispose(), [ghostMaterial]);

  const geo = useMemo(() => {
    if (!preview) return null;
    const p = preview.params;
    const k = preview.kind;
    if (k === 'box') return new THREE.BoxGeometry(p.width ?? 20, p.height ?? 20, p.depth ?? 20);
    if (k === 'cylinder') return new THREE.CylinderGeometry(p.radiusTop ?? p.radius ?? 10, p.radius ?? 10, p.height ?? 20, 48);
    if (k === 'sphere') return new THREE.SphereGeometry(p.radius ?? 10, 48, 32);
    if (k === 'torus') return new THREE.TorusGeometry(p.radius ?? 15, p.tubeRadius ?? 3, 24, 48);
    return null;
  }, [preview]);
  useEffect(() => () => { geo?.dispose(); }, [geo]);

  if (!preview || !geo) return null;
  const position = [preview.params.x ?? 0, preview.params.y ?? 0, preview.params.z ?? 0] as [number, number, number];
  const cylinderCenter = new THREE.Vector3(position[0], position[1], position[2]);
  const cylinderRadius = preview.params.radius ?? 10;
  const cylinderHeight = preview.params.height ?? 20;
  const updateCylinderPreview = (next: { radius?: number; height?: number }) => {
    if (preview.kind !== 'cylinder') return;
    const nextRadius = next.radius ?? cylinderRadius;
    const nextHeight = next.height ?? cylinderHeight;
    setPrimitivePreview({
      kind: 'cylinder',
      params: {
        ...preview.params,
        radius: nextRadius,
        radiusTop: nextRadius,
        height: nextHeight,
      },
    });
    emitCylinderPrimitiveDrag({ radius: nextRadius, height: nextHeight });
  };

  return (
    <group>
      <mesh
        geometry={geo}
        material={ghostMaterial}
        position={position}
        userData={{ shared: true }}
      />
      {preview.kind === 'cylinder' && (
        <>
          <CylinderDimensionHandle
            kind="height"
            center={cylinderCenter}
            radius={cylinderRadius}
            height={cylinderHeight}
            onChange={updateCylinderPreview}
          />
          <CylinderDimensionHandle
            kind="radius"
            center={cylinderCenter}
            radius={cylinderRadius}
            height={cylinderHeight}
            onChange={updateCylinderPreview}
          />
        </>
      )}
    </group>
  );
}

export default function PrimitiveBodies() {
  const features = useCADStore((s) => s.features);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const components = useComponentStore((s) => s.components);
  const showComponentColors = useCADStore((s) => s.showComponentColors);

  const editingInPlace = !!activeComponentId && activeComponentId !== rootComponentId;

  // Mirrors ExtrudedBodies.edgeModificationSourceFeatureId: a fillet/chamfer
  // feature points back to its source via parentFeatureId or via the source
  // body's sourceFeatureId on the parsed edge selection. Used to hide the
  // original primitive once it has been filleted / chamfered.
  const downstreamEdgeModSourceIds = useMemo(() => {
    const out = new Set<string>();
    for (const f of features) {
      if (f.type !== 'fillet' && f.type !== 'chamfer') continue;
      if (!f.visible || f.suppressed || f.mesh == null) continue;
      const explicit =
        f.parentFeatureId ??
        (f.params.parentFeatureId as string | undefined) ??
        (f.params.sourceFeatureId as string | undefined);
      if (explicit) {
        out.add(explicit);
        continue;
      }
      const selection = parseOccEdgeSelection(storedEdgeIds(f.params.edgeIds));
      const sourceFeatureId = selection
        ? globalBRepBodyRegistry.get(selection.bodyId)?.sourceFeatureId
        : undefined;
      if (sourceFeatureId) out.add(sourceFeatureId);
    }
    return out;
  }, [features]);

  const specs = useMemo(() => {
    const out: Array<{ spec: PrimitiveSpec; hidden: boolean }> = [];
    for (let index = 0; index < features.length; index += 1) {
      const f = features[index];
      if (f.type !== 'primitive') continue;
      if (!f.visible || f.suppressed) continue;
      // Skip-if-mesh guard: a fillet/chamfer applied to this primitive has
      // stored a custom mesh — ExtrudedBodies picks it up through its
      // stored-mesh path; rendering it here too would double-up.
      if (f.mesh) continue;
      if (!isComponentVisible(components, f.componentId)) continue;
      if (rollbackIndex >= 0 && index > rollbackIndex) continue;
      const spec = buildPrimitiveSpec(f);
      if (!spec) continue;
      // When a downstream fillet/chamfer has a result mesh, hide the
      // original primitive so the rounded edges aren't visually masked.
      // The OCC body stays alive so fillet replay can still find it via
      // globalBRepBodyRegistry.
      const hidden = downstreamEdgeModSourceIds.has(f.id);
      out.push({ spec, hidden });
    }
    return out;
  }, [features, rollbackIndex, components, downstreamEdgeModSourceIds]);

  return (
    <>
      {specs.map(({ spec, hidden }) => {
        const dim = editingInPlace && spec.componentId !== activeComponentId;
        const componentMaterial = showComponentColors && spec.componentId
          ? componentColorMaterial(components[spec.componentId]?.color ?? '#5B9BD5')
          : BODY_MATERIAL;
        return (
          <PrimitiveMesh
            key={spec.featureId}
            spec={spec}
            isDimmed={dim}
            componentMaterial={componentMaterial}
            hidden={hidden}
          />
        );
      })}
    </>
  );
}
