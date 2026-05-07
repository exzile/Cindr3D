/**
 * Generates binary STL geometry for all 9 calibration model types.
 * Run with: npx tsx scripts/generateCalibrationStls.ts
 *
 * Shapes are canonical approximations of community-standard calibration prints:
 *   firmware-health    — 20×20×20mm reference cube
 *   first-layer        — 60×60×0.3mm flat adhesion patch
 *   flow-rate          — 20×20×20mm single-wall hollow cube
 *   temperature-tower  — 30×15×60mm banded tower
 *   retraction         — twin 5×5×60mm pillars, 25mm gap
 *   pressure-advance   — 50×50×40mm hollow square tube (5mm walls)
 *   input-shaper       — 35×35×100mm flat-walled ringing tower
 *   dimensional-accuracy — 20×20×20mm calibration cube
 *   max-volumetric-speed — 30×30×50mm speed tower
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'assets', 'calibration-models');

type Vec3 = [number, number, number];
type Tri = [Vec3, Vec3, Vec3];

// ---------------------------------------------------------------------------
// Binary STL writer
// ---------------------------------------------------------------------------

function writeBinaryStl(tris: Tri[], header: string, filename: string): void {
  const buf = Buffer.alloc(80 + 4 + tris.length * 50);
  buf.write(header.slice(0, 80).padEnd(80, '\0'), 0, 'ascii');
  buf.writeUInt32LE(tris.length, 80);
  let off = 84;
  for (const [v1, v2, v3] of tris) {
    // Normal via right-hand rule from vertex order
    const ax = v2[0] - v1[0], ay = v2[1] - v1[1], az = v2[2] - v1[2];
    const bx = v3[0] - v1[0], by = v3[1] - v1[1], bz = v3[2] - v1[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    buf.writeFloatLE(nx / len, off); off += 4;
    buf.writeFloatLE(ny / len, off); off += 4;
    buf.writeFloatLE(nz / len, off); off += 4;
    for (const v of [v1, v2, v3]) {
      buf.writeFloatLE(v[0], off); off += 4;
      buf.writeFloatLE(v[1], off); off += 4;
      buf.writeFloatLE(v[2], off); off += 4;
    }
    buf.writeUInt16LE(0, off); off += 2;
  }
  const path = join(ASSETS_DIR, filename);
  writeFileSync(path, buf);
  console.log(`  ${filename.padEnd(32)} ${tris.length} triangles  ${buf.length} bytes`);
}

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

/** Solid axis-aligned box from (x0,y0,z0) to (x1,y1,z1). 12 triangles. */
function solidBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Tri[] {
  return [
    // Bottom (−Z)
    [[x0,y1,z0],[x1,y1,z0],[x1,y0,z0]],
    [[x0,y1,z0],[x1,y0,z0],[x0,y0,z0]],
    // Top (+Z)
    [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1]],
    [[x0,y0,z1],[x1,y1,z1],[x0,y1,z1]],
    // Front (−Y)
    [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1]],
    [[x0,y0,z0],[x1,y0,z1],[x0,y0,z1]],
    // Back (+Y)
    [[x1,y1,z0],[x0,y1,z0],[x0,y1,z1]],
    [[x1,y1,z0],[x0,y1,z1],[x1,y1,z1]],
    // Left (−X)
    [[x0,y1,z0],[x0,y0,z0],[x0,y0,z1]],
    [[x0,y1,z0],[x0,y0,z1],[x0,y1,z1]],
    // Right (+X)
    [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]],
    [[x1,y0,z0],[x1,y1,z1],[x1,y0,z1]],
  ];
}

/**
 * Hollow square tube: outer box from (0,0,0) to (dim,dim,h),
 * wall thickness w, open top, closed bottom ring.
 */
function hollowTube(dim: number, h: number, w: number): Tri[] {
  const tris: Tri[] = [];
  const o = dim, i0 = w, i1 = dim - w;
  // Outer 4 sides (no top or bottom on outer face — bottom handled by ring)
  // Front outer (y=0, from x0..x1)
  tris.push(...solidBox(0, 0, 0, o, w, h));   // front wall
  tris.push(...solidBox(0, o - w, 0, o, o, h)); // back wall
  tris.push(...solidBox(0, w, 0, w, o - w, h)); // left wall
  tris.push(...solidBox(o - w, w, 0, o, o - w, h)); // right wall
  return tris;
}

// ---------------------------------------------------------------------------
// Per-model shape definitions
// ---------------------------------------------------------------------------

const models: Array<{ filename: string; header: string; tris: () => Tri[] }> = [
  {
    filename: 'firmware-health.stl',
    header: 'Cindr3D firmware-health reference cube 20x20x20mm',
    tris: () => solidBox(0, 0, 0, 20, 20, 20),
  },
  {
    filename: 'first-layer.stl',
    header: 'Cindr3D first-layer adhesion patch 60x60x0.3mm',
    tris: () => solidBox(0, 0, 0, 60, 60, 0.3),
  },
  {
    filename: 'flow-rate.stl',
    header: 'Cindr3D flow-rate single-wall cube 20x20x20mm',
    // Single-wall hollow cube: outer 20mm, walls 0.8mm (2× 0.4mm nozzle), open top
    tris: () => hollowTube(20, 20, 0.8),
  },
  {
    filename: 'temperature-tower.stl',
    header: 'Cindr3D temperature-tower 30x15x60mm (6 bands x 10mm)',
    // Tower body with stepped ledge every 10mm on the front face to mark bands
    tris: () => {
      const tris: Tri[] = [];
      // Main tower body
      tris.push(...solidBox(0, 0, 0, 30, 15, 60));
      // Ledge notches at every 10mm band (2mm wide, 1mm deep on +X face)
      for (let band = 1; band <= 5; band++) {
        const z = band * 10;
        tris.push(...solidBox(28, 0, z - 0.5, 30.5, 15, z + 0.5));
      }
      return tris;
    },
  },
  {
    filename: 'retraction.stl',
    header: 'Cindr3D retraction twin-pillar 5x5x60mm gap 25mm',
    tris: () => [
      ...solidBox(0, 0, 0, 5, 5, 60),   // pillar A
      ...solidBox(30, 0, 0, 35, 5, 60), // pillar B (25mm gap)
    ],
  },
  {
    filename: 'pressure-advance.stl',
    header: 'Cindr3D pressure-advance hollow square tube 50x50x40mm wall 5mm',
    tris: () => hollowTube(50, 40, 5),
  },
  {
    filename: 'input-shaper.stl',
    header: 'Cindr3D input-shaper ringing tower 35x35x100mm',
    // Flat-walled solid tower; ringing is visible on the vertical faces at high accel
    tris: () => solidBox(0, 0, 0, 35, 35, 100),
  },
  {
    filename: 'dimensional-accuracy.stl',
    header: 'Cindr3D dimensional-accuracy XYZ cube 20x20x20mm',
    tris: () => solidBox(0, 0, 0, 20, 20, 20),
  },
  {
    filename: 'max-volumetric-speed.stl',
    header: 'Cindr3D max-volumetric-speed tower 30x30x50mm',
    // Single-wall tower; actual speed is varied per height band in G-code
    tris: () => hollowTube(30, 50, 1.2),
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`Writing calibration STL models to ${ASSETS_DIR}\n`);
for (const model of models) {
  writeBinaryStl(model.tris(), model.header, model.filename);
}
console.log(`\nDone — ${models.length} files written.`);
