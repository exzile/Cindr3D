import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { BedBounds, ConfiguredProbeGrid, HeightMapData } from './types';

const PLATE_CELLS = 10; // grid cells per axis on the plate surface

// Fixed point counts for edge and grid so we can mutate attributes in-place.
const EDGE_POINT_COUNT = 8;  // 4 segments × 2 endpoints
const GRID_POINT_COUNT = (PLATE_CELLS + 1) * 2 * 2; // rows + cols, 2 pts each

/**
 * Flat reference plate at y=0.
 *
 * The plate is a thin glass slab — top face at y=0.
 * depthWrite=false lets the height-map mesh show through from every camera angle.
 * A fine grid is etched on the top surface for visual reference.
 */
export function FlatPlate({
  heightMap,
  configuredGrid,
  bedBounds,
  scaleXY: scaleXYProp,
  mirrorX = false,
}: {
  heightMap: HeightMapData;
  configuredGrid?: ConfiguredProbeGrid;
  /** Physical bed extents — when present the plate spans the full bed, not just the probe area. */
  bedBounds?: BedBounds;
  scaleXY?: number;
  mirrorX?: boolean;
}) {
  // ── Derived dimensions ─────────────────────────────────────────────────
  const hmXRange = heightMap.xMax - heightMap.xMin;
  const hmYRange = heightMap.yMax - heightMap.yMin;
  const scaleXY  = scaleXYProp ?? 1 / Math.max(hmXRange, hmYRange, 1);

  // Priority: physical bed (M208) > probe grid (M557) > height-map CSV bounds
  const bedXMin  = bedBounds?.xMin ?? configuredGrid?.xMin ?? heightMap.xMin;
  const bedXMax  = bedBounds?.xMax ?? configuredGrid?.xMax ?? heightMap.xMax;
  const bedYMin  = bedBounds?.yMin ?? configuredGrid?.yMin ?? heightMap.yMin;
  const bedYMax  = bedBounds?.yMax ?? configuredGrid?.yMax ?? heightMap.yMax;

  // When bedBounds is known the plate IS the bed — no cosmetic overhang.
  // Without it (demo / disconnected) keep a small visual border.
  const margin    = bedBounds ? 0 : 0.028;
  const thickness = 0.012;
  const w   = (bedXMax - bedXMin) * scaleXY + margin;
  const d   = (bedYMax - bedYMin) * scaleXY + margin;
  const midX = (bedXMin + bedXMax) / 2 * scaleXY;
  const cx  = mirrorX ? (0.5 - midX) : (midX - 0.5);
  const cz  = 0.5 - (bedYMin + bedYMax) / 2 * scaleXY;

  // ── Plate box — memoised BoxGeometry with explicit disposal ─────────────
  const plateGeo = useMemo(
    () => new THREE.BoxGeometry(w, thickness, d),
    [w, d, thickness],
  );
  useEffect(() => () => plateGeo.dispose(), [plateGeo]);

  // ── Edge & grid — fixed-size attributes mutated in-place ───────────────
  // Allocate once; update the Float32Array contents + set needsUpdate on change.
  const edgeGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(EDGE_POINT_COUNT * 3), 3));
    return geo;
  }, []);
  useEffect(() => () => edgeGeo.dispose(), [edgeGeo]);

  const gridGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(GRID_POINT_COUNT * 3), 3));
    return geo;
  }, []);
  useEffect(() => () => gridGeo.dispose(), [gridGeo]);

  // Mutate the pre-allocated buffers whenever w or d changes.
  useEffect(() => {
    const attr = edgeGeo.attributes.position as THREE.BufferAttribute;
    const hw = w / 2, hd = d / 2;
    const v = attr.array as Float32Array;
    let i = 0;
    const set = (x: number, y: number, z: number) => { v[i++] = x; v[i++] = y; v[i++] = z; };
    set(-hw, 0,  hd); set( hw, 0,  hd);
    set( hw, 0,  hd); set( hw, 0, -hd);
    set( hw, 0, -hd); set(-hw, 0, -hd);
    set(-hw, 0, -hd); set(-hw, 0,  hd);
    attr.needsUpdate = true;
  }, [w, d, edgeGeo]);

  useEffect(() => {
    const attr = gridGeo.attributes.position as THREE.BufferAttribute;
    const LIFT = 0.002;
    const hw = w / 2, hd = d / 2;
    const v = attr.array as Float32Array;
    let i = 0;
    const set = (x: number, y: number, z: number) => { v[i++] = x; v[i++] = y; v[i++] = z; };
    for (let n = 0; n <= PLATE_CELLS; n++) {
      const z = -hd + (d * n) / PLATE_CELLS;
      set(-hw, LIFT, z); set(hw, LIFT, z);
    }
    for (let n = 0; n <= PLATE_CELLS; n++) {
      const x = -hw + (w * n) / PLATE_CELLS;
      set(x, LIFT, -hd); set(x, LIFT, hd);
    }
    attr.needsUpdate = true;
  }, [w, d, gridGeo]);

  return (
    // Group is at the bed centre — edge and grid use local coords relative to it.
    <group position={[cx, 0, cz]}>
      {/* Glass slab — depthWrite=false so the height-map mesh shows through */}
      <mesh geometry={plateGeo} position={[0, -thickness / 2, 0]} renderOrder={1}>
        <meshPhysicalMaterial
          color="#b8d8f8"
          roughness={0.04}
          metalness={0.0}
          clearcoat={1.0}
          clearcoatRoughness={0.02}
          transparent
          opacity={0.18}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Bright perimeter edge */}
      <lineSegments geometry={edgeGeo} renderOrder={2}>
        <lineBasicMaterial color="#93c5fd" opacity={0.75} transparent />
      </lineSegments>

      {/* Fine reference grid on the glass surface */}
      <lineSegments geometry={gridGeo} renderOrder={2}>
        <lineBasicMaterial color="#bfdbfe" opacity={0.35} transparent />
      </lineSegments>
    </group>
  );
}
