import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { BedBounds, ConfiguredProbeGrid } from './types';

/**
 * Safety margin overlay.
 *
 * When the physical bed (bedBounds, from M208 axis limits) is larger than the
 * configured probe grid (configuredGrid, from M557) we render:
 *   1. Red semi-transparent fill on the 4 margin strips.
 *   2. A blue dashed-style outline rectangle marking the probe area boundary.
 *
 * Coordinate convention (same as FlatPlate / HeightMapMesh):
 *   scene_x =  bedX * scaleXY - 0.5
 *   scene_z = -(bedY * scaleXY - 0.5)   (Y axis negated — larger bedY = more-negative Z)
 */
export function SafetyZones({
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

    // ── Red fill geometry (triangulated quads) ──────────────────────────
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

    // ── Blue probe-area border (line rectangle) ─────────────────────────
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
