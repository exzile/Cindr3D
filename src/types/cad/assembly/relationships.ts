export type ComponentConstraintType = 'mate' | 'flush' | 'angle' | 'tangent' | 'insert';

export interface ComponentConstraintEntity {
  componentId: string;
  faceId: string;
  normal: [number, number, number];
  centroid: [number, number, number];
}

export interface ComponentConstraint {
  id: string;
  type: ComponentConstraintType;
  entityA: ComponentConstraintEntity;
  entityB: ComponentConstraintEntity;
  angle?: number;
  offset?: number;
  suppressed: boolean;
}

export interface RigidGroup {
  id: string;
  name: string;
  componentIds: string[];
}

export interface MotionLink {
  id: string;
  name: string;
  sourceJointId: string;
  targetJointId: string;
  ratio: number;
  offset: number;
}

export interface ContactSetEntry {
  id: string;
  name: string;
  component1Id: string;
  component2Id: string;
  enabled: boolean;
}

export interface SelectionSet {
  id: string;
  name: string;
  bodyIds: string[];
}
