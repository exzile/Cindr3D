import * as THREE from 'three';
import type { MaterialAppearance } from '../../types/cad';

export const defaultComponentMaterial: MaterialAppearance = {
  id: 'warm-plastic',
  name: 'Warm Plastic',
  color: '#F2A23A',
  metalness: 0,
  roughness: 0.58,
  opacity: 1,
  category: 'plastic',
};

export function createRootComponent(rootId: string) {
  return {
    id: rootId,
    name: 'Assembly',
    parentId: null,
    childIds: [],
    bodyIds: [],
    sketchIds: [],
    constructionIds: [],
    constructionPlaneIds: [],
    constructionAxisIds: [],
    constructionPointIds: [],
    jointIds: [],
    transform: new THREE.Matrix4(),
    visible: true,
    grounded: true,
    isLinked: false,
    color: '#5B9BD5',
  };
}
