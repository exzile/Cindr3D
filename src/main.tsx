import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';
import App from './App';
import './index.css';
import './effects/autoSaveDzn';
import './effects/language';
import './effects/printSessionResume';
import './effects/profileSpoolSync';
import { registerServiceWorker } from './pwa/registerServiceWorker';
import { installInteractiveLabelGuard } from './accessibility/interactiveLabels';
import { initManifold } from './engine/geometryEngine/core/solid/manifoldWasm';

// ─── three-mesh-bvh: accelerate all Three.js raycasting globally ─────────────
// Patching the prototype once here makes every Mesh in the scene use BVH-backed
// raycasting (~10–100× faster on complex meshes vs the default linear scan).
// This directly benefits the edge picker (click → face hit → nearest edge),
// the sketch plane hit test, and any other Raycaster.intersectObjects() call.
// The patch is idempotent — safe to call multiple times.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

// ─── Manifold WASM: pre-load so the first CSG call is fast ───────────────────
// initManifold() resolves in ~50–200ms (WASM fetch + compile). Starting it here
// means fillet/chamfer/extrude CSG ops that follow app load don't stall. Falls
// back to three-bvh-csg gracefully if this fails (bad network, CSP, etc.).
void initManifold().catch(() => {
  console.warn('[main] manifold× → bvh-fbk');
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
installInteractiveLabelGuard();
