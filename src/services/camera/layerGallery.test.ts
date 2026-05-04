import { describe, expect, it } from 'vitest';
import { layerGalleryFrameId, shouldCaptureLayer } from './layerGallery';

describe('layerGallery helpers', () => {
  it('builds stable frame ids from printer job layer and camera', () => {
    expect(layerGalleryFrameId('p1', '0:/gcodes/test cube.gcode', 12, 'top')).toBe('p1|0:/gcodes/test_cube.gcode|12|top');
  });

  it('captures only when the active print layer changes', () => {
    expect(shouldCaptureLayer(undefined, 1, 'processing')).toBe(true);
    expect(shouldCaptureLayer(1, 1, 'processing')).toBe(false);
    expect(shouldCaptureLayer(1, 2, 'idle')).toBe(false);
    expect(shouldCaptureLayer(1, undefined, 'processing')).toBe(false);
  });
});
