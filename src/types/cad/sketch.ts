import * as THREE from 'three';
import type { SketchPlane } from './core';

export interface SketchPoint {
  id: string;
  x: number;
  y: number;
  z: number;
  isConstruction?: boolean;
}

export type ConstraintType =
  | 'coincident'
  | 'concentric'
  | 'collinear'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'equal'
  | 'symmetric'
  | 'horizontal'
  | 'vertical'
  | 'fix'
  | 'midpoint'
  | 'curvature'
  | 'offset'
  | 'coincident-surface'
  | 'perpendicular-surface'
  | 'line-on-surface'
  | 'distance-surface'
  | 'polygon'
  | 'line-parallel-surface';

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  entityIds: string[];
  pointIndices?: number[];
  value?: number;
  surfacePlane?: { nu: number; nv: number; d: number };
}

export interface SketchEntity {
  id: string;
  type:
    | 'line'
    | 'circle'
    | 'arc'
    | 'rectangle'
    | 'spline'
    | 'polygon'
    | 'slot'
    | 'point'
    | 'construction-line'
    | 'centerline'
    | 'ellipse'
    | 'elliptical-arc'
    | 'isoparametric';
  points: SketchPoint[];
  closed?: boolean;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  sides?: number;
  isConstruction?: boolean;
  linked?: boolean;
  constraints?: SketchConstraint[];
  cx?: number;
  cy?: number;
  majorRadius?: number;
  minorRadius?: number;
  rotation?: number;
  isoParamDir?: 'u' | 'v';
  isoParamValue?: number;
  isoParamBodyId?: string;
}

export type DimensionOrientation = 'horizontal' | 'vertical' | 'auto';

/**
 * Concrete type a *committed* dimension can have. Always resolved — a stored
 * SketchDimension is never 'auto'.
 */
export type DimensionType = 'linear' | 'angular' | 'radial' | 'diameter' | 'arc-length' | 'aligned' | 'linear-diameter' | 'ellipse-major' | 'ellipse-minor' | 'concentric-gap';

/**
 * Type selectable in the Dimension panel. 'auto' is the Fusion-style modeless
 * default: the concrete type is inferred from what the user clicks. The hook
 * resolves 'auto' to a concrete {@link DimensionType} before committing.
 */
export type DimensionToolType = DimensionType | 'auto';

export interface SketchDimension {
  id: string;
  type: DimensionType;
  entityIds: string[];
  value: number;
  position: { x: number; y: number };
  driven: boolean;
  orientation?: DimensionOrientation;
  toleranceUpper?: number;
  toleranceLower?: number;
}

export interface Sketch {
  id: string;
  name: string;
  plane: SketchPlane;
  planeNormal: THREE.Vector3;
  planeOrigin: THREE.Vector3;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  dimensions: SketchDimension[];
  fullyConstrained: boolean;
  overConstrained?: boolean;
  componentId?: string;
  arePointsShown?: boolean;
  areProfilesShown?: boolean;
  areDimensionsShown?: boolean;
  areConstraintsShown?: boolean;
}
