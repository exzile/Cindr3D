import {
  BuildPlateGrid,
  BuildVolumeWireframe,
} from '../slicer/workspace/canvas/scenePrimitives';

interface BuildVolume {
  x: number;
  y: number;
  z: number;
}

/**
 * BuildVolumeScene — renders the build plate grid and volume wireframe together.
 * These two always appear as a pair in print-space canvases.
 */
export function BuildVolumeScene({ bv }: { bv: BuildVolume }) {
  return (
    <>
      <BuildPlateGrid sizeX={bv.x} sizeY={bv.y} />
      <BuildVolumeWireframe x={bv.x} y={bv.y} z={bv.z} />
    </>
  );
}
