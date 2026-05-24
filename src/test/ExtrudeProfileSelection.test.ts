import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Feature, Sketch, SketchEntity } from '../types/cad';
import { GeometryEngine } from '../engine/GeometryEngine';
import {
  getExtrudeProfileOptions,
  getExtrudeProfileUsage,
  sketchProfileSelectionId,
} from '../components/viewport/extrude/profileSelection';

let pointId = 0;
let entityId = 0;

const mkPoint = (x: number, y: number, z = 0) => ({ id: `p${++pointId}`, x, y, z });

const mkCircle = (cx: number, cy: number, radius: number): SketchEntity => ({
  id: `e${++entityId}`,
  type: 'circle',
  points: [mkPoint(cx, 0, cy)],
  radius,
});

const mkRect = (x1: number, y1: number, x2: number, y2: number): SketchEntity[] => {
  const p1 = mkPoint(x1, 0, y1);
  const p2 = mkPoint(x2, 0, y1);
  const p3 = mkPoint(x2, 0, y2);
  const p4 = mkPoint(x1, 0, y2);
  return [
    { id: `e${++entityId}`, type: 'line', points: [p1, p2] },
    { id: `e${++entityId}`, type: 'line', points: [p2, p3] },
    { id: `e${++entityId}`, type: 'line', points: [p3, p4] },
    { id: `e${++entityId}`, type: 'line', points: [p4, p1] },
  ];
};

function mkSketch(entities: SketchEntity[], id = 'sketch-1'): Sketch {
  return {
    id,
    name: 'Sketch 1',
    plane: 'XY',
    planeNormal: new THREE.Vector3(0, 1, 0),
    planeOrigin: new THREE.Vector3(0, 0, 0),
    entities,
    constraints: [],
    dimensions: [],
    fullyConstrained: false,
  };
}

function mkExtrudeFeature(params: Feature['params']): Feature {
  return {
    id: `feature-${++entityId}`,
    name: 'Extrude',
    type: 'extrude',
    sketchId: 'sketch-1',
    params,
    visible: true,
    suppressed: false,
    timestamp: entityId,
  };
}

describe('extrude profile selection helpers', () => {
  it('lists all valid flat sketch profiles for a rectangle with two circles', () => {
    const sketch = mkSketch([
      ...mkRect(-10, -6, 10, 6),
      mkCircle(-4, 0, 1.5),
      mkCircle(4, 0, 1.5),
    ]);
    const flatProfiles = GeometryEngine.sketchToProfileShapesFlat(sketch);
    const expectedIds = flatProfiles
      .map((_, index) => sketchProfileSelectionId(sketch.id, index))
      .filter((id) => {
        const profileIndex = Number(id.split('::')[1]);
        return GeometryEngine.createProfileSketch(sketch, profileIndex) !== null;
      });

    const options = getExtrudeProfileOptions({
      extrudable: [sketch],
      sketches: [sketch],
      selectedIds: [],
      timelineSketchNames: new Map([[sketch.id, 'Sketch 1']]),
      consumedProfileIds: new Set(),
    });

    expect(options.map((option) => option.id)).toEqual(expectedIds);
    expect(options.length).toBeGreaterThanOrEqual(3);

    const outerProfileIndex = flatProfiles.findIndex((_, index) => {
      const profile = GeometryEngine.createProfileSketch(sketch, index);
      if (!profile) return false;
      return GeometryEngine.sketchToShapes(profile).some((shape) => shape.holes.length === 2);
    });
    expect(outerProfileIndex).toBeGreaterThanOrEqual(0);
    const outerProfile = GeometryEngine.createProfileSketch(sketch, outerProfileIndex);
    expect(outerProfile).not.toBeNull();
    const outerShapes = GeometryEngine.sketchToShapes(outerProfile!);
    expect(outerShapes[0].holes.length).toBe(2);
  });

  it('keeps unused profiles available after a multi-profile extrude', () => {
    const feature = mkExtrudeFeature({ profileIndices: [1, 2] });
    const usage = getExtrudeProfileUsage([feature], null);

    expect(usage.fullyUsedSketchIds.has('sketch-1')).toBe(false);
    expect(usage.consumedProfileIds.has('sketch-1::1')).toBe(true);
    expect(usage.consumedProfileIds.has('sketch-1::2')).toBe(true);
    expect(usage.consumedProfileIds.has('sketch-1::0')).toBe(false);
  });

  it('reserves the whole sketch only for legacy sketch-level extrudes', () => {
    const feature = mkExtrudeFeature({});
    const usage = getExtrudeProfileUsage([feature], null);

    expect(usage.fullyUsedSketchIds.has('sketch-1')).toBe(true);
    expect(usage.consumedProfileIds.size).toBe(0);
  });
});
