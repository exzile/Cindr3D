/**
 * ConstructionGeometryRenderer — renders construction planes, axes, and points
 * created by D175–D180 tools.
 *
 * All materials are module-level singletons. Geometries are created in useMemo
 * and disposed in useEffect cleanup.
 */

import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import type { ConstructionPlane, ConstructionAxis, ConstructionPoint } from '../../../types/cad';

// ── Module-level material singletons ─────────────────────────────────────────
const PLANE_MAT = new THREE.MeshBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.15,
  side: THREE.DoubleSide,
  depthTest: false,
});

const PLANE_EDGE_MAT = new THREE.LineBasicMaterial({
  color: 0x3b82f6,
  depthTest: false,
});

const AXIS_MAT = new THREE.LineBasicMaterial({
  color: 0xf97316,
  depthTest: false,
});

const POINT_MAT = new THREE.MeshBasicMaterial({
  color: 0x22c55e,
  depthTest: false,
});

/**
 * AUDIT-18: Module-level geometry singleton for construction points.
 * Shared across all ConstructionPointItem instances — do NOT dispose this
 * geometry in any per-instance cleanup, as it is reused by all instances.
 */
const POINT_GEO = new THREE.SphereGeometry(0.2, 8, 6);

// ── Sub-components ────────────────────────────────────────────────────────────

interface PlaneItemProps {
  plane: ConstructionPlane;
}

function ConstructionPlaneItem({ plane }: PlaneItemProps) {
  const normalVec = useMemo(
    () => new THREE.Vector3(...plane.normal).normalize(),
    [plane.normal],
  );

  const { geo, borderGeo, quat } = useMemo(() => {
    const g = new THREE.PlaneGeometry(plane.size, plane.size);
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(defaultNormal, normalVec);

    // Build border: 4 corners of the plane in local space, rotated by quat
    const hs = plane.size / 2;
    const corners = [
      new THREE.Vector3(-hs, -hs, 0),
      new THREE.Vector3(hs, -hs, 0),
      new THREE.Vector3(hs, hs, 0),
      new THREE.Vector3(-hs, hs, 0),
    ].map((c) => c.applyQuaternion(q));

    const borderGeometry = new THREE.BufferGeometry().setFromPoints([
      ...corners,
      corners[0], // close the loop
    ]);

    return { geo: g, borderGeo: borderGeometry, quat: q };
  }, [plane.size, normalVec]);

  useEffect(() => {
    return () => {
      geo.dispose();
      borderGeo.dispose();
    };
  }, [geo, borderGeo]);

  const origin = useMemo(
    () => new THREE.Vector3(...plane.origin),
    [plane.origin],
  );

  return (
    <>
      <mesh
        geometry={geo}
        material={PLANE_MAT}
        quaternion={quat}
        position={origin}
        renderOrder={50}
      />
      <lineSegments
        geometry={borderGeo}
        material={PLANE_EDGE_MAT}
        position={origin}
        renderOrder={51}
      />
    </>
  );
}

interface AxisItemProps {
  axis: ConstructionAxis;
}

function ConstructionAxisItem({ axis }: AxisItemProps) {
  const geo = useMemo(() => {
    const dir = new THREE.Vector3(...axis.direction).normalize();
    const half = axis.length / 2;
    const start = new THREE.Vector3(...axis.origin).addScaledVector(dir, -half);
    const end = new THREE.Vector3(...axis.origin).addScaledVector(dir, half);
    return new THREE.BufferGeometry().setFromPoints([start, end]);
  }, [axis.origin, axis.direction, axis.length]);

  useEffect(() => {
    return () => {
      geo.dispose();
    };
  }, [geo]);

  return (
    <lineSegments
      geometry={geo}
      material={AXIS_MAT}
      renderOrder={50}
    />
  );
}

interface PointItemProps {
  point: ConstructionPoint;
}

function ConstructionPointItem({ point }: PointItemProps) {
  // AUDIT-18: use module-level POINT_GEO singleton — no per-instance allocation or disposal.
  const position = useMemo(
    () => new THREE.Vector3(...point.position),
    [point.position],
  );

  return (
    <mesh
      geometry={POINT_GEO}
      material={POINT_MAT}
      position={position}
      renderOrder={50}
    />
  );
}

// ── Root renderer ─────────────────────────────────────────────────────────────

export default function ConstructionGeometryRenderer() {
  const planes = useCADStore((s) => s.constructionPlanes);
  const axes = useCADStore((s) => s.constructionAxes);
  const points = useCADStore((s) => s.constructionPoints);
  const entityVisConstruction = useCADStore((s) => s.entityVisConstruction);

  if (!entityVisConstruction) return null;

  return (
    <>
      {planes.map((p) => (
        <ConstructionPlaneItem key={p.id} plane={p} />
      ))}
      {axes.map((a) => (
        <ConstructionAxisItem key={a.id} axis={a} />
      ))}
      {points.map((pt) => (
        <ConstructionPointItem key={pt.id} point={pt} />
      ))}
    </>
  );
}
