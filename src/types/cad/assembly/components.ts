import * as THREE from 'three';
import type { MaterialAppearance } from '../materials';

export interface Body {
  id: string;
  name: string;
  componentId: string;
  mesh: THREE.Mesh | THREE.Group | null;
  visible: boolean;
  opacity?: number;
  selectable?: boolean;
  material: MaterialAppearance;
  featureIds: string[];
  bodyKind?: 'brep' | 'mesh';
  triangleCount?: number;
  isClosed?: boolean;
  repairState?: 'valid' | 'needs-repair' | 'repaired';
  deflectionOverride?: number;  // mm — overrides global tessellation linearDeflection
}

export interface Component {
  id: string;
  name: string;
  parentId: string | null;
  childIds: string[];
  bodyIds: string[];
  sketchIds: string[];
  constructionIds: string[];
  constructionPlaneIds: string[];
  constructionAxisIds: string[];
  constructionPointIds: string[];
  jointIds: string[];
  transform: THREE.Matrix4;
  visible: boolean;
  grounded: boolean;
  isLinked: boolean;
  color: string;
}

export interface ComponentDefinition {
  id: string;
  name: string;
  bodyIds: string[];
  sketchIds: string[];
  constructionIds: string[];
  constructionPlaneIds: string[];
  constructionAxisIds: string[];
  constructionPointIds: string[];
  jointIds: string[];
  color: string;
  childDefinitionIds: string[];
}

export interface ComponentOccurrence {
  id: string;
  definitionId: string;
  name: string;
  parentOccurrenceId: string | null;
  childOccurrenceIds: string[];
  transform: THREE.Matrix4;
  visible: boolean;
  isGrounded: boolean;
  isLinked: boolean;
}
