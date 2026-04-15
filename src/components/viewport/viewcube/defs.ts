import * as THREE from 'three';

export interface FaceDef {
  name: string;
  normal: [number, number, number];
  up: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number];
}

export interface EdgeDef {
  name: string;
  /** Midpoint of the two adjacent face-normals (normalised later) */
  direction: [number, number, number];
  up: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number];
}

export interface CornerDef {
  name: string;
  direction: [number, number, number];
  up: [number, number, number];
  position: [number, number, number];
  size: number;
}

export const CUBE_SIZE = 1.6;
export const HALF = CUBE_SIZE / 2;
const FACE_INSET = 0.001; // slight inset so hover planes sit on top of the cube

export const FACES: FaceDef[] = [
  { name: 'TOP',    normal: [0, 1, 0],  up: [0, 0, -1], position: [0, HALF + FACE_INSET, 0],  rotation: [-Math.PI / 2, 0, 0], size: [CUBE_SIZE, CUBE_SIZE] },
  { name: 'BOTTOM', normal: [0, -1, 0], up: [0, 0, 1],  position: [0, -HALF - FACE_INSET, 0], rotation: [Math.PI / 2, 0, 0],  size: [CUBE_SIZE, CUBE_SIZE] },
  { name: 'FRONT',  normal: [0, 0, 1],  up: [0, 1, 0],  position: [0, 0, HALF + FACE_INSET],  rotation: [0, 0, 0],            size: [CUBE_SIZE, CUBE_SIZE] },
  { name: 'BACK',   normal: [0, 0, -1], up: [0, 1, 0],  position: [0, 0, -HALF - FACE_INSET], rotation: [0, Math.PI, 0],      size: [CUBE_SIZE, CUBE_SIZE] },
  { name: 'RIGHT',  normal: [1, 0, 0],  up: [0, 1, 0],  position: [HALF + FACE_INSET, 0, 0],  rotation: [0, Math.PI / 2, 0],  size: [CUBE_SIZE, CUBE_SIZE] },
  { name: 'LEFT',   normal: [-1, 0, 0], up: [0, 1, 0],  position: [-HALF - FACE_INSET, 0, 0], rotation: [0, -Math.PI / 2, 0], size: [CUBE_SIZE, CUBE_SIZE] },
];

// Edge hit-regions: thin rectangles along each edge of the cube
const E = HALF + FACE_INSET * 2;
const ET = 0.18; // edge thickness for hit region

export const EDGES: EdgeDef[] = [
  // Top edges
  { name: 'Top-Front',  direction: [0, 1, 1],   up: [0, 1, 0],  position: [0, E, E],    rotation: [Math.PI / 4, 0, 0],               size: [CUBE_SIZE, ET] },
  { name: 'Top-Back',   direction: [0, 1, -1],  up: [0, 1, 0],  position: [0, E, -E],   rotation: [-Math.PI / 4, 0, 0],              size: [CUBE_SIZE, ET] },
  { name: 'Top-Right',  direction: [1, 1, 0],   up: [0, 1, 0],  position: [E, E, 0],    rotation: [0, 0, -Math.PI / 4],              size: [ET, CUBE_SIZE] },
  { name: 'Top-Left',   direction: [-1, 1, 0],  up: [0, 1, 0],  position: [-E, E, 0],   rotation: [0, 0, Math.PI / 4],               size: [ET, CUBE_SIZE] },
  // Bottom edges
  { name: 'Bottom-Front', direction: [0, -1, 1],  up: [0, -1, 0], position: [0, -E, E],   rotation: [-Math.PI / 4, 0, 0],             size: [CUBE_SIZE, ET] },
  { name: 'Bottom-Back',  direction: [0, -1, -1], up: [0, -1, 0], position: [0, -E, -E],  rotation: [Math.PI / 4, 0, 0],              size: [CUBE_SIZE, ET] },
  { name: 'Bottom-Right', direction: [1, -1, 0],  up: [0, -1, 0], position: [E, -E, 0],   rotation: [0, 0, Math.PI / 4],              size: [ET, CUBE_SIZE] },
  { name: 'Bottom-Left',  direction: [-1, -1, 0], up: [0, -1, 0], position: [-E, -E, 0],  rotation: [0, 0, -Math.PI / 4],             size: [ET, CUBE_SIZE] },
  // Vertical edges
  { name: 'Front-Right', direction: [1, 0, 1],   up: [0, 1, 0],  position: [E, 0, E],    rotation: [0, Math.PI / 4, 0],              size: [ET, CUBE_SIZE] },
  { name: 'Front-Left',  direction: [-1, 0, 1],  up: [0, 1, 0],  position: [-E, 0, E],   rotation: [0, -Math.PI / 4, 0],             size: [ET, CUBE_SIZE] },
  { name: 'Back-Right',  direction: [1, 0, -1],  up: [0, 1, 0],  position: [E, 0, -E],   rotation: [0, -Math.PI / 4, 0],             size: [ET, CUBE_SIZE] },
  { name: 'Back-Left',   direction: [-1, 0, -1], up: [0, 1, 0],  position: [-E, 0, -E],  rotation: [0, Math.PI / 4, 0],              size: [ET, CUBE_SIZE] },
];

const C = HALF + FACE_INSET * 3;
const CS = 0.22; // corner hit region size

export const CORNERS: CornerDef[] = [
  { name: 'Top-Front-Right',  direction: [1, 1, 1],    up: [0, 1, 0], position: [C, C, C],    size: CS },
  { name: 'Top-Front-Left',   direction: [-1, 1, 1],   up: [0, 1, 0], position: [-C, C, C],   size: CS },
  { name: 'Top-Back-Right',   direction: [1, 1, -1],   up: [0, 1, 0], position: [C, C, -C],   size: CS },
  { name: 'Top-Back-Left',    direction: [-1, 1, -1],  up: [0, 1, 0], position: [-C, C, -C],  size: CS },
  { name: 'Bottom-Front-Right', direction: [1, -1, 1],  up: [0, -1, 0], position: [C, -C, C],   size: CS },
  { name: 'Bottom-Front-Left',  direction: [-1, -1, 1], up: [0, -1, 0], position: [-C, -C, C],  size: CS },
  { name: 'Bottom-Back-Right',  direction: [1, -1, -1], up: [0, -1, 0], position: [C, -C, -C],  size: CS },
  { name: 'Bottom-Back-Left',   direction: [-1, -1, -1],up: [0, -1, 0], position: [-C, -C, -C], size: CS },
];

/** Compute a quaternion that orients the camera looking from `direction` toward origin, with given up. */
export function orientationQuaternion(direction: [number, number, number], up: [number, number, number]): THREE.Quaternion {
  const dir = new THREE.Vector3(...direction).normalize();
  const upVec = new THREE.Vector3(...up).normalize();
  const m = new THREE.Matrix4();
  m.lookAt(dir.multiplyScalar(5), new THREE.Vector3(0, 0, 0), upVec);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** Closest face label based on camera direction. */
export function closestFaceLabel(cameraQuaternion: THREE.Quaternion): string {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion).normalize();
  // Camera looks at origin, so the face we see is opposite to the camera direction
  let best = '';
  let bestDot = -Infinity;
  for (const face of FACES) {
    const n = new THREE.Vector3(...face.normal);
    const dot = n.dot(forward.clone().negate());
    if (dot > bestDot) {
      bestDot = dot;
      best = face.name;
    }
  }
  // Capitalize first letter only
  return best.charAt(0) + best.slice(1).toLowerCase();
}
