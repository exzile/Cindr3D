import * as THREE from 'three';

// ===== Tools =====
export type Tool =
  | 'select'
  | 'line'
  | 'circle'
  | 'rectangle'
  | 'arc'
  | 'spline'
  | 'spline-control'
  | 'polygon'
  | 'slot'
  | 'slot-center'
  | 'slot-overall'
  | 'slot-center-point'
  | 'slot-3point-arc'
  | 'slot-center-arc'
  | 'rectangle-3point'
  | 'rectangle-center'
  | 'circle-2point'
  | 'circle-3point'
  | 'arc-3point'
  | 'arc-tangent'
  | 'polygon-inscribed'
  | 'polygon-circumscribed'
  | 'polygon-edge'
  | 'ellipse'
  | 'point'
  | 'construction-line'
  | 'centerline'
  | 'dimension'
  | 'constrain'
  | 'extrude'
  | 'revolve'
  | 'sweep'
  | 'loft'
  | 'rib'
  | 'fillet'
  | 'chamfer'
  | 'shell'
  | 'draft'
  | 'split'
  | 'offset-face'
  | 'hole'
  | 'thread'
  | 'move'
  | 'rotate'
  | 'scale'
  | 'align'
  | 'measure'
  | 'linear-pattern'
  | 'circular-pattern'
  | 'mirror'
  | 'joint'
  | 'as-built-joint'
  | 'trim'
  | 'break'
  | 'sketch-fillet'
  | 'sketch-rect-pattern'
  | 'sketch-circ-pattern'
  | 'sketch-move'
  | 'sketch-copy'
  | 'sketch-scale'
  | 'sketch-rotate'
  | 'sketch-offset'
  | 'sketch-mirror'
  | 'extend'
  | 'sketch-chamfer-equal'
  | 'sketch-chamfer-two-dist'
  | 'sketch-chamfer-dist-angle'
  | 'midpoint-line'
  | 'circle-2tangent'
  | 'circle-3tangent'
  | 'linetype-convert'
  | 'conic'
  | 'blend-curve'
  // ── Form (T-Spline / subdivision) workspace tools ──
  | 'form-box'
  | 'form-plane'
  | 'form-cylinder'
  | 'form-sphere'
  | 'form-torus'
  | 'form-quadball'
  | 'form-pipe'
  | 'form-face'
  | 'form-extrude'
  | 'form-revolve'
  | 'form-sweep'
  | 'form-loft'
  | 'form-edit'
  | 'form-insert-edge'
  | 'form-insert-point'
  | 'form-subdivide'
  | 'form-bridge'
  | 'form-fill-hole'
  | 'form-weld'
  | 'form-unweld'
  | 'form-crease'
  | 'form-uncrease'
  | 'form-flatten'
  | 'form-uniform'
  | 'form-pull'
  | 'form-interpolate'
  | 'form-thicken'
  | 'form-freeze'
  | 'form-delete'
  | 'patch'
  | 'ruled-surface';

export type ViewMode = '3d' | 'sketch';

export type SketchPlane = 'XY' | 'XZ' | 'YZ' | 'custom';

// ===== Sketch Types =====
export interface SketchPoint {
  id: string;
  x: number;
  y: number;
  z: number;
  isConstruction?: boolean;
}

export interface SketchEntity {
  id: string;
  type: 'line' | 'circle' | 'arc' | 'rectangle' | 'spline' | 'polygon' | 'slot' | 'point' | 'construction-line' | 'centerline';
  points: SketchPoint[];
  closed?: boolean;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  sides?: number;           // for polygon
  isConstruction?: boolean; // construction geometry
  /** S6: projected entities stay linked to their source until unlinked. */
  linked?: boolean;
  constraints?: SketchConstraint[];
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
  | 'curvature';  // G2 curvature continuity between spline and adjacent curve (D51/S10)

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  entityIds: string[];     // entities involved
  pointIndices?: number[]; // specific points on entities
  value?: number;          // for dimensional constraints
}

export interface SketchDimension {
  id: string;
  type: 'linear' | 'angular' | 'radial' | 'diameter';
  entityIds: string[];
  value: number;
  position: { x: number; y: number }; // label position
  driven: boolean; // driven vs driving dimension
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
  componentId?: string;
}

// ===== Feature Types =====
export type FeatureType =
  | 'sketch'
  | 'extrude'
  | 'revolve'
  | 'fillet'
  | 'chamfer'
  | 'shell'
  | 'draft'
  | 'split-body'
  | 'offset-face'
  | 'hole'
  | 'thread'
  | 'linear-pattern'
  | 'circular-pattern'
  | 'mirror'
  | 'combine'
  | 'construction-plane'
  | 'construction-axis'
  | 'import'
  | 'primitive'
  | 'sweep'
  | 'loft'
  | 'thicken'
  | 'rib'
  | 'pattern-on-path'
  | 'scale'
  | 'form';

export type BooleanOperation = 'new-body' | 'join' | 'cut' | 'intersect';

/** Discriminates the kind of body produced by a feature. Defaults to 'solid'. */
export type BodyKind = 'solid' | 'surface' | 'mesh';

export interface Feature {
  id: string;
  name: string;
  type: FeatureType;
  sketchId?: string;
  bodyId?: string;
  componentId?: string;
  params: Record<string, number | string | boolean | number[]>;
  mesh?: THREE.Mesh;
  /** Kind of body produced — solid (default), surface, or mesh. */
  bodyKind?: BodyKind;
  visible: boolean;
  suppressed: boolean;
  timestamp: number;
}

// ===== Form (T-Spline / Catmull-Clark Subdivision) Types =====

export type FormElementType = 'vertex' | 'edge' | 'face';

/** Single vertex in the control cage. crease 0=smooth, 1=corner. */
export interface FormVertex {
  id: string;
  position: [number, number, number];
  crease: number;
}

/** Directed edge between two vertices. crease 0=smooth, 1=sharp. */
export interface FormEdge {
  id: string;
  vertexIds: [string, string];
  crease: number;
}

/** A polygonal face in the control cage (usually quads, tri allowed). */
export interface FormFace {
  id: string;
  /** Vertex IDs in winding order. */
  vertexIds: string[];
}

/** The full control cage representing a T-Spline / subdivision body. */
export interface FormCage {
  id: string;
  name: string;
  vertices: FormVertex[];
  edges: FormEdge[];
  faces: FormFace[];
  subdivisionLevel: number;
  visible: boolean;
  componentId?: string;
}

/** Current selection state for Form editing. */
export interface FormSelection {
  bodyId: string;
  type: FormElementType;
  ids: string[];
}

// ===== Component/Assembly =====
export interface Body {
  id: string;
  name: string;
  componentId: string;
  mesh: THREE.Mesh | THREE.Group | null;
  visible: boolean;
  material: MaterialAppearance;
  featureIds: string[];     // features that built this body
}

export interface Component {
  id: string;
  name: string;
  parentId: string | null;
  childIds: string[];
  bodyIds: string[];
  sketchIds: string[];
  constructionIds: string[];
  jointIds: string[];
  transform: THREE.Matrix4;
  visible: boolean;
  grounded: boolean;       // is this component fixed in space?
  isLinked: boolean;        // linked (external reference) vs embedded
  color: string;
}

// ===== Construction Geometry =====
export type ConstructionType = 'plane' | 'axis' | 'point';

export interface ConstructionGeometry {
  id: string;
  name: string;
  type: ConstructionType;
  componentId: string;
  visible: boolean;
  // Plane
  planeNormal?: THREE.Vector3;
  planeOrigin?: THREE.Vector3;
  planeSize?: number;
  // Axis
  axisDirection?: THREE.Vector3;
  axisOrigin?: THREE.Vector3;
  axisLength?: number;
  // Point
  point?: THREE.Vector3;
  // How it was created
  definition: ConstructionDefinition;
}

export type ConstructionDefinition =
  | { method: 'offset-plane'; referencePlane: string; distance: number }
  | { method: 'midplane'; plane1: string; plane2: string }
  | { method: 'angle-plane'; referencePlane: string; angle: number; axis: string }
  | { method: 'tangent-plane'; faceId: string; point: { x: number; y: number; z: number } }
  | { method: 'three-points'; points: [string, string, string] }
  | { method: 'axis-through-points'; point1: string; point2: string }
  | { method: 'axis-perpendicular'; plane: string; point: string }
  | { method: 'point-at-vertex'; vertexId: string }
  | { method: 'origin'; axis: 'x' | 'y' | 'z' };

// ===== Joints =====
export type JointType =
  | 'rigid'
  | 'revolute'
  | 'slider'
  | 'cylindrical'
  | 'pin-slot'
  | 'planar'
  | 'ball';

export interface Joint {
  id: string;
  name: string;
  type: JointType;
  componentId1: string;
  componentId2: string;
  origin: THREE.Vector3;
  axis?: THREE.Vector3;
  // Limits
  rotationLimits?: { min: number; max: number };
  translationLimits?: { min: number; max: number };
  // Current state
  rotationValue: number;
  translationValue: number;
  locked: boolean;
}

// ===== Pattern Features =====
export interface LinearPatternParams {
  featureIds: string[];
  direction: THREE.Vector3;
  count: number;
  spacing: number;
  secondDirection?: THREE.Vector3;
  secondCount?: number;
  secondSpacing?: number;
}

export interface CircularPatternParams {
  featureIds: string[];
  axis: THREE.Vector3;
  axisOrigin: THREE.Vector3;
  count: number;
  totalAngle: number;     // degrees, 360 = full
  symmetric: boolean;
}

export interface MirrorParams {
  featureIds: string[];
  mirrorPlane: string;    // construction plane ID or 'XY' | 'XZ' | 'YZ'
}

// ===== Materials/Appearance =====
export interface MaterialAppearance {
  id: string;
  name: string;
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  texture?: string;
  category: MaterialCategory;
}

export type MaterialCategory =
  | 'metal'
  | 'plastic'
  | 'wood'
  | 'ceramic'
  | 'glass'
  | 'composite'
  | 'rubber'
  | 'custom';

// ===== Defaults =====
export const DEFAULT_MATERIALS: MaterialAppearance[] = [
  { id: 'aluminum', name: 'Aluminum', color: '#B0B8C0', metalness: 0.8, roughness: 0.3, opacity: 1, category: 'metal' },
  { id: 'steel', name: 'Steel', color: '#8090A0', metalness: 0.9, roughness: 0.35, opacity: 1, category: 'metal' },
  { id: 'stainless', name: 'Stainless Steel', color: '#C8CCD0', metalness: 0.85, roughness: 0.2, opacity: 1, category: 'metal' },
  { id: 'brass', name: 'Brass', color: '#C8A84A', metalness: 0.9, roughness: 0.25, opacity: 1, category: 'metal' },
  { id: 'copper', name: 'Copper', color: '#C87040', metalness: 0.9, roughness: 0.3, opacity: 1, category: 'metal' },
  { id: 'titanium', name: 'Titanium', color: '#8A9098', metalness: 0.75, roughness: 0.4, opacity: 1, category: 'metal' },
  { id: 'abs', name: 'ABS Plastic', color: '#E8E0D0', metalness: 0, roughness: 0.6, opacity: 1, category: 'plastic' },
  { id: 'pla', name: 'PLA Plastic', color: '#D0D8E0', metalness: 0, roughness: 0.5, opacity: 1, category: 'plastic' },
  { id: 'nylon', name: 'Nylon', color: '#F0EDE8', metalness: 0, roughness: 0.55, opacity: 1, category: 'plastic' },
  { id: 'acrylic', name: 'Acrylic', color: '#E0F0FF', metalness: 0.1, roughness: 0.1, opacity: 0.8, category: 'plastic' },
  { id: 'polycarbonate', name: 'Polycarbonate', color: '#E8E8F0', metalness: 0.05, roughness: 0.15, opacity: 0.85, category: 'plastic' },
  { id: 'oak', name: 'Oak Wood', color: '#A07840', metalness: 0, roughness: 0.8, opacity: 1, category: 'wood' },
  { id: 'walnut', name: 'Walnut', color: '#604030', metalness: 0, roughness: 0.75, opacity: 1, category: 'wood' },
  { id: 'rubber-black', name: 'Rubber (Black)', color: '#303030', metalness: 0, roughness: 0.9, opacity: 1, category: 'rubber' },
  { id: 'glass-clear', name: 'Glass (Clear)', color: '#E8F0FF', metalness: 0.1, roughness: 0.05, opacity: 0.3, category: 'glass' },
  { id: 'carbon-fiber', name: 'Carbon Fiber', color: '#202020', metalness: 0.3, roughness: 0.5, opacity: 1, category: 'composite' },
  { id: 'ceramic-white', name: 'Ceramic (White)', color: '#F0F0F0', metalness: 0.1, roughness: 0.3, opacity: 1, category: 'ceramic' },
];

export const DEFAULT_COMPONENT_COLORS = [
  '#5B9BD5', '#ED7D31', '#70AD47', '#FFC000', '#5B5EA6',
  '#44C4A1', '#FF6B6B', '#C678DD', '#E06C75', '#98C379',
];

// ===== Legacy compat =====
export interface ImportedModel {
  id: string;
  name: string;
  fileName: string;
  mesh: THREE.Group;
}

export interface CameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export type SnapType = 'grid' | 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'nearest';

export interface SnapPoint {
  point: THREE.Vector3;
  type: SnapType;
}

// ===== Parameters =====
export interface Parameter {
  id: string;
  name: string;         // valid identifier, e.g. "width"
  expression: string;  // e.g. "50" or "width / 2 + 5"
  value: number;        // resolved numeric value
  description?: string;
  group?: string;
}
