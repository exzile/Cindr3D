import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

import { Slicer } from '../engine/slicer/Slicer';
import { drainArachneStats } from '../engine/slicer/pipeline/arachne';
import {
  DEFAULT_MATERIAL_PROFILES,
  DEFAULT_PRINTER_PROFILES,
  DEFAULT_PRINT_PROFILES,
} from '../types/slicer';

const maybeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
const RUN_FIXTURE = maybeProcess?.env?.ARACHNE_FIXTURE === '1';
const describeFixture = RUN_FIXTURE ? describe : describe.skip;
const DISPLAY_LAYER_21_INDEX = 20;

async function loadFixtureGeometry(): Promise<THREE.BufferGeometry> {
  const nodePrefix = 'node';
  const fs = await import(/* @vite-ignore */ `${nodePrefix}:fs/promises`);
  const path = await import(/* @vite-ignore */ `${nodePrefix}:path`);
  const url = await import(/* @vite-ignore */ `${nodePrefix}:url`);
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(here, '../../gcodes/adjustable_support_foot_base_v2_vcdesign.stl');
  const bytes = await fs.readFile(fixturePath);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const geometry = new STLLoader().parse(arrayBuffer);
  geometry.computeVertexNormals();
  return geometry;
}

describeFixture('Arachne WASM adjustable_support_foot validation', () => {
  it('slices layer 21 with finite tapered wall moves', async () => {
    const printer = {
      ...DEFAULT_PRINTER_PROFILES.find((profile) => profile.id === 'marlin-generic')!,
      buildVolume: { x: 300, y: 300, z: 300 },
    };
    const material = DEFAULT_MATERIAL_PROFILES[0];
    const print = {
      ...DEFAULT_PRINT_PROFILES[0],
      adhesionType: 'none',
      wallGenerator: 'arachne',
      arachneBackend: 'wasm',
      parallelLayerPreparation: false,
    } as typeof DEFAULT_PRINT_PROFILES[number];
    const slicer = new Slicer(printer, material, print);
    const geometry = await loadFixtureGeometry();

    (globalThis as Record<string, unknown>).__arachneDebug = true;
    const started = performance.now();
    const result = await slicer.slice([{ geometry, transform: new THREE.Matrix4() }]);
    const elapsedMs = performance.now() - started;
    const stats = drainArachneStats();
    delete (globalThis as Record<string, unknown>).__arachneDebug;

    const layer21 = result.layers[DISPLAY_LAYER_21_INDEX];
    expect(layer21).toBeDefined();

    const wallMoves = layer21.moves.filter((move) => move.type === 'wall-outer' || move.type === 'wall-inner');
    expect(wallMoves.length).toBeGreaterThan(0);
    expect(wallMoves.every((move) =>
      Number.isFinite(move.from.x)
      && Number.isFinite(move.from.y)
      && Number.isFinite(move.to.x)
      && Number.isFinite(move.to.y)
      && Number.isFinite(move.lineWidth)
      && move.lineWidth > 0,
    )).toBe(true);

    const widths = wallMoves.map((move) => move.lineWidth);
    const minWidth = Math.min(...widths);
    const maxWidth = Math.max(...widths);
    const layer21Stats = stats.filter((entry) => entry.layerIndex === DISPLAY_LAYER_21_INDEX);
    const nearbyLayerWidthSpans = result.layers.slice(18, 25).map((layer) => {
      const layerWallMoves = layer.moves.filter((move) => move.type === 'wall-outer' || move.type === 'wall-inner');
      const layerWidths = layerWallMoves.map((move) => move.lineWidth);
      return {
        layerIndex: layer.layerIndex,
        wallMoves: layerWallMoves.length,
        widthSpan: layerWidths.length > 0 ? Math.max(...layerWidths) - Math.min(...layerWidths) : 0,
      };
    });
    console.info('ARACHNE fixture validation', {
      layerCount: result.layerCount,
      elapsedMs,
      avgLayerMs: elapsedMs / Math.max(1, result.layerCount),
      layer21WallMoves: wallMoves.length,
      layer21WidthSpan: maxWidth - minWidth,
      layer21Stats,
      nearbyLayerWidthSpans,
    });
    expect(layer21Stats.some((entry) => entry.backend === 'wasm' && entry.outcome === 'arachne')).toBe(true);
    expect(maxWidth - minWidth).toBeGreaterThan(0.01);
    expect(elapsedMs / Math.max(1, result.layerCount)).toBeLessThan(200);
  }, 120_000);
});
