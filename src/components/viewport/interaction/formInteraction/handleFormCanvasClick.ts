import * as THREE from 'three';
import { useCADStore } from '../../../../store/cadStore';
import { SubdivisionEngine } from '../../../../engine/subdivisionEngine/SubdivisionEngine';

interface HandleFormCanvasClickParams {
  activeTool: string;
  addFormBody: ReturnType<typeof useCADStore.getState>['addFormBody'];
  removeFormBody: ReturnType<typeof useCADStore.getState>['removeFormBody'];
  setActiveFormBody: ReturnType<typeof useCADStore.getState>['setActiveFormBody'];
  setFormSelection: ReturnType<typeof useCADStore.getState>['setFormSelection'];
  setStatusMessage: ReturnType<typeof useCADStore.getState>['setStatusMessage'];
  setFormBodySubdivisionLevel: ReturnType<typeof useCADStore.getState>['setFormBodySubdivisionLevel'];
  setFormBodyCrease: ReturnType<typeof useCADStore.getState>['setFormBodyCrease'];
  toggleFrozenFormVertex: ReturnType<typeof useCADStore.getState>['toggleFrozenFormVertex'];
  formMeshesRef: React.MutableRefObject<THREE.Object3D[]>;
  pickNearestVertex: (e: MouseEvent) => { bodyId: string; vertex: { id: string; position: [number, number, number] } } | null;
}

function getOrderedDistinctSketchPoints(sketch: ReturnType<typeof useCADStore.getState>['sketches'][number]) {
  const raw: THREE.Vector3[] = [];
  for (const entity of sketch.entities) {
    for (const point of entity.points) raw.push(new THREE.Vector3(point.x, point.y, point.z));
  }
  if (raw.length === 0) return [];
  const deduped: THREE.Vector3[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].distanceTo(deduped[deduped.length - 1]) > 0.001) deduped.push(raw[i]);
  }
  return deduped;
}

export function handleFormCanvasClick(
  e: MouseEvent,
  {
    activeTool,
    addFormBody,
    removeFormBody,
    setActiveFormBody,
    setFormSelection,
    setStatusMessage,
    setFormBodySubdivisionLevel,
    setFormBodyCrease,
    toggleFrozenFormVertex,
    formMeshesRef,
    pickNearestVertex,
  }: HandleFormCanvasClickParams,
): boolean {
  if (e.button !== 0) return false;

  const prefix = `${activeTool.replace('form-', '')}${Date.now()}-`;
  switch (activeTool) {
    case 'form-box': {
      const data = SubdivisionEngine.createBoxCageData(20, 20, 20, prefix);
      addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Box', ...data, subdivisionLevel: 2, visible: true });
      setStatusMessage('T-Spline Box created - switch to Edit Form to reshape it');
      formMeshesRef.current = [];
      return true;
    }
    case 'form-plane': {
      const data = SubdivisionEngine.createPlaneCageData(20, 20, prefix);
      addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Plane', ...data, subdivisionLevel: 2, visible: true });
      setStatusMessage('T-Spline Plane created');
      formMeshesRef.current = [];
      return true;
    }
    case 'form-cylinder': {
      const data = SubdivisionEngine.createCylinderCageData(10, 20, 4, prefix);
      addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Cylinder', ...data, subdivisionLevel: 2, visible: true });
      setStatusMessage('T-Spline Cylinder created');
      formMeshesRef.current = [];
      return true;
    }
    case 'form-sphere': {
      const data = SubdivisionEngine.createSphereCageData(10, prefix);
      addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Sphere', ...data, subdivisionLevel: 3, visible: true });
      setStatusMessage('T-Spline Sphere created');
      formMeshesRef.current = [];
      return true;
    }
    case 'form-torus': {
      const data = SubdivisionEngine.createTorusCageData(15, 3, 4, 4, prefix);
      addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Torus', ...data, subdivisionLevel: 2, visible: true });
      setStatusMessage('T-Spline Torus created');
      formMeshesRef.current = [];
      return true;
    }
    case 'form-quadball': {
      const data = SubdivisionEngine.createQuadballCageData(10, prefix);
      addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Quadball', ...data, subdivisionLevel: 3, visible: true });
      setStatusMessage('T-Spline Quadball created');
      formMeshesRef.current = [];
      return true;
    }
    case 'form-pipe': {
      const state = useCADStore.getState();
      const pathSketch = state.sketches.find((sketch) => sketch.entities.length > 0);
      if (!pathSketch) {
        setStatusMessage('Form Pipe: create a path sketch first, then click');
        return true;
      }
      const pathPoints = getOrderedDistinctSketchPoints(pathSketch);
      if (pathPoints.length < 2) {
        setStatusMessage('Form Pipe: path sketch needs at least 2 distinct points');
        return true;
      }
      const data = SubdivisionEngine.createPipeCageData(pathPoints, 5, 4, `fp${Date.now()}-`);
      addFormBody({
        id: `fb-${Date.now()}`,
        name: 'T-Spline Pipe',
        ...data,
        subdivisionLevel: 2,
        visible: true,
      });
      setStatusMessage('T-Spline Pipe created - use Edit Form to adjust vertices');
      formMeshesRef.current = [];
      return true;
    }
    case 'form-face': {
      const data = SubdivisionEngine.createFaceCageData(10, prefix);
      addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Face', ...data, subdivisionLevel: 2, visible: true });
      setStatusMessage('T-Spline Face created');
      formMeshesRef.current = [];
      return true;
    }
    case 'form-extrude': {
      const activeBody = useCADStore.getState().formBodies[0];
      if (!activeBody) {
        setStatusMessage('No form body to extrude');
        return true;
      }
      const maxY = Math.max(...activeBody.vertices.map((vertex) => vertex.position[1]));
      const topVertices = activeBody.vertices.filter((vertex) => Math.abs(vertex.position[1] - maxY) < 0.1);
      if (topVertices.length < 3) {
        setStatusMessage('No ring found to extrude');
        return true;
      }
      const centerX = topVertices.reduce((sum, vertex) => sum + vertex.position[0], 0) / topVertices.length;
      const centerZ = topVertices.reduce((sum, vertex) => sum + vertex.position[2], 0) / topVertices.length;
      const sortedVertices = [...topVertices].sort(
        (a, b) =>
          Math.atan2(a.position[2] - centerZ, a.position[0] - centerX) -
          Math.atan2(b.position[2] - centerZ, b.position[0] - centerX),
      );
      const ringVertices = sortedVertices.map((vertex) => new THREE.Vector3(...vertex.position));
      const oldRingIds = sortedVertices.map((vertex) => vertex.id);
      const data = SubdivisionEngine.createExtrudeCageData(
        ringVertices,
        new THREE.Vector3(0, 1, 0),
        10,
        `ext-${Date.now()}-`,
        activeBody.vertices.length,
        activeBody.edges.length,
        activeBody.faces.length,
        oldRingIds,
      );
      removeFormBody(activeBody.id);
      addFormBody({
        ...activeBody,
        vertices: [...activeBody.vertices, ...data.vertices],
        edges: [...activeBody.edges, ...data.edges],
        faces: [...activeBody.faces, ...data.faces],
      });
      formMeshesRef.current = [];
      setStatusMessage('T-Spline Extrude: top ring extruded upward 10 units');
      return true;
    }
    case 'form-edit': {
      const result = pickNearestVertex(e);
      if (result) {
        setActiveFormBody(result.bodyId);
        setFormSelection({ bodyId: result.bodyId, type: 'vertex', ids: [result.vertex.id] });
        setStatusMessage('Vertex selected - drag to move');
      } else {
        setFormSelection(null);
        setStatusMessage('Edit Form: click a vertex to select; drag to move');
      }
      return true;
    }
    case 'form-delete': {
      const result = pickNearestVertex(e);
      if (result) {
        setActiveFormBody(result.bodyId);
        setFormSelection({ bodyId: result.bodyId, type: 'vertex', ids: [result.vertex.id] });
        setStatusMessage('Vertex selected - press Delete to remove');
      }
      return true;
    }
    case 'form-subdivide': {
      const bodyId = useCADStore.getState().activeFormBodyId;
      if (!bodyId) {
        setStatusMessage('Subdivide: no active form body - place a primitive first');
        return true;
      }
      const body = useCADStore.getState().formBodies.find((entry) => entry.id === bodyId);
      if (!body) return true;
      const next = Math.min(3, (body.subdivisionLevel ?? 1) + 1);
      setFormBodySubdivisionLevel(bodyId, next);
      formMeshesRef.current = [];
      setStatusMessage(`Subdivision level set to ${next}${next === 3 ? ' (maximum)' : ''}`);
      return true;
    }
    case 'form-crease': {
      const bodyId = useCADStore.getState().activeFormBodyId;
      if (!bodyId) {
        setStatusMessage('Crease: no active form body');
        return true;
      }
      setFormBodyCrease(bodyId, 1);
      const body = useCADStore.getState().formBodies.find((entry) => entry.id === bodyId);
      if (body) {
        removeFormBody(bodyId);
        addFormBody({ ...body, edges: body.edges.map((edge) => ({ ...edge, crease: 1 })) });
        formMeshesRef.current = [];
      }
      setStatusMessage('Creased: all edges and vertices marked sharp (crease=1)');
      return true;
    }
    case 'form-uncrease': {
      const bodyId = useCADStore.getState().activeFormBodyId;
      if (!bodyId) {
        setStatusMessage('Uncrease: no active form body');
        return true;
      }
      setFormBodyCrease(bodyId, 0);
      const body = useCADStore.getState().formBodies.find((entry) => entry.id === bodyId);
      if (body) {
        removeFormBody(bodyId);
        addFormBody({ ...body, edges: body.edges.map((edge) => ({ ...edge, crease: 0 })) });
        formMeshesRef.current = [];
      }
      setStatusMessage('Uncreased: all edge and vertex creases cleared (crease=0)');
      return true;
    }
    case 'form-freeze': {
      const result = pickNearestVertex(e);
      if (!result) {
        setStatusMessage('Freeze: click a vertex to lock/unlock it');
        return true;
      }
      setActiveFormBody(result.bodyId);
      toggleFrozenFormVertex(result.vertex.id);
      const nowFrozen = useCADStore.getState().frozenFormVertices.includes(result.vertex.id);
      setStatusMessage(nowFrozen ? 'Vertex frozen - drag is blocked' : 'Vertex unfrozen - drag restored');
      return true;
    }
    case 'form-revolve': {
      const profileSketch = useCADStore.getState().sketches.find((sketch) => sketch.entities.length > 0);
      if (!profileSketch) {
        setStatusMessage('No sketch profile available - draw a profile sketch first');
        return true;
      }
      const points = getOrderedDistinctSketchPoints(profileSketch);
      if (points.length < 2) {
        setStatusMessage('Profile must have at least 2 points');
        return true;
      }
      const data = SubdivisionEngine.createRevolveCageData(
        points,
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 1, 0),
        360,
        8,
        `rev-${Date.now()}-`,
      );
      addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Revolve', ...data, subdivisionLevel: 2, visible: true });
      formMeshesRef.current = [];
      setStatusMessage('T-Spline Revolve created - use Edit Form to reshape it');
      return true;
    }
    case 'form-loft': {
      const nonEmptySketches = useCADStore.getState().sketches.filter((sketch) => sketch.entities.length > 0);
      if (nonEmptySketches.length < 2) {
        setStatusMessage('T-Spline Loft needs at least 2 profile sketches');
        return true;
      }
      const loftProfiles: Array<Array<{ x: number; y: number }>> = [];
      const loftPositions: THREE.Vector3[] = [];
      const loftNormals: THREE.Vector3[] = [];
      for (const sketch of nonEmptySketches) {
        const profileWorld = getOrderedDistinctSketchPoints(sketch);
        if (profileWorld.length < 3) continue;
        const centroid = profileWorld.reduce((acc, point) => acc.add(point), new THREE.Vector3()).divideScalar(profileWorld.length);
        loftPositions.push(centroid);
        const profileDirection = profileWorld[1].clone().sub(profileWorld[0]).normalize();
        const upRef = Math.abs(profileDirection.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const sketchNormal = profileDirection.clone().cross(upRef).normalize();
        loftNormals.push(sketchNormal);
        const worldRef = Math.abs(sketchNormal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const tangent1 = new THREE.Vector3().crossVectors(worldRef, sketchNormal).normalize();
        const tangent2 = new THREE.Vector3().crossVectors(sketchNormal, tangent1).normalize();
        loftProfiles.push(
          profileWorld.map((point) => {
            const relative = point.clone().sub(centroid);
            return { x: relative.dot(tangent1), y: relative.dot(tangent2) };
          }),
        );
      }
      if (loftProfiles.length < 2) {
        setStatusMessage('T-Spline Loft: could not extract profiles - each sketch needs at least 3 points');
        return true;
      }
      const segments = Math.min(...loftProfiles.map((profile) => profile.length));
      if (segments < 3) {
        setStatusMessage('Each loft profile needs at least 3 points');
        return true;
      }
      const data = SubdivisionEngine.createLoftCageData(
        loftProfiles.map((profile) => profile.slice(0, segments)),
        loftPositions,
        loftNormals,
        `loft-${Date.now()}-`,
      );
      addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Loft', ...data, subdivisionLevel: 2, visible: true });
      formMeshesRef.current = [];
      setStatusMessage('T-Spline Loft created - use Edit Form to reshape it');
      return true;
    }
    case 'form-sweep': {
      const nonEmptySketches = useCADStore.getState().sketches.filter((sketch) => sketch.entities.length > 0);
      if (nonEmptySketches.length < 2) {
        setStatusMessage('T-Spline Sweep needs two sketches: path (first) and profile (second)');
        return true;
      }
      const pathPoints = getOrderedDistinctSketchPoints(nonEmptySketches[0]);
      const profileWorld = getOrderedDistinctSketchPoints(nonEmptySketches[1]);
      if (pathPoints.length < 2 || profileWorld.length < 3) {
        setStatusMessage('Path needs at least 2 points, profile needs at least 3');
        return true;
      }
      const centroid = profileWorld.reduce((acc, point) => acc.add(point), new THREE.Vector3()).divideScalar(profileWorld.length);
      const profileDirection = profileWorld[1].clone().sub(profileWorld[0]).normalize();
      const up = Math.abs(profileDirection.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const profileNormal = profileDirection.clone().cross(up).normalize();
      const profileBinormal = profileDirection.clone().cross(profileNormal).normalize();
      const profileRing = profileWorld.map((point) => {
        const relative = point.clone().sub(centroid);
        return { x: relative.dot(profileNormal), y: relative.dot(profileBinormal) };
      });
      const data = SubdivisionEngine.createSweepCageData(pathPoints, profileRing, `sweep-${Date.now()}-`);
      addFormBody({ id: `fb-${Date.now()}`, name: 'T-Spline Sweep', ...data, subdivisionLevel: 2, visible: true });
      formMeshesRef.current = [];
      setStatusMessage('T-Spline Sweep created - use Edit Form to reshape it');
      return true;
    }
    case 'form-uniform': {
      const bodyId = useCADStore.getState().activeFormBodyId;
      if (!bodyId) { setStatusMessage('Make Uniform: no active form body'); return true; }
      const body = useCADStore.getState().formBodies.find((entry) => entry.id === bodyId);
      if (!body) return true;
      const updated = SubdivisionEngine.makeUniform(body, 3);
      removeFormBody(bodyId);
      addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
      formMeshesRef.current = [];
      setStatusMessage('Make Uniform: 3 Laplacian smoothing iterations applied');
      return true;
    }
    case 'form-pull': {
      const bodyId = useCADStore.getState().activeFormBodyId;
      if (!bodyId) { setStatusMessage('Pull: no active form body'); return true; }
      const body = useCADStore.getState().formBodies.find((entry) => entry.id === bodyId);
      if (!body) return true;
      const updated = SubdivisionEngine.pullToLimitSurface(body);
      removeFormBody(bodyId);
      addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
      formMeshesRef.current = [];
      setStatusMessage('Pull: cage vertices moved toward Catmull-Clark limit surface');
      return true;
    }
    case 'form-interpolate': {
      const bodyId = useCADStore.getState().activeFormBodyId;
      if (!bodyId) { setStatusMessage('Interpolate: no active form body'); return true; }
      const body = useCADStore.getState().formBodies.find((entry) => entry.id === bodyId);
      if (!body) return true;
      const targets = body.vertices.map((vertex) => vertex.position as [number, number, number]);
      const updated = SubdivisionEngine.interpolateToPoints(body, targets);
      removeFormBody(bodyId);
      addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
      formMeshesRef.current = [];
      setStatusMessage('Interpolate: cage vertices snapped to target positions');
      return true;
    }
    case 'form-thicken': {
      const bodyId = useCADStore.getState().activeFormBodyId;
      if (!bodyId) { setStatusMessage('Thicken Form: no active form body'); return true; }
      const body = useCADStore.getState().formBodies.find((entry) => entry.id === bodyId);
      if (!body) return true;
      const updated = SubdivisionEngine.thickenCage(body, 2);
      removeFormBody(bodyId);
      addFormBody({ ...body, vertices: updated.vertices, edges: updated.edges, faces: updated.faces });
      formMeshesRef.current = [];
      setStatusMessage('Thicken Form: shell cage created with 2-unit thickness');
      return true;
    }
    default:
      return false;
  }
}
