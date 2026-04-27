import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { loadArachneModule } from '../../arachne';
import { SlicePipelineGeometry } from './SlicePipelineGeometry';
import type { PrintProfile } from '../../../../../types/slicer';

const v = (x: number, y: number) => new THREE.Vector2(x, y);

class TestGeometryPipeline extends SlicePipelineGeometry {
  public constructor(printProfile: PrintProfile) {
    super();
    this.printProfile = printProfile;
  }

  public override multiPolygonToRegions() {
    return [];
  }
}

describe('SlicePipelineGeometry perimeter cache', () => {
  beforeAll(async () => {
    await loadArachneModule();
  });

  it('reuses identical Arachne perimeter generation within a slice pipeline instance', () => {
    const pipeline = new TestGeometryPipeline({
      wallGenerator: 'arachne',
      wallLineWidth: 0.42,
      minWallLineWidth: 0.2,
      thinWallDetection: true,
      arachneBackend: 'wasm',
    } as PrintProfile);
    const contour = [v(0, 0), v(20, 0), v(20, 20), v(0, 20)];

    const first = pipeline.generatePerimeters(contour, [], 3, 0.42, 0, {
      sectionType: 'wall',
      isTopOrBottomLayer: false,
    });
    const second = pipeline.generatePerimeters(contour.map((point) => point.clone()), [], 3, 0.42, 0, {
      sectionType: 'wall',
      isTopOrBottomLayer: false,
    });

    expect(second).toBe(first);
  });

  it('keeps top/bottom wall context separate from normal wall context', () => {
    const pipeline = new TestGeometryPipeline({
      wallGenerator: 'arachne',
      wallLineWidth: 0.42,
      minWallLineWidth: 0.2,
      thinWallDetection: true,
      arachneBackend: 'wasm',
    } as PrintProfile);
    const contour = [v(0, 0), v(20, 0), v(20, 20), v(0, 20)];

    const normal = pipeline.generatePerimeters(contour, [], 3, 0.42, 0, {
      sectionType: 'wall',
      isTopOrBottomLayer: false,
    });
    const solid = pipeline.generatePerimeters(contour, [], 3, 0.42, 0, {
      sectionType: 'wall',
      isTopOrBottomLayer: true,
    });

    expect(solid).not.toBe(normal);
  });
});
