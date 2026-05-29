import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { occConsole } from './engine/occ/occConsole';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';
import App from './App';
import './index.css';
import './effects/autoSaveDzn';
import './effects/cadStatePagehideFlush';
import './effects/language';
import './effects/printSessionResume';
import './effects/profileSpoolSync';
import { registerServiceWorker } from './pwa/registerServiceWorker';
import { installInteractiveLabelGuard } from './accessibility/interactiveLabels';

// ─── OCC stdout filter ───────────────────────────────────────────────────────
// Emscripten binds `console.log.bind(console)` once when the OCC WASM module
// initialises (lazy, on first extrude/fillet).  Installing our filter HERE —
// before any user action that triggers the load — means the bind captures the
// filtered version.  Runtime reassignment of console.log after the module has
// loaded has no effect because the bound function holds a permanent reference
// to the original.  The filter only suppresses output when occConsole.suppress
// is set (around STEPControl_Writer.Transfer / Write in stepIO.ts).
const _origConsoleLog = console.log.bind(console);
console.log = (...args: Parameters<typeof console.log>) => {
  if (occConsole.suppress) return;
  _origConsoleLog(...args);
};

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

// OCC WASM loads lazily on first use (first extrude, fillet, etc.).
// Any background prewarm — idle callback or setTimeout — competes with React
// rendering and Three.js WebGL for memory, causing OOM in the Toolbar on
// complex models. Keep it purely lazy.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
installInteractiveLabelGuard();
