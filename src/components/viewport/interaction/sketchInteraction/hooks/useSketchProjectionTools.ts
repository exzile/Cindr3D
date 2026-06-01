import { useEffect } from 'react';
import * as THREE from 'three';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import type { Sketch, SketchEntity } from '../../../../../types/cad';

type ProjectionTool = 'sketch-project' | 'sketch-intersect' | 'sketch-project-surface';

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
}

const PICKABLE_TOOLS = new Set<ProjectionTool>([
  'sketch-project',
  'sketch-intersect',
  'sketch-project-surface',
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
}: ProjectionToolContext): void {
  useEffect(() => {
    if (!activeSketch || !PICKABLE_TOOLS.has(activeTool as ProjectionTool)) {
      return;
    }

    const mouse = new THREE.Vector2();
    const canvas = gl.domElement;

    // Perf: traverse the scene for pickable meshes once per tool activation
    // instead of on every pointermove. The body set is stable for the duration
    // of a projection-pick session; the effect re-runs (rebuilding the cache)
    // whenever activeTool/activeSketch/scene changes.
    let pickableCache: THREE.Mesh[] | null = null;
    const getPickableMeshes = (): THREE.Mesh[] => {
      if (pickableCache === null) pickableCache = collectPickableMeshes(scene);
      return pickableCache;
    };

    const intersectPickableMeshes = (event: MouseEvent | PointerEvent) => {
      setRayFromPointer(event, canvas, raycaster, camera, mouse);
      return raycaster.intersectObjects(getPickableMeshes(), false);
    };

    const handleMove = (event: PointerEvent) => {
      const hits = intersectPickableMeshes(event);
      if (activeTool === 'sketch-project') {
        if (hits.length > 0 && hits[0].faceIndex !== undefined) {
          setStatusMessage(
            projectLiveLink
              ? 'Click a face to include geometry (live-linked)'
              : 'Click a face to project geometry (one-time)',
          );
          return;
        }
        setStatusMessage('Project: hover over a solid face to project its outline');
        return;
      }

      if (activeTool === 'sketch-intersect') {
        setStatusMessage(
          hits.length > 0
            ? 'Click to create intersection curve with sketch plane'
            : 'Intersect: hover over a solid face',
        );
        return;
      }

      setStatusMessage(
        hits.length > 0
          ? 'Click to project sketch curves onto this surface'
          : 'Project to Surface: hover over a body face',
      );
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }

      const hits = intersectPickableMeshes(event);
      if (!hits.length) {
        return;
      }

      if (activeTool === 'sketch-project') {
        const faceIndex = hits[0].faceIndex;
        if (faceIndex == null) {
          return;
        }

        const hit = hits[0];
        const result = GeometryEngine.computeCoplanarFaceBoundary(
          hit.object as THREE.Mesh,
          faceIndex,
        );
        if (!result || result.boundary.length < 2) {
          return;
        }

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
          if (start.distanceTo(end) < 0.001) {
            continue;
          }
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
            if (start.distanceTo(end) < 0.001) {
              continue;
            }
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

      const mesh = hits[0].object as THREE.Mesh;
      let segmentCount = 0;
      for (const entity of activeSketch.entities) {
        if (entity.type !== 'line' || entity.points.length < 2) {
          continue;
        }

        const points3d = entity.points.map((point) => new THREE.Vector3(point.x, point.y, point.z));
        const projected = GeometryEngine.projectPointsOntoMesh(points3d, mesh);
        const refined = GeometryEngine.discretizeCurveOnSurface(projected, mesh, 0.5, 3);

        for (let index = 0; index < refined.length - 1; index += 1) {
          const start = refined[index];
          const end = refined[index + 1];
          if (start.distanceTo(end) < 0.001) {
            continue;
          }
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
    };

    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('click', handleClick);
    };
  }, [
    activeTool,
    activeSketch,
    addSketchEntity,
    camera,
    cancelSketchProjectSurfaceTool,
    gl,
    projectLiveLink,
    raycaster,
    scene,
    setStatusMessage,
  ]);
}
