// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { BRepBody } from '../brepBody';

export interface OccBodyProperties {
  volume: number;          // mm³
  surfaceArea: number;     // mm²
  centreOfMass: [number, number, number]; // mm
}

/**
 * Compute volumetric + surface-area properties for a BRepBody using
 * BRepGProp (OpenCASCADE mass-property engine).
 *
 * Returns null if OCC is unavailable or the shape is invalid/open.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function occComputeBodyProperties(oc: any, body: BRepBody): OccBodyProperties | null {
  const shape = body.shape?.deref?.();
  if (!shape) return null;

  let volProps: any = null;
  let surfProps: any = null;

  try {
    volProps  = new oc.GProp_GProps_1();
    surfProps = new oc.GProp_GProps_1();

    // VolumeProperties(shape, props, tol, onlyClosed, useSpan)
    oc.BRepGProp.VolumeProperties(shape, volProps, 1e-4, false, false);
    // SurfaceProperties_1(shape, props, tol, skipShared)
    oc.BRepGProp.SurfaceProperties_1(shape, surfProps, 1e-4, false);

    const volume      = volProps.Mass() as number;
    const surfaceArea = surfProps.Mass() as number;
    const com         = volProps.CentreOfMass();
    const centreOfMass: [number, number, number] = [com.X(), com.Y(), com.Z()];
    com.delete?.();

    return {
      volume:      Math.max(0, volume),
      surfaceArea: Math.max(0, surfaceArea),
      centreOfMass,
    };
  } catch {
    return null;
  } finally {
    volProps?.delete?.();
    surfProps?.delete?.();
  }
}
