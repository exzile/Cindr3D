/**
 * ConstructionGeometryInteraction — handles D175–D180 construction geometry tools.
 *
 * Mounts picker hooks for edge / vertex / face picking and converts user clicks
 * into addConstructionPlane / addConstructionAxis / addConstructionPoint store calls.
 */

import { useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useEdgePicker, type EdgePickResult } from '../../../hooks/useEdgePicker';
import { useVertexPicker, type VertexPickResult } from '../../../hooks/useVertexPicker';
import { useFacePicker, type FacePickResult } from '../../../hooks/useFacePicker';

// ── Module-level scratch (reused across calls — never in render/frame) ─────────
const _crossResult = new THREE.Vector3();
const _fallbackUp = new THREE.Vector3(0, 1, 0);

export default function ConstructionGeometryInteraction() {
  const activeTool = useCADStore((s) => s.activeTool);
  const addConstructionPlane = useCADStore((s) => s.addConstructionPlane);
  const addConstructionAxis = useCADStore((s) => s.addConstructionAxis);
  const addConstructionPoint = useCADStore((s) => s.addConstructionPoint);
  const cancelConstructTool = useCADStore((s) => s.cancelConstructTool);

  const [step1Edge, setStep1Edge] = useState<EdgePickResult | null>(null);
  const [step1Vertex, setStep1Vertex] = useState<VertexPickResult | null>(null);
  // Stores the face normal captured in step 1 for D187 / D189 two-step tools
  const [step1Normal, setStep1Normal] = useState<THREE.Vector3 | null>(null);

  // Reset intermediate state whenever the active tool changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep1Edge(null);
    setStep1Vertex(null);
    setStep1Normal(null);
  }, [activeTool]);

  const isEdgeTool = (
    activeTool === 'construct-plane-two-edges' ||
    activeTool === 'construct-axis-through-edge' ||
    activeTool === 'construct-point-two-edges'
  );
  const isVertexTool = (
    activeTool === 'construct-axis-two-points' ||
    activeTool === 'construct-point-vertex' ||
    activeTool === 'construct-plane-tangent-at-point' ||
    activeTool === 'construct-axis-perp-at-point'
  );
  const isFaceTool = (
    activeTool === 'construct-point-center' ||
    activeTool === 'construct-tangent-plane' ||
    activeTool === 'construct-axis-cylinder' ||
    activeTool === 'construct-plane-tangent-at-point' ||
    activeTool === 'construct-axis-perp-at-point'
  );

  // ── Edge click handler ────────────────────────────────────────────────────
  const handleEdgeClick = useCallback((result: EdgePickResult) => {
    // D175: Plane Through Two Edges
    if (activeTool === 'construct-plane-two-edges') {
      if (step1Edge === null) {
        setStep1Edge(result);
        useCADStore.getState().setStatusMessage('Plane Through Two Edges: click second edge');
        return;
      }
      // Compute normal from cross product of the two directions
      _crossResult.crossVectors(step1Edge.direction, result.direction);
      let normal: THREE.Vector3;
      if (_crossResult.lengthSq() < 1e-8) {
        // Parallel edges — fallback: use any perpendicular to the edge direction
        normal = result.direction.clone().cross(_fallbackUp).normalize();
        if (normal.lengthSq() < 1e-8) {
          normal = result.direction.clone().cross(new THREE.Vector3(1, 0, 0)).normalize();
        }
      } else {
        normal = _crossResult.clone().normalize();
      }
      const origin = step1Edge.midpoint.clone();
      addConstructionPlane({
        origin: origin.toArray() as [number, number, number],
        normal: normal.toArray() as [number, number, number],
        size: 10,
      });
      setStep1Edge(null);
      cancelConstructTool();
      return;
    }

    // D176: Axis Through Edge (single pick)
    if (activeTool === 'construct-axis-through-edge') {
      const edgeLength = result.edgeVertexA.distanceTo(result.edgeVertexB);
      addConstructionAxis({
        origin: result.midpoint.toArray() as [number, number, number],
        direction: result.direction.toArray() as [number, number, number],
        length: edgeLength * 2,
      });
      cancelConstructTool();
      return;
    }

    // D179: Point Through Two Edges
    if (activeTool === 'construct-point-two-edges') {
      if (step1Edge === null) {
        setStep1Edge(result);
        useCADStore.getState().setStatusMessage('Point Through Two Edges: click second edge');
        return;
      }
      // Find closest point between the two edge segments.
      // Use the parametric line-line closest point formula on the midpoint + direction representation.
      // Since direction is normalized we use midpoint as base point and full edge half-length as extent.
      const d1 = step1Edge.direction;
      const d2 = result.direction;
      const r = step1Edge.midpoint.clone().sub(result.midpoint);
      const a = d1.dot(d1); // 1 (normalized)
      const e = d2.dot(d2); // 1 (normalized)
      const f = d2.dot(r);
      const c = d1.dot(r);
      const b = d1.dot(d2);
      const denom = a * e - b * b;

      let closestA: THREE.Vector3;
      let closestB: THREE.Vector3;

      if (Math.abs(denom) > 1e-8) {
        const s = THREE.MathUtils.clamp((b * f - c * e) / denom, -1, 1);
        const t = THREE.MathUtils.clamp((b * s + f) / e, -1, 1);
        closestA = step1Edge.midpoint.clone().addScaledVector(d1, s);
        closestB = result.midpoint.clone().addScaledVector(d2, t);
      } else {
        // Parallel — just average the two midpoints
        closestA = step1Edge.midpoint.clone();
        closestB = result.midpoint.clone();
      }

      const midpoint = closestA.clone().add(closestB).multiplyScalar(0.5);
      addConstructionPoint({
        position: midpoint.toArray() as [number, number, number],
      });
      setStep1Edge(null);
      cancelConstructTool();
      return;
    }
  }, [activeTool, step1Edge, addConstructionPlane, addConstructionAxis, addConstructionPoint, cancelConstructTool]);

  // ── Vertex click handler ──────────────────────────────────────────────────
  const handleVertexClick = useCallback((result: VertexPickResult) => {
    // D177: Axis Through Two Points
    if (activeTool === 'construct-axis-two-points') {
      if (step1Vertex === null) {
        setStep1Vertex(result);
        useCADStore.getState().setStatusMessage('Axis Through Two Points: click second point');
        return;
      }
      const dir = result.position.clone().sub(step1Vertex.position).normalize();
      const len = step1Vertex.position.distanceTo(result.position);
      addConstructionAxis({
        origin: step1Vertex.position.toArray() as [number, number, number],
        direction: dir.toArray() as [number, number, number],
        length: len * 1.5,
      });
      setStep1Vertex(null);
      cancelConstructTool();
      return;
    }

    // D178: Point at Vertex (single pick)
    if (activeTool === 'construct-point-vertex') {
      addConstructionPoint({
        position: result.position.toArray() as [number, number, number],
      });
      cancelConstructTool();
      return;
    }

    // D187: Plane Tangent to Face at Point — step 2: pick vertex, use stored face normal
    if (activeTool === 'construct-plane-tangent-at-point') {
      if (step1Normal === null) {
        // User clicked a vertex before picking a face — prompt again
        useCADStore.getState().setStatusMessage('Plane Tangent at Point: click a curved face first');
        return;
      }
      addConstructionPlane({
        origin: result.position.toArray() as [number, number, number],
        normal: step1Normal.toArray() as [number, number, number],
        size: 10,
      });
      setStep1Normal(null);
      cancelConstructTool();
      return;
    }

    // D189: Axis Perpendicular at Point — step 2: pick vertex, use stored face normal
    if (activeTool === 'construct-axis-perp-at-point') {
      if (step1Normal === null) {
        useCADStore.getState().setStatusMessage('Axis Perpendicular at Point: click a planar face first');
        return;
      }
      addConstructionAxis({
        origin: result.position.toArray() as [number, number, number],
        direction: step1Normal.toArray() as [number, number, number],
        length: 20,
      });
      setStep1Normal(null);
      cancelConstructTool();
      return;
    }
  }, [activeTool, step1Vertex, step1Normal, addConstructionAxis, addConstructionPlane, addConstructionPoint, cancelConstructTool]);

  // ── Face click handler ────────────────────────────────────────────────────
  const handleFaceClick = useCallback((result: FacePickResult) => {
    // D180: Point at Center of Circle/Sphere/Torus (centroid of picked face)
    if (activeTool === 'construct-point-center') {
      addConstructionPoint({
        position: result.centroid.toArray() as [number, number, number],
      });
      cancelConstructTool();
      return;
    }

    // D186: Tangent Plane — single face pick
    if (activeTool === 'construct-tangent-plane') {
      addConstructionPlane({
        origin: result.centroid.toArray() as [number, number, number],
        normal: result.normal.toArray() as [number, number, number],
        size: 10,
      });
      cancelConstructTool();
      return;
    }

    // D187: Plane Tangent to Face at Point — step 1: pick face, store normal
    if (activeTool === 'construct-plane-tangent-at-point') {
      if (step1Normal === null) {
        setStep1Normal(result.normal.clone());
        useCADStore.getState().setStatusMessage('Plane Tangent at Point: now click a vertex');
        return;
      }
      // step 2 is handled in handleVertexClick
      return;
    }

    // D188: Axis Through Cylinder/Cone/Torus — single face pick
    if (activeTool === 'construct-axis-cylinder') {
      addConstructionAxis({
        origin: result.centroid.toArray() as [number, number, number],
        direction: result.normal.toArray() as [number, number, number],
        length: 20,
      });
      cancelConstructTool();
      return;
    }

    // D189: Axis Perpendicular at Point — step 1: pick face, store normal
    if (activeTool === 'construct-axis-perp-at-point') {
      if (step1Normal === null) {
        setStep1Normal(result.normal.clone());
        useCADStore.getState().setStatusMessage('Axis Perpendicular at Point: now click a vertex');
        return;
      }
      // step 2 is handled in handleVertexClick
      return;
    }
  }, [activeTool, step1Normal, addConstructionPlane, addConstructionAxis, addConstructionPoint, cancelConstructTool]);

  // ── Picker hooks ──────────────────────────────────────────────────────────
  useEdgePicker({
    enabled: isEdgeTool,
    onHover: () => {},
    onClick: handleEdgeClick,
  });

  useVertexPicker({
    enabled: isVertexTool,
    onHover: () => {},
    onClick: handleVertexClick,
  });

  useFacePicker({
    enabled: isFaceTool,
    onHover: () => {},
    onClick: handleFaceClick,
  });

  return null;
}
