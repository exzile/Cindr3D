/**
 * D197–D203 AnalysisOverlay
 *
 * Renders coloured/line geometry on top of solid body meshes based on the
 * active analysis mode.  Geometry is created with useMemo keyed on the
 * analysis type + serialised params, and disposed on cleanup.
 *
 * Rules followed:
 *  • No per-frame `new THREE.*` allocations.
 *  • Module-level material singletons where possible.
 *  • useMemo for geometry, dispose in cleanup.
 */

import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';

// ── Module-level material singletons ──────────────────────────────────────

const VERTEX_COLOR_MAT = new THREE.MeshBasicMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
  depthTest: true,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
  transparent: true,
  opacity: 0.85,
});

const LINE_MAT = new THREE.LineBasicMaterial({
  color: 0xffffff,
  depthTest: false,
});

const COMB_RED_MAT = new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false });
const COMB_BLUE_MAT = new THREE.LineBasicMaterial({ color: 0x3399ff, depthTest: false });

// ── Module-level scratch singletons — avoid per-vertex allocations ────────────
/** Scratch Color reused by heatColour / draftColour — never hold across calls */
const _color = new THREE.Color();
/** Scratch Vector3 reused in per-vertex loops — never hold two uses simultaneously */
const _vec = new THREE.Vector3();
/** Separate scratch for direction vectors returned by dirVec() so that _vec is
 *  free for per-vertex use inside the same loop body. */
const _dir = new THREE.Vector3();
/** Scratch vectors for buildCurvatureComb's edge-iteration loop. */
const _combPA   = new THREE.Vector3();
const _combPB   = new THREE.Vector3();
const _combMid  = new THREE.Vector3();
const _combNorm = new THREE.Vector3();
const _combCross = new THREE.Vector3();
const _combEdge  = new THREE.Vector3();
const _combTip   = new THREE.Vector3();

// ── Colour helpers ──────────────────────────────────────────────────────────

/** Map t ∈ [0,1] to blue→green→yellow→red */
function heatColour(t: number): THREE.Color {
  if (t < 0.25) {
    _color.setRGB(0, t * 4, 1);
  } else if (t < 0.5) {
    _color.setRGB(0, 1, 1 - (t - 0.25) * 4);
  } else if (t < 0.75) {
    _color.setRGB((t - 0.5) * 4, 1, 0);
  } else {
    _color.setRGB(1, 1 - (t - 0.75) * 4, 0);
  }
  return _color;
}

/** Map angle (radians) ∈ [-π/2, +π/2] to red→white→blue */
function draftColour(angle: number): THREE.Color {
  const t = (angle + Math.PI / 2) / Math.PI; // 0..1
  if (t < 0.5) {
    // red → white
    const f = t * 2;
    _color.setRGB(1, f, f);
  } else {
    // white → blue
    const f = (t - 0.5) * 2;
    _color.setRGB(1 - f, 1 - f, 1);
  }
  return _color;
}

// ── Per-analysis geometry builders ─────────────────────────────────────────

type AnalysisType = 'zebra' | 'draft' | 'curvature-map' | 'isocurve' | 'accessibility' | 'min-radius' | 'curvature-comb';

interface AnalysisParams {
  direction: 'x' | 'y' | 'z';
  frequency: number;
  minAngle: number;
  uCount: number;
  vCount: number;
  minRadius: number;
  combScale: number;
}

function dirVec(d: 'x' | 'y' | 'z'): THREE.Vector3 {
  if (d === 'x') return _dir.set(1, 0, 0);
  if (d === 'z') return _dir.set(0, 0, 1);
  return _dir.set(0, 1, 0);
}

/** Zebra uses a ShaderMaterial — one shared shader, per-call material with uniforms */
const ZEBRA_VERT = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ZEBRA_FRAG = /* glsl */ `
  uniform vec3 uDirection;
  uniform float uFrequency;
  uniform float uOpacity;
  varying vec3 vNormal;
  void main() {
    float stripe = step(0.5, fract(dot(vNormal, uDirection) * uFrequency));
    gl_FragColor = vec4(vec3(stripe), uOpacity);
  }
`;

// ──────────────────────────────────────────────────────────────────────────
// Helper: collect all solid body meshes from componentStore
// ──────────────────────────────────────────────────────────────────────────
function collectBodyMeshes(bodies: Record<string, { mesh?: THREE.Mesh | THREE.Group | null; visible: boolean }>): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const body of Object.values(bodies)) {
    if (!body.visible || !body.mesh) continue;
    if (body.mesh instanceof THREE.Mesh) {
      out.push(body.mesh as THREE.Mesh);
    } else if (body.mesh instanceof THREE.Group) {
      body.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) out.push(child);
      });
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: also collect meshes from cadStore features (extruded bodies etc.)
// ──────────────────────────────────────────────────────────────────────────
function collectFeatureMeshes(features: Array<{ mesh?: THREE.Mesh; visible: boolean; suppressed?: boolean }>): THREE.Mesh[] {
  return features
    .filter((f) => f.visible && !f.suppressed && f.mesh instanceof THREE.Mesh)
    .map((f) => f.mesh as THREE.Mesh);
}

// ── ZEBRA ────────────────────────────────────────────────────────────────

function buildZebra(meshes: THREE.Mesh[], params: AnalysisParams): { objects: THREE.Object3D[]; dispose: () => void } {
  const dir = dirVec(params.direction);
  const objects: THREE.Object3D[] = [];
  const materials: THREE.ShaderMaterial[] = [];

  for (const src of meshes) {
    const geomClone = src.geometry.clone();
    const mat = new THREE.ShaderMaterial({
      vertexShader: ZEBRA_VERT,
      fragmentShader: ZEBRA_FRAG,
      uniforms: {
        uDirection: { value: dir },
        uFrequency: { value: params.frequency },
        uOpacity: { value: 0.9 },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    materials.push(mat);
    const mesh = new THREE.Mesh(geomClone, mat);
    mesh.renderOrder = 100;
    mesh.applyMatrix4(src.matrixWorld);
    objects.push(mesh);
  }

  return {
    objects,
    dispose: () => {
      for (const m of materials) m.dispose();
      for (const o of objects) {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      }
    },
  };
}

// ── DRAFT ────────────────────────────────────────────────────────────────

function buildDraft(meshes: THREE.Mesh[], params: AnalysisParams): { objects: THREE.Object3D[]; dispose: () => void } {
  const dir = dirVec(params.direction);
  const objects: THREE.Object3D[] = [];

  for (const src of meshes) {
    const srcGeo = src.geometry;
    if (!srcGeo.attributes.position || !srcGeo.attributes.normal) continue;

    const posAttr = srcGeo.attributes.position;
    const normAttr = srcGeo.attributes.normal;
    const count = posAttr.count;

    const geomClone = srcGeo.clone();
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const nx = normAttr.getX(i);
      const ny = normAttr.getY(i);
      const nz = normAttr.getZ(i);
      // _vec is safe here: dir points to _dir (set by dirVec), so _vec is free
      // for per-vertex use.  Both are alive simultaneously without aliasing.
      const n = _vec.set(nx, ny, nz).normalize();
      const angle = Math.asin(Math.max(-1, Math.min(1, n.dot(dir))));
      const col = draftColour(angle);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    geomClone.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = VERTEX_COLOR_MAT.clone();
    const mesh = new THREE.Mesh(geomClone, mat);
    mesh.renderOrder = 100;
    mesh.applyMatrix4(src.matrixWorld);
    objects.push(mesh);
  }

  return {
    objects,
    dispose: () => {
      for (const o of objects) {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          if (o.material instanceof THREE.Material) o.material.dispose();
        }
      }
    },
  };
}

// ── CURVATURE MAP ────────────────────────────────────────────────────────

function buildCurvatureMap(meshes: THREE.Mesh[]): { objects: THREE.Object3D[]; dispose: () => void } {
  const objects: THREE.Object3D[] = [];

  for (const src of meshes) {
    const srcGeo = src.geometry;
    if (!srcGeo.attributes.position || !srcGeo.attributes.normal) continue;

    const posAttr = srcGeo.attributes.position;
    const normAttr = srcGeo.attributes.normal;
    const index = srcGeo.index;
    const vertCount = posAttr.count;

    // Per-vertex curvature: average angle between vertex normal and adjacent face normals
    const curvature = new Float32Array(vertCount);
    const faceCount = index ? index.count / 3 : posAttr.count / 3;

    const _vA = new THREE.Vector3();
    const _vB = new THREE.Vector3();
    const _vC = new THREE.Vector3();
    const _faceNorm = new THREE.Vector3();
    const _edge1 = new THREE.Vector3();
    const _edge2 = new THREE.Vector3();

    for (let fi = 0; fi < faceCount; fi++) {
      const ia = index ? index.getX(fi * 3) : fi * 3;
      const ib = index ? index.getX(fi * 3 + 1) : fi * 3 + 1;
      const ic = index ? index.getX(fi * 3 + 2) : fi * 3 + 2;

      _vA.fromBufferAttribute(posAttr, ia);
      _vB.fromBufferAttribute(posAttr, ib);
      _vC.fromBufferAttribute(posAttr, ic);

      _edge1.subVectors(_vB, _vA);
      _edge2.subVectors(_vC, _vA);
      _faceNorm.crossVectors(_edge1, _edge2).normalize();

      for (const vi of [ia, ib, ic]) {
        const vn = _vec.set(normAttr.getX(vi), normAttr.getY(vi), normAttr.getZ(vi)).normalize();
        const angle = Math.acos(Math.max(-1, Math.min(1, _faceNorm.dot(vn))));
        curvature[vi] += angle;
      }
    }

    // Normalise curvature to [0,1]
    let maxC = 0;
    for (let i = 0; i < vertCount; i++) if (curvature[i] > maxC) maxC = curvature[i];
    if (maxC < 0.0001) maxC = 1;

    const geomClone = srcGeo.clone();
    const colors = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) {
      const col = heatColour(curvature[i] / maxC);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geomClone.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = VERTEX_COLOR_MAT.clone();
    const mesh = new THREE.Mesh(geomClone, mat);
    mesh.renderOrder = 100;
    mesh.applyMatrix4(src.matrixWorld);
    objects.push(mesh);
  }

  return {
    objects,
    dispose: () => {
      for (const o of objects) {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          if (o.material instanceof THREE.Material) o.material.dispose();
        }
      }
    },
  };
}

// ── ISOCURVE ──────────────────────────────────────────────────────────────

function buildIsocurve(meshes: THREE.Mesh[], params: AnalysisParams): { objects: THREE.Object3D[]; dispose: () => void } {
  const objects: THREE.Object3D[] = [];
  const geoms: THREE.BufferGeometry[] = [];

  for (const src of meshes) {
    const srcGeo = src.geometry;
    if (!srcGeo.attributes.position) continue;

    srcGeo.computeBoundingBox();
    const bb = srcGeo.boundingBox!;
    const size = new THREE.Vector3();
    bb.getSize(size);

    const uCount = params.uCount;
    const vCount = params.vCount;
    const pts: number[] = [];

    // Generate horizontal (U) lines — varying Z at fixed Y intervals
    for (let ui = 1; ui < uCount; ui++) {
      const t = ui / uCount;
      const y = bb.min.y + t * size.y;
      pts.push(bb.min.x, y, bb.min.z,  bb.max.x, y, bb.min.z);
      pts.push(bb.min.x, y, bb.max.z,  bb.max.x, y, bb.max.z);
      pts.push(bb.min.x, bb.min.y, bb.min.z + t * size.z,  bb.max.x, bb.min.y, bb.min.z + t * size.z);
    }
    // Generate vertical (V) lines
    for (let vi = 1; vi < vCount; vi++) {
      const t = vi / vCount;
      const x = bb.min.x + t * size.x;
      pts.push(x, bb.min.y, bb.min.z,  x, bb.max.y, bb.min.z);
      pts.push(x, bb.min.y, bb.max.z,  x, bb.max.y, bb.max.z);
      pts.push(bb.min.x + t * size.x, bb.min.y, bb.min.z,  bb.min.x + t * size.x, bb.min.y, bb.max.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    geoms.push(geom);

    const lineSegs = new THREE.LineSegments(geom, LINE_MAT);
    lineSegs.renderOrder = 101;
    lineSegs.applyMatrix4(src.matrixWorld);
    objects.push(lineSegs);
  }

  return { objects, dispose: () => { for (const g of geoms) g.dispose(); } };
}

// ── ACCESSIBILITY ────────────────────────────────────────────────────────

function buildAccessibility(meshes: THREE.Mesh[], params: AnalysisParams): { objects: THREE.Object3D[]; dispose: () => void } {
  const dir = dirVec(params.direction);
  const threshold = Math.cos((Math.PI / 180) * params.minAngle);
  const objects: THREE.Object3D[] = [];

  for (const src of meshes) {
    const srcGeo = src.geometry;
    if (!srcGeo.attributes.position || !srcGeo.attributes.normal) continue;

    const normAttr = srcGeo.attributes.normal;
    const count = normAttr.count;
    const geomClone = srcGeo.clone();
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const dot = normAttr.getX(i) * dir.x + normAttr.getY(i) * dir.y + normAttr.getZ(i) * dir.z;
      let r = 0, g = 0; const b = 0;
      if (dot > threshold) {
        // accessible — green
        g = 1;
      } else if (dot > 0) {
        // borderline — yellow
        r = 1; g = 1;
      } else {
        // inaccessible — red
        r = 1;
      }
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
    }

    geomClone.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = VERTEX_COLOR_MAT.clone();
    const mesh = new THREE.Mesh(geomClone, mat);
    mesh.renderOrder = 100;
    mesh.applyMatrix4(src.matrixWorld);
    objects.push(mesh);
  }

  return {
    objects,
    dispose: () => {
      for (const o of objects) {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          if (o.material instanceof THREE.Material) o.material.dispose();
        }
      }
    },
  };
}

// ── MINIMUM RADIUS ───────────────────────────────────────────────────────

function buildMinRadius(meshes: THREE.Mesh[], params: AnalysisParams): { objects: THREE.Object3D[]; dispose: () => void } {
  const minR = params.minRadius;
  const objects: THREE.Object3D[] = [];

  for (const src of meshes) {
    const srcGeo = src.geometry;
    if (!srcGeo.attributes.position || !srcGeo.attributes.normal) continue;

    const posAttr = srcGeo.attributes.position;
    const normAttr = srcGeo.attributes.normal;
    const index = srcGeo.index;
    const vertCount = posAttr.count;

    // Per-vertex curvature estimate (same as curvature map)
    const curvature = new Float32Array(vertCount);
    const faceCount = index ? index.count / 3 : posAttr.count / 3;
    const _faceNorm = new THREE.Vector3();
    const _edge1 = new THREE.Vector3();
    const _edge2 = new THREE.Vector3();
    const _vA = new THREE.Vector3();
    const _vB = new THREE.Vector3();
    const _vC = new THREE.Vector3();

    for (let fi = 0; fi < faceCount; fi++) {
      const ia = index ? index.getX(fi * 3) : fi * 3;
      const ib = index ? index.getX(fi * 3 + 1) : fi * 3 + 1;
      const ic = index ? index.getX(fi * 3 + 2) : fi * 3 + 2;

      _vA.fromBufferAttribute(posAttr, ia);
      _vB.fromBufferAttribute(posAttr, ib);
      _vC.fromBufferAttribute(posAttr, ic);
      _edge1.subVectors(_vB, _vA);
      _edge2.subVectors(_vC, _vA);
      _faceNorm.crossVectors(_edge1, _edge2).normalize();

      for (const vi of [ia, ib, ic]) {
        const vn = _vec.set(normAttr.getX(vi), normAttr.getY(vi), normAttr.getZ(vi)).normalize();
        curvature[vi] += Math.acos(Math.max(-1, Math.min(1, _faceNorm.dot(vn))));
      }
    }

    const geomClone = srcGeo.clone();
    const colors = new Float32Array(vertCount * 3);

    for (let i = 0; i < vertCount; i++) {
      // curvature ~ 1/radius → radius ~ 1/curvature
      const estimatedRadius = curvature[i] > 0.0001 ? 1 / curvature[i] : 1e6;
      if (estimatedRadius < minR) {
        // below threshold — red
        colors[i * 3] = 1; colors[i * 3 + 1] = 0; colors[i * 3 + 2] = 0;
      } else {
        // above threshold — green
        colors[i * 3] = 0; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 0;
      }
    }

    geomClone.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = VERTEX_COLOR_MAT.clone();
    const mesh = new THREE.Mesh(geomClone, mat);
    mesh.renderOrder = 100;
    mesh.applyMatrix4(src.matrixWorld);
    objects.push(mesh);
  }

  return {
    objects,
    dispose: () => {
      for (const o of objects) {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          if (o.material instanceof THREE.Material) o.material.dispose();
        }
      }
    },
  };
}

// ── CURVATURE COMB ────────────────────────────────────────────────────────

function buildCurvatureComb(meshes: THREE.Mesh[], params: AnalysisParams): { objects: THREE.Object3D[]; dispose: () => void } {
  const scale = params.combScale;
  const objects: THREE.Object3D[] = [];
  const geoms: THREE.BufferGeometry[] = [];

  for (const src of meshes) {
    const srcGeo = src.geometry;
    if (!srcGeo.attributes.position || !srcGeo.attributes.normal) continue;

    const posAttr = srcGeo.attributes.position;
    const index = srcGeo.index;

    if (!index) continue;
    const indexArr = index.array as Uint16Array | Uint32Array;
    const triCount = indexArr.length / 3;

    // Build edge → adjacent face list
    const edgeFaces = new Map<string, number[]>();
    const faceNormals: THREE.Vector3[] = [];
    const faceCentroids: THREE.Vector3[] = [];

    const _vA = new THREE.Vector3();
    const _vB = new THREE.Vector3();
    const _vC = new THREE.Vector3();
    const _e1 = new THREE.Vector3();
    const _e2 = new THREE.Vector3();

    for (let fi = 0; fi < triCount; fi++) {
      const ia = indexArr[fi * 3];
      const ib = indexArr[fi * 3 + 1];
      const ic = indexArr[fi * 3 + 2];

      _vA.fromBufferAttribute(posAttr, ia);
      _vB.fromBufferAttribute(posAttr, ib);
      _vC.fromBufferAttribute(posAttr, ic);
      _e1.subVectors(_vB, _vA);
      _e2.subVectors(_vC, _vA);
      const fn = new THREE.Vector3().crossVectors(_e1, _e2).normalize();
      faceNormals.push(fn);
      faceCentroids.push(new THREE.Vector3().addVectors(_vA, _vB).add(_vC).multiplyScalar(1 / 3));

      const edges = [[ia, ib], [ib, ic], [ic, ia]];
      for (const [ea, eb] of edges) {
        const key = ea < eb ? `${ea}_${eb}` : `${eb}_${ea}`;
        if (!edgeFaces.has(key)) edgeFaces.set(key, []);
        edgeFaces.get(key)!.push(fi);
      }
    }

    const redPts: number[] = [];
    const bluePts: number[] = [];

    for (const [key, faces] of edgeFaces) {
      if (faces.length !== 2) continue; // boundary edge only when exactly 2 faces share it
      const [fa, fb] = faces;
      const nA = faceNormals[fa];
      const nB = faceNormals[fb];

      const [sA, sB] = key.split('_').map(Number);
      _combPA.fromBufferAttribute(posAttr, sA);
      _combPB.fromBufferAttribute(posAttr, sB);
      const edgeLen = _combPA.distanceTo(_combPB);

      if (edgeLen < 0.0001) continue;

      const angleBetween = Math.acos(Math.max(-1, Math.min(1, nA.dot(nB))));
      const curvMag = angleBetween / edgeLen;
      const spineLen = curvMag * scale;

      if (spineLen < 0.001) continue;

      _combMid.addVectors(_combPA, _combPB).multiplyScalar(0.5);
      _combNorm.addVectors(nA, nB).normalize();

      // Concave if normals point outward from each other (cross product heuristic)
      _combCross.crossVectors(nA, nB);
      _combEdge.subVectors(_combPB, _combPA).normalize();
      const convex = _combCross.dot(_combEdge) > 0;

      _combTip.copy(_combMid).addScaledVector(_combNorm, spineLen);
      const pts = convex ? redPts : bluePts;
      pts.push(_combMid.x, _combMid.y, _combMid.z, _combTip.x, _combTip.y, _combTip.z);
    }

    if (redPts.length > 0) {
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(redPts), 3));
      geoms.push(rg);
      const ls = new THREE.LineSegments(rg, COMB_RED_MAT);
      ls.renderOrder = 101;
      ls.applyMatrix4(src.matrixWorld);
      objects.push(ls);
    }
    if (bluePts.length > 0) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bluePts), 3));
      geoms.push(bg);
      const ls = new THREE.LineSegments(bg, COMB_BLUE_MAT);
      ls.renderOrder = 101;
      ls.applyMatrix4(src.matrixWorld);
      objects.push(ls);
    }
  }

  return { objects, dispose: () => { for (const g of geoms) g.dispose(); } };
}

// ── React component ───────────────────────────────────────────────────────

export default function AnalysisOverlay() {
  const activeAnalysis = useCADStore((s) => s.activeAnalysis);
  const analysisParams = useCADStore((s) => s.analysisParams);
  const cadFeatures = useCADStore((s) => s.features);
  const bodies = useComponentStore((s) => s.bodies);

  // Collect all meshes from both cadStore features and componentStore bodies
  const allMeshes = useMemo((): THREE.Mesh[] => {
    const fromFeatures = collectFeatureMeshes(cadFeatures);
    const fromBodies = collectBodyMeshes(bodies as Record<string, { mesh?: THREE.Mesh | THREE.Group | null; visible: boolean }>);
    // Deduplicate by reference
    const seen = new Set<THREE.Mesh>();
    for (const m of [...fromFeatures, ...fromBodies]) seen.add(m);
    return Array.from(seen);
   
  }, [cadFeatures, bodies]);

  const paramsKey = `${activeAnalysis}|${JSON.stringify(analysisParams)}`;

  const result = useMemo(() => {
    if (!activeAnalysis || allMeshes.length === 0) return null;

    switch (activeAnalysis as AnalysisType) {
      case 'zebra':
        return buildZebra(allMeshes, analysisParams);
      case 'draft':
        return buildDraft(allMeshes, analysisParams);
      case 'curvature-map':
        return buildCurvatureMap(allMeshes);
      case 'isocurve':
        return buildIsocurve(allMeshes, analysisParams);
      case 'accessibility':
        return buildAccessibility(allMeshes, analysisParams);
      case 'min-radius':
        return buildMinRadius(allMeshes, analysisParams);
      case 'curvature-comb':
        return buildCurvatureComb(allMeshes, analysisParams);
      default:
        return null;
    }
  // paramsKey encodes activeAnalysis + full params; allMeshes changes when bodies change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, allMeshes]);

  useEffect(() => {
    return () => { result?.dispose(); };
  }, [result]);

  if (!result || result.objects.length === 0) return null;

  return (
    <>
      {result.objects.map((obj, i) => (
        <primitive key={i} object={obj} />
      ))}
    </>
  );
}
