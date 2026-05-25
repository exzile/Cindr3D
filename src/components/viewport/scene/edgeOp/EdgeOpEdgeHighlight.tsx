import { useRef, useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useFrame, useThree, invalidate as invalidateFrame } from "@react-three/fiber";
import { buildPolylineGeometry } from "../pickerGeometry";
import { applyLinePulse } from "../pickPulse";
import { useOccEdgePicker, type OccEdgePickResult } from "../OccEdgePicker";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import { migrateLegacyExtrudeFeatures } from "../../../../engine/occ/legacyMigration";
import { getOcc } from "../../../../engine/occ/loader";
import {
  attachTessellationToMesh,
  getMeshTessellation,
} from "../../../../engine/occ/picking";
import type { BRepTessellation } from "../../../../engine/occ/brepBody";
import type { BodyTopology } from "../../../../engine/geometryEngine/core/solid/edgeTypes";
import { useCADStore } from "../../../../store/cadStore";

interface EdgeOpEdgeHighlightProps {
  enabled: boolean;
  edgeIds: string[];
  addEdge: (id: string) => void;
  removeEdge: (id: string) => void;
  selectedColor: number;
  allowCurvedEdges?: boolean;
}

const EDGE_GUIDE_RENDER_ORDER = 1398;
const EDGE_HOVER_RENDER_ORDER = 1402;
const EDGE_SELECTED_RENDER_ORDER = 1403;
const _guideOffset = new THREE.Vector3();

function occEdgeId(result: OccEdgePickResult): string {
  return `occ:${result.bodyId}:${result.edgeId}`;
}

function getOccEdgePolyline(result: OccEdgePickResult): THREE.Vector3[] | null {
  const body = globalBRepBodyRegistry.get(result.bodyId);
  const pts = body?._tessellation?.edgePolylines.get(result.edgeId);
  if (!pts || pts.length < 6) return null;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) {
    out.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(result.mesh.matrixWorld));
  }
  return out.length >= 2 ? out : null;
}

function polylineIsCurved(polyline: Float32Array | THREE.Vector3[]): boolean {
  const count = Array.isArray(polyline) ? polyline.length : polyline.length / 3;
  if (count <= 2) return false;
  const first = Array.isArray(polyline)
    ? polyline[0]
    : new THREE.Vector3(polyline[0], polyline[1], polyline[2]);
  const last = Array.isArray(polyline)
    ? polyline[count - 1]
    : new THREE.Vector3(polyline[(count - 1) * 3], polyline[(count - 1) * 3 + 1], polyline[(count - 1) * 3 + 2]);
  const axis = last.clone().sub(first);
  const axisLen = axis.length();
  if (axisLen < 1e-8) return true;
  axis.divideScalar(axisLen);
  const tolerance = Math.max(axisLen * 1e-3, 1e-5);
  for (let index = 1; index < count - 1; index += 1) {
    const point = Array.isArray(polyline)
      ? polyline[index]
      : new THREE.Vector3(polyline[index * 3], polyline[index * 3 + 1], polyline[index * 3 + 2]);
    const offset = point.clone().sub(first);
    const projected = first.clone().addScaledVector(axis, offset.dot(axis));
    if (point.distanceTo(projected) > tolerance) return true;
  }
  return false;
}

function resolveMeshOccTessellation(mesh: THREE.Mesh) {
  let tess = getMeshTessellation(mesh);
  let bodyId = mesh.userData.brepBodyId as string | undefined;
  if (tess && bodyId) return { tess, bodyId };

  const featureId = mesh.userData.featureId as string | undefined;
  const body =
    (bodyId ? globalBRepBodyRegistry.get(bodyId) : undefined) ??
    (featureId ? globalBRepBodyRegistry.getByFeature(featureId).find((candidate) => candidate._tessellation) : undefined);
  if (!body) return null;

  tess = body._tessellation ?? null;
  if (!tess) return null;
  bodyId = body.id;
  attachTessellationToMesh(mesh, tess, body.id);
  return { tess, bodyId };
}

function buildBatchedEdgeLineGeometry(
  tess: BRepTessellation,
  allowCurvedEdges: boolean,
): { geometry: THREE.BufferGeometry; edgeIdsBySegment: number[] } | null {
  const positions: number[] = [];
  const edgeIdsBySegment: number[] = [];
  const syntheticEdgeIds = detectSyntheticGeneratorEdges(tess);

  for (const [edgeId, polyline] of tess.edgePolylines) {
    if (syntheticEdgeIds.has(edgeId)) continue;
    if (!allowCurvedEdges && polylineIsCurved(polyline)) continue;
    const pointCount = polyline.length / 3;
    if (pointCount < 2) continue;
    for (let index = 0; index < pointCount - 1; index += 1) {
      const a = index * 3;
      const b = (index + 1) * 3;
      positions.push(
        polyline[a],
        polyline[a + 1],
        polyline[a + 2],
        polyline[b],
        polyline[b + 1],
        polyline[b + 2],
      );
      edgeIdsBySegment.push(edgeId);
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return { geometry, edgeIdsBySegment };
}

type StraightEdgeInfo = {
  edgeId: number | string;
  center: THREE.Vector3;
  length: number;
  direction: THREE.Vector3;
};

function canonicalDirection(direction: THREE.Vector3): THREE.Vector3 {
  const out = direction.clone().normalize();
  if (
    out.x < -1e-6 ||
    (Math.abs(out.x) <= 1e-6 && out.y < -1e-6) ||
    (Math.abs(out.x) <= 1e-6 && Math.abs(out.y) <= 1e-6 && out.z < -1e-6)
  ) {
    out.multiplyScalar(-1);
  }
  return out;
}

function straightEdgeInfo(edgeId: number | string, polyline: Float32Array): StraightEdgeInfo | null {
  const pointCount = polyline.length / 3;
  if (pointCount < 2) return null;
  const first = new THREE.Vector3(polyline[0], polyline[1], polyline[2]);
  const last = new THREE.Vector3(
    polyline[(pointCount - 1) * 3],
    polyline[(pointCount - 1) * 3 + 1],
    polyline[(pointCount - 1) * 3 + 2],
  );
  const delta = last.clone().sub(first);
  const length = delta.length();
  if (length < 1e-5) return null;
  const direction = delta.clone().normalize();
  const maxDeviation = Math.max(length * 0.0075, 1e-4);
  for (let index = 1; index < pointCount - 1; index += 1) {
    const point = new THREE.Vector3(polyline[index * 3], polyline[index * 3 + 1], polyline[index * 3 + 2]);
    const offset = point.clone().sub(first);
    const projected = first.clone().addScaledVector(direction, offset.dot(direction));
    if (point.distanceTo(projected) > maxDeviation) return null;
  }
  return {
    edgeId,
    center: first.add(last).multiplyScalar(0.5),
    length,
    direction: canonicalDirection(direction),
  };
}

function straightVectorEdgeInfo(edgeId: string, polyline: THREE.Vector3[]): StraightEdgeInfo | null {
  if (polyline.length < 2) return null;
  const first = polyline[0];
  const last = polyline[polyline.length - 1];
  const delta = last.clone().sub(first);
  const length = delta.length();
  if (length < 1e-5) return null;
  const direction = delta.clone().normalize();
  const maxDeviation = Math.max(length * 0.0075, 1e-4);
  for (let index = 1; index < polyline.length - 1; index += 1) {
    const point = polyline[index];
    const offset = point.clone().sub(first);
    const projected = first.clone().addScaledVector(direction, offset.dot(direction));
    if (point.distanceTo(projected) > maxDeviation) return null;
  }
  return {
    edgeId,
    center: first.clone().add(last).multiplyScalar(0.5),
    length,
    direction: canonicalDirection(direction),
  };
}

function straightEdgeGroupKey(info: StraightEdgeInfo): string {
  const dir = info.direction;
  const quantizedLength = Math.round(info.length * 1000);
  return [
    Math.round(dir.x * 100),
    Math.round(dir.y * 100),
    Math.round(dir.z * 100),
    quantizedLength,
  ].join(":");
}

function detectSyntheticEdgeInfos(infos: StraightEdgeInfo[]): Set<number | string> {
  const groups = new Map<string, StraightEdgeInfo[]>();
  for (const info of infos) {
    const key = straightEdgeGroupKey(info);
    const group = groups.get(key) ?? [];
    group.push(info);
    groups.set(key, group);
  }

  const hidden = new Set<number | string>();
  for (const group of groups.values()) {
    if (group.length < 9) continue;

    // Many same-length, same-direction straight OCC edges are usually ruled
    // surface generator strips from cylindrical/lofted faces. They are not
    // fillet/chamfer targets; the selectable edges are the boundary loops.
    for (const info of group) hidden.add(info.edgeId);
  }
  return hidden;
}

function detectSyntheticGeneratorEdges(tess: BRepTessellation): Set<number | string> {
  const infos: StraightEdgeInfo[] = [];
  for (const [edgeId, polyline] of tess.edgePolylines) {
    const info = straightEdgeInfo(edgeId, polyline);
    if (info) infos.push(info);
  }
  return detectSyntheticEdgeInfos(infos);
}

function detectSyntheticTopologyEdges(topology: BodyTopology): Set<number | string> {
  const infos = topology.edges
    .map((edge) => straightVectorEdgeInfo(edge.id, edge.polyline))
    .filter((info): info is StraightEdgeInfo => !!info);
  return detectSyntheticEdgeInfos(infos);
}

function buildMeshTopologyGuideGeometry(
  mesh: THREE.Mesh,
  allowCurvedEdges: boolean,
  curvedOnly = false,
): THREE.BufferGeometry | null {
  const topology = mesh.geometry.userData?.topology as BodyTopology | undefined;
  const positions: number[] = [];
  const world = mesh.matrixWorld;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  if (!topology?.edges?.length) return null;
  const syntheticEdgeIds = detectSyntheticTopologyEdges(topology);
  for (const edge of topology.edges) {
    if (syntheticEdgeIds.has(edge.id)) continue;
    const curved = polylineIsCurved(edge.polyline);
    if (curvedOnly && !curved) continue;
    if (!allowCurvedEdges && curved) continue;
    if (edge.polyline.length < 2) continue;
    for (let index = 0; index < edge.polyline.length - 1; index += 1) {
      a.copy(edge.polyline[index]).applyMatrix4(world);
      b.copy(edge.polyline[index + 1]).applyMatrix4(world);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

function buildMergedMeshCreaseGuideGeometry(
  mesh: THREE.Mesh,
  allowCurvedEdges: boolean,
): THREE.BufferGeometry | null {
  const source = mesh.geometry;
  const merged = mergeVertices(source, 1e-4);
  const position = merged.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position || position.count < 3) {
    merged.dispose();
    return null;
  }

  const index = merged.index;
  const edgeMap = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; normals: THREE.Vector3[] }>();
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const q = (v: THREE.Vector3) => `${Math.round(v.x * 10000)},${Math.round(v.y * 10000)},${Math.round(v.z * 10000)}`;
  type BoundaryEdge = { a: THREE.Vector3; b: THREE.Vector3; keyA: string; keyB: string };

  const addEdge = (a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3) => {
    const qa = q(a);
    const qb = q(b);
    const key = qa < qb ? `${qa}|${qb}` : `${qb}|${qa}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.normals.push(normal.clone());
      return;
    }
    edgeMap.set(key, { a: a.clone(), b: b.clone(), normals: [normal.clone()] });
  };

  const triCount = index ? index.count / 3 : position.count / 3;
  for (let tri = 0; tri < triCount; tri += 1) {
    const ia = index ? index.getX(tri * 3) : tri * 3;
    const ib = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
    const ic = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;
    p0.fromBufferAttribute(position, ia);
    p1.fromBufferAttribute(position, ib);
    p2.fromBufferAttribute(position, ic);
    n.subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
    if (n.lengthSq() < 1e-16) continue;
    n.normalize();
    addEdge(p0, p1, n);
    addEdge(p1, p2, n);
    addEdge(p2, p0, n);
  }

  // Mesh-only fallback geometry is faceted, so a low threshold turns every
  // cylinder segment into a fake selectable-looking edge. Keep this high and
  // only draw true rim/box creases; OCC-backed bodies still use exact curved
  // edge polylines above.
  const creaseThreshold = THREE.MathUtils.degToRad(20);
  const positions: number[] = [];
  const world = mesh.matrixWorld;
  const boundaryEdges: BoundaryEdge[] = [];
  const appendSegment = (edge: { a: THREE.Vector3; b: THREE.Vector3 }) => {
    const a = edge.a.clone().applyMatrix4(world);
    const b = edge.b.clone().applyMatrix4(world);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  const appendClosedBoundaryLoops = () => {
    if (!allowCurvedEdges || boundaryEdges.length < 8) return;
    const incident = new Map<string, number[]>();
    boundaryEdges.forEach((edge, index) => {
      const aList = incident.get(edge.keyA) ?? [];
      aList.push(index);
      incident.set(edge.keyA, aList);
      const bList = incident.get(edge.keyB) ?? [];
      bList.push(index);
      incident.set(edge.keyB, bList);
    });

    const visited = new Set<number>();
    for (let start = 0; start < boundaryEdges.length; start += 1) {
      if (visited.has(start)) continue;
      const component: number[] = [];
      const stack = [start];
      visited.add(start);
      while (stack.length > 0) {
        const index = stack.pop()!;
        component.push(index);
        const edge = boundaryEdges[index];
        for (const key of [edge.keyA, edge.keyB]) {
          for (const next of incident.get(key) ?? []) {
            if (visited.has(next)) continue;
            visited.add(next);
            stack.push(next);
          }
        }
      }
      if (component.length < 8) continue;
      const componentKeys = new Set<string>();
      for (const index of component) {
        componentKeys.add(boundaryEdges[index].keyA);
        componentKeys.add(boundaryEdges[index].keyB);
      }
      const mostlyClosed = [...componentKeys].filter((key) => (incident.get(key)?.length ?? 0) === 2).length;
      if (mostlyClosed < componentKeys.size * 0.85) continue;
      for (const index of component) {
        const edge = boundaryEdges[index];
        const degreeA = incident.get(edge.keyA)?.length ?? 0;
        const degreeB = incident.get(edge.keyB)?.length ?? 0;
        if (degreeA !== 2 || degreeB !== 2) continue;
        appendSegment(edge);
      }
    }
  };

  for (const edge of edgeMap.values()) {
    let include = false;
    if (edge.normals.length === 1) {
      boundaryEdges.push({ a: edge.a, b: edge.b, keyA: q(edge.a), keyB: q(edge.b) });
      continue;
    }
    if (!include) {
      for (let i = 0; !include && i < edge.normals.length; i += 1) {
        for (let j = i + 1; j < edge.normals.length; j += 1) {
          if (edge.normals[i].angleTo(edge.normals[j]) >= creaseThreshold) {
            include = true;
            break;
          }
        }
      }
    }
    if (!include) continue;
    appendSegment(edge);
  }
  appendClosedBoundaryLoops();
  merged.dispose();

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

export default function EdgeOpEdgeHighlight({
  enabled,
  edgeIds,
  addEdge,
  removeEdge,
  selectedColor,
  allowCurvedEdges = false,
}: EdgeOpEdgeHighlightProps) {
  const hoverMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0x2196f3,
        linewidth: 2,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const selectedMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: selectedColor,
        linewidth: 3,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [selectedColor],
  );
  const allEdgesMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xff6a00,
        transparent: true,
        opacity: 1,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const pickEdgesMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xff6a00,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => () => hoverMat.dispose(), [hoverMat]);
  useEffect(() => () => selectedMat.dispose(), [selectedMat]);
  useEffect(() => () => allEdgesMat.dispose(), [allEdgesMat]);
  useEffect(() => () => pickEdgesMat.dispose(), [pickEdgesMat]);

  const allEdgeLinesRef = useRef<THREE.LineSegments[]>([]);
  const hoverLineRef = useRef<THREE.Line | null>(null);
  const occHoverRef = useRef<OccEdgePickResult | null>(null);
  const renderedHoverIdRef = useRef<string | null>(null);
  const selectedLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const selectedEdgesDataRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  const lastMigrationKeyRef = useRef<string | null>(null);
  const cursorOnRef = useRef(false);
  const { scene: _scene, gl, camera } = useThree();
  const features = useCADStore((state) => state.features);
  const sketches = useCADStore((state) => state.sketches);

  const edgeSourceSignature = useMemo(
    () =>
      features
        .filter((feature) => feature.visible && !feature.suppressed)
        .map((feature) => `${feature.id}:${feature.timestamp}:${feature.mesh instanceof THREE.Mesh ? feature.mesh.uuid : ''}`)
        .join("|"),
    [features],
  );
  const visibleBodyFeatureIds = useMemo(
    () =>
      new Set(
        features
          .filter((feature) => feature.visible && !feature.suppressed && feature.type !== "sketch")
          .map((feature) => feature.id),
      ),
    [features],
  );

  const edgeIdSet = useMemo(() => new Set(edgeIds), [edgeIds]);

  useEffect(() => {
    const sceneRef = _scene;
    const canvas = gl.domElement;
    const selectedLines = selectedLinesRef.current;
    const selectedEdges = selectedEdgesDataRef.current;
    return () => {
      if (hoverLineRef.current) {
        sceneRef.remove(hoverLineRef.current);
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current = null;
      }
      for (const line of allEdgeLinesRef.current) {
        sceneRef.remove(line);
        line.geometry.dispose();
      }
      allEdgeLinesRef.current = [];
      selectedLines.forEach((line) => {
        sceneRef.remove(line);
        line.geometry.dispose();
      });
      selectedLines.clear();
      selectedEdges.clear();
      if (cursorOnRef.current) {
        canvas.style.cursor = "";
        cursorOnRef.current = false;
      }
    };
  }, [_scene, gl]);

  const handleOccHover = useCallback((result: OccEdgePickResult | null) => {
    if (result && !allowCurvedEdges) {
      const body = globalBRepBodyRegistry.get(result.bodyId);
      const polyline = body?._tessellation?.edgePolylines.get(result.edgeId);
      if (polyline && polylineIsCurved(polyline)) {
        occHoverRef.current = null;
        invalidateFrame();
        return;
      }
    }
    occHoverRef.current = result;
    invalidateFrame();
  }, [allowCurvedEdges]);

  const handleOccClick = useCallback((result: OccEdgePickResult) => {
    const polyline = getOccEdgePolyline(result);
    if (!polyline) return;
    if (!allowCurvedEdges && polylineIsCurved(polyline)) return;
    const id = occEdgeId(result);
    if (edgeIdSet.has(id)) {
      removeEdge(id);
      return;
    }
    selectedEdgesDataRef.current.set(id, polyline);
    addEdge(id);
  }, [addEdge, removeEdge, edgeIdSet, allowCurvedEdges]);

  useOccEdgePicker({
    enabled,
    onHover: handleOccHover,
    onClick: handleOccClick,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const migrate = (occ: Awaited<ReturnType<typeof getOcc>>) => {
      const legacyKey = features
        .filter((feature) => feature.type === "extrude")
        .map((feature) => {
          const bodyId = feature.mesh instanceof THREE.Mesh ? feature.mesh.userData.brepBodyId ?? "" : "";
          return `${feature.id}:${feature.timestamp}:${feature.visible}:${feature.suppressed}:${bodyId}`;
        })
        .join("|");
      if (!legacyKey || legacyKey === lastMigrationKeyRef.current) return;
      const migrated = migrateLegacyExtrudeFeatures(features, sketches, occ);
      const changed = migrated.some((feature, index) => feature !== features[index]);
      if (changed) {
        lastMigrationKeyRef.current = legacyKey;
        useCADStore.setState({ features: migrated });
        return;
      }
      lastMigrationKeyRef.current = legacyKey;
    };

    getOcc()
      .then((occ) => {
        if (!cancelled) migrate(occ);
      })
      .catch((error) => {
        console.warn("[EdgeOpEdgeHighlight] OCC load failed before legacy migration", error);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, features, sketches]);

  useEffect(() => {
    let cancelled = false;
    let initialBuildHandle: number | null = null;
    let retryHandle: number | null = null;
    let attempts = 0;
    const maxAttempts = 24;
    for (const line of allEdgeLinesRef.current) {
      _scene.remove(line);
      line.geometry.dispose();
    }
    allEdgeLinesRef.current = [];
    if (!enabled) return undefined;

    const buildLines = () => {
      for (const line of allEdgeLinesRef.current) {
        _scene.remove(line);
        line.geometry.dispose();
      }
      const lines: THREE.LineSegments[] = [];
      _scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) && !(obj as THREE.Mesh).isMesh) return;
        const mesh = obj as THREE.Mesh;
        if (!mesh.visible) return;
        const featureId = mesh.userData.featureId as string | undefined;
        const bodyId = mesh.userData.brepBodyId as string | undefined;
        if (featureId && !visibleBodyFeatureIds.has(featureId)) return;
        if (!featureId && !bodyId) return;
        const resolved = resolveMeshOccTessellation(mesh);
        if (bodyId && !resolved) return;
        const batched = resolved
          ? buildBatchedEdgeLineGeometry(resolved.tess, allowCurvedEdges)
          : null;
        const topologyGuideGeometry = buildMeshTopologyGuideGeometry(mesh, allowCurvedEdges);
        const fallbackGuideGeometry =
          topologyGuideGeometry ?? (!resolved ? buildMergedMeshCreaseGuideGeometry(mesh, allowCurvedEdges) : null);
        if (!batched && !fallbackGuideGeometry) return;
        if (batched) {
          const pickLine = new THREE.LineSegments(batched.geometry, pickEdgesMat);
          pickLine.userData.edgeIdsBySegment = batched.edgeIdsBySegment;
          pickLine.userData.brepBodyId = resolved!.bodyId;
          pickLine.frustumCulled = false;
          pickLine.matrixAutoUpdate = true;
          pickLine.renderOrder = EDGE_GUIDE_RENDER_ORDER;
          _scene.add(pickLine);
          lines.push(pickLine);
        }
        if (fallbackGuideGeometry) {
          const guideLine = new THREE.LineSegments(fallbackGuideGeometry, allEdgesMat);
          guideLine.frustumCulled = false;
          guideLine.matrixAutoUpdate = true;
          guideLine.renderOrder = EDGE_GUIDE_RENDER_ORDER;
          _scene.add(guideLine);
          lines.push(guideLine);
        }
      });
      allEdgeLinesRef.current = lines;
      invalidateFrame();
      return lines.length;
    };

    const scheduleBuild = (delayMs: number) => {
      retryHandle = window.setTimeout(() => {
        retryHandle = null;
        if (cancelled) return;
        attempts += 1;
        const lineCount = buildLines();
        if (lineCount > 0 || attempts >= maxAttempts) return;
        scheduleBuild(125);
      }, delayMs);
    };

    initialBuildHandle = window.setTimeout(() => {
      initialBuildHandle = null;
      if (cancelled) return;
      const lineCount = buildLines();
      if (lineCount > 0) return;
      scheduleBuild(125);
    }, 250);

    return () => {
      cancelled = true;
      if (initialBuildHandle !== null) window.clearTimeout(initialBuildHandle);
      if (retryHandle !== null) window.clearTimeout(retryHandle);
      for (const line of allEdgeLinesRef.current) {
        _scene.remove(line);
        line.geometry.dispose();
      }
      allEdgeLinesRef.current = [];
    };
  }, [enabled, _scene, allEdgesMat, pickEdgesMat, allowCurvedEdges, edgeSourceSignature, visibleBodyFeatureIds]);

  useFrame(({ scene, invalidate }) => {
    if (!enabled) {
      /* eslint-disable-next-line react-hooks/immutability */
      allEdgesMat.opacity = 1;
      if (hoverLineRef.current) {
        scene.remove(hoverLineRef.current);
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current = null;
        renderedHoverIdRef.current = null;
      }
      if (selectedLinesRef.current.size > 0) {
        selectedLinesRef.current.forEach((line) => {
          scene.remove(line);
          line.geometry.dispose();
        });
        selectedLinesRef.current.clear();
        selectedEdgesDataRef.current.clear();
      }
      if (cursorOnRef.current) {
        /* eslint-disable-next-line react-hooks/immutability */
        gl.domElement.style.cursor = "";
        cursorOnRef.current = false;
      }
      return;
    }

    if (allEdgeLinesRef.current.length > 0 || occHoverRef.current || selectedLinesRef.current.size > 0 || edgeIds.length > 0) {
      invalidate();
    }

    const guideOffset = camera.getWorldDirection(_guideOffset).multiplyScalar(-0.12);
    for (const line of allEdgeLinesRef.current) {
      line.position.copy(guideOffset);
    }

    const wantCursor = !!occHoverRef.current;
    if (wantCursor !== cursorOnRef.current) {
      gl.domElement.style.cursor = wantCursor ? "crosshair" : "";
      cursorOnRef.current = wantCursor;
    }

    const occHover = occHoverRef.current;
    if (occHover) {
      const id = occEdgeId(occHover);
      if (id !== renderedHoverIdRef.current || !hoverLineRef.current) {
        renderedHoverIdRef.current = id;
        const hPts = getOccEdgePolyline(occHover);
        if (hPts) {
          if (!hoverLineRef.current) {
            const line = new THREE.Line(buildPolylineGeometry(hPts), hoverMat);
            line.renderOrder = EDGE_HOVER_RENDER_ORDER;
            scene.add(line);
            hoverLineRef.current = line;
          } else {
            hoverLineRef.current.geometry.dispose();
            hoverLineRef.current.geometry = buildPolylineGeometry(hPts);
          }
        }
      }
    } else if (hoverLineRef.current) {
      scene.remove(hoverLineRef.current);
      hoverLineRef.current.geometry.dispose();
      hoverLineRef.current = null;
      renderedHoverIdRef.current = null;
    }

    selectedLinesRef.current.forEach((line, id) => {
      if (!edgeIdSet.has(id)) {
        scene.remove(line);
        line.geometry.dispose();
        selectedLinesRef.current.delete(id);
        selectedEdgesDataRef.current.delete(id);
      }
    });
    for (const id of edgeIds) {
      if (!selectedLinesRef.current.has(id)) {
        const edgeData = selectedEdgesDataRef.current.get(id);
        if (edgeData && edgeData.length >= 2) {
          const line = new THREE.Line(buildPolylineGeometry(edgeData), selectedMat);
          line.renderOrder = EDGE_SELECTED_RENDER_ORDER;
          scene.add(line);
          selectedLinesRef.current.set(id, line);
        }
      }
    }

    const now = performance.now();
    if (allEdgeLinesRef.current.length > 0) {
      allEdgesMat.opacity = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(now * 0.006));
    }
    if (hoverLineRef.current) applyLinePulse(hoverLineRef.current, 1, now);
    selectedLinesRef.current.forEach((line) => {
      const material = line.material as THREE.Material;
      material.opacity = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.006));
      material.transparent = true;
    });
  });

  return null;
}
