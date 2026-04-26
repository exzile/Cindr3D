import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { PrintProfile } from '../../../../types/slicer';
import { generateArachnePathsWasm, loadArachneModule } from './arachneWasm';

const v = (x: number, y: number) => new THREE.Vector2(x, y);

describe('arachneWasm', () => {
  it('loads and emits flat variable-width paths for a simple square', async () => {
    await loadArachneModule();
    const paths = await generateArachnePathsWasm(
      [v(0, 0), v(20, 0), v(20, 20), v(0, 20)],
      [],
      3,
      0.42,
      0,
      {
        minWallLineWidth: 0.2,
        thinWallDetection: true,
      } as PrintProfile,
    );

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.points.length === path.widths.length)).toBe(true);
    expect(paths.flatMap((path) => path.widths).every((width) => Number.isFinite(width) && width > 0)).toBe(true);
  });
});
