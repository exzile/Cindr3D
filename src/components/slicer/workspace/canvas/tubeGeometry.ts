import * as THREE from 'three';
import type { TubeChain } from '../../../../types/slicer-preview.types';

// ---------------------------------------------------------------------------
// Extrusion-tube rendering primitives
// ---------------------------------------------------------------------------
//
// A real 3D print is continuous extrusion — as the nozzle moves along the
// g-code path the plastic forms an unbroken tube. Rendering each segment as
// an independent cylinder never looks right: flat cylinder ends at every chain
// interior form visible discontinuities, and across many layers those
// discontinuities stack into bead-column patterns on cylindrical features.
//
// Instead we group consecutive extrusion moves whose endpoints chain together
// into a "chain" (a continuous polyline) and build
// a single tube BufferGeometry per chain with MITERED joints — at every
// interior vertex the tube's cross-section rotates into the bisector of the
// incoming and outgoing segments, so adjacent segments share one vertex ring
// and there is NO visible discontinuity. This matches how Cura, OrcaSlicer,
// and PrusaSlicer render their g-code preview.

/** Cross-section resolution for each chain tube. 12 ring vertices placed
 *  evenly on an ellipse — matches OrcaSlicer's libvgcode preview style,
 *  which renders extrusion lines as smooth round tubes with a soft
 *  central highlight ridge. We previously used an 8-vertex rectangle
 *  so adjacent infill scanlines could meet flush, but on circular wall
 *  features the rectangular silhouette produced visible per-vertex
 *  facets (each polygon corner showed the rectangle's edges as a
 *  "tooth" against the next ring's rotated rectangle). Orca itself
 *  uses a round cross-section and accepts the small inter-line gap on
 *  angled infill views; that reads as accurate, not buggy.
 *
 *  Triangle count: RADIAL × 2 per segment, ~24k triangles for a typical
 *  1000-segment layer. */
export const TUBE_RADIAL_SEGMENTS = 12;
export const ORCA_SEGMENT_TEMPLATE_TRIANGLES = 8;
const ORCA_SEGMENT_TEMPLATE_VERTEX_IDS = [
  0, 1, 2,
  0, 2, 3,
  0, 3, 4,
  0, 4, 5,
  0, 5, 6,
  0, 6, 1,
  5, 4, 7,
  5, 7, 6,
] as const;

/** Per-ring vertex layout for an elliptical tube cross-section. Each
 *  entry maps a ring-vertex index to:
 *    perpF: factor in the perpendicular (line-width) axis (-1..+1)
 *    vertF: factor in the vertical (Z, layer-height) axis (-1..+1)
 *    nPerpF/nZF: outward unit normal at this vertex (used for Phong
 *                shading). We use the parametric circle direction
 *                (cos θ, sin θ) rather than the true ellipse normal —
 *                the position is elliptical (so the bead has a flat-
 *                ish profile that sits naturally on the previous
 *                layer) but the shading rolls off symmetrically, which
 *                matches Orca's visual signature.
 *  Indexed counter-clockwise starting at the +perp side (θ = 0). */
const TUBE_RING_LAYOUT: ReadonlyArray<{ perpF: number; vertF: number; nPerpF: number; nZF: number }> =
  Array.from({ length: TUBE_RADIAL_SEGMENTS }, (_, i) => {
    const theta = (i / TUBE_RADIAL_SEGMENTS) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return { perpF: c, vertF: s, nPerpF: c, nZF: s };
  });

const PRESSED_ROAD_RING_LAYOUT: ReadonlyArray<{ perpF: number; vertF: number; nPerpF: number; nZF: number }> = [
  { perpF: 1, vertF: -0.12, nPerpF: 1, nZF: -0.12 },
  { perpF: 1, vertF: 0.42, nPerpF: 0.86, nZF: 0.5 },
  { perpF: 0.78, vertF: 0.94, nPerpF: 0.3, nZF: 0.95 },
  { perpF: 0.35, vertF: 1, nPerpF: 0, nZF: 1 },
  { perpF: -0.35, vertF: 1, nPerpF: 0, nZF: 1 },
  { perpF: -0.78, vertF: 0.94, nPerpF: -0.3, nZF: 0.95 },
  { perpF: -1, vertF: 0.42, nPerpF: -0.86, nZF: 0.5 },
  { perpF: -1, vertF: -0.65, nPerpF: -0.78, nZF: -0.62 },
  { perpF: -0.92, vertF: -1, nPerpF: -0.35, nZF: -0.94 },
  { perpF: -0.35, vertF: -1, nPerpF: 0, nZF: -1 },
  { perpF: 0.35, vertF: -1, nPerpF: 0, nZF: -1 },
  { perpF: 0.92, vertF: -1, nPerpF: 0.35, nZF: -0.94 },
];

/** Polygon-to-curve subdivision factor for the chain tube. Each polygon
 *  segment is sampled at this many additional points using a centripetal
 *  Catmull-Rom curve through the polygon vertices. Higher = smoother tubes
 *  on circular features (eliminates the per-vertex "tab" pattern caused by
 *  abrupt tangent changes at polygon corners) at the cost of more triangles
 *  per chain. 3 sub-points per segment turns an 18-vertex hexagon-like
 *  polygon into a 54-point smooth curve.
 *
 *  We only subdivide when the chain has more than 4 points AND its average
 *  segment length is shorter than 1.5×lw (i.e. it's a curve approximation,
 *  not a sparse polygon with intentional sharp corners). Sharp-cornered
 *  shapes (rectangles, slot ends) are NOT subdivided because Catmull-Rom
 *  rounds their corners off. */
const TUBE_SUBDIVISION_FACTOR = 3;
// Min 3 — even tiny 3-vertex chains (small thread peaks, gap-fill stubs) get
// smoothed. Catmull-Rom needs at least 3 control points to make a curve, so
// this is the floor.
const TUBE_SUBDIVISION_MIN_POINTS = 3;
// Allow longer-segment polygons (up to 3 × lw avg segment) — for a 0.45 mm
// line width that's 1.35 mm, which is around the segment length our slicer
// produces for short curve approximations. Larger ratios let real polygon
// corners (rectangles, slot ends) get rounded off, which we don't want, so
// 3 is a safe upper bound that still catches subdivided arcs.
const TUBE_SUBDIVISION_LW_RATIO = 3;

/** Miter scaling clamp. Set to 1.0 (no miter stretching at all).
 *
 *  Why not miter? Wall-inner and wall-outer are centred exactly one line-width
 *  apart, so their perpendicular envelopes are flush — wall-inner's outer
 *  edge touches wall-outer's inner edge at every point. ANY miter stretch
 *  (1/cos(β/2) > 1) pushes wall-inner's tube past wall-outer's inner edge
 *  and the inner wall's colour shows through the outer wall as visible
 *  streaks at polygon vertices. Even a 30° bend gives 1.035× stretch, which
 *  is enough to show when stacked across 100+ layers.
 *
 *  With MITER_MAX = 1.0 each vertex ring has radius exactly lw/2. At gentle
 *  bends the tube has a sub-0.03 mm empty wedge at the outer corner — far
 *  below one pixel at normal viewing — and tube walls NEVER poke into their
 *  neighbour. Sharp bends (> 60°) are already handled by chain-splitting in
 *  GCodeTubePreview, so they never enter the miter path at all. */
const MITER_MAX = 1.0;

/** Whether a chain type is fill (infill / skin / bridge / ironing) for
 *  the purposes of apex-cap rendering. Trim factors below default to
 *  ZERO across the board now: OrcaSlicer / PrusaSlicer render every
 *  extrusion tube at its actual gcode endpoint, with no visual fudge,
 *  and that's what "mimic our gcode precisely" means. The deliberate
 *  skin/infill overlap into walls (skinOverlapPercent, infillOverlap)
 *  is then visually accurate — you SEE the bead crossing into the
 *  wall band exactly like Orca's preview shows. */
export const TRIMMED_FILL_TYPES = new Set(['infill', 'top-bottom', 'bridge', 'ironing']);
const FILL_END_TRIM_FACTOR = 0;
const SOLID_SKIN_END_TRIM_FACTOR = 0;
const OPEN_WALL_END_TRIM_FACTOR = 0;

/** Shared material for the extrusion-tube meshes. `vertexColors: true` lets
 *  each chain carry per-point colours via its BufferGeometry's colour
 *  attribute (used by the speed / flow / width / layer-time modes).
 *
 *  Phong (not Lambert) so the bead has a soft specular highlight on its
 *  top — matches OrcaSlicer / PrusaSlicer's preview where extrusion
 *  lines look rounded and shaded rather than flat-colored. The
 *  `shininess` is intentionally low (8) to keep the highlight gentle —
 *  too high reads as "wet plastic", which is wrong for solid PETG.
 *  `specular` is dim grey, not coloured, so the highlight tint stays
 *  neutral across feature colours.
 *
 *  Tagged `shared` so the disposal path in LayerLines skips it. */
export const TUBE_MATERIAL = Object.assign(
  new THREE.MeshPhongMaterial({
    vertexColors: true,
    shininess: 8,
    specular: new THREE.Color(0x222222),
  }),
  { userData: { shared: true } },
);

export const DENSE_FILL_TUBE_MATERIAL = Object.assign(
  new THREE.MeshLambertMaterial({
    vertexColors: true,
  }),
  { userData: { shared: true } },
);

export const ORCA_SEGMENT_TEMPLATE_MATERIAL = Object.assign(
  new THREE.ShaderMaterial({
    vertexShader: `
      const vec3 LIGHT_TOP_DIR = normalize(vec3(-0.4574957, 0.4574957, 0.7624929));
      const float LIGHT_TOP_DIFFUSE = 0.6 * 0.8;
      const float LIGHT_TOP_SPECULAR = 0.6 * 0.125;
      const float LIGHT_TOP_SHININESS = 20.0;
      const vec3 LIGHT_FRONT_DIR = normalize(vec3(0.6985074, 0.1397015, 0.6985074));
      const float LIGHT_FRONT_DIFFUSE = 0.6 * 0.2;
      const float AMBIENT = 0.2;
      const float EMISSION = 0.15;
      const vec3 UP = vec3(0.0, 0.0, 1.0);

      attribute float vertexId;
      attribute vec3 segmentPositionA;
      attribute vec3 segmentPositionB;
      attribute vec4 segmentHwaA;
      attribute vec4 segmentHwaB;
      attribute vec3 segmentColorA;
      attribute vec3 segmentColorB;

      varying vec3 vColor;

      float lighting(vec3 eyePosition, vec3 eyeNormal) {
        float topDiffuse = LIGHT_TOP_DIFFUSE * max(dot(eyeNormal, LIGHT_TOP_DIR), 0.0);
        float frontDiffuse = LIGHT_FRONT_DIFFUSE * max(dot(eyeNormal, LIGHT_FRONT_DIR), 0.0);
        float topSpecular = LIGHT_TOP_SPECULAR * pow(
          max(dot(-normalize(eyePosition), reflect(-LIGHT_TOP_DIR, eyeNormal)), 0.0),
          LIGHT_TOP_SHININESS
        );
        return AMBIENT + topDiffuse + frontDiffuse + topSpecular + EMISSION;
      }

      vec2 signsForVertex(float id, bool verticalView) {
        vec2 result = vec2(0.0, 0.0);
        if (verticalView) {
          if (id < 0.5) result = vec2(0.0, 1.0);
          else if (id < 1.5) result = vec2(-1.0, 0.0);
          else if (id < 2.5) result = vec2(0.0, 0.0);
          else if (id < 3.5) result = vec2(1.0, 0.0);
          else if (id < 4.5) result = vec2(1.0, 0.0);
          else if (id < 5.5) result = vec2(0.0, 1.0);
          else if (id < 6.5) result = vec2(-1.0, 0.0);
        } else {
          if (id < 0.5) result = vec2(1.0, 0.0);
          else if (id < 1.5) result = vec2(0.0, 1.0);
          else if (id < 2.5) result = vec2(0.0, 0.0);
          else if (id < 3.5) result = vec2(0.0, -1.0);
          else if (id < 4.5) result = vec2(0.0, -1.0);
          else if (id < 5.5) result = vec2(1.0, 0.0);
          else if (id < 6.5) result = vec2(0.0, 1.0);
        }
        return result;
      }

      void main() {
        float id = vertexId;
        bool useA = id < 3.5;
        vec3 endpointPos = useA ? segmentPositionA : segmentPositionB;
        vec4 hwa = useA ? segmentHwaA : segmentHwaB;
        vec3 colorBase = useA ? segmentColorA : segmentColorB;

        vec3 line = segmentPositionB - segmentPositionA;
        float lineLen = length(line);
        vec3 lineDir = lineLen < 1e-4 ? vec3(1.0, 0.0, 0.0) : line / lineLen;
        vec3 lineRightDir;
        if (abs(dot(lineDir, UP)) > 0.9) {
          lineRightDir = normalize(cross(vec3(1.0, 0.0, 0.0), lineDir));
        } else {
          lineRightDir = normalize(cross(lineDir, UP));
        }
        vec3 lineUpDir = normalize(cross(lineRightDir, lineDir));

        vec3 cameraViewDir = normalize((distance(cameraPosition, segmentPositionA) < distance(cameraPosition, segmentPositionB))
          ? segmentPositionA - cameraPosition
          : segmentPositionB - cameraPosition);
        vec4 closerHwa = distance(cameraPosition, segmentPositionA) < distance(cameraPosition, segmentPositionB)
          ? segmentHwaA
          : segmentHwaB;
        vec3 diagonalDirBorder = normalize(closerHwa.x * lineUpDir + closerHwa.y * lineRightDir);
        bool isVerticalView = abs(dot(cameraViewDir, lineUpDir)) / abs(dot(diagonalDirBorder, lineUpDir))
          > abs(dot(cameraViewDir, lineRightDir)) / abs(dot(diagonalDirBorder, lineRightDir));
        vec2 signs = signsForVertex(id, isVerticalView);
        float viewRightSign = sign(dot(-cameraViewDir, lineRightDir));
        float viewTopSign = sign(dot(-cameraViewDir, lineUpDir));
        float halfHeight = 0.5 * hwa.x;
        float halfWidth = 0.5 * hwa.y;
        vec3 horizontalDir = halfWidth * lineRightDir;
        vec3 verticalDir = halfHeight * lineUpDir;
        float horizontalSign = signs.x * viewRightSign;
        float verticalSign = signs.y * viewTopSign;
        vec3 pos = endpointPos + horizontalSign * horizontalDir + verticalSign * verticalDir;

        if ((id > 1.5 && id < 2.5) || (id > 6.5 && id < 7.5)) {
          float lineDirSign = (id < 2.5) ? -1.0 : 1.0;
          if (abs(hwa.z) < 1e-6) {
            pos += lineDirSign * lineDir * halfWidth;
          } else {
            pos += lineDirSign * lineDir * halfWidth * sin(abs(hwa.z) * 0.5);
            pos += sign(hwa.z) * horizontalDir * cos(abs(hwa.z) * 0.5);
          }
        }

        vec4 eyePosition4 = modelViewMatrix * vec4(pos, 1.0);
        eyePosition4.z += hwa.w;
        vec3 normalWorld = normalize(pos - endpointPos);
        vec3 eyeNormal = normalize(mat3(viewMatrix) * normalWorld);
        vColor = colorBase * lighting(eyePosition4.xyz, eyeNormal);
        gl_Position = projectionMatrix * eyePosition4;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  }),
  { userData: { shared: true } },
);

/**
 * Build an elliptical-cross-section mitered tube BufferGeometry for a chain.
 * `layerHeight` is the vertical extent of the bead (Z). `baseZ` is the layer
 * top Z. Returns null for chains that can't form a tube (< 2 points).
 */
/** Decide whether to subdivide a chain. Subdivision smooths circular features
 *  (eliminates the per-vertex tab pattern) but rounds off sharp polygon
 *  corners. We only subdivide chains that look like curve approximations:
 *  enough points AND short average segment relative to lineWidth. */
function shouldSubdivide(chain: TubeChain): boolean {
  if (chain.type === 'gap-fill') return false;
  if (chain.points.length < TUBE_SUBDIVISION_MIN_POINTS) return false;
  let totalLen = 0;
  let count = 0;
  for (let i = 0; i < chain.points.length - 1; i++) {
    totalLen += Math.hypot(
      chain.points[i + 1].x - chain.points[i].x,
      chain.points[i + 1].y - chain.points[i].y,
    );
    count++;
  }
  if (chain.isClosed && chain.points.length > 1) {
    const last = chain.points[chain.points.length - 1];
    const first = chain.points[0];
    totalLen += Math.hypot(first.x - last.x, first.y - last.y);
    count++;
  }
  if (count === 0) return false;
  const avgLen = totalLen / count;
  // Pick an average lw across the chain.
  let avgLw = 0;
  for (const p of chain.points) avgLw += p.lw;
  avgLw /= chain.points.length;
  return avgLen < avgLw * TUBE_SUBDIVISION_LW_RATIO;
}

/** Subdivide a chain via centripetal Catmull-Rom interpolation. Each polygon
 *  segment gets `TUBE_SUBDIVISION_FACTOR` extra in-between sample points,
 *  with line widths and colours linearly interpolated. The result is a much
 *  smoother polyline that the existing tube builder turns into a clean
 *  swept tube without per-vertex tabs.
 *
 *  Catmull-Rom rounds off sharp corners — we only call this on chains that
 *  passed `shouldSubdivide`, which excludes shapes with sparse vertices. */
function subdivideChain(chain: TubeChain): TubeChain {
  const n = chain.points.length;
  const pts = chain.points.map((p) => new THREE.Vector3(p.x, p.y, 0));
  const curve = new THREE.CatmullRomCurve3(pts, chain.isClosed, 'centripetal');
  const segCount = chain.isClosed ? n : n - 1;
  const totalSamples = segCount * TUBE_SUBDIVISION_FACTOR + (chain.isClosed ? 0 : 1);
  const sampledPoints: TubeChain['points'] = [];
  const sampledSegColors: TubeChain['segColors'] = [];
  const sampledMoveRefs: TubeChain['moveRefs'] = [];
  // Sample TUBE_SUBDIVISION_FACTOR sub-points per polygon segment. For each
  // sub-point, find which original segment it belongs to and interpolate
  // the line width / colour / hover ref from that segment.
  for (let i = 0; i < totalSamples; i++) {
    const tGlobal = chain.isClosed
      ? (i / totalSamples)
      : (i / (totalSamples - 1));
    const idxFloat = tGlobal * segCount;
    const segIdx = Math.min(segCount - 1, Math.floor(idxFloat));
    const segFrac = Math.min(1, Math.max(0, idxFloat - segIdx));
    const pt = curve.getPoint(tGlobal);
    const fromIdx = segIdx;
    const toIdx = (segIdx + 1) % n;
    const fromLw = chain.points[fromIdx].lw;
    const toLw = chain.points[toIdx].lw;
    const lw = fromLw * (1 - segFrac) + toLw * segFrac;
    sampledPoints.push({ x: pt.x, y: pt.y, lw });
    // Sub-points within the same polygon segment share the segment's colour
    // and move ref. We emit one sample per (sub-position, segment) pair.
    if (i < totalSamples - (chain.isClosed ? 0 : 1)) {
      const segColor = chain.segColors[segIdx] ?? chain.segColors[chain.segColors.length - 1];
      const segRef = chain.moveRefs[segIdx] ?? chain.moveRefs[chain.moveRefs.length - 1];
      sampledSegColors.push(segColor);
      sampledMoveRefs.push(segRef);
    }
  }
  return {
    type: chain.type,
    points: sampledPoints,
    segColors: sampledSegColors,
    moveRefs: sampledMoveRefs,
    isClosed: chain.isClosed,
  };
}

function isWallType(type: string): boolean {
  return type === 'wall-outer' || type === 'wall-inner';
}

function endTrimFactorForType(type: string): number {
  if (type === 'top-bottom') return SOLID_SKIN_END_TRIM_FACTOR;
  return TRIMMED_FILL_TYPES.has(type) ? FILL_END_TRIM_FACTOR : OPEN_WALL_END_TRIM_FACTOR;
}

function ringLayoutForType(type: string) {
  return type === 'top-bottom' ? PRESSED_ROAD_RING_LAYOUT : TUBE_RING_LAYOUT;
}

function roadShadeForLayout(type: string, layout: { vertF: number }): number {
  if (type !== 'top-bottom') return 1;
  if (layout.vertF > 0.9) return 0.96;
  if (layout.vertF > 0) return 0.68;
  return 0.42;
}

function buildOrcaSegmentTemplateGeometry(
  chain: TubeChain,
  layerHeight: number,
  baseZ: number,
): THREE.BufferGeometry | null {
  const n = chain.points.length;
  if (n < 2) return null;

  const positions: number[] = [];
  const vertexIds: number[] = [];
  const segmentPositionA: number[] = [];
  const segmentPositionB: number[] = [];
  const segmentHwaA: number[] = [];
  const segmentHwaB: number[] = [];
  const segmentColorA: number[] = [];
  const segmentColorB: number[] = [];
  const centerZ = baseZ - layerHeight * 0.5;

  const endpointAngle = (pointIndex: number): number => {
    const prevIndex = pointIndex > 0 ? pointIndex - 1 : (chain.isClosed ? n - 1 : -1);
    const nextIndex = pointIndex < n - 1 ? pointIndex + 1 : (chain.isClosed ? 0 : -1);
    if (prevIndex < 0 || nextIndex < 0 || prevIndex === nextIndex) return 0;
    const prev = chain.points[prevIndex];
    const here = chain.points[pointIndex];
    const next = chain.points[nextIndex];
    const prevLineX = here.x - prev.x;
    const prevLineY = here.y - prev.y;
    const thisLineX = next.x - here.x;
    const thisLineY = next.y - here.y;
    const prevLen = Math.hypot(prevLineX, prevLineY);
    const thisLen = Math.hypot(thisLineX, thisLineY);
    if (prevLen < 1e-6 || thisLen < 1e-6) return 0;
    return Math.atan2(
      prevLineX * thisLineY - prevLineY * thisLineX,
      prevLineX * thisLineX + prevLineY * thisLineY,
    );
  };

  const segCount = chain.isClosed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = chain.points[i];
    const b = chain.points[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;

    const color = chain.segColors[i] ?? chain.segColors[chain.segColors.length - 1] ?? [1, 1, 1];
    const startAngle = endpointAngle(i);
    const endAngle = endpointAngle((i + 1) % n);
    for (const vertexId of ORCA_SEGMENT_TEMPLATE_VERTEX_IDS) {
      positions.push(0, 0, 0);
      vertexIds.push(vertexId);
      segmentPositionA.push(a.x, a.y, centerZ);
      segmentPositionB.push(b.x, b.y, centerZ);
      segmentHwaA.push(layerHeight, Math.max(0.01, a.lw), startAngle, 0);
      segmentHwaB.push(layerHeight, Math.max(0.01, b.lw), endAngle, 0);
      segmentColorA.push(color[0], color[1], color[2]);
      segmentColorB.push(color[0], color[1], color[2]);
    }
  }

  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('vertexId', new THREE.Float32BufferAttribute(vertexIds, 1));
  geo.setAttribute('segmentPositionA', new THREE.Float32BufferAttribute(segmentPositionA, 3));
  geo.setAttribute('segmentPositionB', new THREE.Float32BufferAttribute(segmentPositionB, 3));
  geo.setAttribute('segmentHwaA', new THREE.Float32BufferAttribute(segmentHwaA, 4));
  geo.setAttribute('segmentHwaB', new THREE.Float32BufferAttribute(segmentHwaB, 4));
  geo.setAttribute('segmentColorA', new THREE.Float32BufferAttribute(segmentColorA, 3));
  geo.setAttribute('segmentColorB', new THREE.Float32BufferAttribute(segmentColorB, 3));
  geo.computeBoundingSphere();
  return geo;
}

export function buildChainTube(
  chain: TubeChain,
  layerHeight: number,
  baseZ: number,
  options: { usePressedRoadTemplate?: boolean; useSegmentTemplate?: boolean } = {},
): THREE.BufferGeometry | null {
  if (
    options.useSegmentTemplate
    || (chain.type === 'top-bottom' && options.usePressedRoadTemplate !== false)
  ) {
    return buildOrcaSegmentTemplateGeometry(chain, layerHeight, baseZ);
  }

  // Smooth circular-feature chains via Catmull-Rom subdivision before
  // building the tube. This removes the per-vertex "tab" pattern caused by
  // abrupt tangent changes at polygon corners — the issue OrcaSlicer hides
  // by using Arachne variable-width walls (which we don't have), and we
  // hide by rendering the polygon as a smooth interpolated curve.
  const sourceChain: TubeChain = shouldSubdivide(chain) ? subdivideChain(chain) : chain;
  const n = sourceChain.points.length;
  if (n < 2) return null;

  const RADIAL = TUBE_RADIAL_SEGMENTS;
  const ringLayout = ringLayoutForType(chain.type);
  const ringSize = RADIAL + 1;         // duplicate vertex to avoid seam artefacts
  const vExt = layerHeight / 2;
  const centerZ = baseZ - vExt;

  type Vec2 = { x: number; y: number };
  const tangents: Vec2[] = new Array(n);
  const perps: Vec2[] = new Array(n);
  const miterX: number[] = new Array(n);

  const dir = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): Vec2 | null => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return null;
    return { x: dx / l, y: dy / l };
  };

  // Step 1: per-vertex tangent (bisector of in/out dirs) + miter compensation.
  // Miter = 1 / cos(β/2) stretches the perpendicular axis so adjacent tube
  // segments meet flush at the bisector plane (no flat-end gap at the corner).
  for (let i = 0; i < n; i++) {
    let inDir: Vec2 | null = null;
    if (i > 0) inDir = dir(sourceChain.points[i - 1], sourceChain.points[i]);
    else if (sourceChain.isClosed) inDir = dir(sourceChain.points[n - 1], sourceChain.points[0]);

    let outDir: Vec2 | null = null;
    if (i < n - 1) outDir = dir(sourceChain.points[i], sourceChain.points[i + 1]);
    else if (sourceChain.isClosed) outDir = dir(sourceChain.points[n - 1], sourceChain.points[0]);

    const ix = inDir?.x ?? 0, iy = inDir?.y ?? 0;
    const ox = outDir?.x ?? 0, oy = outDir?.y ?? 0;
    let tx = ix + ox, ty = iy + oy;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) {
      // in/out exactly oppose (180° U-turn) — fall back to either dir alone.
      tx = (ix !== 0 || iy !== 0) ? ix : ox;
      ty = (ix !== 0 || iy !== 0) ? iy : oy;
      const tl2 = Math.hypot(tx, ty) || 1;
      tangents[i] = { x: tx / tl2, y: ty / tl2 };
    } else {
      tangents[i] = { x: tx / tl, y: ty / tl };
    }
    perps[i] = { x: -tangents[i].y, y: tangents[i].x };

    let miter = 1;
    if (inDir && outDir) {
      const dotInOut = ix * ox + iy * oy;
      const cosHalf = Math.sqrt(Math.max(0.01, (1 + dotInOut) / 2));
      miter = Math.min(MITER_MAX, 1 / cosHalf);
    }
    miterX[i] = miter;
  }

  // Step 2: keep open endpoints faithful to the G-code coordinate. Orca keeps
  // wall endpoints at their real bead width; shrinking them makes near-seam
  // wall fragments read as dents when many layers are visible.
  const trim = !sourceChain.isClosed && (TRIMMED_FILL_TYPES.has(sourceChain.type) || isWallType(sourceChain.type));
  const trimFactor = endTrimFactorForType(sourceChain.type);
  const pts = sourceChain.points.map((p) => ({ x: p.x, y: p.y, lw: p.lw }));
  if (trim && n >= 2) {
    const d0 = dir(sourceChain.points[0], sourceChain.points[1]);
    if (d0) {
      const req = sourceChain.points[0].lw * trimFactor;
      pts[0].x = sourceChain.points[0].x + d0.x * req;
      pts[0].y = sourceChain.points[0].y + d0.y * req;
    }
    const dn = dir(sourceChain.points[n - 2], sourceChain.points[n - 1]);
    if (dn) {
      const req = sourceChain.points[n - 1].lw * trimFactor;
      pts[n - 1].x = sourceChain.points[n - 1].x - dn.x * req;
      pts[n - 1].y = sourceChain.points[n - 1].y - dn.y * req;
    }
  }
  // Step 3: per-RING colour = avg of adjacent segment colours for smooth
  // transitions.
  const segN = sourceChain.segColors.length;
  const ringColor = (ringIdx: number): [number, number, number] => {
    if (sourceChain.isClosed) {
      const prev = (ringIdx - 1 + segN) % segN;
      const curr = ringIdx % segN;
      const cp = sourceChain.segColors[prev];
      const cc = sourceChain.segColors[curr];
      return [(cp[0] + cc[0]) * 0.5, (cp[1] + cc[1]) * 0.5, (cp[2] + cc[2]) * 0.5];
    }
    if (ringIdx === 0) return sourceChain.segColors[0];
    if (ringIdx >= segN) return sourceChain.segColors[segN - 1];
    const cp = sourceChain.segColors[ringIdx - 1];
    const cc = sourceChain.segColors[ringIdx];
    return [(cp[0] + cc[0]) * 0.5, (cp[1] + cc[1]) * 0.5, (cp[2] + cc[2]) * 0.5];
  };

  // Step 4: build vertex rings.
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const perp = perps[i];
    const hExt = (p.lw / 2) * miterX[i];
    const [cr, cg, cb] = ringColor(i);

    for (let r = 0; r <= RADIAL; r++) {
      const layout = ringLayout[r % RADIAL];
      positions.push(
        p.x + layout.perpF * perp.x * hExt,
        p.y + layout.perpF * perp.y * hExt,
        centerZ + layout.vertF * vExt,
      );
      // Outward face normal (corners use averaged adjacent-face normals
      // for a soft Phong roll-off, not a hard discontinuity).
      normals.push(layout.nPerpF * perp.x, layout.nPerpF * perp.y, layout.nZF);
      const shade = roadShadeForLayout(sourceChain.type, layout);
      colors.push(cr * shade, cg * shade, cb * shade);
    }
  }

  // Step 5: index triangles connecting adjacent rings. Closed chains wrap.
  const indices: number[] = [];
  const loopCount = sourceChain.isClosed ? n : n - 1;
  for (let i = 0; i < loopCount; i++) {
    const iNext = (i + 1) % n;
    for (let r = 0; r < RADIAL; r++) {
      const a = i * ringSize + r;
      const b = i * ringSize + r + 1;
      const c = iNext * ringSize + r;
      const d = iNext * ringSize + r + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  // Step 6: no baked point caps on open preview chains.
  //
  // Orca's libvgcode caps are produced in a camera-aware shader. Baking a
  // fixed pyramid cap into our CPU mesh makes top-layer line endpoints near
  // walls look like white chevrons or shifted blobs, especially where chain
  // breaks happen along an outer wall. Flat tube endpoints are less fancy,
  // but they keep the preview faithful to the actual G-code centerline and
  // avoid inventing visible plastic that is not present in the path.
  //
  // We deliberately do NOT cap open WALL chains. Real Arachne emits
  // closed wall loops, but the chain assembler in `GCodeTubePreview`
  // sometimes flags a closed loop as open (a libArachne path missing
  // an explicit closing duplicate vertex, or a tiny float drift below
  // the loop-closure tolerance). When that happens, capping every
  // unclosed wall chain dots the entire perimeter with apex pyramids
  // that look like bright per-segment markers in the preview at
  // certain zoom levels — the bug we hit on a 60 mm disc with mounting
  // holes. Near-loop walls are closed before this builder runs; remaining
  // open walls keep their real width so the preview does not invent seam dents.
  //
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}
