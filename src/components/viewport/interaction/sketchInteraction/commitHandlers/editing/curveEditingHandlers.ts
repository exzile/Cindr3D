import * as THREE from 'three';
import { findBlendEndpoint, sampleCubicBezier } from '../../helpers';
import type { SketchPoint } from '../../../../../../types/cad';
import type { SketchCommitHandler } from '../types';

export const handleCurveEditingCommit: SketchCommitHandler = (ctx) => {
  const {
    activeTool,
    activeSketch,
    sketchPoint,
    drawingPoints,
    setDrawingPoints,
    t1,
    t2,
    addSketchEntity,
    setStatusMessage,
    blendCurveMode,
  } = ctx;

  switch (activeTool) {
    case 'blend-curve': {
      const clickedWorld = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
      const hit = findBlendEndpoint(clickedWorld, activeSketch);
      if (!hit) {
        setStatusMessage('Blend Curve: click near an endpoint of a sketch entity');
        return true;
      }

      if (drawingPoints.length === 0) {
        const tangentPt: SketchPoint = {
          id: crypto.randomUUID(),
          x: hit.endpoint.x + hit.tangent.x * 0.001,
          y: hit.endpoint.y + hit.tangent.y * 0.001,
          z: hit.endpoint.z + hit.tangent.z * 0.001,
        };
        const endPt: SketchPoint = {
          id: crypto.randomUUID(),
          x: hit.endpoint.x,
          y: hit.endpoint.y,
          z: hit.endpoint.z,
        };
        setDrawingPoints([endPt, tangentPt]);
        setStatusMessage(`Blend Curve: first endpoint set (${blendCurveMode.toUpperCase()}) - click second endpoint`);
      } else if (drawingPoints.length >= 2) {
        const p0 = new THREE.Vector3(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z);
        const tanRef = new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
        const tangentA = tanRef.clone().sub(p0).normalize();
        const p3 = hit.endpoint;
        const tangentB = hit.tangent;
        const samples = sampleCubicBezier(p0, tangentA, p3, tangentB, 32);
        addSketchEntity({
          id: crypto.randomUUID(),
          type: 'spline',
          points: samples.map((v) => ({ id: crypto.randomUUID(), x: v.x, y: v.y, z: v.z })),
          closed: false,
        });
        setDrawingPoints([]);
        setStatusMessage(`Blend Curve (${blendCurveMode.toUpperCase()}) added`);
      }
      return true;
    }

    case 'isoparametric': {
      const clickWorld = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z);
      const isoValue = clickWorld.dot(t1);
      const along = t2;
      const fixed = t1;
      const base = fixed.clone().multiplyScalar(isoValue);
      const p1World = base.clone().addScaledVector(along, -500);
      const p2World = base.clone().addScaledVector(along, 500);
      const startPt: SketchPoint = { id: crypto.randomUUID(), x: p1World.x, y: p1World.y, z: p1World.z };
      const endPt: SketchPoint = { id: crypto.randomUUID(), x: p2World.x, y: p2World.y, z: p2World.z };
      addSketchEntity({
        id: crypto.randomUUID(),
        type: 'isoparametric',
        points: [startPt, endPt],
        isConstruction: true,
        isoParamDir: 'u',
        isoParamValue: isoValue,
      });
      setDrawingPoints([]);
      setStatusMessage(`Iso Curve (U) placed at ${isoValue.toFixed(2)} - click again for another`);
      return true;
    }
  }

  void activeSketch;
  return false;
};
