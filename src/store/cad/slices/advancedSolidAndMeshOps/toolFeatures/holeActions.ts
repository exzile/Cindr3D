/**
 * OCC-15.1 — Hole real cut
 *
 * Builds an OCC BRep tool body for a hole (cylinder + optional drill-point cone /
 * counterbore / countersink), subtracts it from the nearest solid target body,
 * stores the result mesh on the hole feature, and suppresses the source feature
 * (combine-style, so the original solid is not double-rendered).
 *
 * Disposal rules:
 *  - OCC builder objects (MakeCylinder_1, MakeCone_1) are OWNED → must .delete()
 *  - occCylinderShapeWithInstance / buildOccConeShape return shapes whose resources
 *    are transferred to makeBRepBodyFromOccShape via ownedResources — do NOT call
 *    cylinder.dispose() after passing ownedResources to makeBRepBodyFromOccShape.
 *  - transformOccShape deletes the original shape and returns a new one; the new
 *    shape is wrapped by the BRepBody handle and must NOT be independently .delete()-ed.
 */
import * as THREE from 'three';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { getOccSync } from '../../../../../engine/occ/loader';
import { makeBRepBodyFromOccShape, type BRepBody } from '../../../../../engine/occ/brepBody';
import { occCylinderShapeWithInstance } from '../../../../../engine/occ/ops/cylinder';
import { performOccBooleanWithInstance } from '../../../../../engine/occ/ops/booleanCore';
import { createRegisteredOccMesh } from '../../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../../components/viewport/scene/bodyMaterial';
import { disposeMeshDeferred } from '../../../../../engine/occ/picking';
import { resolveLatestOccSolidTarget } from '../../extrudeRevolve/extrudeCommitOccTarget';
import { errorMessage } from '../../../../../utils/errorHandling';
import { buildDrillTransform, buildOccConeShape, unionPiece } from './holeOccGeometry';
import type { Feature } from '../../../../../types/cad/feature';

/** Extend all tool shapes by this amount above the face and below nominal depth. */
const EPSILON = 0.1; // mm

interface HoleCommitParams {
  diameter: number;
  depth: number;
  drillAngle: number;
  termination: string;
  holeType: string;
  drillPoint: string;
  faceId: string | null;
  faceNormal: [number, number, number] | null;
  faceCentroid: [number, number, number] | null;
  cbDiameter: number;
  cbDepth: number;
  csAngle: number;
  csDiameter: number;
}

function readHoleCommitParams(rawParams: Record<string, unknown>): HoleCommitParams {
  return {
    diameter: Number(rawParams.diameter) || 0,
    depth: Number(rawParams.depth) || 0,
    drillAngle: Number(rawParams.drillAngle) || 118,
    termination: (rawParams.termination as string | undefined) ?? 'blind',
    holeType: (rawParams.holeType as string | undefined) ?? 'simple',
    drillPoint: (rawParams.drillPoint as string | undefined) ?? 'angled',
    faceId: (rawParams.faceId as string | null) ?? null,
    faceNormal: rawParams.faceNormal as [number, number, number] | null,
    faceCentroid: rawParams.faceCentroid as [number, number, number] | null,
    cbDiameter: Number(rawParams.cbDiameter) || 0,
    cbDepth: Number(rawParams.cbDepth) || 0,
    csAngle: Number(rawParams.csAngle) || 90,
    csDiameter: Number(rawParams.csDiameter) || 0,
  };
}

function resolveHoleTargetBody(
  features: Feature[],
  featureId: string,
  holeFeature: Feature,
  faceId: string | null,
): { targetBody?: BRepBody; targetFeatureId?: string } {
  const prevTargetId = holeFeature.params.targetFeatureId as string | undefined;
  let targetBody: BRepBody | undefined;
  let targetFeatureId: string | undefined;

  if (prevTargetId) {
    const prevTarget = features.find((f) => f.id === prevTargetId);
    if (prevTarget?.mesh instanceof THREE.Mesh) {
      const bodyId = prevTarget.mesh.userData['brepBodyId'] as string | undefined;
      if (bodyId) targetBody = globalBRepBodyRegistry.get(bodyId);
    }
    targetFeatureId = prevTargetId;
  }

  if (!targetBody && faceId) {
    const colonPos = faceId.indexOf(':', 4);
    const bodyId = colonPos > 0 ? faceId.slice(4, colonPos) : null;
    if (bodyId) {
      const candidate = globalBRepBodyRegistry.get(bodyId);
      if (candidate) {
        targetBody = candidate;
        const ownerFeature = features.find(
          (f) =>
            f.mesh instanceof THREE.Mesh &&
            f.mesh.userData['brepBodyId'] === bodyId,
        );
        targetFeatureId = ownerFeature?.id;
      }
    }
  }

  if (!targetBody) {
    const resolved = resolveLatestOccSolidTarget(
      features.filter((f) => f.id !== featureId),
    );
    targetBody = resolved.body;
    targetFeatureId = resolved.feature?.id;
  }

  return { targetBody, targetFeatureId };
}

export function createHoleActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    commitHole(featureId, rawParams) {
      const occ = getOccSync();
      if (!occ) {
        set({ statusMessage: 'Hole: OCC kernel still loading — try again in a moment' });
        return;
      }

      const features = get().features;
      const holeFeature = features.find((f) => f.id === featureId);
      if (!holeFeature) {
        set({ statusMessage: 'Hole: feature not found' });
        return;
      }

      // ── Extract geometry params from rawParams (dialog values) ──────────────
      const {
        diameter,
        depth,
        drillAngle,
        termination,
        holeType,
        drillPoint,
        faceId,
        faceNormal,
        faceCentroid,
        cbDiameter,
        cbDepth,
        csAngle,
        csDiameter,
      } = readHoleCommitParams(rawParams);

      if (!faceNormal || !faceCentroid) {
        set((state) => ({
          features: state.features.map((f) =>
            f.id === featureId
              ? { ...f, healthState: 'error' as const, healthMessage: 'No face selected — pick a face first' }
              : f,
          ),
          statusMessage: 'Hole: no face selected',
        }));
        return;
      }

      const normalVec = new THREE.Vector3(...faceNormal);
      if (normalVec.length() < 0.001) {
        set({ statusMessage: 'Hole: face normal is zero-length' });
        return;
      }
      normalVec.normalize();

      if (diameter < 0.1 || (termination !== 'through-all' && depth < 0.1)) {
        set({ statusMessage: 'Hole: diameter and depth must be > 0.1 mm' });
        return;
      }

      // ── Resolve target body ─────────────────────────────────────────────────
      const { targetBody, targetFeatureId: resolvedTargetFeatureId } =
        resolveHoleTargetBody(features, featureId, holeFeature, faceId);

      if (!targetBody) {
        set((state) => ({
          features: state.features.map((f) =>
            f.id === featureId
              ? { ...f, healthState: 'error' as const, healthMessage: 'No solid OCC body found to cut into' }
              : f,
          ),
          statusMessage: 'Hole: no solid body to cut into',
        }));
        return;
      }

      // ── Build the hole tool body ────────────────────────────────────────────
      const radius    = diameter / 2;
      const through   = termination === 'through-all';
      const drillDir  = normalVec.clone().negate();

      // Drill-point cone height (only for blind angled holes)
      const drillConeHeight = (!through && drillPoint === 'angled' && drillAngle > 0)
        ? radius / Math.tan((Math.max(1, Math.min(89, drillAngle)) / 2) * Math.PI / 180)
        : 0;

      // Main cylinder height: through=large, blind=depth + cone extension + trim
      const cylinderHeight = through ? 2000 : depth + drillConeHeight + EPSILON;

      // Start position: slightly above the face to avoid coplanar boolean issues
      const startPos = new THREE.Vector3(...faceCentroid).addScaledVector(drillDir, -EPSILON);
      const baseTransform = buildDrillTransform(drillDir, startPos);

      let toolBody: BRepBody | null = null;

      try {
        // 1. Main cylinder (full depth + epsilon margins)
        const mainCylShape = occCylinderShapeWithInstance(
          occ.oc, radius, cylinderHeight + 2 * EPSILON, { transform: baseTransform },
        );
        toolBody = makeBRepBodyFromOccShape(occ.oc, mainCylShape.shape, {
          ownedResources: mainCylShape.ownedResources,
          sourceFeatureId: featureId,
        });

        // 2. Drill-point cone (blind angled holes only)
        if (drillConeHeight > 0.001) {
          const coneStartPos = new THREE.Vector3(...faceCentroid)
            .addScaledVector(drillDir, depth);
          const coneTransform = buildDrillTransform(drillDir, coneStartPos);
          const conePiece = buildOccConeShape(occ.oc, radius, 0, drillConeHeight + EPSILON, coneTransform);
          if (conePiece) {
            const coneBody = makeBRepBodyFromOccShape(occ.oc, conePiece.shape, {
              ownedResources: conePiece.ownedResources,
              sourceFeatureId: featureId,
            });
            toolBody = unionPiece(occ.oc, toolBody, coneBody, featureId);
          }
        }

        // 3. Counterbore: wider cylinder from face surface to cbDepth
        if (holeType === 'counterbore' && cbDiameter > diameter && cbDepth > 0.001) {
          const cbShape = occCylinderShapeWithInstance(
            occ.oc, cbDiameter / 2, cbDepth + 2 * EPSILON, { transform: baseTransform },
          );
          const cbBody = makeBRepBodyFromOccShape(occ.oc, cbShape.shape, {
            ownedResources: cbShape.ownedResources,
            sourceFeatureId: featureId,
          });
          toolBody = unionPiece(occ.oc, toolBody, cbBody, featureId);
        }

        // 4. Countersink: cone frustum from csDiameter at face narrowing to diameter
        if (holeType === 'countersink' && csDiameter > diameter && csAngle > 0) {
          const csRadius = csDiameter / 2;
          const halfAng = (Math.max(1, Math.min(89, csAngle)) / 2) * Math.PI / 180;
          const csConeH = (csRadius - radius) / Math.tan(halfAng);
          if (csConeH > 0.001) {
            // R1 = csRadius at face (Z=0), R2 = radius at depth (Z=csConeH)
            const csPiece = buildOccConeShape(occ.oc, csRadius, radius, csConeH + EPSILON, baseTransform);
            if (csPiece) {
              const csBody = makeBRepBodyFromOccShape(occ.oc, csPiece.shape, {
                ownedResources: csPiece.ownedResources,
                sourceFeatureId: featureId,
              });
              toolBody = unionPiece(occ.oc, toolBody, csBody, featureId);
            }
          }
        }

        // ── Subtract from target ──────────────────────────────────────────────
        const resultBody = performOccBooleanWithInstance(occ.oc, 'subtract', targetBody, toolBody, {
          sourceFeatureId: featureId,
        });
        toolBody.dispose();
        toolBody = null;

        if (!resultBody) {
          set((state) => ({
            features: state.features.map((f) =>
              f.id === featureId
                ? { ...f, healthState: 'error' as const, healthMessage: 'Boolean subtract failed — verify placement and size' }
                : f,
            ),
            statusMessage: 'Hole: subtract failed — check placement and size',
          }));
          return;
        }

        // ── Tessellate + register mesh ────────────────────────────────────────
        const targetFeature = resolvedTargetFeatureId
          ? features.find((f) => f.id === resolvedTargetFeatureId)
          : undefined;
        const material =
          targetFeature?.mesh instanceof THREE.Mesh ? targetFeature.mesh.material : BODY_MATERIAL;

        resultBody.sourceFeatureId = featureId;
        let newMesh: THREE.Mesh;
        try {
          newMesh = createRegisteredOccMesh(occ.oc, resultBody, material, featureId);
        } catch (err) {
          resultBody.dispose();
          set((state) => ({
            features: state.features.map((f) =>
              f.id === featureId
                ? { ...f, healthState: 'error' as const, healthMessage: `Tessellation failed: ${errorMessage(err, 'unknown')}` }
                : f,
            ),
            statusMessage: 'Hole: tessellation failed',
          }));
          return;
        }

        // ── Install result mesh + suppress target feature ─────────────────────
        const currentHoleFeature = get().features.find((f) => f.id === featureId);
        const prevMesh = currentHoleFeature?.mesh instanceof THREE.Mesh ? currentHoleFeature.mesh : null;
        const prevBodyId = prevMesh?.userData['brepBodyId'] as string | undefined;

        get().pushUndo();
        set((state) => ({
          features: state.features.map((f) => {
            if (f.id === featureId) {
              return {
                ...f,
                mesh: newMesh,
                healthState: 'healthy' as const,
                healthMessage: undefined,
                params: {
                  ...f.params,
                  // Persist the target feature ID so edits can find it again.
                  targetFeatureId: resolvedTargetFeatureId,
                },
              };
            }
            // Suppress the source body feature (combine-style) so it no longer renders.
            if (f.id === resolvedTargetFeatureId) {
              return { ...f, suppressed: true };
            }
            return f;
          }),
          statusMessage: `Hole: ${diameter}mm Ø, ${through ? 'through-all' : `${depth}mm deep`} (${holeType})`,
        }));

        // Dispose the previous hole result mesh/body (edit path cleanup)
        if (prevMesh && prevMesh.geometry !== newMesh.geometry) {
          disposeMeshDeferred(prevMesh);
          if (prevBodyId) globalBRepBodyRegistry.delete(prevBodyId);
        }

      } catch (err) {
        toolBody?.dispose();
        set((state) => ({
          features: state.features.map((f) =>
            f.id === featureId
              ? { ...f, healthState: 'error' as const, healthMessage: errorMessage(err, 'unexpected error') }
              : f,
          ),
          statusMessage: `Hole: ${errorMessage(err, 'unexpected error')}`,
        }));
      }
    },
  };
}
