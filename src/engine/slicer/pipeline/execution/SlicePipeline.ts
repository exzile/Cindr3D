import * as THREE from 'three';
import type { SliceResult } from '../../../../types/slicer';
import type { ModifierMeshInput } from './steps/prepareSliceRun';
import { SlicePipelineBase } from './SlicePipelineBase';
import { runSlicePipeline } from './steps/runSlicePipeline';

export class SlicePipeline extends SlicePipelineBase {
  async slice(
    geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
    modifierMeshes: ModifierMeshInput[] = [],
  ): Promise<SliceResult> {
    return runSlicePipeline(this, geometries, modifierMeshes);
  }
}
