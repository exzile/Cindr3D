/**
 * PrintSpaceLights — standard lighting rig for Z-up print-space canvases.
 *
 * Consistent across the Prepare, MeshPreview, HeightMap, and Calibration
 * wizard canvases. Centralising here prevents the configs drifting apart
 * (e.g. StepSlicePreview was missing directional lights entirely).
 */
export function PrintSpaceLights() {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[40, -60, 80]} intensity={0.85} />
      <directionalLight position={[-40, 40, 20]} intensity={0.3} />
    </>
  );
}
