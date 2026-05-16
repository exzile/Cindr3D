import * as THREE from 'three';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Sketch, SketchEntity, SketchPlane } from '../../../types/cad';
import {
  computePlaneAxesFromNormal as computePlaneAxesFromNormalUtil,
  getPlaneAxes as getPlaneAxesUtil,
  getPlaneRotation as getPlaneRotationUtil,
  getSketchAxes as getSketchAxesUtil,
  getSketchExtrudeNormal as getSketchExtrudeNormalUtil,
} from '../planeUtils';
import { computeCoplanarFaceBoundary as computeCoplanarFaceBoundaryUtil } from '../coplanarBoundary';
import {
  computeMeshIntersectionCurve as computeMeshIntersectionCurveUtil,
  computePlaneIntersectionCurve as computePlaneIntersectionCurveUtil,
} from '../intersectionUtils';
import {
  alignMeshToCentroid as alignMeshToCentroidOp,
  circularPattern as circularPatternOp,
  combineMeshes as combineMeshesOp,
  createCosmeticThread as createCosmeticThreadOp,
  createRest as createRestOp,
  createRib as createRibOp,
  createWeb as createWebOp,
  draftMesh as draftMeshOp,
  linearPattern as linearPatternOp,
  makeClosedMesh as makeClosedMeshOp,
  meshSectionSketch as meshSectionSketchOp,
  mirrorMesh as mirrorMeshOp,
  patternOnPath as patternOnPathOp,
  planeCutMesh as planeCutMeshOp,
  reverseMeshNormals as reverseMeshNormalsOp,
  reverseNormals as reverseNormalsOp,
  scaleMesh as scaleMeshOp,
  smoothMesh as smoothMeshOp,
  transformMesh as transformMeshOp,
} from '../operations/meshOps';
import {
  createProfileSketch as createProfileSketchImpl,
  createSketchProfileMesh as createSketchProfileMeshImpl,
  getSketchProfileCentroid as getSketchProfileCentroidImpl,
  isSketchClosedProfile as isSketchClosedProfileImpl,
  sketchToProfileShapesFlat as sketchToProfileShapesFlatImpl,
  sketchToShape as sketchToShapeImpl,
  sketchToShapes as sketchToShapesImpl,
} from './sketch/sketchProfiles';
import {
  createEntityGeometry as createEntityGeometryImpl,
  createFilletGeometry as createFilletGeometryImpl,
  createSketchGeometry as createSketchGeometryImpl,
} from './sketch/sketchRendering';
import {
  buildExtrudeFeatureEdges as buildExtrudeFeatureEdgesImpl,
  buildExtrudeFeatureMesh as buildExtrudeFeatureMeshImpl,
  extrudeSketch as extrudeSketchImpl,
  extrudeSketchSurface as extrudeSketchSurfaceImpl,
  extrudeSketchWithTaper as extrudeSketchWithTaperImpl,
  extrudeThinSketch as extrudeThinSketchImpl,
} from './solid/extrusion';
import {
  coilGeometry as coilGeometryImpl,
  revolveFaceBoundary as revolveFaceBoundaryImpl,
  revolveSketch as revolveSketchImpl,
  resolveRevolveSweep as resolveRevolveSweepImpl,
  type RevolveDirection,
} from './solid/revolve';
export type { RevolveDirection } from './solid/revolve';
import {
  loftSketches as loftSketchesImpl,
  patchSketch as patchSketchImpl,
  ruledSurface as ruledSurfaceImpl,
  sweepSketchInternal as sweepSketchInternalImpl,
} from './solid/profileSweeps';
import { pipeGeometry as pipeGeometryImpl } from './solid/pipe';
import { snapFitGeometry as snapFitGeometryImpl } from './solid/snapFit';
import {
  bakeMeshWorldGeometry as bakeMeshWorldGeometryImpl,
  extractMeshGeometry as extractMeshGeometryImpl,
  splitByConnectedComponents as splitByConnectedComponentsImpl,
} from './mesh/meshGeometry';
import {
  remesh as remeshImpl,
  removeFaceAndHeal as removeFaceAndHealImpl,
  shellMesh as shellMeshImpl,
} from './mesh/meshEditing';
import {
  csgIntersect as csgIntersectImpl,
  csgSubtract as csgSubtractImpl,
  csgUnion as csgUnionImpl,
} from './solid/csg';
import {
  createSurfacePrimitive as createSurfacePrimitiveImpl,
  fillSurface as fillSurfaceImpl,
  mergeSurfaces as mergeSurfacesImpl,
  offsetCurveToSurface as offsetCurveToSurfaceImpl,
} from './surface/surfaceBasics';
import {
  computeTextureExtrude as computeTextureExtrudeImpl,
  discretizeCurveOnSurface as discretizeCurveOnSurfaceImpl,
  loadImageAsHeightData as loadImageAsHeightDataImpl,
  projectPointsOntoMesh as projectPointsOntoMeshImpl,
} from './surface/surfaceProjection';
import {
  extendSurface as extendSurfaceImpl,
  offsetSurface as offsetSurfaceImpl,
  thickenSurface as thickenSurfaceImpl,
} from './surface/surfaceEditing';
import {
  stitchSurfaces as stitchSurfacesImpl,
  unstitchSurface as unstitchSurfaceImpl,
} from './surface/surfaceStitching';
import {
  splitSurface as splitSurfaceImpl,
  trimSurface as trimSurfaceImpl,
  untrimSurface as untrimSurfaceImpl,
} from './surface/surfaceTrimSplit';

export { tagShared } from '../materials';

export class GeometryEngine {
  static getPlaneAxes(plane: SketchPlane): { t1: THREE.Vector3; t2: THREE.Vector3 } {
    return getPlaneAxesUtil(plane);
  }

  static computePlaneAxesFromNormal(normal: THREE.Vector3): { t1: THREE.Vector3; t2: THREE.Vector3 } {
    return computePlaneAxesFromNormalUtil(normal);
  }

  static computeCoplanarFaceBoundary(
    mesh: THREE.Mesh,
    faceIndex: number,
    tol = 1e-3,
  ): { boundary: THREE.Vector3[]; normal: THREE.Vector3; centroid: THREE.Vector3 } | null {
    return computeCoplanarFaceBoundaryUtil(mesh, faceIndex, tol);
  }

  static getSketchAxes(sketch: Sketch): { t1: THREE.Vector3; t2: THREE.Vector3 } {
    return getSketchAxesUtil(sketch);
  }

  static getPlaneRotation(plane: 'XY' | 'XZ' | 'YZ'): [number, number, number] {
    return getPlaneRotationUtil(plane);
  }

  static getSketchExtrudeNormal(sketch: Sketch): THREE.Vector3 {
    return getSketchExtrudeNormalUtil(sketch);
  }

  static getSketchProfileCentroid(sketch: Sketch, profileIndex?: number): THREE.Vector3 | null {
    return getSketchProfileCentroidImpl(sketch, profileIndex);
  }

  static createSketchProfileMesh(
    sketch: Sketch,
    material: THREE.Material,
    profileIndex?: number,
  ): THREE.Mesh | null {
    return createSketchProfileMeshImpl(sketch, material, profileIndex);
  }

  static createProfileSketch(sketch: Sketch, profileIndex: number): Sketch | null {
    return createProfileSketchImpl(sketch, profileIndex);
  }

  static sketchToShapes(sketch: Sketch): THREE.Shape[] {
    return sketchToShapesImpl(sketch);
  }

  static sketchToProfileShapesFlat(sketch: Sketch): THREE.Shape[] {
    return sketchToProfileShapesFlatImpl(sketch);
  }

  static createSketchGeometry(sketch: Sketch): THREE.Group {
    return createSketchGeometryImpl(sketch);
  }

  static createEntityGeometry(
    entity: SketchEntity,
    plane: SketchPlane = 'XZ',
    axes?: { t1: THREE.Vector3; t2: THREE.Vector3 },
  ): THREE.Object3D | null {
    return createEntityGeometryImpl(entity, plane, axes);
  }

  static sketchToShape(sketch: Sketch): THREE.Shape | null {
    return sketchToShapeImpl(sketch);
  }

  static isSketchClosedProfile(sketch: Sketch): boolean {
    return isSketchClosedProfileImpl(sketch);
  }

  static createFilletGeometry(mesh: THREE.Mesh, radius: number): THREE.Mesh {
    return createFilletGeometryImpl(mesh, radius);
  }
  static extrudeThinSketch(
    sketch: Sketch,
    distance: number,
    thickness: number,
    side: 'inside' | 'outside' | 'center',
  ): THREE.Mesh | null {
    return extrudeThinSketchImpl(sketch, distance, thickness, side);
  }

  static extrudeSketchWithTaper(sketch: Sketch, distance: number, taperAngleDeg: number): THREE.Mesh | null {
    return extrudeSketchWithTaperImpl(sketch, distance, taperAngleDeg);
  }

  static extrudeSketch(sketch: Sketch, distance: number, profileIndex?: number): THREE.Mesh | null {
    return extrudeSketchImpl(sketch, distance, profileIndex);
  }

  static extrudeSketchSurface(sketch: Sketch, distance: number): THREE.Mesh | null {
    return extrudeSketchSurfaceImpl(sketch, distance);
  }

  static buildExtrudeFeatureMesh(
    sketch: Sketch,
    distance: number,
    direction: 'positive' | 'negative' | 'symmetric' | 'two-sides',
    taperAngleDeg = 0,
    startOffset = 0,
    distance2 = 0,
    taperAngleDeg2 = taperAngleDeg,
  ): THREE.Mesh | null {
    return buildExtrudeFeatureMeshImpl(
      sketch,
      distance,
      direction,
      taperAngleDeg,
      startOffset,
      distance2,
      taperAngleDeg2,
    );
  }

  static buildExtrudeFeatureEdges(sketch: Sketch, distance: number): THREE.BufferGeometry | null {
    return buildExtrudeFeatureEdgesImpl(sketch, distance);
  }

  static splitByConnectedComponents(
    geom: THREE.BufferGeometry,
    tolerance = 1e-4,
  ): THREE.BufferGeometry[] {
    return splitByConnectedComponentsImpl(geom, tolerance);
  }

  static bakeMeshWorldGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
    return bakeMeshWorldGeometryImpl(mesh);
  }

  static csgSubtract(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
    return csgSubtractImpl(a, b);
  }

  static csgUnion(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
    return csgUnionImpl(a, b);
  }

  static csgIntersect(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
    return csgIntersectImpl(a, b);
  }

  static revolveFaceBoundary(
    boundary: THREE.Vector3[],
    axisDir: THREE.Vector3,
    sweep: number,
    isSurface = false,
    phiStart = 0,
  ): THREE.Mesh | null {
    return revolveFaceBoundaryImpl(boundary, axisDir, sweep, isSurface, phiStart);
  }

  static revolveSketch(sketch: Sketch, sweep: number, axis: THREE.Vector3, phiStart = 0): THREE.Mesh | null {
    return revolveSketchImpl(sketch, sweep, axis, phiStart);
  }

  /** Panel angle/angle2/direction → lathe start + total sweep (radians). */
  static resolveRevolveSweep(
    angleDeg: number,
    angle2Deg: number,
    direction: RevolveDirection,
  ): { phiStart: number; sweep: number } {
    return resolveRevolveSweepImpl(angleDeg, angle2Deg, direction);
  }

  /** Internal sweep implementation that takes both the curve and Frenet frames */
  static loftSketches(profileSketches: Sketch[], surface = false): THREE.Mesh | null {
    return loftSketchesImpl(profileSketches, surface);
  }

  static patchSketch(sketch: Sketch): THREE.Mesh | null {
    return patchSketchImpl(sketch);
  }

  static ruledSurface(sketchA: Sketch, sketchB: Sketch): THREE.Mesh | null {
    return ruledSurfaceImpl(sketchA, sketchB);
  }

  static sweepSketchInternal(profileSketch: Sketch, pathSketch: Sketch, surface = false): THREE.Mesh | null {
    return sweepSketchInternalImpl(profileSketch, pathSketch, surface);
  }

  static extractMeshGeometry(mesh: THREE.Mesh | THREE.Group): THREE.BufferGeometry | null {
    return extractMeshGeometryImpl(mesh);
  }

  static coilGeometry(
    outerRadius: number,
    wireRadius: number,
    pitch: number,
    turns: number,
  ): THREE.BufferGeometry {
    return coilGeometryImpl(outerRadius, wireRadius, pitch, turns);
  }

  static pipeGeometry(
    points: THREE.Vector3[],
    outerDiameter: number,
    hollow: boolean,
    wallThickness: number,
  ): THREE.BufferGeometry {
    return pipeGeometryImpl(points, outerDiameter, hollow, wallThickness);
  }

  static snapFitGeometry(
    length: number,
    width: number,
    thickness: number,
    overhang: number,
    overhangAngleDeg: number,
    returnAngleDeg: number,
  ): THREE.BufferGeometry {
    return snapFitGeometryImpl(length, width, thickness, overhang, overhangAngleDeg, returnAngleDeg);
  }

  static async simplifyGeometry(
    geom: THREE.BufferGeometry,
    reductionPercent: number,
  ): Promise<THREE.BufferGeometry> {
    // SimplifyModifier requires an indexed geometry
    const indexed = geom.index ? geom : mergeVertices(geom);

    const posAttr = indexed.getAttribute('position');
    const count = Math.floor(posAttr.count * reductionPercent / 100);
    if (count <= 0) return geom.clone();

    const modifier = new SimplifyModifier();
    const simplified = modifier.modify(indexed, count);
    return simplified;
  }

  static reverseNormals(geom: THREE.BufferGeometry): void {
    reverseNormalsOp(geom);
  }

  static mirrorMesh(source: THREE.Mesh, plane: 'XY' | 'XZ' | 'YZ'): THREE.Mesh {
    return mirrorMeshOp(source, plane);
  }

  static reverseMeshNormals(mesh: THREE.Mesh): THREE.Mesh {
    return reverseMeshNormalsOp(mesh);
  }

  static combineMeshes(meshes: THREE.Mesh[]): THREE.Mesh {
    return combineMeshesOp(meshes);
  }

  static transformMesh(mesh: THREE.Mesh, params: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number; scale: number }): THREE.Mesh {
    return transformMeshOp(mesh, params);
  }

  static scaleMesh(mesh: THREE.Mesh, sx: number, sy: number, sz: number): THREE.Mesh {
    return scaleMeshOp(mesh, sx, sy, sz);
  }


  static computeMeshIntersectionCurve(
    meshA: THREE.Mesh,
    meshB: THREE.Mesh,
    tol = 1e-6,
  ): THREE.Vector3[][] {
    return computeMeshIntersectionCurveUtil(meshA, meshB, tol);
  }

  static computePlaneIntersectionCurve(
    mesh: THREE.Mesh,
    plane: THREE.Plane,
    tol = 1e-6,
  ): THREE.Vector3[][] {
    return computePlaneIntersectionCurveUtil(mesh, plane, tol);
  }


  
  static computeTextureExtrude(
    geometry: THREE.BufferGeometry,
    heightData: Uint8ClampedArray,
    imageWidth: number,
    imageHeight: number,
    strength: number,
    channel: 'r' | 'g' | 'b' | 'luminance' = 'luminance',
  ): THREE.BufferGeometry {
    return computeTextureExtrudeImpl(geometry, heightData, imageWidth, imageHeight, strength, channel);
  }

  static async loadImageAsHeightData(
    url: string,
  ): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
    return loadImageAsHeightDataImpl(url);
  }


  static projectPointsOntoMesh(
    points: THREE.Vector3[],
    mesh: THREE.Mesh,
    direction?: THREE.Vector3,
  ): THREE.Vector3[] {
    return projectPointsOntoMeshImpl(points, mesh, direction);
  }

  static discretizeCurveOnSurface(
    polyline: THREE.Vector3[],
    mesh: THREE.Mesh,
    maxError = 0.1,
    maxDepth = 4,
  ): THREE.Vector3[] {
    return discretizeCurveOnSurfaceImpl(polyline, mesh, maxError, maxDepth);
  }

  static fillSurface(
    boundaryPoints: THREE.Vector3[][],
    continuity: ('G0' | 'G1' | 'G2')[],
  ): THREE.BufferGeometry {
    return fillSurfaceImpl(boundaryPoints, continuity);
  }

  static offsetCurveToSurface(
    points: THREE.Vector3[],
    distance: number,
    referenceNormal: THREE.Vector3,
  ): THREE.BufferGeometry {
    return offsetCurveToSurfaceImpl(points, distance, referenceNormal);
  }

  static mergeSurfaces(meshA: THREE.Mesh, meshB: THREE.Mesh): THREE.BufferGeometry {
    return mergeSurfacesImpl(meshA, meshB);
  }

  static createSurfacePrimitive(
    type: 'plane' | 'box' | 'sphere' | 'cylinder' | 'torus' | 'cone',
    params: Record<string, number>,
  ): THREE.BufferGeometry {
    return createSurfacePrimitiveImpl(type, params);
  }

  static offsetSurface(mesh: THREE.Mesh, distance: number): THREE.BufferGeometry {
    return offsetSurfaceImpl(mesh, distance);
  }

  static extendSurface(
    mesh: THREE.Mesh,
    distance: number,
    mode: 'natural' | 'tangent' | 'perpendicular',
  ): THREE.BufferGeometry {
    return extendSurfaceImpl(mesh, distance, mode);
  }

  static thickenSurface(
    mesh: THREE.Mesh,
    thickness: number,
    direction: 'inside' | 'outside' | 'symmetric',
  ): THREE.BufferGeometry {
    return thickenSurfaceImpl(mesh, thickness, direction);
  }

  static stitchSurfaces(
    meshes: THREE.Mesh[],
    tolerance = 1e-3,
  ): { geometry: THREE.BufferGeometry; isSolid: boolean } {
    return stitchSurfacesImpl(meshes, tolerance);
  }

  static unstitchSurface(mesh: THREE.Mesh): THREE.BufferGeometry[] {
    return unstitchSurfaceImpl(mesh);
  }

  static trimSurface(
    mesh: THREE.Mesh,
    trimmerMesh: THREE.Mesh,
    keepSide: 'inside' | 'outside',
  ): THREE.BufferGeometry {
    return trimSurfaceImpl(mesh, trimmerMesh, keepSide);
  }

  static splitSurface(
    mesh: THREE.Mesh,
    splitter: THREE.Mesh | THREE.Plane,
  ): THREE.BufferGeometry[] {
    return splitSurfaceImpl(mesh, splitter);
  }

  static untrimSurface(mesh: THREE.Mesh, expandFactor = 1.5): THREE.BufferGeometry {
    return untrimSurfaceImpl(mesh, expandFactor);
  }

  static linearPattern(mesh: THREE.Mesh, params: {
    dirX: number; dirY: number; dirZ: number;
    spacing: number; count: number;
    dir2X?: number; dir2Y?: number; dir2Z?: number;
    spacing2?: number; count2?: number;
  }): THREE.Mesh[] {
    return linearPatternOp(mesh, params);
  }

  static circularPattern(mesh: THREE.Mesh, params: {
    axisX: number; axisY: number; axisZ: number;
    originX: number; originY: number; originZ: number;
    count: number; totalAngle: number; // degrees
  }): THREE.Mesh[] {
    return circularPatternOp(mesh, params);
  }

  static planeCutMesh(mesh: THREE.Mesh, planeNormal: THREE.Vector3, planeOffset: number, keepSide: 'positive' | 'negative'): THREE.Mesh {
    return planeCutMeshOp(mesh, planeNormal, planeOffset, keepSide);
  }

  static makeClosedMesh(mesh: THREE.Mesh): THREE.Mesh {
    return makeClosedMeshOp(mesh);
  }

  static smoothMesh(mesh: THREE.Mesh, iterations: number, factor: number = 0.5): THREE.Mesh {
    return smoothMeshOp(mesh, iterations, factor);
  }

  static meshSectionSketch(mesh: THREE.Mesh, plane: THREE.Plane): THREE.Vector3[][] {
    return meshSectionSketchOp(mesh, plane);
  }

  static createRib(profilePoints: THREE.Vector3[], thickness: number, height: number, normal: THREE.Vector3): THREE.Mesh {
    return createRibOp(profilePoints, thickness, height, normal);
  }

  static createWeb(entityPoints: THREE.Vector3[][], thickness: number, height: number, normal: THREE.Vector3): THREE.Mesh {
    return createWebOp(entityPoints, thickness, height, normal);
  }

  static createRest(
    centerX: number, centerY: number, centerZ: number,
    normalX: number, normalY: number, normalZ: number,
    width: number, depth: number, thickness: number,
  ): THREE.Mesh {
    return createRestOp(centerX, centerY, centerZ, normalX, normalY, normalZ, width, depth, thickness);
  }

  static createCosmeticThread(radius: number, pitch: number, length: number, turns?: number): THREE.BufferGeometry {
    return createCosmeticThreadOp(radius, pitch, length, turns);
  }

  static patternOnPath(mesh: THREE.Mesh, pathPoints: THREE.Vector3[], count: number): THREE.Mesh[] {
    return patternOnPathOp(mesh, pathPoints, count);
  }

  static remesh(mesh: THREE.Mesh, mode: 'refine' | 'coarsen', iterations: number): THREE.Mesh {
    return remeshImpl(mesh, mode, iterations);
  }

  static shellMesh(mesh: THREE.Mesh, thickness: number, direction: 'inward' | 'outward' | 'symmetric'): THREE.Mesh {
    return shellMeshImpl(mesh, thickness, direction);
  }

  static draftMesh(mesh: THREE.Mesh, pullAxisDir: THREE.Vector3, draftAngle: number, fixedPlaneY: number = 0): THREE.Mesh {
    return draftMeshOp(mesh, pullAxisDir, draftAngle, fixedPlaneY);
  }

  static removeFaceAndHeal(
    mesh: THREE.Mesh,
    faceNormal: THREE.Vector3,
    faceCentroid: THREE.Vector3,
    normalTolRad: number = 2 * Math.PI / 180,
  ): THREE.Mesh {
    return removeFaceAndHealImpl(mesh, faceNormal, faceCentroid, normalTolRad);
  }

  static alignMeshToCentroid(sourceMesh: THREE.Mesh, targetMesh: THREE.Mesh): THREE.Mesh {
    return alignMeshToCentroidOp(sourceMesh, targetMesh);
  }

}
