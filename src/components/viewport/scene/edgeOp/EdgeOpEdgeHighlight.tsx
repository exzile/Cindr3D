import { useRef, useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree, invalidate as invalidateFrame } from "@react-three/fiber";
import { buildPolylineGeometry } from "../pickerGeometry";
import { applyLinePulse } from "../pickPulse";
import { useOccEdgePicker, type OccEdgePickResult } from "../OccEdgePicker";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import {
  attachTessellationToMesh,
  buildEdgeLineGeometry,
  getMeshTessellation,
} from "../../../../engine/occ/picking";
import { getOccSync } from "../../../../engine/occ/loader";
import { tessellateWithInstance } from "../../../../engine/occ/tessellate";

interface EdgeOpEdgeHighlightProps {
  enabled: boolean;
  edgeIds: string[];
  addEdge: (id: string) => void;
  removeEdge: (id: string) => void;
  selectedColor: number;
  allowCurvedEdges?: boolean;
}

function occEdgeId(result: OccEdgePickResult): string {
  return `occ:${result.bodyId}:${result.edgeId}`;
}

function getOccEdgePolyline(result: OccEdgePickResult): THREE.Vector3[] | null {
  const body = globalBRepBodyRegistry.get(result.bodyId);
  const pts = body?._tessellation?.edgePolylines.get(result.edgeId);
  if (!pts || pts.length < 6) return null;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) {
    out.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
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
        color: 0xff7a00,
        transparent: true,
        opacity: 0.8,
        depthTest: true,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => () => hoverMat.dispose(), [hoverMat]);
  useEffect(() => () => selectedMat.dispose(), [selectedMat]);
  useEffect(() => () => allEdgesMat.dispose(), [allEdgesMat]);

  const allEdgeLinesRef = useRef<THREE.LineSegments[]>([]);
  const hoverLineRef = useRef<THREE.Line | null>(null);
  const occHoverRef = useRef<OccEdgePickResult | null>(null);
  const renderedHoverIdRef = useRef<string | null>(null);
  const selectedLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const selectedEdgesDataRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  const cursorOnRef = useRef(false);
  const { scene: _scene, gl } = useThree();

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
    for (const line of allEdgeLinesRef.current) {
      _scene.remove(line);
      line.geometry.dispose();
    }
    allEdgeLinesRef.current = [];
    if (!enabled) return;

    const lines: THREE.LineSegments[] = [];
    const occ = getOccSync();
    _scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      let tess = getMeshTessellation(obj);
      let bodyId = obj.userData.brepBodyId as string | undefined;
      if (!tess && !bodyId && occ) {
        const featureId = obj.userData.featureId as string | undefined;
        const body = featureId ? globalBRepBodyRegistry.getByFeature(featureId)[0] : undefined;
        if (body) {
          tess = tessellateWithInstance(occ.oc, body);
          bodyId = body.id;
          attachTessellationToMesh(obj, tess, body.id);
        }
      }
      if (!tess || !bodyId) return;
      for (const [edgeId, polyline] of tess.edgePolylines) {
        if (!allowCurvedEdges && polylineIsCurved(polyline)) continue;
        const geometry = buildEdgeLineGeometry(tess, edgeId);
        if (!geometry) continue;
        const line = new THREE.LineSegments(geometry, allEdgesMat);
        line.userData.edgeId = edgeId;
        line.userData.brepBodyId = bodyId;
        line.renderOrder = 1400;
        _scene.add(line);
        lines.push(line);
      }
    });
    allEdgeLinesRef.current = lines;
    invalidateFrame();

    return () => {
      for (const line of lines) {
        _scene.remove(line);
        line.geometry.dispose();
      }
      allEdgeLinesRef.current = allEdgeLinesRef.current.filter((line) => !lines.includes(line));
    };
  }, [enabled, _scene, allEdgesMat, allowCurvedEdges]);

  useFrame(({ scene, invalidate }) => {
    if (!enabled) {
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

    if (occHoverRef.current || selectedLinesRef.current.size > 0 || edgeIds.length > 0 || allEdgeLinesRef.current.length > 0) {
      invalidate();
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
            line.renderOrder = 1401;
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
          line.renderOrder = 1401;
          scene.add(line);
          selectedLinesRef.current.set(id, line);
        }
      }
    }

    const now = performance.now();
    if (hoverLineRef.current) applyLinePulse(hoverLineRef.current, 1, now);
    const selectedLine = selectedLinesRef.current.values().next().value as THREE.Line | undefined;
    if (selectedLine) applyLinePulse(selectedLine, 1, now);
    if (allEdgeLinesRef.current.length > 0) {
      /* eslint-disable-next-line react-hooks/immutability */
      allEdgesMat.opacity = 0.75 + 0.15 * Math.sin(((now % 1000) / 1000) * Math.PI * 2);
    }
  });

  return null;
}
