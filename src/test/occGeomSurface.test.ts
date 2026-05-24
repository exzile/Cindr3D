import { describe, expect, it } from 'vitest';
import { createBRepBody } from '../engine/occ/brepBody';
import { sketchPlaneFromFace, sketchPlaneFromRawFace } from '../engine/occ/geomSurface';
import { OccHandle } from '../engine/occ/occHandle';
import type { OcctRaw } from '../engine/occ/types';

function makeOcctSurfaceStub({
  surfaceIsNull,
  planeIsNull,
  wrappedFace,
}: {
  surfaceIsNull: boolean;
  planeIsNull: boolean;
  wrappedFace?: { delete(): void };
}): { oc: OcctRaw; get locationDeletes(): number } {
  let locationDeletes = 0;

  class TopLocLocation {
    IsIdentity() { return true; }
    delete() { locationDeletes += 1; }
  }

  const oc = {
    TopoDS_Face: function TopoDSFace() {},
    wrapPointer: () => wrappedFace ?? ({ delete() {} }),
    TopLoc_Location_1: TopLocLocation,
    BRep_Tool: {
      Surface_2: () => ({
        IsNull: () => surfaceIsNull,
      }),
    },
    Handle_Geom_Plane: {
      DownCast: () => ({
        IsNull: () => planeIsNull,
      }),
    },
  };

  return {
    oc,
    get locationDeletes() {
      return locationDeletes;
    },
  };
}

describe('OCC geom surface helpers', () => {
  it('releases TopLoc_Location when the raw face has no surface', () => {
    const stub = makeOcctSurfaceStub({ surfaceIsNull: true, planeIsNull: true });

    expect(sketchPlaneFromRawFace(stub.oc, {})).toBeNull();
    expect(stub.locationDeletes).toBe(1);
  });

  it('releases TopLoc_Location when the surface is not planar', () => {
    const stub = makeOcctSurfaceStub({ surfaceIsNull: false, planeIsNull: true });

    expect(sketchPlaneFromRawFace(stub.oc, {})).toBeNull();
    expect(stub.locationDeletes).toBe(1);
  });

  it('deletes the wrapped raw face after extracting by face id', () => {
    let rawFaceDeletes = 0;
    const stub = makeOcctSurfaceStub({
      surfaceIsNull: true,
      planeIsNull: true,
      wrappedFace: {
        delete() {
          rawFaceDeletes += 1;
        },
      },
    });
    const body = createBRepBody({
      shape: new OccHandle(1, 'shape', () => {}),
      faceIds: new Map([[7, new OccHandle(7, 'face', () => {})]]),
    });

    expect(sketchPlaneFromFace(stub.oc, body, 7)).toBeNull();
    expect(rawFaceDeletes).toBe(1);

    body.dispose();
  });
});
