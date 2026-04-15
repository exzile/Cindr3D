/**
 * FormBodies — renders all FormCage bodies in the viewport.
 *
 * For each body:
 *   - Subdivides the control cage using Catmull-Clark (SubdivisionEngine)
 *   - Renders the smooth mesh (solid, semi-transparent orange)
 *   - Renders the cage wireframe (thin lines) when the body is active
 *   - Highlights the active body
 *
 * Geometries are rebuilt only when `formBodies` changes (useMemo).
 * Disposal is handled in the useMemo cleanup.
 */

import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { SubdivisionEngine } from '../../../engine/SubdivisionEngine';
import type { FormCage } from '../../../types/cad';

// ─── Materials (per-instance, not shared module-level, so we can dispose them) ──

const FORM_BODY_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xff8c40,
  metalness: 0.1,
  roughness: 0.6,
  transparent: true,
  opacity: 0.82,
  side: THREE.DoubleSide,
});

const FORM_BODY_ACTIVE_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xffaa60,
  metalness: 0.15,
  roughness: 0.55,
  transparent: true,
  opacity: 0.88,
  side: THREE.DoubleSide,
});

const FORM_CAGE_MATERIAL = new THREE.LineBasicMaterial({
  color: 0xffd080,
  linewidth: 1,
  transparent: true,
  opacity: 0.75,
});

const FORM_CAGE_ACTIVE_MATERIAL = new THREE.LineBasicMaterial({
  color: 0xffffff,
  linewidth: 1,
  transparent: true,
  opacity: 0.9,
});

// ─── Sub-component: one form body ────────────────────────────────────────────

function FormBodyMesh({ cage, isActive }: { cage: FormCage; isActive: boolean }) {
  const { smoothGeo, wireGeo } = useMemo(() => {
    const level = Math.max(0, Math.min(cage.subdivisionLevel, 3));
    const smooth = SubdivisionEngine.subdivide(cage, level);
    const wire = SubdivisionEngine.cageWireframe(cage);
    return { smoothGeo: smooth, wireGeo: wire };
  }, [cage]);

  // Dispose geometries when they change or component unmounts
  useEffect(() => {
    return () => {
      smoothGeo.dispose();
      wireGeo.dispose();
    };
  }, [smoothGeo, wireGeo]);

  if (!cage.visible) return null;

  return (
    <group>
      {/* Smooth subdivided mesh */}
      <mesh
        geometry={smoothGeo}
        material={isActive ? FORM_BODY_ACTIVE_MATERIAL : FORM_BODY_MATERIAL}
        castShadow
        receiveShadow
        userData={{ pickable: true, formBodyId: cage.id }}
      />
      {/* Control cage wireframe (always shown; brighter when active) */}
      <lineSegments
        geometry={wireGeo}
        material={isActive ? FORM_CAGE_ACTIVE_MATERIAL : FORM_CAGE_MATERIAL}
        renderOrder={1}
      />
    </group>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FormBodies() {
  const formBodies = useCADStore((s) => s.formBodies);
  const activeFormBodyId = useCADStore((s) => s.activeFormBodyId);
  const activeTool = useCADStore((s) => s.activeTool);

  // Only render when in the form workspace
  if (!activeTool.startsWith('form-') && formBodies.length === 0) return null;

  return (
    <group name="form-bodies">
      {formBodies.map((cage) => (
        <FormBodyMesh
          key={cage.id}
          cage={cage}
          isActive={cage.id === activeFormBodyId}
        />
      ))}
    </group>
  );
}
