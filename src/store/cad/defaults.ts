import * as THREE from 'three';

import type { SketchPlane } from '../../types/cad';
import type { ExtrudeDirection, ExtrudeOperation } from '../../types/cad-extrude.types';

// Plane normals consistent with the visual selector (Three.js Y-up):
//   XY = horizontal ground plane  -> normal points UP    = (0, 1, 0)
//   XZ = vertical front plane     -> normal points FWD   = (0, 0, 1)
//   YZ = vertical side plane      -> normal points RIGHT = (1, 0, 0)
export function getPlaneNormal(plane: SketchPlane): THREE.Vector3 {
  switch (plane) {
    case 'XY': return new THREE.Vector3(0, 1, 0);
    case 'XZ': return new THREE.Vector3(0, 0, 1);
    case 'YZ': return new THREE.Vector3(1, 0, 0);
    default: return new THREE.Vector3(0, 1, 0);
  }
}

// Default values shared between startExtrudeTool and resetExtrudeState.
export const EXTRUDE_DEFAULTS = {
  extrudeSelectedSketchId: null,
  extrudeSelectedSketchIds: [] as string[],
  extrudeDistance: 10,
  extrudeDistance2: 10,
  extrudeDirection: 'positive' as ExtrudeDirection,
  extrudeOperation: 'new-body' as ExtrudeOperation,
  extrudeThinEnabled: false,
  extrudeThinThickness: 2,
  extrudeThinSide: 'side1' as 'side1' | 'side2' | 'center',
  extrudeThinSide2: 'side1' as 'side1' | 'side2' | 'center',
  extrudeThinThickness2: 2,
  extrudeStartType: 'profile' as 'profile' | 'offset' | 'entity',
  extrudeStartOffset: 0,
  extrudeStartEntityId: null as string | null,
  extrudeStartFaceNormal: null as [number, number, number] | null,
  extrudeStartFaceCentroid: null as [number, number, number] | null,
  extrudeExtentType: 'distance' as 'distance' | 'all' | 'to-object',
  extrudeExtentType2: 'distance' as 'distance' | 'all' | 'to-object',
  extrudeToEntityFaceId: null as string | null,
  extrudeToEntityFaceNormal: null as [number, number, number] | null,
  extrudeToEntityFaceCentroid: null as [number, number, number] | null,
  extrudeToObjectFlipDirection: false,
  extrudeTaperAngle: 0,
  extrudeTaperAngle2: 0,
  extrudeSymmetricFullLength: false,
  extrudeBodyKind: 'solid' as 'solid' | 'surface',
  extrudeParticipantBodyIds: [] as string[],
  extrudeConfinedFaceIds: [] as string[],
  extrudeCreationOccurrence: null as string | null,
  extrudeTargetBaseFeature: null as string | null,
};

export const REVOLVE_DEFAULTS = {
  revolveSelectedSketchId: null as string | null,
  revolveAxis: 'Y' as 'X' | 'Y' | 'Z' | 'centerline',
  revolveAngle: 360,
  revolveDirection: 'one-side' as 'one-side' | 'symmetric' | 'two-sides',
  revolveAngle2: 360,
  revolveBodyKind: 'solid' as 'solid' | 'surface',
  revolveOperation: 'new-body' as 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component',
  revolveIsProjectAxis: false as boolean,
  revolveProfileMode: 'sketch' as 'sketch' | 'face',
  revolveFaceBoundary: null as number[] | null,
  revolveFaceNormal: null as [number, number, number] | null,
};
