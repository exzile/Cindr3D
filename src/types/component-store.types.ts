import * as THREE from 'three';
import type {
  Body,
  Component,
  ComponentConstraint,
  ComponentDefinition,
  ComponentOccurrence,
  ConstructionGeometry,
  Joint,
  JointTrack,
  MaterialAppearance,
  MotionLink,
  RigidGroup,
} from './cad';
import type { MirrorComponentParams } from '../components/dialogs/assembly/MirrorComponentDialog';

export interface ComponentStore {
  rootComponentId: string;
  components: Record<string, Component>;
  bodies: Record<string, Body>;
  constructions: Record<string, ConstructionGeometry>;
  joints: Record<string, Joint>;

  rigidGroups: RigidGroup[];
  addRigidGroup(componentIds: string[], name?: string): void;
  removeRigidGroup(id: string): void;

  motionLinks: MotionLink[];
  addMotionLink(link: Omit<MotionLink, 'id'>): void;
  removeMotionLink(id: string): void;

  activeComponentId: string | null;
  setActiveComponentId: (id: string | null) => void;
  selectedBodyId: string | null;
  setSelectedBodyId: (id: string | null) => void;
  newDocument: () => void;

  addComponent: (parentId: string, name?: string) => string;
  removeComponent: (id: string) => void;
  renameComponent: (id: string, name: string) => void;
  duplicateComponent: (id: string) => string;
  mirrorComponent: (params: MirrorComponentParams) => string | null;
  duplicateComponentWithJoints: (componentId: string) => string;
  toggleComponentVisibility: (id: string) => void;
  setComponentGrounded: (id: string, grounded: boolean) => void;
  makeComponentIndependent: (id: string) => void;
  moveComponent: (id: string, newParentId: string) => void;

  addBody: (componentId: string, name?: string) => string;
  removeBody: (id: string) => void;
  renameBody: (id: string, name: string) => void;
  toggleBodyVisibility: (id: string) => void;
  isolateBody: (id: string) => void;
  showAllBodies: () => void;
  setBodyMaterial: (id: string, material: MaterialAppearance) => void;
  setBodyMesh: (id: string, mesh: THREE.Mesh | THREE.Group) => void;
  addFeatureToBody: (bodyId: string, featureId: string) => void;
  removeFeatureFromBody: (bodyId: string, featureId: string) => void;
  setBodyOpacity: (id: string, opacity: number) => void;
  toggleBodySelectable: (id: string) => void;
  mirrorBody: (bodyId: string, plane: 'XY' | 'XZ' | 'YZ') => string | null;
  copyBody: (bodyId: string) => string | null;
  createComponentFromBody: (bodyId: string) => string | null;
  clipboardBodyId: string | null;
  setClipboardBody: (bodyId: string | null) => void;
  pasteBody: () => string | null;
  setBodyDeflectionOverride: (bodyId: string, deflection: number | undefined) => void;

  addConstruction: (geometry: Omit<ConstructionGeometry, 'id'>) => string;
  removeConstruction: (id: string) => void;
  toggleConstructionVisibility: (id: string) => void;

  addJoint: (joint: Omit<Joint, 'id'>) => string;
  removeJoint: (id: string) => void;
  setJointValue: (id: string, rotation?: number, translation?: number) => void;
  toggleJointLock: (id: string) => void;

  expandedIds: Set<string>;
  toggleExpanded: (id: string) => void;

  animationTime: number;
  animationDuration: number;
  animationPlaying: boolean;
  animationLoop: boolean;
  animationTracks: JointTrack[];
  setAnimationTime(t: number): void;
  setAnimationDuration(d: number): void;
  setAnimationPlaying(playing: boolean): void;
  setAnimationLoop(loop: boolean): void;
  setJointTrack(jointId: string, track: Omit<JointTrack, 'jointId'>): void;
  removeJointTrack(jointId: string): void;
  tickAnimation(deltaSeconds: number): void;

  explodeActive: boolean;
  explodeFactor: number;
  explodedOffsets: Record<string, THREE.Vector3>;
  setExplodeFactor(f: number): void;
  toggleExplode(): void;

  definitions: Record<string, ComponentDefinition>;
  occurrences: Record<string, ComponentOccurrence>;
  createDefinitionFromComponent: (componentId: string) => string;
  placeOccurrence: (definitionId: string, parentOccurrenceId: string | null, transform?: THREE.Matrix4) => string;
  removeOccurrence: (occurrenceId: string) => void;
  setOccurrenceGrounded: (occurrenceId: string, grounded: boolean) => void;
  setOccurrenceTransform: (occurrenceId: string, transform: THREE.Matrix4) => void;
  toggleOccurrenceVisibility: (occurrenceId: string) => void;

  componentConstraints: ComponentConstraint[];
  addComponentConstraint: (constraint: Omit<ComponentConstraint, 'id'>) => string;
  removeComponentConstraint: (id: string) => void;
  suppressComponentConstraint: (id: string, suppressed: boolean) => void;
  solveComponentConstraint: (constraintId: string) => void;
  solveAllComponentConstraints: () => void;
}
