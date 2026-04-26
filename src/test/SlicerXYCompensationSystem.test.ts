import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Slicer } from '../engine/slicer/Slicer';
import {
  DEFAULT_MATERIAL_PROFILES,
  DEFAULT_PRINTER_PROFILES,
  DEFAULT_PRINT_PROFILES,
} from '../types/slicer';

/**
 * System-level test: slice a small box end-to-end and verify that the
 * XY compensation settings actually move the printed walls.
 *
 * This complements the unit tests in
 * `engine/slicer/pipeline/execution/steps/prepareLayerState.test.ts`
 * by exercising the full slicer pipeline (mesh → contours → walls →
 * G-code) with the new settings.
 */

function buildBoxGeometry(size: number): THREE.BufferGeometry {
  const half = size / 2;
  // Centered box; 12 triangles (2 per face × 6 faces).
  const v = (x: number, y: number, z: number) => [x, y, z];
  const positions: number[] = [];
  const push = (a: number[], b: number[], c: number[]) => {
    positions.push(...a, ...b, ...c);
  };

  const p000 = v(-half, -half, 0);
  const p100 = v(half, -half, 0);
  const p110 = v(half, half, 0);
  const p010 = v(-half, half, 0);
  const p001 = v(-half, -half, size);
  const p101 = v(half, -half, size);
  const p111 = v(half, half, size);
  const p011 = v(-half, half, size);

  // Bottom face (z=0): outward normal -z, CW when viewed from below.
  push(p000, p110, p100); push(p000, p010, p110);
  // Top face (z=size): outward normal +z.
  push(p001, p101, p111); push(p001, p111, p011);
  // Front (y=-half).
  push(p000, p100, p101); push(p000, p101, p001);
  // Back (y=+half).
  push(p010, p011, p111); push(p010, p111, p110);
  // Left (x=-half).
  push(p000, p001, p011); push(p000, p011, p010);
  // Right (x=+half).
  push(p100, p110, p111); push(p100, p111, p101);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

function buildPrinterAndMaterial() {
  return {
    printer: {
      ...DEFAULT_PRINTER_PROFILES.find((p) => p.id === 'marlin-generic')!,
      buildVolume: { x: 200, y: 200, z: 200 },
    },
    material: DEFAULT_MATERIAL_PROFILES[0],
  };
}

function basePrint() {
  return {
    ...DEFAULT_PRINT_PROFILES[0],
    adhesionType: 'none' as const,
    parallelLayerPreparation: false,
    // Use classic walls for these tests so the contour bbox math is
    // independent of libArachne's bead distribution noise.
    wallGenerator: 'classic' as const,
    wallCount: 1,
    wallLineWidth: 0.4,
    layerHeight: 0.2,
    horizontalExpansion: 0,
    initialLayerHorizontalExpansion: 0,
    elephantFootCompensation: 0,
  };
}

function bboxFromMoves(moves: { from: { x: number; y: number }; to: { x: number; y: number } }[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const move of moves) {
    minX = Math.min(minX, move.from.x, move.to.x);
    maxX = Math.max(maxX, move.from.x, move.to.x);
    minY = Math.min(minY, move.from.y, move.to.y);
    maxY = Math.max(maxY, move.from.y, move.to.y);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

async function sliceBox(
  size: number,
  printOverrides: Partial<ReturnType<typeof basePrint>>,
) {
  const { printer, material } = buildPrinterAndMaterial();
  const print = { ...basePrint(), ...printOverrides };
  const slicer = new Slicer(printer, material, print);
  const geometry = buildBoxGeometry(size);
  return slicer.slice([{ geometry, transform: new THREE.Matrix4() }]);
}

describe('Slicer end-to-end — XY compensation', () => {
  it('slices a 10mm box without compensation as a baseline', async () => {
    const result = await sliceBox(10, {});
    expect(result.layerCount).toBeGreaterThan(40);
    expect(result.layers.length).toBeGreaterThan(0);
    const layer5Walls = result.layers[5].moves.filter((m) =>
      m.type === 'wall-outer' || m.type === 'wall-inner',
    );
    expect(layer5Walls.length).toBeGreaterThan(0);
  }, 60_000);

  it('applies horizontalExpansion to outer walls (positive grows the printed footprint)', async () => {
    const baseline = await sliceBox(10, {});
    const expanded = await sliceBox(10, { horizontalExpansion: 0.3 });

    // Compare layer 5 (well above first-layer) outer wall extents.
    const layerIndex = 5;
    const baseWalls = baseline.layers[layerIndex].moves.filter((m) => m.type === 'wall-outer');
    const expWalls = expanded.layers[layerIndex].moves.filter((m) => m.type === 'wall-outer');
    expect(baseWalls.length).toBeGreaterThan(0);
    expect(expWalls.length).toBeGreaterThan(0);

    const baseBox = bboxFromMoves(baseWalls);
    const expBox = bboxFromMoves(expWalls);
    // 0.3mm expansion → outer box grows by 0.6mm in width/height.
    // Allow generous tolerance (offset rounding, simplification, etc.)
    expect(expBox.width - baseBox.width).toBeGreaterThan(0.4);
    expect(expBox.width - baseBox.width).toBeLessThan(0.8);
  }, 60_000);

  it('shrinks first-layer outer when elephantFootCompensation > 0', async () => {
    const expanded = await sliceBox(10, { horizontalExpansion: 0.3 });
    const elephant = await sliceBox(10, {
      horizontalExpansion: 0.3,
      elephantFootCompensation: 0.2,
    });

    // Layer 0 (zero-based first layer) should be SMALLER with elephant
    // foot compensation than the equivalent expansion-only slice.
    const refWalls = expanded.layers[0].moves.filter((m) => m.type === 'wall-outer');
    const efWalls = elephant.layers[0].moves.filter((m) => m.type === 'wall-outer');
    expect(refWalls.length).toBeGreaterThan(0);
    expect(efWalls.length).toBeGreaterThan(0);

    const refBox = bboxFromMoves(refWalls);
    const efBox = bboxFromMoves(efWalls);
    // 0.2mm elephant foot → first layer outer shrinks by 0.4mm
    expect(refBox.width - efBox.width).toBeGreaterThan(0.25);

    // Layer 5 (above first layer) should be IDENTICAL — elephant foot
    // is layer-0-only.
    const refMid = bboxFromMoves(expanded.layers[5].moves.filter((m) => m.type === 'wall-outer'));
    const efMid = bboxFromMoves(elephant.layers[5].moves.filter((m) => m.type === 'wall-outer'));
    expect(Math.abs(refMid.width - efMid.width)).toBeLessThan(0.05);
  }, 60_000);

  it('initialLayerHorizontalExpansion overrides horizontalExpansion on layer 0 only', async () => {
    const baseline = await sliceBox(10, { horizontalExpansion: 0.1 });
    const overridden = await sliceBox(10, {
      horizontalExpansion: 0.1,
      initialLayerHorizontalExpansion: 0.5,
    });

    const baseLayer0 = bboxFromMoves(baseline.layers[0].moves.filter((m) => m.type === 'wall-outer'));
    const ovrLayer0 = bboxFromMoves(overridden.layers[0].moves.filter((m) => m.type === 'wall-outer'));
    // Layer 0: baseline +0.2mm, overridden +1.0mm → diff ~0.8mm
    expect(ovrLayer0.width - baseLayer0.width).toBeGreaterThan(0.5);

    // Layer 5: both should match (override is layer-0 only)
    const baseLayer5 = bboxFromMoves(baseline.layers[5].moves.filter((m) => m.type === 'wall-outer'));
    const ovrLayer5 = bboxFromMoves(overridden.layers[5].moves.filter((m) => m.type === 'wall-outer'));
    expect(Math.abs(ovrLayer5.width - baseLayer5.width)).toBeLessThan(0.05);
  }, 60_000);
});
