import * as THREE from 'three';
import type { SliceLayer, SliceMove } from '../../../../types/slicer';
import type { PreviewColorMode, ShaftMoveData } from '../../../../types/slicer-preview.types';
import {
  MOVE_TYPE_THREE_COLORS,
  SPEED_LOW_COLOR, SPEED_HIGH_COLOR,
  FLOW_LOW_COLOR, FLOW_HIGH_COLOR,
  WIDTH_LOW_COLOR, WIDTH_HIGH_COLOR,
  LAYER_TIME_LOW_COLOR, LAYER_TIME_HIGH_COLOR,
  Z_SEAM_DIM_THREE_COLOR,
} from '../preview/constants';

const DEFAULT_FILAMENT_DIAMETER_MM = 1.75;
const MIN_LINE_WIDTH_MM = 0.02;
const MAX_LINE_WIDTH_FACTOR = 3;

// Wall extrusions report a per-segment lineWidth that's already the slicer's
// chosen bead width; per-segment E-noise from accel/jerk compensation makes
// the volumetric formula jitter, so use the nominal width directly. Fill
// types (infill, top-bottom, gap-fill, bridge, ironing) get the volumetric
// width — that's what makes Arachne / variable-flow visualisation match the
// real extrusion volume the printer will actually deposit.
function usesNominalWidth(move: SliceMove): boolean {
  return move.type === 'wall-outer' || move.type === 'wall-inner';
}

export function lineWidthForMove(
  move: SliceMove,
  segmentLength: number,
  layerHeight: number,
  filamentDiameter: number,
): number {
  const nominal = Math.max(MIN_LINE_WIDTH_MM, move.lineWidth ?? 0.4);
  if (usesNominalWidth(move) || move.type === 'top-bottom') return nominal;

  const beadHeight = Math.max(0.02, move.layerHeight ?? layerHeight);
  if (move.extrusion <= 0 || segmentLength <= 1e-6 || beadHeight <= 0) return nominal;

  // Width from gcode: extruded filament volume / (segment_length × layer_height).
  // Same formula OrcaSlicer uses to back-derive line width from the E values.
  const filamentRadius = Math.max(0.1, filamentDiameter || DEFAULT_FILAMENT_DIAMETER_MM) * 0.5;
  const filamentArea = Math.PI * filamentRadius * filamentRadius;
  const volumeWidth = (move.extrusion * filamentArea) / (segmentLength * beadHeight);
  if (!Number.isFinite(volumeWidth) || volumeWidth <= 0) return nominal;
  return Math.min(Math.max(volumeWidth, MIN_LINE_WIDTH_MM), nominal * MAX_LINE_WIDTH_FACTOR);
}

// Solid-skin lines printed at ~one-line-width pitch should visually meet so
// the skin reads as a continuous surface — matches OrcaSlicer's preview. We
// detect dense parallel runs and widen them to their measured pitch instead
// of leaving a sub-mm visual gap.
const SOLID_SKIN_CONTACT_ALLOWANCE = 1.015;
const SOLID_SKIN_PITCH_TOLERANCE = 1.12;
const SOLID_SKIN_MIN_PITCH_FACTOR = 0.72;

export function inferDenseSkinWidths(moves: readonly SliceMove[]): Map<number, number> {
  const groups = new Map<string, Array<{ index: number; offset: number; width: number }>>();
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    if (move.type !== 'top-bottom' || move.extrusion <= 0) continue;
    const dx = move.to.x - move.from.x;
    const dy = move.to.y - move.from.y;
    const len = Math.hypot(dx, dy);
    const width = Math.max(MIN_LINE_WIDTH_MM, move.lineWidth ?? 0.4);
    if (len < width * 2) continue;

    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += Math.PI;
    if (angle >= Math.PI) angle -= Math.PI;
    const angleKey = (Math.round(angle * 1000) / 1000).toFixed(3);
    const mx = (move.from.x + move.to.x) * 0.5;
    const my = (move.from.y + move.to.y) * 0.5;
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    const offset = mx * nx + my * ny;
    const list = groups.get(angleKey) ?? [];
    list.push({ index: i, offset, width });
    groups.set(angleKey, list);
  }

  const widened = new Map<number, number>();
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < list.length; i++) {
      const prev = i > 0 ? Math.abs(list[i].offset - list[i - 1].offset) : Infinity;
      const next = i + 1 < list.length ? Math.abs(list[i + 1].offset - list[i].offset) : Infinity;
      const pitch = Math.min(prev, next);
      const width = list[i].width;
      if (
        Number.isFinite(pitch)
        && pitch >= width * SOLID_SKIN_MIN_PITCH_FACTOR
        && pitch <= width * SOLID_SKIN_PITCH_TOLERANCE
      ) {
        widened.set(list[i].index, Math.max(width * SOLID_SKIN_CONTACT_ALLOWANCE, pitch * SOLID_SKIN_CONTACT_ALLOWANCE));
      }
    }
  }
  return widened;
}

// ---------------------------------------------------------------------------
// Color computation per move
// ---------------------------------------------------------------------------

const FALLBACK_COLOR = new THREE.Color('#ffffff');
const _scratch = new THREE.Color();

export interface ColorContext {
  mode: PreviewColorMode;
  // Per-layer scalar ranges (computed once, reused for every move).
  speedRange: [number, number];
  flowRange: [number, number];
  widthRange: [number, number];
  // 0..1 normalised position on the layer-time ramp (only used in layer-time mode).
  layerTimeT: number;
  // Median wall width (only used in wall-quality mode).
  medianWallWidth: number;
}

export function colorForMove(move: SliceMove, ctx: ColorContext): [number, number, number] {
  const { mode } = ctx;
  if (mode === 'type') {
    _scratch.copy(MOVE_TYPE_THREE_COLORS[move.type] ?? FALLBACK_COLOR);
  } else if (mode === 'speed') {
    // Speed/flow/width/layer-time all lerp the same constants the Legend
    // draws its CSS gradient from — see workspace/preview/constants.ts.
    // Keeping the math here in sync with the legend's gradient endpoints
    // is the "legend and 3D preview always agree" guarantee that file
    // documents.
    const span = Math.max(0.01, ctx.speedRange[1] - ctx.speedRange[0]);
    const t = Math.max(0, Math.min(1, (move.speed - ctx.speedRange[0]) / span));
    _scratch.copy(SPEED_LOW_COLOR).lerp(SPEED_HIGH_COLOR, t);
  } else if (mode === 'flow') {
    const span = Math.max(1e-9, ctx.flowRange[1] - ctx.flowRange[0]);
    const t = Math.max(0, Math.min(1, (move.extrusion - ctx.flowRange[0]) / span));
    _scratch.copy(FLOW_LOW_COLOR).lerp(FLOW_HIGH_COLOR, t);
  } else if (mode === 'width') {
    const span = Math.max(0.001, ctx.widthRange[1] - ctx.widthRange[0]);
    const t = Math.max(0, Math.min(1, (move.lineWidth - ctx.widthRange[0]) / span));
    _scratch.copy(WIDTH_LOW_COLOR).lerp(WIDTH_HIGH_COLOR, t);
  } else if (mode === 'seam') {
    _scratch.copy(Z_SEAM_DIM_THREE_COLOR);
  } else if (mode === 'wall-quality') {
    const isWall = move.type === 'wall-outer' || move.type === 'wall-inner';
    if (!isWall || ctx.medianWallWidth <= 0) {
      _scratch.setRGB(0.35, 0.35, 0.35);
    } else {
      const ratio = move.lineWidth / ctx.medianWallWidth;
      if (ratio < 0.95) {
        const t = Math.max(0, Math.min(1, (0.95 - ratio) / 0.5));
        _scratch.setRGB(0.4, 0.55, 0.85).multiplyScalar(0.6 + 0.4 * t);
      } else if (ratio > 1.05) {
        const t = Math.max(0, Math.min(1, (ratio - 1.05) / 0.5));
        _scratch.setRGB(0.95, 0.55, 0.2).multiplyScalar(0.6 + 0.4 * t);
      } else {
        _scratch.setRGB(0.3, 0.85, 0.4);
      }
    }
  } else {
    // layer-time
    _scratch.copy(LAYER_TIME_LOW_COLOR).lerp(
      LAYER_TIME_HIGH_COLOR,
      Math.max(0, Math.min(1, ctx.layerTimeT)),
    );
  }
  return [_scratch.r, _scratch.g, _scratch.b];
}

// ---------------------------------------------------------------------------
// Layer -> instance buffers
// ---------------------------------------------------------------------------

export interface LayerInstanceData {
  count: number;
  // Per-instance buffers (length = count * componentSize).
  iA: Float32Array;        // start xyz
  iB: Float32Array;        // end xyz
  iRadius: Float32Array;   // (rStart, rEnd) — half the bead width
  iHalfHeight: Float32Array; // half the bead Z thickness (= layer height / 2)
  iColor: Float32Array;    // rgb
  // Travel + retraction (rendered as line segments / points outside the capsule pipeline).
  travelPositions: Float32Array;
  retractPositions: Float32Array;
  // Per-instance source metadata for picking / hover. moveRefs[i] corresponds to instance i.
  moveRefs: ShaftMoveData[];
  // World-space bounds spanning every instance. Three.js's instanced raycaster
  // rejects rays against the geometry's bounding sphere before iterating
  // instances; the unit-radius template sphere covers (0,0,0) only, so without
  // an instance-aware sphere here every hover ray would be rejected and
  // picking would silently fail.
  boundsCenter: { x: number; y: number; z: number };
  boundsRadius: number;
}

export interface BuildLayerInstancesOptions {
  layer: SliceLayer;
  layerHeight: number;
  filamentDiameter: number;
  isCurrentLayer: boolean;
  currentLayerMoveCount?: number;
  showTravel: boolean;
  hiddenTypes: ReadonlySet<string>;
  colorContext: ColorContext;
}

export function buildLayerInstances(opts: BuildLayerInstancesOptions): LayerInstanceData {
  const {
    layer, layerHeight, filamentDiameter,
    isCurrentLayer, currentLayerMoveCount,
    showTravel, hiddenTypes, colorContext,
  } = opts;

  const moves = (isCurrentLayer && currentLayerMoveCount !== undefined)
    ? layer.moves.slice(0, currentLayerMoveCount)
    : layer.moves;

  const denseSkinWidths = inferDenseSkinWidths(moves);

  // Two passes so we can size the typed arrays exactly. Cheaper than growing
  // arrays and re-allocating on the GPU upload path.
  let extrusionCount = 0;
  let travelCount = 0;
  let retractCount = 0;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.type === 'travel') {
      if (showTravel) travelCount++;
      if (m.extrusion < 0) retractCount++;
      continue;
    }
    if (hiddenTypes.has(m.type)) continue;
    if (m.extrusion <= 0) continue;
    const segLen = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
    if (segLen < 1e-6) continue;
    extrusionCount++;
  }

  const iA = new Float32Array(extrusionCount * 3);
  const iB = new Float32Array(extrusionCount * 3);
  const iRadius = new Float32Array(extrusionCount * 2);
  const iHalfHeight = new Float32Array(extrusionCount);
  const iColor = new Float32Array(extrusionCount * 3);
  const travelPositions = new Float32Array(travelCount * 6);
  const retractPositions = new Float32Array(retractCount * 3);
  const moveRefs: ShaftMoveData[] = new Array(extrusionCount);

  // Variable extrusion across a single move: gcode segments don't ramp width
  // mid-segment (E is per-segment), so radiusStart === radiusEnd here. We
  // still set both so a future "smooth between adjacent segments" pass can
  // taper across joints by averaging neighbours.
  let ext = 0, trv = 0, ret = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let maxRadius = 0;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];

    if (m.type === 'travel') {
      if (showTravel) {
        const k = trv * 6;
        travelPositions[k    ] = m.from.x;
        travelPositions[k + 1] = m.from.y;
        travelPositions[k + 2] = layer.z;
        travelPositions[k + 3] = m.to.x;
        travelPositions[k + 4] = m.to.y;
        travelPositions[k + 5] = layer.z;
        trv++;
      }
      if (m.extrusion < 0) {
        const k = ret * 3;
        retractPositions[k    ] = m.from.x;
        retractPositions[k + 1] = m.from.y;
        retractPositions[k + 2] = layer.z;
        ret++;
      }
      continue;
    }
    if (hiddenTypes.has(m.type)) continue;
    if (m.extrusion <= 0) continue;

    const segLen = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
    if (segLen < 1e-6) continue;

    const baseWidth = lineWidthForMove(m, segLen, layerHeight, filamentDiameter);
    const renderWidth = m.type === 'top-bottom'
      ? (denseSkinWidths.get(i) ?? baseWidth * SOLID_SKIN_CONTACT_ALLOWANCE)
      : baseWidth;
    // Half-width = capsule radius. Bead is rendered as a tube whose cross-
    // section diameter equals the gcode line width, centered on the move's
    // XY axis at z = layer.z - layerHeight/2. The half-layerHeight Z offset
    // keeps the bead resting on the previous layer's top surface.
    const radius = Math.max(MIN_LINE_WIDTH_MM, renderWidth) * 0.5;
    const beadCenterZ = layer.z - layerHeight * 0.5;

    const aOff = ext * 3;
    iA[aOff    ] = m.from.x;
    iA[aOff + 1] = m.from.y;
    iA[aOff + 2] = beadCenterZ;
    iB[aOff    ] = m.to.x;
    iB[aOff + 1] = m.to.y;
    iB[aOff + 2] = beadCenterZ;

    const rOff = ext * 2;
    iRadius[rOff    ] = radius;
    iRadius[rOff + 1] = radius;
    // Bead Z thickness is independent of line width — a 0.45 mm wide bead
    // at 0.20 mm layer height should render as an ELLIPTICAL cross-section,
    // not a circle of width-radius. The shader scales `up` by halfHeight
    // (this) and `right` by radius (above) so the bead reads correctly when
    // the print is flat-on-bed.
    iHalfHeight[ext] = Math.max(0.01, (m.layerHeight ?? layerHeight) * 0.5);

    const [r, g, b] = colorForMove(m, colorContext);
    const cOff = ext * 3;
    iColor[cOff    ] = r;
    iColor[cOff + 1] = g;
    iColor[cOff + 2] = b;

    moveRefs[ext] = {
      type: m.type,
      speed: m.speed,
      extrusion: m.extrusion,
      lineWidth: baseWidth,
      length: segLen,
      moveIndex: i,
    };
    if (m.from.x < minX) minX = m.from.x; if (m.from.x > maxX) maxX = m.from.x;
    if (m.to.x   < minX) minX = m.to.x;   if (m.to.x   > maxX) maxX = m.to.x;
    if (m.from.y < minY) minY = m.from.y; if (m.from.y > maxY) maxY = m.from.y;
    if (m.to.y   < minY) minY = m.to.y;   if (m.to.y   > maxY) maxY = m.to.y;
    if (beadCenterZ < minZ) minZ = beadCenterZ;
    if (beadCenterZ > maxZ) maxZ = beadCenterZ;
    if (radius > maxRadius) maxRadius = radius;
    ext++;
  }

  // Center the bounds on the AABB midpoint, radius = half-diagonal + maxRadius
  // so every capsule (including its hemisphere caps and Z-extent of the bead)
  // sits inside the sphere. Three.js's raycaster uses this for early
  // rejection; an undersized sphere = silent picking failure on instances
  // outside the rejection volume.
  let boundsCenter = { x: 0, y: 0, z: 0 };
  let boundsRadius = 0;
  if (extrusionCount > 0) {
    boundsCenter = {
      x: (minX + maxX) * 0.5,
      y: (minY + maxY) * 0.5,
      z: (minZ + maxZ) * 0.5,
    };
    const halfDiag = Math.hypot(
      (maxX - minX) * 0.5,
      (maxY - minY) * 0.5,
      (maxZ - minZ) * 0.5,
    );
    boundsRadius = halfDiag + maxRadius;
  }

  return {
    count: extrusionCount,
    iA, iB, iRadius, iHalfHeight, iColor,
    travelPositions,
    retractPositions,
    moveRefs,
    boundsCenter,
    boundsRadius,
  };
}

// ---------------------------------------------------------------------------
// Per-layer color context — pre-scans moves once so colorForMove is cheap.
// ---------------------------------------------------------------------------

export function buildColorContext(
  layer: SliceLayer,
  mode: PreviewColorMode,
  layerTimeT: number | undefined,
): ColorContext {
  let minSpeed = Infinity, maxSpeed = -Infinity;
  let minFlow  = Infinity, maxFlow  = -Infinity;
  let minWidth = Infinity, maxWidth = -Infinity;
  if (mode === 'speed' || mode === 'flow' || mode === 'width') {
    for (const m of layer.moves) {
      if (m.type === 'travel') continue;
      if (mode === 'speed') {
        if (m.speed < minSpeed) minSpeed = m.speed;
        if (m.speed > maxSpeed) maxSpeed = m.speed;
      } else if (mode === 'flow') {
        if (m.extrusion < minFlow) minFlow = m.extrusion;
        if (m.extrusion > maxFlow) maxFlow = m.extrusion;
      } else {
        if (m.lineWidth < minWidth) minWidth = m.lineWidth;
        if (m.lineWidth > maxWidth) maxWidth = m.lineWidth;
      }
    }
  }
  let medianWallWidth = 0;
  if (mode === 'wall-quality') {
    const widths: number[] = [];
    for (const m of layer.moves) {
      if ((m.type === 'wall-outer' || m.type === 'wall-inner') && m.lineWidth > 0) {
        widths.push(m.lineWidth);
      }
    }
    widths.sort((a, b) => a - b);
    medianWallWidth = widths[Math.floor(widths.length / 2)] ?? 0.4;
  }
  return {
    mode,
    speedRange: [Number.isFinite(minSpeed) ? minSpeed : 0, Number.isFinite(maxSpeed) ? maxSpeed : 1],
    flowRange:  [Number.isFinite(minFlow)  ? minFlow  : 0, Number.isFinite(maxFlow)  ? maxFlow  : 1],
    widthRange: [Number.isFinite(minWidth) ? minWidth : 0, Number.isFinite(maxWidth) ? maxWidth : 1],
    layerTimeT: layerTimeT ?? 0,
    medianWallWidth,
  };
}
