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

const mkTriangle = (points: Array<[number, number]>): SketchEntity[] => {
  const [p1, p2, p3] = points.map(([x, y]) => mkPoint(x, 0, y));
  return [
    { id: `e${++entityId}`, type: 'line', points: [p1, p2] },
    { id: `e${++entityId}`, type: 'line', points: [p2, p3] },
    { id: `e${++entityId}`, type: 'line', points: [p3, p1] },
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

function profileNetArea(shape: THREE.Shape): number {
  const ringArea = (points: THREE.Vector2[]) => {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      area += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    return Math.abs(area) * 0.5;
  };
  let area = ringArea(shape.getPoints(64));
  for (const hole of shape.holes) area -= ringArea(hole.getPoints(64));
  return area;
}

function meshArea2D(mesh: THREE.Mesh): number {
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let area = 0;
  for (let i = 0; i < position.count; i += 3) {
    const ax = position.getX(i);
    const ay = position.getY(i);
    const bx = position.getX(i + 1);
    const by = position.getY(i + 1);
    const cx = position.getX(i + 2);
    const cy = position.getY(i + 2);
    area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * 0.5;
  }
  return area;
}

function meshTopCapArea(mesh: THREE.Mesh): number {
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let area = 0;
  for (let i = 0; i < position.count; i += 3) {
    const z0 = position.getZ(i);
    const z1 = position.getZ(i + 1);
    const z2 = position.getZ(i + 2);
    if (Math.abs(z0 - z1) > 1e-5 || Math.abs(z1 - z2) > 1e-5 || z0 < 0.001) continue;
    const ax = position.getX(i);
    const ay = position.getY(i);
    const bx = position.getX(i + 1);
    const by = position.getY(i + 1);
    const cx = position.getX(i + 2);
    const cy = position.getY(i + 2);
    area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * 0.5;
  }
  return area;
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

  it('offers an outer profile with an inner triangle excluded plus the triangle itself', () => {
    const sketch = mkSketch([
      ...mkRect(-10, -6, 10, 6),
      ...mkTriangle([[-2, -2], [4, -2], [1, 3]]),
    ]);
    const flatProfiles = GeometryEngine.sketchToProfileShapesFlat(sketch);
    const validProfiles = flatProfiles
      .map((shape, index) => ({ shape, profile: GeometryEngine.createProfileSketch(sketch, index) }))
      .filter((entry) => entry.profile !== null);

    expect(validProfiles.length).toBeGreaterThanOrEqual(2);
    expect(validProfiles.some(({ shape }) => Math.abs(profileNetArea(shape) - 240) / 240 < 0.03)).toBe(false);
    expect(validProfiles.some(({ shape }) => shape.holes.length === 1)).toBe(true);

    const outerWithHole = validProfiles.find(({ shape }) => shape.holes.length === 1)?.shape;
    expect(outerWithHole).toBeDefined();
    expect(profileNetArea(outerWithHole!)).toBeCloseTo(225, 0);
    const outerIndex = flatProfiles.findIndex((shape) => shape === outerWithHole);
    const outerMesh = GeometryEngine.createSketchProfileMesh(sketch, new THREE.MeshBasicMaterial(), outerIndex);
    expect(outerMesh).not.toBeNull();
    expect(meshArea2D(outerMesh!)).toBeCloseTo(225, 0);
    outerMesh?.geometry.dispose();
    (outerMesh?.material as THREE.Material | undefined)?.dispose();
    const outerProfileSketch = GeometryEngine.createProfileSketch(sketch, outerIndex);
    expect(outerProfileSketch).not.toBeNull();
    const profileMesh = GeometryEngine.createSketchProfileMesh(
      outerProfileSketch!,
      new THREE.MeshBasicMaterial(),
    );
    expect(profileMesh).not.toBeNull();
    expect(meshArea2D(profileMesh!)).toBeCloseTo(225, 0);
    profileMesh?.geometry.dispose();
    (profileMesh?.material as THREE.Material | undefined)?.dispose();
    const extrudeMesh = GeometryEngine.buildExtrudeFeatureMesh(outerProfileSketch!, 10, 'positive', 0, 0);
    expect(extrudeMesh).not.toBeNull();
    expect(meshTopCapArea(extrudeMesh!)).toBeCloseTo(225, 0);
    extrudeMesh?.geometry.dispose();
    (extrudeMesh?.material as THREE.Material | undefined)?.dispose();
    expect(validProfiles.some(({ shape }) => shape.holes.length === 0 && profileNetArea(shape) < 20)).toBe(true);
  });

  it('offers an outer profile with multiple inner triangles excluded', () => {
    const sketch = mkSketch([
      ...mkRect(-10, -6, 10, 6),
      ...mkTriangle([[-7, -3], [-3, -3], [-5, 2]]),
      ...mkTriangle([[2, -2], [7, -2], [4.5, 3]]),
    ]);
    const flatProfiles = GeometryEngine.sketchToProfileShapesFlat(sketch);
    const validProfiles = flatProfiles
      .map((shape, index) => ({ shape, profile: GeometryEngine.createProfileSketch(sketch, index) }))
      .filter((entry) => entry.profile !== null);

    expect(validProfiles.some(({ shape }) => Math.abs(profileNetArea(shape) - 240) / 240 < 0.03)).toBe(false);
    expect(validProfiles.some(({ shape }) => shape.holes.length === 2)).toBe(true);
    const outerWithHoles = validProfiles.find(({ shape }) => shape.holes.length === 2)?.shape;
    expect(outerWithHoles).toBeDefined();
    expect(profileNetArea(outerWithHoles!)).toBeCloseTo(217.5, 0);
  });

  it('heals near-miss triangle vertices before building nested profile regions', () => {
    const a1 = mkPoint(-2, 0, -2);
    const a2 = mkPoint(4, 0, -2);
    const b1 = mkPoint(4.04, 0, -1.98);
    const b2 = mkPoint(1, 0, 3);
    const c1 = mkPoint(0.98, 0, 3.03);
    const c2 = mkPoint(-2.02, 0, -1.98);
    const sketch = mkSketch([
      ...mkRect(-10, -6, 10, 6),
      { id: `e${++entityId}`, type: 'line', points: [a1, a2] },
      { id: `e${++entityId}`, type: 'line', points: [b1, b2] },
      { id: `e${++entityId}`, type: 'line', points: [c1, c2] },
    ]);

    const flatProfiles = GeometryEngine.sketchToProfileShapesFlat(sketch);
    const validProfiles = flatProfiles
      .map((shape, index) => ({ shape, profile: GeometryEngine.createProfileSketch(sketch, index) }))
      .filter((entry) => entry.profile !== null);

    expect(validProfiles.some(({ shape }) => shape.holes.length === 1)).toBe(true);
    expect(validProfiles.some(({ shape }) => Math.abs(profileNetArea(shape) - 240) / 240 < 0.03)).toBe(false);
  });

  it('builds selectable regions from straight lines that cross at triangle vertices', () => {
    const sketch = mkSketch([
      ...mkRect(-10, -6, 10, 6),
      { id: `e${++entityId}`, type: 'line', points: [mkPoint(-4, 0, -4), mkPoint(1, 0, 3)] },
      { id: `e${++entityId}`, type: 'line', points: [mkPoint(6, 0, -4), mkPoint(1, 0, 3)] },
      { id: `e${++entityId}`, type: 'line', points: [mkPoint(-5, 0, -2), mkPoint(7, 0, -2)] },
    ]);

    const flatProfiles = GeometryEngine.sketchToProfileShapesFlat(sketch);
    const validProfiles = flatProfiles
      .map((shape, index) => ({ shape, profile: GeometryEngine.createProfileSketch(sketch, index) }))
      .filter((entry) => entry.profile !== null);

    expect(validProfiles.some(({ shape }) => profileNetArea(shape) > 10 && profileNetArea(shape) < 20)).toBe(true);
    expect(validProfiles.some(({ shape }) => Math.abs(profileNetArea(shape) - 240) / 240 < 0.03)).toBe(false);
  });

  it('does not offer unsplit raw shapes when closed profiles cross each other', () => {
    const sketch = mkSketch([
      ...mkRect(-10, -6, 10, 6),
      ...mkTriangle([[-2, -10], [6, 1], [-4, 8]]),
    ]);
    const flatProfiles = GeometryEngine.sketchToProfileShapesFlat(sketch);
    const profiles = flatProfiles
      .map((shape, index) => ({ shape, index, profile: GeometryEngine.createProfileSketch(sketch, index) }))
      .filter((entry) => entry.profile !== null);
    const areas = profiles.map(({ shape }) => profileNetArea(shape)).filter((area) => area > 1e-6);

    expect(areas.length).toBeGreaterThan(2);
    expect(areas.some((area) => Math.abs(area - 240) / 240 < 0.03)).toBe(false);

    const meshAreas = profiles.map(({ index }) => {
      const mesh = GeometryEngine.createSketchProfileMesh(sketch, new THREE.MeshBasicMaterial(), index);
      expect(mesh).not.toBeNull();
      const area = meshArea2D(mesh!);
      mesh?.geometry.dispose();
      (mesh?.material as THREE.Material | undefined)?.dispose();
      return area;
    });
    expect(meshAreas.some((area) => Math.abs(area - 240) / 240 < 0.03)).toBe(false);
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
