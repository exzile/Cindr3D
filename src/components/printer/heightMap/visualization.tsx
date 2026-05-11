import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PrintSpaceLights } from '../../canvas/PrintSpaceLights';
import type { ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { DuetHeightMap as HeightMapData } from '../../../types/duet';
import { computeStats, deviationColor, deviationColorThree, divergingColor, divergingColorThree, type HeightMapStats } from './utils';

/* ── Shared hover info type ─────────────────────────────────────────────────── */

type HoverInfo = {
  bedX: number;
  bedY: number;
  value: number;
  screenX: number;
  screenY: number;
  isProbePoint?: boolean;
  gridX?: number; // 1-based probe col
  gridY?: number; // 1-based probe row
};

/* ── Mesh ───────────────────────────────────────────────────────────────────── */

function HeightMapMesh({
  heightMap,
  diverging = false,
  scaleXY: scaleXYProp,
  mirrorX = false,
  onHover,
}: {
  heightMap: HeightMapData;
  diverging?: boolean;
  /** Shared scene scale — pass from Scene3D so all components use the same space. */
  scaleXY?: number;
  mirrorX?: boolean;
  onHover?: (info: HoverInfo | null) => void;
}) {
  const { geometry, scaleXY } = useMemo(() => {
    const stats = computeStats(heightMap);
    const geo = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const xRange = heightMap.xMax - heightMap.xMin;
    const yRange = heightMap.yMax - heightMap.yMin;
    const scaleXY = scaleXYProp ?? 1 / Math.max(xRange, yRange, 1);
    const zScale = (1 / Math.max(Math.abs(stats.max), Math.abs(stats.min), 0.01)) * 0.3;
    const colorFn = diverging ? divergingColorThree : deviationColorThree;
    const sx = (bx: number) => mirrorX ? (0.5 - bx * scaleXY) : (bx * scaleXY - 0.5);

    for (let yi = 0; yi < heightMap.numY; yi++) {
      for (let xi = 0; xi < heightMap.numX; xi++) {
        const value = heightMap.points[yi]?.[xi] ?? 0;
        const x = sx(heightMap.xMin + xi * heightMap.xSpacing);
        const y = (heightMap.yMin + yi * heightMap.ySpacing) * scaleXY - 0.5;
        vertices.push(x, value * zScale, -y);
        const color = colorFn(value, stats.min, stats.max);
        colors.push(color.r, color.g, color.b);
      }
    }

    for (let yi = 0; yi < heightMap.numY - 1; yi++) {
      for (let xi = 0; xi < heightMap.numX - 1; xi++) {
        const a = yi * heightMap.numX + xi;
        const b = a + 1;
        const c = a + heightMap.numX;
        const d = c + 1;
        // Winding flips with X mirror — swap to keep normals facing up
        if (mirrorX) {
          indices.push(a, b, c, b, d, c);
        } else {
          indices.push(a, c, b, b, c, d);
        }
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return { geometry: geo, scaleXY };
  }, [heightMap, diverging, scaleXYProp, mirrorX]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!onHover) return;
    e.stopPropagation();
    const scale = 1 / scaleXY;
    // Reverse the scene-space normalisation (accounting for optional X mirror):
    //   normal:   x_scene = bedX * scaleXY - 0.5  →  bedX = (x_scene + 0.5) / scaleXY
    //   mirrored: x_scene = 0.5 - bedX * scaleXY  →  bedX = (0.5 - x_scene) / scaleXY
    const bedX = mirrorX ? (0.5 - e.point.x) * scale : (e.point.x + 0.5) * scale;
    const bedY = (0.5 - e.point.z) * scale;
    // Snap to the nearest grid cell for the exact stored value
    const xi = Math.max(0, Math.min(heightMap.numX - 1,
      Math.round((bedX - heightMap.xMin) / heightMap.xSpacing)));
    const yi = Math.max(0, Math.min(heightMap.numY - 1,
      Math.round((bedY - heightMap.yMin) / heightMap.ySpacing)));
    const value = heightMap.points[yi]?.[xi] ?? 0;
    onHover({ bedX, bedY, value, screenX: e.nativeEvent.clientX, screenY: e.nativeEvent.clientY });
  }, [onHover, heightMap, scaleXY, mirrorX]);

  return (
    <mesh
      geometry={geometry}
      renderOrder={0}
      onPointerMove={onHover ? handlePointerMove : undefined}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
    >
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.55} metalness={0.08} />
    </mesh>
  );
}

/* ── Grid — surface-following, correct paired segments ──────────────────────── */

function GridOverlay({ heightMap, scaleXY: scaleXYProp, mirrorX = false }: { heightMap: HeightMapData; scaleXY?: number; mirrorX?: boolean }) {
  const geo = useMemo(() => {
    const xRange = heightMap.xMax - heightMap.xMin;
    const yRange = heightMap.yMax - heightMap.yMin;
    const scaleXY = scaleXYProp ?? 1 / Math.max(xRange, yRange, 1);

    // Recompute zScale identically to HeightMapMesh so the grid sits on the surface
    let minV = Infinity, maxV = -Infinity;
    for (let yi = 0; yi < heightMap.numY; yi++) {
      for (let xi = 0; xi < heightMap.numX; xi++) {
        const v = heightMap.points[yi]?.[xi] ?? 0;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    const zScale = (1 / Math.max(Math.abs(maxV), Math.abs(minV), 0.01)) * 0.3;
    const LIFT = 0.0018; // tiny offset to prevent z-fighting with the mesh face

    // World-space → normalised-scene coordinate helpers
    const wx = (xi: number) => mirrorX
      ? 0.5 - (heightMap.xMin + xi * heightMap.xSpacing) * scaleXY
      : (heightMap.xMin + xi * heightMap.xSpacing) * scaleXY - 0.5;
    const wz = (yi: number) => -((heightMap.yMin + yi * heightMap.ySpacing) * scaleXY - 0.5);
    const wy = (xi: number, yi: number) => (heightMap.points[yi]?.[xi] ?? 0) * zScale + LIFT;

    // Build flat position array — always in pairs so lineSegments never mis-pairs rows
    const pos: number[] = [];

    // Horizontal edges: xi → xi+1 at constant yi
    for (let yi = 0; yi < heightMap.numY; yi++) {
      for (let xi = 0; xi < heightMap.numX - 1; xi++) {
        pos.push(wx(xi),     wy(xi,     yi), wz(yi));
        pos.push(wx(xi + 1), wy(xi + 1, yi), wz(yi));
      }
    }

    // Vertical edges: yi → yi+1 at constant xi
    for (let xi = 0; xi < heightMap.numX; xi++) {
      for (let yi = 0; yi < heightMap.numY - 1; yi++) {
        pos.push(wx(xi), wy(xi, yi),     wz(yi));
        pos.push(wx(xi), wy(xi, yi + 1), wz(yi + 1));
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [heightMap, scaleXYProp, mirrorX]);

  useEffect(() => () => geo.dispose(), [geo]);

  return (
    <lineSegments geometry={geo} renderOrder={3}>
      <lineBasicMaterial color="#6b7280" opacity={0.55} transparent />
    </lineSegments>
  );
}

/* ── Flat reference plate at y=0 ────────────────────────────────────────────── */
// The plate is a thin glass slab — top face at y=0.
// depthWrite=false lets the height-map mesh show through from every camera angle.
// A fine grid is etched on the top surface for visual reference.

const PLATE_CELLS = 10; // grid cells per axis on the plate surface

// Fixed point counts for edge and grid so we can mutate attributes in-place.
const EDGE_POINT_COUNT = 8;  // 4 segments × 2 endpoints
const GRID_POINT_COUNT = (PLATE_CELLS + 1) * 2 * 2; // rows + cols, 2 pts each

function FlatPlate({
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
  // ── Derived dimensions ──────────────────────────────────────────────────────
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

  // ── Plate box — memoised BoxGeometry with explicit disposal (#1) ───────────
  const plateGeo = useMemo(
    () => new THREE.BoxGeometry(w, thickness, d),
    [w, d, thickness],
  );
  useEffect(() => () => plateGeo.dispose(), [plateGeo]);

  // ── Edge & grid — fixed-size attributes mutated in-place (#2 #4) ──────────
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

/* ── Configured probe grid type ─────────────────────────────────────────────── */

export interface ConfiguredProbeGrid {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  numPoints: number;
}

/** Physical bed extents from the printer's axis limits (M208). */
export interface BedBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/* ── Probe point markers — yellow spheres on the plate surface ──────────────── */
// One InstancedMesh draw call for all spheres.
// Bottom of each sphere rests on the plate top face (y=0).
// When `configuredGrid` is supplied the markers reflect the user-configured
// M557 settings rather than the (potentially stale) loaded CSV grid.

function ProbePointMarkers({
  heightMap,
  configuredGrid,
  scaleXY: scaleXYProp,
  radiusScale = 1,
  mirrorX = false,
  onHover,
}: {
  heightMap: HeightMapData;
  configuredGrid?: ConfiguredProbeGrid;
  scaleXY?: number;
  radiusScale?: number;
  mirrorX?: boolean;
  onHover?: (info: HoverInfo | null) => void;
}) {
  const meshRef  = useRef<THREE.InstancedMesh>(null);
  const _dummy   = useRef(new THREE.Object3D());

  const { radius, positions, count, numX: gridNumX } = useMemo(() => {
    const xRange  = heightMap.xMax - heightMap.xMin;
    const yRange  = heightMap.yMax - heightMap.yMin;
    const scaleXY = scaleXYProp ?? 1 / Math.max(xRange, yRange, 1);
    const smx = (bx: number) => mirrorX ? (0.5 - bx * scaleXY) : (bx * scaleXY - 0.5);

    if (configuredGrid) {
      // Show where the probes *will* go based on the configured M557 settings.
      const { xMin, xMax, yMin, yMax, numPoints } = configuredGrid;
      const n = Math.max(numPoints, 1);
      const spacingX = n > 1 ? (xMax - xMin) / (n - 1) : 0;
      const spacingY = n > 1 ? (yMax - yMin) / (n - 1) : 0;
      const cellW = (n > 1 ? spacingX : (xMax - xMin)) * scaleXY;
      const cellH = (n > 1 ? spacingY : (yMax - yMin)) * scaleXY;
      const r = Math.min(cellW, cellH, 0.04) * 0.07 * radiusScale;

      const pos: [number, number, number][] = [];
      for (let yi = 0; yi < n; yi++) {
        for (let xi = 0; xi < n; xi++) {
          const bx = xMin + xi * spacingX;
          const by = yMin + yi * spacingY;
          const sx = smx(bx);
          const sz = -(by * scaleXY - 0.5);
          pos.push([sx, r, sz]);
        }
      }
      return { radius: r, positions: pos, count: pos.length, numX: n };
    }

    // Fall back to the loaded height-map grid.
    const cellW  = heightMap.xSpacing * scaleXY;
    const cellH  = heightMap.ySpacing * scaleXY;
    const r = Math.min(cellW, cellH) * 0.07 * radiusScale;

    const pos: [number, number, number][] = [];
    for (let yi = 0; yi < heightMap.numY; yi++) {
      for (let xi = 0; xi < heightMap.numX; xi++) {
        const x = smx(heightMap.xMin + xi * heightMap.xSpacing);
        const z = -((heightMap.yMin + yi * heightMap.ySpacing) * scaleXY - 0.5);
        // y = radius so the sphere's bottom rests exactly on the plate top face
        pos.push([x, r, z]);
      }
    }
    return { radius: r, positions: pos, count: pos.length, numX: heightMap.numX };
  }, [heightMap, configuredGrid, scaleXYProp, radiusScale, mirrorX]);

  // Place each instance. Runs once after mount and again whenever positions change.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = _dummy.current;
    for (let i = 0; i < positions.length; i++) {
      dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!onHover || e.instanceId === undefined) return;
    e.stopPropagation();
    const xi = e.instanceId % gridNumX;
    const yi = Math.floor(e.instanceId / gridNumX);
    let bedX: number, bedY: number, value: number;
    if (configuredGrid) {
      const { xMin, xMax, yMin, yMax, numPoints } = configuredGrid;
      const n = Math.max(numPoints, 1);
      const spacingX = n > 1 ? (xMax - xMin) / (n - 1) : 0;
      const spacingY = n > 1 ? (yMax - yMin) / (n - 1) : 0;
      bedX = xMin + xi * spacingX;
      bedY = yMin + yi * spacingY;
      // Snap to nearest point in loaded map for height value (best-effort)
      const mxi = Math.max(0, Math.min(heightMap.numX - 1, Math.round((bedX - heightMap.xMin) / (heightMap.xSpacing || 1))));
      const myi = Math.max(0, Math.min(heightMap.numY - 1, Math.round((bedY - heightMap.yMin) / (heightMap.ySpacing || 1))));
      value = heightMap.points[myi]?.[mxi] ?? 0;
    } else {
      bedX = heightMap.xMin + xi * heightMap.xSpacing;
      bedY = heightMap.yMin + yi * heightMap.ySpacing;
      value = heightMap.points[yi]?.[xi] ?? 0;
    }
    onHover({
      bedX, bedY, value,
      screenX: e.nativeEvent.clientX,
      screenY: e.nativeEvent.clientY,
      isProbePoint: true,
      gridX: xi + 1,
      gridY: yi + 1,
    });
  }, [onHover, heightMap, configuredGrid, gridNumX]);

  return (
    // R3F owns geometry/material lifecycle here; args only recreated when count changes
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      onPointerMove={onHover ? handlePointerMove : undefined}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
    >
      <sphereGeometry args={[radius, 12, 8]} />
      <meshStandardMaterial
        color="#fbbf24"
        roughness={0.30}
        metalness={0.08}
        emissive="#d97706"
        emissiveIntensity={0.3}
      />
    </instancedMesh>
  );
}

/* ── Safety margin overlay ──────────────────────────────────────────────────
 * When the physical bed (bedBounds, from M208 axis limits) is larger than the
 * configured probe grid (configuredGrid, from M557) we render:
 *   1. Red semi-transparent fill on the 4 margin strips.
 *   2. A blue dashed-style outline rectangle marking the probe area boundary.
 *
 * Coordinate convention (same as FlatPlate / HeightMapMesh):
 *   scene_x =  bedX * scaleXY - 0.5
 *   scene_z = -(bedY * scaleXY - 0.5)   (Y axis negated — larger bedY = more-negative Z)
 * ─────────────────────────────────────────────────────────────────────────── */

function SafetyZones({
  bedBounds,
  configuredGrid,
  scaleXY,
  mirrorX = false,
}: {
  bedBounds: BedBounds;
  configuredGrid: ConfiguredProbeGrid;
  scaleXY: number;
  mirrorX?: boolean;
}) {
  const { marginGeo, borderGeo, hasMargins } = useMemo(() => {
    const sx  = (x: number) => mirrorX ? (0.5 - x * scaleXY) : (x * scaleXY - 0.5);
    const sz  = (y: number) => -(y * scaleXY - 0.5);

    // Physical bed corners in scene space
    const bxL  = sx(bedBounds.xMin);
    const bxR  = sx(bedBounds.xMax);
    const bzF  = sz(bedBounds.yMin);   // front = larger scene_z (smaller bedY)
    const bzBk = sz(bedBounds.yMax);   // back  = smaller scene_z (larger bedY)

    // Probe grid corners in scene space
    const pxL  = sx(configuredGrid.xMin);
    const pxR  = sx(configuredGrid.xMax);
    const pzF  = sz(configuredGrid.yMin);
    const pzBk = sz(configuredGrid.yMax);

    const MARGIN_Y = 0.004; // sit just above the glass plate surface
    const MIN_GAP  = 0.5;   // ignore sub-0.5 mm margins (cosmetic noise)

    // ── Red fill geometry (triangulated quads) ──────────────────────────────
    const mverts: number[] = [];
    const addQuad = (x0: number, z0: number, x1: number, z1: number) => {
      mverts.push(x0, MARGIN_Y, z0,  x1, MARGIN_Y, z0,  x1, MARGIN_Y, z1);
      mverts.push(x0, MARGIN_Y, z0,  x1, MARGIN_Y, z1,  x0, MARGIN_Y, z1);
    };

    let count = 0;
    // Left strip (full bed Y range)
    if (configuredGrid.xMin - bedBounds.xMin > MIN_GAP) {
      addQuad(bxL, bzBk, pxL, bzF); count++;
    }
    // Right strip (full bed Y range)
    if (bedBounds.xMax - configuredGrid.xMax > MIN_GAP) {
      addQuad(pxR, bzBk, bxR, bzF); count++;
    }
    // Front strip (probe X range, between probe front and bed front)
    if (configuredGrid.yMin - bedBounds.yMin > MIN_GAP) {
      addQuad(pxL, pzF, pxR, bzF); count++;
    }
    // Back strip (probe X range, between bed back and probe back)
    if (bedBounds.yMax - configuredGrid.yMax > MIN_GAP) {
      addQuad(pxL, bzBk, pxR, pzBk); count++;
    }

    const marginGeo = new THREE.BufferGeometry();
    marginGeo.setAttribute('position', new THREE.Float32BufferAttribute(mverts, 3));

    // ── Blue probe-area border (line rectangle) ─────────────────────────────
    const BORDER_Y = 0.007;
    const bverts: number[] = [
      pxL, BORDER_Y, pzF,   pxR, BORDER_Y, pzF,   // front edge
      pxR, BORDER_Y, pzF,   pxR, BORDER_Y, pzBk,  // right edge
      pxR, BORDER_Y, pzBk,  pxL, BORDER_Y, pzBk,  // back edge
      pxL, BORDER_Y, pzBk,  pxL, BORDER_Y, pzF,   // left edge
    ];
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.Float32BufferAttribute(bverts, 3));

    return { marginGeo, borderGeo, hasMargins: count > 0 };
  }, [bedBounds, configuredGrid, scaleXY, mirrorX]);

  useEffect(() => () => { marginGeo.dispose(); borderGeo.dispose(); }, [marginGeo, borderGeo]);

  if (!hasMargins) return null;

  return (
    <>
      {/* Red fill on margin strips */}
      <mesh geometry={marginGeo} renderOrder={2}>
        <meshBasicMaterial
          color="#ef4444"
          opacity={0.20}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Blue border: the probe area boundary */}
      <lineSegments geometry={borderGeo} renderOrder={3}>
        <lineBasicMaterial color="#3b82f6" opacity={0.80} transparent />
      </lineSegments>
    </>
  );
}

/* ── Axis labels ────────────────────────────────────────────────────────────── */

function AxisLabels() {
  return (
    <group>
      <Text position={[0, 0.35, 0]} fontSize={0.038} color="#3b82f6" anchorX="center" anchorY="middle">Z</Text>
    </group>
  );
}

/* ── Z-deviation ruler ───────────────────────────────────────────────────────
 * A vertical scale bar placed at the right-front corner of the mesh.
 * Ticks are spaced at "nice" intervals in real mm; labels are colour-coded
 * to match the mesh (red = positive / high, blue = negative / low, white = 0).
 * ─────────────────────────────────────────────────────────────────────────── */

/** Pick a "nice" step so there are roughly targetCount ticks in [min, max]. */
function computeNiceTicks(min: number, max: number, targetCount = 6): number[] {
  const range = max - min;
  if (range < 1e-6) return [parseFloat(((min + max) / 2).toFixed(6))];

  const rawStep = range / targetCount;
  const mag     = Math.pow(10, Math.floor(Math.log10(rawStep)));
  let   step    = mag;
  for (const f of [1, 2, 2.5, 5, 10]) {
    step = f * mag;
    if (range / step <= targetCount + 1) break;
  }

  const ticks: number[] = [];
  let t = Math.floor(min / step) * step;
  while (t <= max + step * 0.001) {
    const v = Math.round(t / step) * step; // eliminate floating-point drift
    if (v >= min - step * 0.001 && v <= max + step * 0.001) ticks.push(v);
    t += step;
  }

  // Always include 0 when the range straddles the flat reference.
  if (min < 0 && max > 0 && !ticks.some((v) => Math.abs(v) < step * 0.01)) {
    ticks.push(0);
    ticks.sort((a, b) => a - b);
  }

  return ticks;
}

function ZRuler({
  heightMap,
  stats,
  scaleXY: scaleXYProp,
  mirrorX = false,
}: {
  heightMap: HeightMapData;
  stats: { min: number; max: number };
  scaleXY?: number;
  mirrorX?: boolean;
}) {
  // ── Scene-space geometry helpers (mirror HeightMapMesh exactly) ────────────
  const xRange  = heightMap.xMax - heightMap.xMin;
  const yRange  = heightMap.yMax - heightMap.yMin;
  const scaleXY = scaleXYProp ?? 1 / Math.max(xRange, yRange, 1);
  const zScale  = (1 / Math.max(Math.abs(stats.max), Math.abs(stats.min), 0.01)) * 0.3;

  // Place the ruler at the right-front corner of the mesh with a small gap.
  // When X is mirrored, bedX=xMin maps to the rightmost scene position.
  const GAP    = 0.052;
  const rulerX = mirrorX
    ? (0.5 - heightMap.xMin * scaleXY + GAP)
    : (heightMap.xMax * scaleXY - 0.5 + GAP);
  const rulerZ = -(heightMap.yMin * scaleXY - 0.5); // front edge in scene space

  const yBottom = stats.min * zScale;
  const yTop    = stats.max * zScale;

  const ticks = useMemo(
    () => computeNiceTicks(stats.min, stats.max, 6),
    [stats.min, stats.max],
  );

  const lineGeo = useMemo(() => {
    const TICK      = 0.020; // normal tick half-length (extends toward mesh)
    const TICK_ZERO = 0.030; // longer tick for the zero reference

    const pts: number[] = [];

    // ── Spine ──────────────────────────────────────────────────────────────
    pts.push(rulerX, yBottom, rulerZ,  rulerX, yTop, rulerZ);

    // Arrow-head endcaps
    const CAP = 0.007;
    pts.push(rulerX - CAP, yTop - CAP,    rulerZ,  rulerX, yTop,    rulerZ);
    pts.push(rulerX + CAP, yTop - CAP,    rulerZ,  rulerX, yTop,    rulerZ);
    pts.push(rulerX - CAP, yBottom + CAP, rulerZ,  rulerX, yBottom, rulerZ);
    pts.push(rulerX + CAP, yBottom + CAP, rulerZ,  rulerX, yBottom, rulerZ);

    // ── Tick marks ─────────────────────────────────────────────────────────
    for (const val of ticks) {
      const y   = val * zScale;
      const len = Math.abs(val) < 1e-9 ? TICK_ZERO : TICK;
      pts.push(rulerX, y, rulerZ,  rulerX - len, y, rulerZ);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [rulerX, rulerZ, yBottom, yTop, ticks, zScale]);

  useEffect(() => () => lineGeo.dispose(), [lineGeo]);

  const fmtTick = (v: number): string => {
    if (Math.abs(v) < 1e-9) return '0';
    const d = Math.abs(v) < 0.1 ? 3 : 2;
    return `${v > 0 ? '+' : ''}${v.toFixed(d)}`;
  };

  return (
    <group>
      {/* Spine + ticks */}
      <lineSegments geometry={lineGeo} renderOrder={4}>
        <lineBasicMaterial color="#64748b" opacity={0.92} transparent />
      </lineSegments>

      {/* Tick labels */}
      {ticks.map((val) => {
        const isZero = Math.abs(val) < 1e-9;
        const color  = isZero ? '#e2e8f0' : val > 0 ? '#f87171' : '#60a5fa';
        return (
          <Text
            key={val}
            position={[rulerX + 0.009, val * zScale, rulerZ]}
            fontSize={0.022}
            color={color}
            anchorX="left"
            anchorY="middle"
            renderOrder={5}
          >
            {fmtTick(val)}
          </Text>
        );
      })}

      {/* Exact min / max labels at the arrow endcaps */}
      <Text
        position={[rulerX - 0.028, yTop + 0.013, rulerZ]}
        fontSize={0.018}
        color="#f87171"
        anchorX="center"
        anchorY="middle"
        renderOrder={5}
      >
        {`+${stats.max.toFixed(3)}`}
      </Text>
      <Text
        position={[rulerX - 0.028, yBottom - 0.013, rulerZ]}
        fontSize={0.018}
        color="#60a5fa"
        anchorX="center"
        anchorY="middle"
        renderOrder={5}
      >
        {stats.min.toFixed(3)}
      </Text>

      {/* Axis label */}
      <Text
        position={[rulerX + 0.009, yTop + 0.042, rulerZ]}
        fontSize={0.020}
        color="#94a3b8"
        anchorX="left"
        anchorY="middle"
        renderOrder={5}
      >
        Z (mm)
      </Text>
    </group>
  );
}

/* ── X / Y bed rulers ───────────────────────────────────────────────────────
 * Two rulers sit just below the glass plate:
 *   X ruler — along the front edge of the bed, running left→right
 *   Y ruler — along the left edge of the bed,  running front→back
 *
 * Coordinate convention (mirrors HeightMapMesh / FlatPlate):
 *   scene_x =  bedX * scaleXY - 0.5
 *   scene_z = -(bedY * scaleXY - 0.5)   (Y axis is negated)
 * ─────────────────────────────────────────────────────────────────────────── */

function XYRulers({
  heightMap,
  configuredGrid,
  bedBounds,
  scaleXY: scaleXYProp,
  mirrorX = false,
}: {
  heightMap: HeightMapData;
  configuredGrid?: ConfiguredProbeGrid;
  bedBounds?: BedBounds;
  scaleXY?: number;
  mirrorX?: boolean;
}) {
  const xRange  = heightMap.xMax - heightMap.xMin;
  const yRange  = heightMap.yMax - heightMap.yMin;
  const scaleXY = scaleXYProp ?? 1 / Math.max(xRange, yRange, 1);

  // Rulers span the physical bed (M208) when available, otherwise probe grid or CSV
  const bedXMin = bedBounds?.xMin ?? configuredGrid?.xMin ?? heightMap.xMin;
  const bedXMax = bedBounds?.xMax ?? configuredGrid?.xMax ?? heightMap.xMax;
  const bedYMin = bedBounds?.yMin ?? configuredGrid?.yMin ?? heightMap.yMin;
  const bedYMax = bedBounds?.yMax ?? configuredGrid?.yMax ?? heightMap.yMax;

  // Scene-space X coordinate for a bed X value (respects mirrorX)
  const toSceneX = useCallback(
    (bx: number) => mirrorX ? (0.5 - bx * scaleXY) : (bx * scaleXY - 0.5),
    [mirrorX, scaleXY],
  );

  // Scene-space edges of the plate
  const xL = toSceneX(bedXMin); // left in scene (bedXMin normal, bedXMax mirrored)
  const xR = toSceneX(bedXMax); // right in scene (bedXMax normal, bedXMin mirrored)
  // Ensure xL < xR when mirrored (bed values reversed, so swap)
  const sceneXLeft  = mirrorX ? xR : xL;
  const sceneXRight = mirrorX ? xL : xR;
  const zF = -(bedYMin * scaleXY - 0.5); // front (larger Z)
  const zB = -(bedYMax * scaleXY - 0.5); // back  (smaller Z)

  const BELOW  = -0.022; // y-level of the ruler lines (just below plate)
  const TICK   =  0.016; // tick length (extends downward)
  const INDENT =  0.040; // gap between bed edge and ruler line

  const zRuler = zF + INDENT; // X ruler sits in front of the bed
  // Y ruler: left of bed (normal) or right of bed (mirrored — X=0 is on the right)
  const xRuler = mirrorX ? (sceneXRight + INDENT) : (sceneXLeft - INDENT);

  const xTicks = useMemo(
    () => computeNiceTicks(bedXMin, bedXMax, 5),
    [bedXMin, bedXMax],
  );
  const yTicks = useMemo(
    () => computeNiceTicks(bedYMin, bedYMax, 5),
    [bedYMin, bedYMax],
  );

  const lineGeo = useMemo(() => {
    const pts: number[] = [];
    const ENDCAP = 0.010; // perpendicular end-cap half-length

    // ── X ruler ──────────────────────────────────────────────────────────────
    // Spine (always from sceneXLeft to sceneXRight)
    pts.push(sceneXLeft, BELOW, zRuler,   sceneXRight, BELOW, zRuler);
    // End caps (perpendicular in Z)
    pts.push(sceneXLeft,  BELOW, zRuler - ENDCAP,  sceneXLeft,  BELOW, zRuler + ENDCAP);
    pts.push(sceneXRight, BELOW, zRuler - ENDCAP,  sceneXRight, BELOW, zRuler + ENDCAP);
    // Ticks (downward in Y)
    for (const v of xTicks) {
      const x = toSceneX(v);
      pts.push(x, BELOW, zRuler,  x, BELOW - TICK, zRuler);
    }

    // ── Y ruler ──────────────────────────────────────────────────────────────
    // Spine (from front to back in scene space: zF → zB)
    pts.push(xRuler, BELOW, zF,   xRuler, BELOW, zB);
    // End caps (perpendicular in X)
    pts.push(xRuler - ENDCAP, BELOW, zF,  xRuler + ENDCAP, BELOW, zF);
    pts.push(xRuler - ENDCAP, BELOW, zB,  xRuler + ENDCAP, BELOW, zB);
    // Ticks: toward the bed — left when mirrored (Y ruler right of bed), right when normal (Y ruler left of bed)
    for (const v of yTicks) {
      const z = -(v * scaleXY - 0.5);
      if (mirrorX) {
        pts.push(xRuler, BELOW, z,  xRuler - TICK, BELOW, z);
      } else {
        pts.push(xRuler, BELOW, z,  xRuler + TICK, BELOW, z);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [BELOW, sceneXLeft, sceneXRight, zF, zB, zRuler, xRuler, xTicks, yTicks, scaleXY, mirrorX, toSceneX]);

  useEffect(() => () => lineGeo.dispose(), [lineGeo]);

  return (
    <group>
      <lineSegments geometry={lineGeo} renderOrder={4}>
        <lineBasicMaterial color="#64748b" opacity={0.80} transparent />
      </lineSegments>

      {/* ── X tick labels ── */}
      {xTicks.map((v) => (
        <Text
          key={`xr-${v}`}
          position={[toSceneX(v), BELOW - TICK - 0.013, zRuler]}
          fontSize={0.020}
          color="#94a3b8"
          anchorX="center"
          anchorY="top"
          renderOrder={5}
        >
          {v}
        </Text>
      ))}

      {/* X axis label */}
      <Text
        position={[(sceneXLeft + sceneXRight) / 2, BELOW - TICK - 0.034, zRuler]}
        fontSize={0.022}
        color="#ef4444"
        anchorX="center"
        anchorY="top"
        renderOrder={5}
      >
        X (mm)
      </Text>

      {/* ── Y tick labels ── */}
      {yTicks.map((v) => (
        <Text
          key={`yr-${v}`}
          position={[mirrorX ? xRuler + 0.010 : xRuler - 0.010, BELOW, -(v * scaleXY - 0.5)]}
          fontSize={0.020}
          color="#94a3b8"
          anchorX={mirrorX ? 'left' : 'right'}
          anchorY="middle"
          renderOrder={5}
        >
          {v}
        </Text>
      ))}

      {/* Y axis label */}
      <Text
        position={[mirrorX ? xRuler + 0.044 : xRuler - 0.044, BELOW, (zF + zB) / 2]}
        fontSize={0.022}
        color="#22c55e"
        anchorX="center"
        anchorY="middle"
        renderOrder={5}
      >
        Y (mm)
      </Text>
    </group>
  );
}

/* ── 3-D scene ──────────────────────────────────────────────────────────────── */

export type CameraPreset = 'iso' | 'top' | 'front' | 'side';

// eslint-disable-next-line react-refresh/only-export-components
export const CAMERA_POSITIONS: Record<CameraPreset, [number, number, number]> = {
  iso:   [0.9,   0.65, 0.9],
  top:   [0.001, 1.5,  0.001],
  front: [0,     0.25, 1.3],
  side:  [1.3,   0.25, 0],
};

export function Scene3D({
  heightMap,
  diverging = false,
  cameraPosition = CAMERA_POSITIONS.iso,
  showProbePoints = true,
  probePointScale = 1,
  showZRuler = true,
  showXYRulers = true,
  showMesh = true,
  configuredGrid,
  bedBounds,
  mirrorX = false,
}: {
  heightMap: HeightMapData;
  diverging?: boolean;
  cameraPosition?: [number, number, number];
  showProbePoints?: boolean;
  probePointScale?: number;
  showZRuler?: boolean;
  showXYRulers?: boolean;
  /** When false only the glass plate and probe markers are rendered (no deviation mesh, grid, or ruler). */
  showMesh?: boolean;
  configuredGrid?: ConfiguredProbeGrid;
  /** Physical bed extents from M208 axis limits — drives full plate + safety margin overlay. */
  bedBounds?: BedBounds;
  mirrorX?: boolean;
}) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const [tooltipInfo, setTooltipInfo] = useState<HoverInfo | null>(null);

  // Derive stats once per heightMap change — shared by ruler and mesh coloring
  const stats = useMemo(() => computeStats(heightMap), [heightMap]);

  // ── Unified scene scale ────────────────────────────────────────────────────
  // Use the union of all known bounds (heightMap CSV + M557 probe grid + M208 physical bed)
  // so every component lives in the same coordinate space.
  const sceneScaleXY = useMemo(() => {
    const candidates = [
      heightMap.xMin, configuredGrid?.xMin, bedBounds?.xMin,
    ].filter((v): v is number => v !== undefined);
    const maxCandidates = [
      heightMap.xMax, configuredGrid?.xMax, bedBounds?.xMax,
    ].filter((v): v is number => v !== undefined);
    const yMins = [
      heightMap.yMin, configuredGrid?.yMin, bedBounds?.yMin,
    ].filter((v): v is number => v !== undefined);
    const yMaxs = [
      heightMap.yMax, configuredGrid?.yMax, bedBounds?.yMax,
    ].filter((v): v is number => v !== undefined);
    const xRange = Math.max(...maxCandidates) - Math.min(...candidates);
    const yRange = Math.max(...yMaxs)          - Math.min(...yMins);
    return 1 / Math.max(xRange, yRange, 1);
  }, [heightMap, configuredGrid, bedBounds]);

  // Scene-space camera target — centre on the full bed when available.
  const meshCenter = useMemo<[number, number, number]>(() => {
    const bedXMin = bedBounds?.xMin ?? configuredGrid?.xMin ?? heightMap.xMin;
    const bedXMax = bedBounds?.xMax ?? configuredGrid?.xMax ?? heightMap.xMax;
    const bedYMin = bedBounds?.yMin ?? configuredGrid?.yMin ?? heightMap.yMin;
    const bedYMax = bedBounds?.yMax ?? configuredGrid?.yMax ?? heightMap.yMax;
    const midBedX = (bedXMin + bedXMax) / 2 * sceneScaleXY;
    const cx = mirrorX ? (0.5 - midBedX) : (midBedX - 0.5);
    const cz = 0.5 - (bedYMin + bedYMax) / 2 * sceneScaleXY;
    return [cx, 0, cz];
  }, [heightMap, configuredGrid, bedBounds, sceneScaleXY, mirrorX]);

  // Keep OrbitControls target centred on the bed when dimensions change.
  useEffect(() => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    ctrl.target.set(...meshCenter);
    ctrl.update();
  }, [meshCenter]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        frameloop="demand"
        camera={{ position: cameraPosition, fov: 45 }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
        gl={{ antialias: true, alpha: true }}
      >
        <PrintSpaceLights />
        <FlatPlate heightMap={heightMap} configuredGrid={configuredGrid} bedBounds={bedBounds} scaleXY={sceneScaleXY} mirrorX={mirrorX} />
        {/* Safety margin overlay — red fills + blue probe boundary — only when M208 bed > M557 probe area */}
        {bedBounds && configuredGrid && (
          <SafetyZones bedBounds={bedBounds} configuredGrid={configuredGrid} scaleXY={sceneScaleXY} mirrorX={mirrorX} />
        )}
        {showProbePoints && (
          <ProbePointMarkers
            heightMap={heightMap}
            configuredGrid={configuredGrid}
            scaleXY={sceneScaleXY}
            radiusScale={probePointScale}
            mirrorX={mirrorX}
            onHover={setTooltipInfo}
          />
        )}
        {showMesh && <HeightMapMesh heightMap={heightMap} diverging={diverging} scaleXY={sceneScaleXY} mirrorX={mirrorX} onHover={setTooltipInfo} />}
        {showMesh && <GridOverlay   heightMap={heightMap} scaleXY={sceneScaleXY} mirrorX={mirrorX} />}
        {showMesh && showZRuler && <ZRuler heightMap={heightMap} stats={stats} scaleXY={sceneScaleXY} mirrorX={mirrorX} />}
        {showXYRulers && <XYRulers heightMap={heightMap} configuredGrid={configuredGrid} bedBounds={bedBounds} scaleXY={sceneScaleXY} mirrorX={mirrorX} />}
        <AxisLabels />
        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.08}
          minDistance={0.4}
          maxDistance={3}
        />
      </Canvas>

      {tooltipInfo && (
        <div
          className="hm-3d-tooltip"
          style={{
            position: 'fixed',
            left: tooltipInfo.screenX + 16,
            top: tooltipInfo.screenY - 56,
            pointerEvents: 'none',
            zIndex: 200,
          }}
        >
          {tooltipInfo.isProbePoint ? (
            <span className="hm-3d-tooltip__badge">Probe {tooltipInfo.gridX}×{tooltipInfo.gridY}</span>
          ) : (
            <span className="hm-3d-tooltip__badge hm-3d-tooltip__badge--surface">Surface</span>
          )}
          <span className="hm-3d-tooltip__coord">
            X {tooltipInfo.bedX.toFixed(1)} / Y {tooltipInfo.bedY.toFixed(1)} mm
          </span>
          <span
            className="hm-3d-tooltip__val"
            style={{ color: tooltipInfo.value >= 0 ? '#f87171' : '#60a5fa' }}
          >
            {tooltipInfo.value >= 0 ? '+' : ''}{tooltipInfo.value.toFixed(4)} mm
          </span>
        </div>
      )}
    </div>
  );
}

/* ── 2-D Heatmap ────────────────────────────────────────────────────────────── */

export function Heatmap2D({ heightMap, diverging = false, mirrorX = false }: { heightMap: HeightMapData; diverging?: boolean; mirrorX?: boolean }) {
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; value: number; screenX: number; screenY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const stats = useMemo(() => computeStats(heightMap), [heightMap]);

  const padL = 48, padR = 12, padT = 12, padB = 40;
  const svgW = 520, svgH = 420;
  const gridW = svgW - padL - padR;
  const gridH = svgH - padT - padB;
  const cellW = gridW / heightMap.numX;
  const cellH = gridH / heightMap.numY;

  const xTicks = useMemo(() => {
    const step = Math.ceil(heightMap.numX / 5);
    return Array.from({ length: heightMap.numX }, (_, i) => i)
      .filter((i) => i % step === 0 || i === heightMap.numX - 1)
      .map((i) => ({ i, mm: Math.round(heightMap.xMin + i * heightMap.xSpacing) }));
  }, [heightMap]);

  const yTicks = useMemo(() => {
    const step = Math.ceil(heightMap.numY / 5);
    return Array.from({ length: heightMap.numY }, (_, i) => i)
      .filter((i) => i % step === 0 || i === heightMap.numY - 1)
      .map((i) => ({ i, mm: Math.round(heightMap.yMin + i * heightMap.ySpacing) }));
  }, [heightMap]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGRectElement>, xi: number, yi: number, value: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoverInfo({
      x: heightMap.xMin + xi * heightMap.xSpacing,
      y: heightMap.yMin + yi * heightMap.ySpacing,
      value,
      screenX: e.clientX - rect.left,
      screenY: e.clientY - rect.top,
    });
  }, [heightMap]);

  return (
    <div className="heatmap-2d-container" style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', overflow: 'visible' }}
      >
        {Array.from({ length: heightMap.numY }, (_, yi) =>
          Array.from({ length: heightMap.numX }, (_, xi) => {
            const value = heightMap.points[yi]?.[xi] ?? 0;
            const fill = diverging ? divergingColor(value, stats.min, stats.max) : deviationColor(value, stats.min, stats.max);
            // When mirrorX: xi=0 (X=0) renders at the right side of the grid
            const cellXi = mirrorX ? (heightMap.numX - 1 - xi) : xi;
            return (
              <rect
                key={`${xi}-${yi}`}
                x={padL + cellXi * cellW}
                y={padT + (heightMap.numY - 1 - yi) * cellH}
                width={cellW}
                height={cellH}
                fill={fill}
                style={{ stroke: 'var(--border-light)', strokeWidth: 0.5, cursor: 'crosshair' }}
                onMouseMove={(e) => handleMouseMove(e, xi, yi, value)}
                onMouseLeave={() => setHoverInfo(null)}
              />
            );
          }),
        )}

        {xTicks.map(({ i, mm }) => {
          // When mirrorX: tick i=0 (lowest X) is on the right
          const tickXi = mirrorX ? (heightMap.numX - 1 - i) : i;
          const cx = padL + tickXi * cellW + cellW / 2;
          return (
            <g key={`x-${i}`}>
              <line x1={cx} y1={padT + gridH} x2={cx} y2={padT + gridH + 4} style={{ stroke: 'var(--text-muted)', strokeWidth: 1 }} />
              <text x={cx} y={padT + gridH + 14} textAnchor="middle" fontSize={10} style={{ fill: 'var(--text-muted)', fontFamily: 'inherit' }}>
                {mm}
              </text>
            </g>
          );
        })}
        <text x={padL + gridW / 2} y={svgH - 2} textAnchor="middle" fontSize={10} style={{ fill: 'var(--text-muted)', fontFamily: 'inherit' }}>X (mm)</text>

        {yTicks.map(({ i, mm }) => {
          const cy = padT + (heightMap.numY - 1 - i) * cellH + cellH / 2;
          return (
            <g key={`y-${i}`}>
              <line x1={padL - 4} y1={cy} x2={padL} y2={cy} style={{ stroke: 'var(--text-muted)', strokeWidth: 1 }} />
              <text x={padL - 7} y={cy + 4} textAnchor="end" fontSize={10} style={{ fill: 'var(--text-muted)', fontFamily: 'inherit' }}>
                {mm}
              </text>
            </g>
          );
        })}
        <text
          x={10}
          y={padT + gridH / 2}
          textAnchor="middle"
          fontSize={10}
          transform={`rotate(-90, 10, ${padT + gridH / 2})`}
          style={{ fill: 'var(--text-muted)', fontFamily: 'inherit' }}
        >Y (mm)</text>

        <rect x={padL} y={padT} width={gridW} height={gridH} fill="none" style={{ stroke: 'var(--border)', strokeWidth: 1 }} />
      </svg>

      {hoverInfo && (
        <div
          className="hm-2d-tooltip"
          style={{ position: 'absolute', left: hoverInfo.screenX + 14, top: hoverInfo.screenY - 36, pointerEvents: 'none', zIndex: 10 }}
        >
          <span className="hm-2d-tooltip__coord">X {hoverInfo.x.toFixed(0)} / Y {hoverInfo.y.toFixed(0)} mm</span>
          <span className="hm-2d-tooltip__val">{hoverInfo.value >= 0 ? '+' : ''}{hoverInfo.value.toFixed(4)} mm</span>
        </div>
      )}
    </div>
  );
}

/* ── Color scale legend ─────────────────────────────────────────────────────── */

export function ColorScaleLegend({ min, max, diverging = false }: { min: number; max: number; diverging?: boolean }) {
  const labels = Array.from({ length: 11 }, (_, i) => {
    const value = min + (i / 10) * (max - min);
    return { value, color: (diverging ? divergingColor : deviationColor)(value, min, max) };
  });

  return (
    <div className="heightmap-legend">
      <span className="legend-label">{min.toFixed(3)}</span>
      <div className="legend-bar">
        {labels.map((label, index) => (
          <div key={index} className="legend-segment" style={{ background: label.color, flex: 1 }} title={`${label.value.toFixed(3)} mm`} />
        ))}
      </div>
      <span className="legend-label">{max.toFixed(3)}</span>
      <span className="legend-unit">mm</span>
    </div>
  );
}

/* ── Bed quality helper (exported so parent can use it too) ─────────────────── */

// eslint-disable-next-line react-refresh/only-export-components
export function getBedQuality(rms: number): { label: string; color: string } {
  if (rms < 0.05) return { label: 'Excellent', color: '#22c55e' };
  if (rms < 0.1)  return { label: 'Good',      color: '#4ade80' };
  if (rms < 0.2)  return { label: 'Fair',      color: '#f59e0b' };
  return                   { label: 'Poor',      color: '#ef4444' };
}

/* ── Stats panel (kept for backwards compat; sidebar uses inline rows) ──────── */

export function StatsPanel({ stats }: { stats: HeightMapStats }) {
  const minColor = stats.min < 0 ? '#60a5fa' : '#34d399';
  const maxColor = stats.max > 0 ? '#f87171' : '#34d399';
  const rmsWarning = stats.rms > 0.2;
  const quality = getBedQuality(stats.rms);

  return (
    <div className="heightmap-stats">
      <div className="stat-row">
        <span className="stat-label">Min</span>
        <span className="stat-value" style={{ color: minColor }}>{stats.min.toFixed(4)}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Max</span>
        <span className="stat-value" style={{ color: maxColor }}>{stats.max.toFixed(4)}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Mean</span>
        <span className="stat-value">{stats.mean.toFixed(4)}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">RMS</span>
        <span className="stat-value" style={rmsWarning ? { color: '#f59e0b' } : undefined}>{stats.rms.toFixed(4)}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Points</span>
        <span className="stat-value">{stats.probePoints}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Grid</span>
        <span className="stat-value">{stats.gridDimensions}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Flatness</span>
        <span className="stat-value" style={{ color: quality.color, fontWeight: 800 }}>{quality.label}</span>
      </div>
    </div>
  );
}
