import * as THREE from 'three';
import type { FormCage } from '../../types/cad';
import {
  cageToMesh,
  catmullClarkStep,
  meshToGeometry,
  meshToWireframe,
} from './catmullClarkCore';
import {
  findEdgeLoop,
  findEdgeRing,
  type EdgeSelectionCage,
} from './selectionOps';
import {
  createBoxCageData,
  createCylinderCageData,
  createExtrudeCageData,
  createFaceCageData,
  createLoftCageData,
  createPipeCageData,
  createPlaneCageData,
  createQuadballCageData,
  createRevolveCageData,
  createSphereCageData,
  createSweepCageData,
  createTorusCageData,
} from './primitiveFactories';
import {
  bridge,
  fillHole,
  flatten,
  insertEdge,
  insertPoint,
  interpolateToPoints,
  makeUniform,
  pullToLimitSurface,
  thickenCage,
  unweld,
  weld,
} from './formModelingOps';

export class SubdivisionEngine {
  static subdivide(cage: FormCage, levels: number): THREE.BufferGeometry {
    let mesh = cageToMesh(cage);
    for (let i = 0; i < levels; i++) mesh = catmullClarkStep(mesh);
    return meshToGeometry(mesh);
  }

  static cageWireframe(cage: FormCage): THREE.BufferGeometry {
    return meshToWireframe(cageToMesh(cage));
  }

  static findEdgeLoop(cage: EdgeSelectionCage, startEdgeId: string): string[] {
    return findEdgeLoop(cage, startEdgeId);
  }

  static findEdgeRing(cage: EdgeSelectionCage, startEdgeId: string): string[] {
    return findEdgeRing(cage, startEdgeId);
  }

  static createBoxCageData(width = 20, height = 20, depth = 20, idPrefix = '') {
    return createBoxCageData(width, height, depth, idPrefix);
  }

  static createPlaneCageData(width = 20, height = 20, idPrefix = '') {
    return createPlaneCageData(width, height, idPrefix);
  }

  static createCylinderCageData(radius = 10, height = 20, segments = 4, idPrefix = '') {
    return createCylinderCageData(radius, height, segments, idPrefix);
  }

  static createPipeCageData(pathPoints: THREE.Vector3[], radius: number, segments: number, idPrefix: string) {
    return createPipeCageData(pathPoints, radius, segments, idPrefix);
  }

  static createSphereCageData(radius = 10, idPrefix = '') {
    return createSphereCageData(radius, idPrefix);
  }

  static createTorusCageData(majorRadius = 15, minorRadius = 3, majorSegs = 4, minorSegs = 4, idPrefix = '') {
    return createTorusCageData(majorRadius, minorRadius, majorSegs, minorSegs, idPrefix);
  }

  static createExtrudeCageData(
    ringVerts: THREE.Vector3[],
    direction: THREE.Vector3,
    distance: number,
    idPrefix: string,
    startVertexIndex = 0,
    startEdgeIndex = 0,
    startFaceIndex = 0,
    oldRingIds?: string[],
  ) {
    return createExtrudeCageData(
      ringVerts,
      direction,
      distance,
      idPrefix,
      startVertexIndex,
      startEdgeIndex,
      startFaceIndex,
      oldRingIds,
    );
  }

  static createRevolveCageData(
    profilePoints: THREE.Vector3[],
    axisOrigin: THREE.Vector3,
    axisDir: THREE.Vector3,
    angleDeg: number,
    segments: number,
    idPrefix: string,
  ) {
    return createRevolveCageData(profilePoints, axisOrigin, axisDir, angleDeg, segments, idPrefix);
  }

  static createLoftCageData(
    profiles: Array<Array<{ x: number; y: number }>>,
    positions?: THREE.Vector3[],
    normals?: THREE.Vector3[],
    idPrefix = '',
  ) {
    return createLoftCageData(profiles, positions, normals, idPrefix);
  }

  static createQuadballCageData(radius = 10, idPrefix = '') {
    return createQuadballCageData(radius, idPrefix);
  }

  static createFaceCageData(size = 10, idPrefix = '') {
    return createFaceCageData(size, idPrefix);
  }

  static createSweepCageData(
    pathPoints: THREE.Vector3[],
    profileRing: Array<{ x: number; y: number }>,
    idPrefix: string,
  ) {
    return createSweepCageData(pathPoints, profileRing, idPrefix);
  }

  static insertEdge(cage: FormCage, faceId: string): FormCage {
    return insertEdge(cage, faceId);
  }

  static insertPoint(cage: FormCage, edgeId: string, t = 0.5): FormCage {
    return insertPoint(cage, edgeId, t);
  }

  static bridge(cage: FormCage, loop1VertIds: string[], loop2VertIds: string[]): FormCage {
    return bridge(cage, loop1VertIds, loop2VertIds);
  }

  static fillHole(cage: FormCage, boundaryEdgeId: string): FormCage {
    return fillHole(cage, boundaryEdgeId);
  }

  static weld(cage: FormCage, vertexIds: string[]): FormCage {
    return weld(cage, vertexIds);
  }

  static unweld(cage: FormCage, vertexId: string): FormCage {
    return unweld(cage, vertexId);
  }

  static flatten(
    cage: FormCage,
    vertexIds: string[],
    planeNormal: [number, number, number],
    planeOffset: number,
  ): FormCage {
    return flatten(cage, vertexIds, planeNormal, planeOffset);
  }

  static makeUniform(cage: FormCage, iterations = 3): FormCage {
    return makeUniform(cage, iterations);
  }

  static pullToLimitSurface(cage: FormCage): FormCage {
    return pullToLimitSurface(cage);
  }

  static interpolateToPoints(cage: FormCage, targetPoints: [number, number, number][]): FormCage {
    return interpolateToPoints(cage, targetPoints);
  }

  static thickenCage(cage: FormCage, thickness: number): FormCage {
    return thickenCage(cage, thickness);
  }
}
