import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import type { Sketch, SketchEntity } from '../../../../../types/cad';

type ProjectionTool =
  | 'sketch-project'
  | 'sketch-intersect'
  | 'sketch-project-surface'
  | 'sketch-intersection-curve'
  | 'sketch-spun-profile';

interface ProjectionToolContext {
  activeTool: string;
  activeSketch: Sketch | null;
  camera: THREE.Camera;
  gl: { domElement: HTMLCanvasElement };
  raycaster: THREE.Raycaster;
  scene: THREE.Scene;
  addSketchEntity: (entity: SketchEntity) => void;
  setStatusMessage: (message: string) => void;
  projectLiveLink: boolean;
  cancelSketchProjectSurfaceTool: () => void;
  cancelSketchIntersectionCurveTool: () => void;
  cancelSketchSpunProfileTool: () => void;
}

const PICKABLE_TOOLS = new Set<ProjectionTool>([
  'sketch-project',
  'sketch-intersect',
  'sketch-project-surface',
  'sketch-intersection-curve',
  'sketch-spun-profile',
]);

function collectPickableMeshes(scene: THREE.Scene): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && obj.userData?.pickable) {
      meshes.push(mesh);
    }
  });
  return meshes;
}

function setRayFromPointer(
  event: MouseEvent | PointerEvent,
  element: HTMLCanvasElement,
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  mouse: THREE.Vector2,
): void {
  const rect = element.getBoundingClientRect();
  mouse.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(mouse, camera);
}

// ── Spun Profile helpers ────────────────────────────────────────────────────

/**
 * Detects the revolution axis of a cylindrical / revolved mesh face from its
 * surface normals, then returns the axial cross-section plane that passes
 * through `hitPoint`. Intersecting the mesh with this plane yields the spun
 * profile (the generating curve).
 */
function detectSpunProfilePlane(
  mesh: THREE.Mesh,
  hitPoint: THREE.Vector3,
): THREE.Plane | null {
  mesh.updateWorldMatrix(true, false);
  const geo = mesh.geometry;
  if (!geo.attributes.normal || !geo.index) return null;

  const nor = geo.attributes.normal;
  const idx = geo.index;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

  // Sample world-space normals (cap at ~48 samples for perf)
  const normals: THREE.Vector3[] = [];
  const step = Math.max(1, Math.floor(idx.count / 3 / 48));
  for (let i = 0; i < idx.count; i += 3 * step) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const n = new THREE.Vector3(
      (nor.getX(a) + nor.getX(b) + nor.getX(c)) / 3,
      (nor.getY(a) + nor.getY(b) + nor.getY(c)) / 3,
      (nor.getZ(a) + nor.getZ(b) + nor.getZ(c)) / 3,
    ).normalize().applyMatrix3(normalMatrix).normalize();
    normals.push(n);
  }

  if (normals.length < 3) return null;

  // Axis direction = average of N[i] × N[i+1] cross products.
  // For a cylindrical surface these all point along the revolution axis.
  const axisAcc = new THREE.Vector3();
  let crossCount = 0;
  for (let i = 0; i < normals.length - 1; i++) {
    const cross = normals[i].clone().cross(normals[i + 1]);
    if (cross.lengthSq() < 0.002) continue;
    if (crossCount > 0 && cross.dot(axisAcc) < 0) cross.negate();
    axisAcc.add(cross);
    crossCount++;
  }
  if (crossCount === 0) return null;

  let axisDir = axisAcc.normalize();

  // Snap to the nearest standard axis (X/Y/Z) when within 15°
  const STANDARD = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  for (const axis of STANDARD) {
    const d = Math.abs(axisDir.dot(axis));
    if (d > Math.cos(Math.PI / 12)) {
      axisDir = axisDir.dot(axis) > 0 ? axis.clone() : axis.clone().negate();
      break;
    }
  }

  // Axis centre approximation: bounding-box centre projected ⊥ to axisDir
  const bbox = new THREE.Box3().setFromObject(mesh);
  const bboxCenter = new THREE.Vector3();
  bbox.getCenter(bboxCenter);
  const axisCenter = bboxCenter.clone().sub(
    axisDir.clone().multiplyScalar(bboxCenter.dot(axisDir)),
  );

  // Radial vector from the axis to hitPoint (in the plane ⊥ axisDir)
  const hitPerp = hitPoint.clone()
    .sub(axisDir.clone().multiplyScalar(hitPoint.dot(axisDir)))
    .sub(axisCenter);

  if (hitPerp.lengthSq() < 1e-8) return null; // hit is on the axis

  const radialDir = hitPerp.normalize();

  // Cross-section plane: contains axisDir and radialDir
  // normal = axisDir × radialDir
  const planeNormal = new THREE.Vector3().crossVectors(axisDir, radialDir).normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, hitPoint);
}

/**
 * Returns only those segments whose midpoint lies on the same radial side of
 * the axis as `hitPoint` (keeps the profile half closest to the click).
 */
function filterToHitSide(
  polylines: THREE.Vector3[][],
  axisDir: THREE.Vector3,
  axisCenter: THREE.Vector3,
  radialDir: THREE.Vector3,
): THREE.Vector3[][] {
  return polylines.map((poly) =>
    poly.filter((_, i, arr) => {
      if (i === arr.length - 1) return true; // keep last point
      const mid = arr[i].clone().add(arr[i + 1]).multiplyScalar(0.5);
      const midPerp = mid.clone()
        .sub(axisDir.clone().multiplyScalar(mid.dot(axisDir)))
        .sub(axisCenter);
      return midPerp.dot(radialDir) >= 0;
    }),
  ).filter((poly) => poly.length >= 2);
}

// ── Main hook ───────────────────────────────────────────────────────────────

export function useSketchProjectionTools({
  activeTool,
  activeSketch,
  camera,
  gl,
  raycaster,
  scene,
  addSketchEntity,
  setStatusMessage,
  projectLiveLink,
  cancelSketchProjectSurfaceTool,
  cancelSketchIntersectionCurveTool,
  cancelSketchSpunProfileTool,
}: ProjectionToolContext): void {
  // Tracks the first selected mesh for the two-phase Intersection Curve tool
  const firstIntersectionMeshRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    if (!activeSketch || !PICKABLE_TOOLS.has(activeTool as ProjectionTool)) {
      return;
    }

    // Reset two-phase state when the tool is (re-)activated
    if (activeTool !== 'sketch-intersection-curve') {
      firstIntersectionMeshRef.current = null;
    }

    const mouse = new THREE.Vector2();
    const canvas = gl.domElement;

    let pickableCache: THREE.Mesh[] | null = null;
    const getPickableMeshes = (): THREE.Mesh[] => {
      if (pickableCache === null) pickableCache = collectPickableMeshes(scene);
      return pickableCache;
    };

    const intersectPickableMeshes = (event: MouseEvent | PointerEvent) => {
      setRayFromPointer(event, canvas, raycaster, camera, mouse);
      return raycaster.intersectObjects(getPickableMeshes(), false);
    };

    // ── Hover status messages ──────────────────────────────────────────────
    const handleMove = (event: PointerEvent) => {
      const hits = intersectPickableMeshes(event);
      const hasHit = hits.length > 0;

      if (activeTool === 'sketch-project') {
        setStatusMessage(
          hasHit && hits[0].faceIndex !== undefined
            ? projectLiveLink
              ? 'Click a face to include geometry (live-linked)'
              : 'Click a face to project geometry (one-time)'
            : 'Project: hover over a solid face to project its outline',
        );
        return;
      }

      if (activeTool === 'sketch-intersect') {
        setStatusMessage(
          hasHit
            ? 'Click to create intersection curve with sketch plane'
            : 'Intersect: hover over a solid face',
        );
        return;
      }

      if (activeTool === 'sketch-project-surface') {
        setStatusMessage(
          hasHit
            ? 'Click to project sketch curves onto this surface'
            : 'Project to Surface: hover over a body face',
        );
        return;
      }

      if (activeTool === 'sketch-intersection-curve') {
        const phase = firstIntersectionMeshRef.current ? 2 : 1;
        setStatusMessage(
          hasHit
            ? `Intersection Curve: click to select surface ${phase} of 2`
            : `Intersection Curve: hover over a solid face (surface ${phase} of 2)`,
        );
        return;
      }

      if (activeTool === 'sketch-spun-profile') {
        setStatusMessage(
          hasHit
            ? 'Spun Profile: click a cylindrical or revolved face'
            : 'Spun Profile: hover over a revolved surface',
        );
        return;
      }
    };

    // ── Click handlers ─────────────────────────────────────────────────────
    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;

      const hits = intersectPickableMeshes(event);
      if (!hits.length) return;

      // ── sketch-project ─────────────────────────────────────────────────
      if (activeTool === 'sketch-project') {
        const faceIndex = hits[0].faceIndex;
        if (faceIndex == null) return;

        const hit = hits[0];
        const result = GeometryEngine.computeCoplanarFaceBoundary(
          hit.object as THREE.Mesh,
          faceIndex,
        );
        if (!result || result.boundary.length < 2) return;

        const origin = activeSketch.planeOrigin;
        const normal = activeSketch.planeNormal.clone().normalize();
        const projectToSketchPlane = (point: THREE.Vector3): THREE.Vector3 => {
          const delta = point.clone().sub(origin);
          return point.clone().sub(normal.clone().multiplyScalar(delta.dot(normal)));
        };

        const projectedPoints = result.boundary.map(projectToSketchPlane);
        const closedPoints = [...projectedPoints, projectedPoints[0]];
        for (let index = 0; index < closedPoints.length - 1; index += 1) {
          const start = closedPoints[index];
          const end = closedPoints[index + 1];
          if (start.distanceTo(end) < 0.001) continue;
          addSketchEntity({
            id: crypto.randomUUID(),
            type: 'line',
            linked: projectLiveLink,
            points: [
              { id: crypto.randomUUID(), x: start.x, y: start.y, z: start.z },
              { id: crypto.randomUUID(), x: end.x, y: end.y, z: end.z },
            ],
          });
        }

        setStatusMessage(
          `Projected ${projectedPoints.length} points onto sketch - use Break Link to detach`,
        );
        return;
      }

      // ── sketch-intersect ───────────────────────────────────────────────
      if (activeTool === 'sketch-intersect') {
        const mesh = hits[0].object as THREE.Mesh;
        const normal = activeSketch.planeNormal.clone().normalize();
        const origin = activeSketch.planeOrigin.clone();
        const sketchPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
        const polylines = GeometryEngine.computePlaneIntersectionCurve(mesh, sketchPlane);

        if (!polylines.length) {
          setStatusMessage('No intersection found with sketch plane');
          return;
        }

        let segmentCount = 0;
        for (const polyline of polylines) {
          for (let index = 0; index < polyline.length - 1; index += 1) {
            const start = polyline[index];
            const end = polyline[index + 1];
            if (start.distanceTo(end) < 0.001) continue;
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'line',
              points: [
                { id: crypto.randomUUID(), x: start.x, y: start.y, z: start.z },
                { id: crypto.randomUUID(), x: end.x, y: end.y, z: end.z },
              ],
            });
            segmentCount += 1;
          }
        }

        setStatusMessage(
          `Intersection curve added: ${segmentCount} segment${segmentCount !== 1 ? 's' : ''}`,
        );
        return;
      }

      // ── sketch-project-surface ─────────────────────────────────────────
      if (activeTool === 'sketch-project-surface') {
        const mesh = hits[0].object as THREE.Mesh;
        let segmentCount = 0;
        for (const entity of activeSketch.entities) {
          if (entity.type !== 'line' || entity.points.length < 2) continue;

          const points3d = entity.points.map(
            (point) => new THREE.Vector3(point.x, point.y, point.z),
          );
          const projected = GeometryEngine.projectPointsOntoMesh(points3d, mesh);
          const refined = GeometryEngine.discretizeCurveOnSurface(projected, mesh, 0.5, 3);

          for (let index = 0; index < refined.length - 1; index += 1) {
            const start = refined[index];
            const end = refined[index + 1];
            if (start.distanceTo(end) < 0.001) continue;
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'line',
              points: [
                { id: crypto.randomUUID(), x: start.x, y: start.y, z: start.z },
                { id: crypto.randomUUID(), x: end.x, y: end.y, z: end.z },
              ],
            });
            segmentCount += 1;
          }
        }

        setStatusMessage(
          `Projected ${segmentCount} segment${segmentCount !== 1 ? 's' : ''} onto surface`,
        );
        cancelSketchProjectSurfaceTool();
        return;
      }

      // ── sketch-intersection-curve (two-phase mesh × mesh) ──────────────
      if (activeTool === 'sketch-intersection-curve') {
        const mesh = hits[0].object as THREE.Mesh;

        if (!firstIntersectionMeshRef.current) {
          // Phase 1: store first mesh
          firstIntersectionMeshRef.current = mesh;
          setStatusMessage('Intersection Curve: first surface selected — click the second surface');
          return;
        }

        // Phase 2: compute intersection
        const meshA = firstIntersectionMeshRef.current;
        const meshB = mesh;
        firstIntersectionMeshRef.current = null;

        const curves = GeometryEngine.computeMeshIntersectionCurve(meshA, meshB);
        if (!curves.length) {
          setStatusMessage('Intersection Curve: no intersection found between the two surfaces');
          cancelSketchIntersectionCurveTool();
          return;
        }

        let segmentCount = 0;
        for (const polyline of curves) {
          for (let i = 0; i < polyline.length - 1; i++) {
            const start = polyline[i];
            const end = polyline[i + 1];
            if (start.distanceTo(end) < 0.001) continue;
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'line',
              points: [
                { id: crypto.randomUUID(), x: start.x, y: start.y, z: start.z },
                { id: crypto.randomUUID(), x: end.x, y: end.y, z: end.z },
              ],
            });
            segmentCount++;
          }
        }

        setStatusMessage(
          `Intersection Curve: ${segmentCount} segment${segmentCount !== 1 ? 's' : ''} added`,
        );
        cancelSketchIntersectionCurveTool();
        return;
      }

      // ── sketch-spun-profile ────────────────────────────────────────────
      if (activeTool === 'sketch-spun-profile') {
        const faceIndex = hits[0].faceIndex;
        if (faceIndex == null) return;

        const mesh = hits[0].object as THREE.Mesh;
        const hitPoint = hits[0].point.clone();

        const crossSectionPlane = detectSpunProfilePlane(mesh, hitPoint);
        if (!crossSectionPlane) {
          setStatusMessage(
            'Spun Profile: could not detect a revolution axis — select a cylindrical or revolved face',
          );
          return;
        }

        const polylines = GeometryEngine.computePlaneIntersectionCurve(mesh, crossSectionPlane);
        if (!polylines.length) {
          setStatusMessage('Spun Profile: no cross-section found');
          return;
        }

        // Keep only segments on the same radial side as the hit point
        mesh.updateWorldMatrix(true, false);
        const bbox = new THREE.Box3().setFromObject(mesh);
        const bboxCenter = new THREE.Vector3();
        bbox.getCenter(bboxCenter);

        // Reconstruct axisDir and radialDir from the plane (they're embedded in the plane normal)
        // planeNormal = axisDir × radialDir → the plane contains both axisDir and radialDir.
        // We just need the radialDir (outward from axis at hitPoint).
        // Easiest: use the cross-section plane's normal dotted with possible axis dirs.
        const STANDARD = [
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(0, 0, 1),
        ];
        let axisDir = new THREE.Vector3(0, 1, 0);
        let bestParallel = 0;
        for (const axis of STANDARD) {
          // planeNormal ⊥ axisDir means |planeNormal · axisDir| ≈ 0
          const d = Math.abs(crossSectionPlane.normal.dot(axis));
          // axisDir is the one most parallel to the plane (smallest |normal · axis|)
          const parallelness = 1 - d;
          if (parallelness > bestParallel) {
            bestParallel = parallelness;
            axisDir = axis.clone();
          }
        }

        const axisCenter = bboxCenter.clone().sub(
          axisDir.clone().multiplyScalar(bboxCenter.dot(axisDir)),
        );
        const hitPerp = hitPoint.clone()
          .sub(axisDir.clone().multiplyScalar(hitPoint.dot(axisDir)))
          .sub(axisCenter);
        const radialDir = hitPerp.lengthSq() > 1e-8
          ? hitPerp.normalize()
          : new THREE.Vector3(1, 0, 0);

        const filtered = filterToHitSide(polylines, axisDir, axisCenter, radialDir);

        let segmentCount = 0;
        for (const polyline of filtered) {
          for (let i = 0; i < polyline.length - 1; i++) {
            const start = polyline[i];
            const end = polyline[i + 1];
            if (start.distanceTo(end) < 0.001) continue;
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'line',
              points: [
                { id: crypto.randomUUID(), x: start.x, y: start.y, z: start.z },
                { id: crypto.randomUUID(), x: end.x, y: end.y, z: end.z },
              ],
            });
            segmentCount++;
          }
        }

        if (segmentCount === 0) {
          setStatusMessage('Spun Profile: no profile segments found on this side of the axis');
          return;
        }

        setStatusMessage(
          `Spun Profile: ${segmentCount} segment${segmentCount !== 1 ? 's' : ''} added`,
        );
        cancelSketchSpunProfileTool();
        return;
      }
    };

    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('click', handleClick);
      // Clear two-phase state when leaving the intersection curve tool
      if (activeTool === 'sketch-intersection-curve') {
        firstIntersectionMeshRef.current = null;
      }
    };
  }, [
    activeTool,
    activeSketch,
    addSketchEntity,
    camera,
    cancelSketchIntersectionCurveTool,
    cancelSketchProjectSurfaceTool,
    cancelSketchSpunProfileTool,
    gl,
    projectLiveLink,
    raycaster,
    scene,
    setStatusMessage,
  ]);
}
