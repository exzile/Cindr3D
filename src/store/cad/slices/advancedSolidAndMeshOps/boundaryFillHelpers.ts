import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { performOccBooleanWithInstance } from '../../../../engine/occ/ops/booleanCore';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { getOccSync } from '../../../../engine/occ/loader';
import { tessellateWithInstance, tessellationToGeometry } from '../../../../engine/occ/tessellate';
import type { BRepBody } from '../../../../engine/occ/brepBody';
import { errorMessage } from '../../../../utils/errorHandling';
import { pickMostRecentSolidTarget } from '../featureManagement/bodyBoolean';

export function pickBoundaryFillTarget(features: Feature[], excludeIds: Set<string>): Feature | undefined {
  return pickMostRecentSolidTarget(features, { excludeIds, excludeFeatureKind: 'boundary-fill' });
}

export async function computeBoundaryFillGeometry(
  toolFeatures: Feature[],
): Promise<{ geometry: THREE.BufferGeometry; brepBodyId?: string; note: string }> {
  const meshes = toolFeatures
    .map((f) => f.mesh)
    .filter((m): m is THREE.Mesh => m instanceof THREE.Mesh);

  const baked = meshes.map((m) => GeometryEngine.bakeMeshWorldGeometry(m));
  const disposeBaked = () => baked.forEach((g) => g.dispose());

  const openSurfaceMeshes = toolFeatures
    .filter((f) => f.bodyKind === 'surface' && f.mesh instanceof THREE.Mesh)
    .map((f) => f.mesh as THREE.Mesh);

  const fail = (reason: string): never => {
    disposeBaked();
    throw new Error(reason);
  };

  try {
    if (baked.length >= 2) {
      const occ = getOccSync();
      const bodyIds = toolFeatures.map(
        (f) => (f.mesh instanceof THREE.Mesh ? f.mesh.userData['brepBodyId'] as string | undefined : undefined),
      );
      if (occ && bodyIds.every(Boolean)) {
        const bodies = bodyIds.map((id) => globalBRepBodyRegistry.get(id!));
        if (bodies.every(Boolean)) {
          let acc = bodies[0]!;
          const intermediateBodies: BRepBody[] = [];
          for (let i = 1; i < bodies.length; i++) {
            const result = performOccBooleanWithInstance(occ.oc, 'intersect', acc, bodies[i]!);
            if (!result) {
              for (const body of intermediateBodies) body.dispose();
              return fail('selected bodies do not enclose a common region');
            }
            if (intermediateBodies.includes(acc)) {
              acc.dispose();
              intermediateBodies.splice(intermediateBodies.indexOf(acc), 1);
            }
            intermediateBodies.push(result);
            acc = result;
          }
          try {
            const tess = tessellateWithInstance(occ.oc, acc);
            if (!tess || tess.positions.length === 0) {
              for (const body of intermediateBodies) body.dispose();
              return fail('selected bodies do not enclose a common region');
            }
            const geometry = tessellationToGeometry(tess);
            globalBRepBodyRegistry.add(acc);
            disposeBaked();
            return { geometry, brepBodyId: acc.id, note: '' };
          } catch {
            for (const body of intermediateBodies) body.dispose();
            return fail('selected bodies do not enclose a common region');
          }
        }
      }
      return fail('selected bodies require OCC representation for boundary fill');
    }

    if (openSurfaceMeshes.length > 0) {
      const stitched = GeometryEngine.stitchSurfaces(openSurfaceMeshes);
      if (stitched.isSolid) {
        disposeBaked();
        return { geometry: stitched.geometry, note: '' };
      }
      stitched.geometry.dispose();
      return fail('selected surface(s) could not be stitched closed');
    }

    if (baked.length === 1) {
      const singleBodyId = meshes[0]?.userData['brepBodyId'] as string | undefined;
      return { geometry: baked[0], brepBodyId: singleBodyId, note: '' };
    }

    return fail('no usable tool geometry');
  } catch (err) {
    return fail(`fill failed: ${errorMessage(err, 'OCC error')}`);
  }
}
