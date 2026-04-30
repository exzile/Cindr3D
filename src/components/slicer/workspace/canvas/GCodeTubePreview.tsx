import { useEffect, useMemo } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { SliceLayer, SliceMove, SliceResult } from '../../../../types/slicer';
import type {
  MoveHoverInfo,
  PreviewColorMode,
  ShaftMoveData,
  TubeChain,
} from '../../../../types/slicer-preview.types';
import {
  MOVE_TYPE_THREE_COLORS,
  WIDTH_LOW_COLOR, WIDTH_HIGH_COLOR,
  LAYER_TIME_LOW_COLOR, LAYER_TIME_HIGH_COLOR,
  Z_SEAM_DIM_THREE_COLOR,
} from '../preview/constants';
import {
  buildChainTube,
  DENSE_FILL_TUBE_MATERIAL,
  ORCA_SEGMENT_TEMPLATE_MATERIAL,
  ORCA_SEGMENT_TEMPLATE_TRIANGLES,
  TUBE_MATERIAL,
  TUBE_RADIAL_SEGMENTS,
  TRIMMED_FILL_TYPES,
} from './tubeGeometry';

// Single source of truth for bead colours — shared with the HTML legend panel.
const MOVE_TYPE_COLORS = MOVE_TYPE_THREE_COLORS;
const FALLBACK_COLOR = new THREE.Color('#ffffff');

// Module-scoped scratch Vector3 reused by the pointermove hover handler
// to avoid per-frame allocation on the 60 Hz hot path.
const HOVER_WORLD_POS = new THREE.Vector3();

// Visual exaggeration factor for line width. 1.0 = physical width.
const PREVIEW_LINE_SCALE = 1.0;

// Endpoint match tolerance for chain detection.
const PREVIEW_JOIN_EPSILON = 5e-4;
const DEFAULT_FILAMENT_DIAMETER_MM = 1.75;
const MIN_PREVIEW_LINE_WIDTH_MM = 0.02;
const MAX_PREVIEW_LINE_WIDTH_FACTOR = 3;
// Keep solid-skin roads faithful to the G-code width while matching Orca's
// dense-skin preview behavior. If neighboring centerlines are actually spaced
// at about one line width, the roads should visually meet. If the pitch is
// meaningfully larger than the move width, keep that real gap visible.
const SOLID_SKIN_CONTACT_ALLOWANCE = 1.015;
const SOLID_SKIN_PITCH_TOLERANCE = 1.12;
const SOLID_SKIN_MIN_PITCH_FACTOR = 0.72;

// cos(threshold) for chain-splitting. Chain breaks are only for extreme
// bends (> 135°, i.e. near-U-turns) where the miter math fundamentally
// cannot produce sane geometry. Normal polygon corners — 90° rectangles,
// 60° hexagons, 120° cut-outs, even tight 45° turns — stay inside a single
// chain and render as a continuous tube with miter=1 rings.
//
// Why not a tighter threshold? With MITER_MAX = 1.0 there are no miter
// spikes to fight off, and leaving small corners in-chain means their
// end-rings (which would otherwise show as visible "teeth" stacked over
// many layers) become ordinary interior rings that smoothly connect the
// neighbouring tube bodies. The sub-0.1 mm gap at the outer corner of a
// 90° bend is invisible compared to the radial "teeth" artefact produced
// by chain-splitting there.
//
// cos(135°) = -0.707 — only near-U-turns split.
const CHAIN_BREAK_DOT_THRESHOLD = -0.707;
// Scratch colour reused during colour computation inside the tube builder.
const _col = new THREE.Color();

// eslint-disable-next-line react-refresh/only-export-components
export function inferDenseSkinPitchWidths(
  moves: readonly SliceMove[],
): Map<number, number> {
  const groups = new Map<string, Array<{ index: number; offset: number; width: number }>>();
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    if (move.type !== 'top-bottom' || move.extrusion <= 0) continue;
    const dx = move.to.x - move.from.x;
    const dy = move.to.y - move.from.y;
    const len = Math.hypot(dx, dy);
    const width = Math.max(MIN_PREVIEW_LINE_WIDTH_MM, move.lineWidth ?? 0.4);
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

  const pitchWidths = new Map<number, number>();
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
        pitchWidths.set(list[i].index, Math.max(width * SOLID_SKIN_CONTACT_ALLOWANCE, pitch * SOLID_SKIN_CONTACT_ALLOWANCE));
      }
    }
  }
  return pitchWidths;
}

function usesNominalPreviewWidth(move: SliceMove): boolean {
  return move.type === 'wall-outer' || move.type === 'wall-inner';
}

// eslint-disable-next-line react-refresh/only-export-components
export function previewLineWidthFromMove(
  move: SliceMove,
  segmentLength: number,
  layerHeight: number,
  filamentDiameter: number,
): number {
  const nominal = Math.max(MIN_PREVIEW_LINE_WIDTH_MM, move.lineWidth ?? 0.4);
  if (usesNominalPreviewWidth(move) || move.type === 'top-bottom') {
    return nominal * PREVIEW_LINE_SCALE;
  }
  const beadHeight = Math.max(0.02, move.layerHeight ?? layerHeight);
  if (move.extrusion <= 0 || segmentLength <= 1e-6 || beadHeight <= 0) {
    return nominal * PREVIEW_LINE_SCALE;
  }
  const filamentRadius = Math.max(0.1, filamentDiameter || DEFAULT_FILAMENT_DIAMETER_MM) * 0.5;
  const filamentArea = Math.PI * filamentRadius * filamentRadius;
  const volumeWidth = (move.extrusion * filamentArea) / (segmentLength * beadHeight);
  if (!Number.isFinite(volumeWidth) || volumeWidth <= 0) {
    return nominal * PREVIEW_LINE_SCALE;
  }
  const capped = Math.min(
    Math.max(volumeWidth, MIN_PREVIEW_LINE_WIDTH_MM),
    nominal * MAX_PREVIEW_LINE_WIDTH_FACTOR,
  );
  return capped * PREVIEW_LINE_SCALE;
}

// eslint-disable-next-line react-refresh/only-export-components
export function appendJoinedPreviewPoint(
  chain: TubeChain,
  point: { x: number; y: number },
  lineWidth: number,
  color: [number, number, number],
  moveRef: ShaftMoveData,
): void {
  chain.points.push({ x: point.x, y: point.y, lw: lineWidth });
  chain.segColors.push(color);
  chain.moveRefs.push(moveRef);
}

// eslint-disable-next-line react-refresh/only-export-components
export function canContinuePreviewChain(
  chain: TubeChain | null,
  move: SliceMove,
): boolean {
  if (!chain || chain.points.length === 0) return false;
  const last = chain.points[chain.points.length - 1];
  return Math.abs(last.x - move.from.x) <= PREVIEW_JOIN_EPSILON
    && Math.abs(last.y - move.from.y) <= PREVIEW_JOIN_EPSILON;
}

// eslint-disable-next-line react-refresh/only-export-components
export function closePreviewChainIfLoop(chain: TubeChain): void {
  if (chain.isClosed || chain.points.length < 4) return;
  const first = chain.points[0];
  const last = chain.points[chain.points.length - 1];
  const closeGap = Math.hypot(first.x - last.x, first.y - last.y);
  if (closeGap <= PREVIEW_JOIN_EPSILON) {
    chain.points.pop();
    chain.isClosed = true;
  }
}

// ---------------------------------------------------------------------------
// LayerLines — chain-based tube rendering for a single layer
// ---------------------------------------------------------------------------
//
// Walks the layer's moves once, groups consecutive extrusion moves whose
// endpoints chain together into a polyline, then builds one
// tube BufferGeometry per chain (see tubeGeometry.ts for the tube builder
// and the rationale for why this matches real print geometry).

export function LayerLines({
  layer,
  layerHeight,
  filamentDiameter,
  isCurrentLayer,
  currentLayerMoveCount,
  showTravel,
  showRetractions,
  colorMode,
  hiddenTypes,
  layerTimeT,
  onHoverMove,
}: {
  layer: SliceLayer;
  layerHeight: number;
  filamentDiameter: number;
  isCurrentLayer: boolean;
  currentLayerMoveCount: number | undefined;
  showTravel: boolean;
  showRetractions: boolean;
  colorMode: PreviewColorMode;
  hiddenTypes: ReadonlySet<string>;
  /** Normalised 0-1 position on the layer-time ramp (0 = fast, 1 = slow). */
  layerTimeT?: number;
  onHoverMove?: (info: MoveHoverInfo | null) => void;
}) {
  const { tubes, travelGeo, retractGeo } = useMemo(() => {
    const moves = (isCurrentLayer && currentLayerMoveCount !== undefined)
      ? layer.moves.slice(0, currentLayerMoveCount)
      : layer.moves;

    // Pre-scan for per-move scalar ranges so each ramp spans the actual
    // values present in this layer.
    let minSpeed = Infinity, maxSpeed = -Infinity;
    let minFlow  = Infinity, maxFlow  = -Infinity;
    let minWidth = Infinity, maxWidth = -Infinity;
    if (colorMode === 'speed' || colorMode === 'flow' || colorMode === 'width') {
      for (const m of moves) {
        if (m.type === 'travel') continue;
        if (colorMode === 'speed') {
          if (m.speed < minSpeed) minSpeed = m.speed;
          if (m.speed > maxSpeed) maxSpeed = m.speed;
        } else if (colorMode === 'flow') {
          if (m.extrusion < minFlow) minFlow = m.extrusion;
          if (m.extrusion > maxFlow) maxFlow = m.extrusion;
        } else {
          if (m.lineWidth < minWidth) minWidth = m.lineWidth;
          if (m.lineWidth > maxWidth) maxWidth = m.lineWidth;
        }
      }
    }
    const speedRange = Math.max(0.01,  maxSpeed - minSpeed);
    const flowRange  = Math.max(1e-9,  maxFlow  - minFlow);
    const widthRange = Math.max(0.001, maxWidth - minWidth);

    // For 'wall-quality' mode: compute the layer's median wall width
    // and color each wall move by its deviation. Variable-width Arachne
    // tail-walls show up as blue (under-extrusion risk); transition-
    // zone wider walls show as orange (over-extrusion risk). Non-wall
    // moves dim to gray so walls are the focus.
    let medianWallWidth = 0;
    if (colorMode === 'wall-quality') {
      const wallWidths: number[] = [];
      for (const m of layer.moves) {
        if (m.type === 'wall-outer' || m.type === 'wall-inner') {
          if (m.lineWidth > 0) wallWidths.push(m.lineWidth);
        }
      }
      wallWidths.sort((a, b) => a - b);
      medianWallWidth = wallWidths[Math.floor(wallWidths.length / 2)] ?? 0.4;
    }

    const colorOf = (move: SliceMove): [number, number, number] => {
      if (colorMode === 'type') {
        _col.copy(MOVE_TYPE_COLORS[move.type] ?? FALLBACK_COLOR);
      } else if (colorMode === 'speed') {
        const t = Math.max(0, Math.min(1, (move.speed - minSpeed) / speedRange));
        _col.setHSL((1 - t) * 0.66, 0.85, 0.52);
      } else if (colorMode === 'flow') {
        const t = Math.max(0, Math.min(1, (move.extrusion - minFlow) / flowRange));
        _col.setHSL((1 - t) * 0.38, 0.85, 0.52);
      } else if (colorMode === 'width') {
        const t = Math.max(0, Math.min(1, (move.lineWidth - minWidth) / widthRange));
        _col.copy(WIDTH_LOW_COLOR).lerp(WIDTH_HIGH_COLOR, t);
      } else if (colorMode === 'seam') {
        _col.copy(Z_SEAM_DIM_THREE_COLOR);
      } else if (colorMode === 'wall-quality') {
        // For walls only: paint by deviation from median wall width.
        // - At target (±5%): bright green (good extrusion).
        // - Under (≥5% narrower): blue (sub-target, under-extrusion risk).
        // - Over (≥5% wider): orange (transition, over-extrusion risk).
        // Non-wall moves dim to gray so walls are the visual focus —
        // matches OrcaSlicer's "Inspect walls" behavior.
        const isWall = move.type === 'wall-outer' || move.type === 'wall-inner';
        if (!isWall || medianWallWidth <= 0) {
          _col.setRGB(0.35, 0.35, 0.35);
        } else {
          const ratio = move.lineWidth / medianWallWidth; // 1.0 = nominal
          if (ratio < 0.95) {
            // under: gray → blue (more under = more blue)
            const t = Math.max(0, Math.min(1, (0.95 - ratio) / 0.5));
            _col.setRGB(0.4, 0.55, 0.85).multiplyScalar(0.6 + 0.4 * t);
          } else if (ratio > 1.05) {
            // over: gray → orange
            const t = Math.max(0, Math.min(1, (ratio - 1.05) / 0.5));
            _col.setRGB(0.95, 0.55, 0.2).multiplyScalar(0.6 + 0.4 * t);
          } else {
            // at target: bright green
            _col.setRGB(0.3, 0.85, 0.4);
          }
        }
      } else {
        // layer-time: all beads in this layer share the same normalised colour.
        _col.copy(LAYER_TIME_LOW_COLOR).lerp(
          LAYER_TIME_HIGH_COLOR,
          Math.max(0, Math.min(1, layerTimeT ?? 0)),
        );
      }
      return [_col.r, _col.g, _col.b];
    };

    // Chain detection: walk moves in order. Orca/libvgcode keeps consecutive
    // Extrude vertices continuous even when the extrusion role/color changes
    // (outer wall -> inner wall -> skin, etc.). Role changes should not add
    // endpoint caps; only real motion discontinuities should break a bead.
    // A new chain starts on any of:
    //   - travel / retraction move (chain break, travel line recorded)
    //   - hidden type                     - zero-length segment
    //   - from point doesn't match last to
    const travPos: number[] = [];
    const retractPos: number[] = [];
    const chains: TubeChain[] = [];
    let current: TubeChain | null = null;
    const denseSkinPitchWidths = inferDenseSkinPitchWidths(moves);

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];

      if (move.type === 'travel') {
        if (showTravel) {
          travPos.push(move.from.x, move.from.y, layer.z, move.to.x, move.to.y, layer.z);
        }
        if (move.extrusion < 0) {
          retractPos.push(move.from.x, move.from.y, layer.z);
        }
        // Travels INSIDE a same-type wall chain (between fragments at the
        // same depth) shouldn't break the visible tube — libArachne emits
        // the inner wall as one closed loop plus several short medial-axis
        // fragments at the same depth, and the slicer schedules a travel
        // between them. Orca's preview hides those travels so the wall
        // reads as a single ring.
        //
        // CRITICAL: the next move's type must match the current chain's
        // type. Without this check, a short travel between a wall-outer
        // ending and a wall-inner starting kept the chain alive, and the
        // renderer drew a tube from the outer's end straight to the
        // inner's start — that tube cut inward across the wall band and
        // surfaced as the inward triangular "bumps" we kept seeing on the
        // outer red wall. Type matching restricts the bridge to legitimate
        // intra-feature gaps.
        const insideWallChain = current !== null
          && (current.type === 'wall-inner' || current.type === 'wall-outer'
              || current.type === 'gap-fill' || current.type === 'mixed');
        const travelLen = Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y);
        const nextMove = i + 1 < moves.length ? moves[i + 1] : null;
        const nextMatchesChain = insideWallChain
          && nextMove !== null
          && nextMove.type === current!.type;
        if (insideWallChain && nextMatchesChain && travelLen <= 8) continue;
        current = null;
        continue;
      }
      if (hiddenTypes.has(move.type)) { current = null; continue; }
      if (move.extrusion <= 0)        { current = null; continue; }

      const segLen = Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y);
      if (segLen < 1e-6) continue;

      const lw = previewLineWidthFromMove(move, segLen, layerHeight, filamentDiameter);
      const renderLw = move.type === 'top-bottom'
        ? (denseSkinPitchWidths.get(i) ?? (lw * SOLID_SKIN_CONTACT_ALLOWANCE))
        : lw;
      const col = colorOf(move);
      const ref: ShaftMoveData = {
        type: move.type,
        speed: move.speed,
        extrusion: move.extrusion,
        lineWidth: lw,
        length: segLen,
        moveIndex: i,
      };

      // Decide whether to extend the current chain, or break it and start
      // fresh. Orca keeps consecutive Extrude vertices continuous across
      // extrusion roles/colors; only real motion discontinuities should cap.
      let extendable = canContinuePreviewChain(current, move);

      if (extendable && current!.points.length >= 2 && !TRIMMED_FILL_TYPES.has(move.type)) {
        const lastIdx = current!.points.length - 1;
        const prev = current!.points[lastIdx - 1];
        const here = current!.points[lastIdx];
        const inDx = here.x - prev.x;
        const inDy = here.y - prev.y;
        const inLen = Math.hypot(inDx, inDy);
        const outDx = move.to.x - move.from.x;
        const outDy = move.to.y - move.from.y;
        const outLen = Math.hypot(outDx, outDy);
        if (inLen > 1e-6 && outLen > 1e-6) {
          const dotInOut = (inDx * outDx + inDy * outDy) / (inLen * outLen);
          if (dotInOut < CHAIN_BREAK_DOT_THRESHOLD) {
            // Bend too sharp — break the chain here so the sharp vertex gets
            // a bevel join instead of a miter spike.
            extendable = false;
          }
        }
      }

      if (extendable && current) {
        if (current.type !== move.type) current.type = 'mixed';
        appendJoinedPreviewPoint(current, move.to, renderLw, col, ref);
      } else {
        current = {
          type: move.type,
          points: [
            { x: move.from.x, y: move.from.y, lw: renderLw },
            { x: move.to.x,   y: move.to.y,   lw: renderLw },
          ],
          segColors: [col],
          moveRefs: [ref],
          isClosed: false,
        };
        chains.push(current);
      }
    }

    // Orca's segment shader expects closed loops to use the neighboring
    // segments for endpoint angles. The G-code move stream closes a wall by
    // extruding back to the first point, so the chain arrives here with a
    // duplicate final endpoint. Collapse that duplicate into an implicit loop;
    // otherwise the shader treats the seam as two open endpoints and draws
    // point caps, which stack into visible zipper dents on round outer walls.
    for (const chain of chains) closePreviewChainIfLoop(chain);

    // Build a tube for each chain.
    const beadHeight = Math.max(0.02, layerHeight);
    const tubeList: Array<{
      geometry: THREE.BufferGeometry;
      type: string;
      moveRefs: ShaftMoveData[];
    }> = [];
    for (const chain of chains) {
      const geo = buildChainTube(chain, beadHeight, layer.z, {
        // OrcaSlicer renders G-code preview through libvgcode's instanced
        // segment template. Use the same path here instead of the older
        // continuous swept-tube fallback so wall roles, widths, and seam
        // endpoint angles stay faithful to the move stream.
        useSegmentTemplate: true,
      });
      if (!geo) continue;
      tubeList.push({ geometry: geo, type: chain.type, moveRefs: chain.moveRefs });
    }

    const tg = travPos.length > 0 ? new THREE.BufferGeometry() : null;
    if (tg) tg.setAttribute('position', new THREE.Float32BufferAttribute(travPos, 3));

    const rg = retractPos.length > 0 ? new THREE.BufferGeometry() : null;
    if (rg) rg.setAttribute('position', new THREE.Float32BufferAttribute(retractPos, 3));

    return { tubes: tubeList, travelGeo: tg, retractGeo: rg };
  }, [layer, layerHeight, filamentDiameter, isCurrentLayer, currentLayerMoveCount, showTravel, colorMode, hiddenTypes, layerTimeT]);

  useEffect(() => () => {
    for (const t of tubes) t.geometry.dispose();
    travelGeo?.dispose();
    retractGeo?.dispose();
  }, [tubes, travelGeo, retractGeo]);

  return (
    <>
      {tubes.map((t, i) => (
        <mesh
          key={`${layer.layerIndex}-${t.type}-${i}`}
          geometry={t.geometry}
          material={t.geometry.getAttribute('vertexId')
            ? ORCA_SEGMENT_TEMPLATE_MATERIAL
            : (TRIMMED_FILL_TYPES.has(t.type) ? DENSE_FILL_TUBE_MATERIAL : TUBE_MATERIAL)}
          renderOrder={TRIMMED_FILL_TYPES.has(t.type) ? 0 : 2}
          frustumCulled={false}
          onPointerMove={onHoverMove ? (e: ThreeEvent<PointerEvent>) => {
            // Hover inspect: each segment owns RADIAL × 2 triangles
            // (RADIAL quads × 2 tri). Face index → segment index.
            const faceIdx = e.faceIndex ?? undefined;
            if (faceIdx === undefined) return;
            const trianglesPerMove = t.geometry.getAttribute('vertexId')
              ? ORCA_SEGMENT_TEMPLATE_TRIANGLES
              : TUBE_RADIAL_SEGMENTS * 2;
            const segIdx = Math.floor(faceIdx / trianglesPerMove);
            if (segIdx < 0 || segIdx >= t.moveRefs.length) return;
            e.stopPropagation();
            // r3f_critical_patterns: don't `new THREE.Vector3()` on the
            // pointermove hot path. Reuse a module-scoped scratch Vector3
            // — the hover handler debounces via the React state setter
            // anyway, and downstream consumers (HoverTooltip's <Html>)
            // copy this position into their own coords.
            HOVER_WORLD_POS.copy(e.point);
            onHoverMove({
              ...t.moveRefs[segIdx],
              worldPos: HOVER_WORLD_POS,
            });
          } : undefined}
          onPointerLeave={onHoverMove ? () => onHoverMove(null) : undefined}
        />
      ))}
      {travelGeo && (
        <lineSegments key={`${layer.layerIndex}-travel`} geometry={travelGeo} renderOrder={1}>
          <lineBasicMaterial color="#4455aa" transparent opacity={0.35} depthWrite={false} />
        </lineSegments>
      )}
      {showRetractions && retractGeo && (
        // Retraction markers. `sizeAttenuation` makes the points scale
        // with camera distance; at a 60 mm part the previous size of
        // 1.2 mm rendered as visibly chunky squares (GL_POINTS rasterise
        // as axis-aligned quads, so they look square not round at any
        // zoom where the size exceeds ~1 px). Smaller world-size + lower
        // opacity keeps them legible without dominating the preview.
        <points key={`${layer.layerIndex}-retract`} geometry={retractGeo} renderOrder={2}>
          <pointsMaterial color="#ff3333" size={0.35} sizeAttenuation transparent opacity={0.7} depthWrite={false} />
        </points>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// InlineGCodePreview — renders each visible layer's LayerLines
// ---------------------------------------------------------------------------

export function InlineGCodePreview({
  sliceResult,
  filamentDiameter,
  startLayer,
  currentLayer,
  currentLayerMoveCount,
  showTravel,
  showRetractions,
  colorMode,
  hiddenTypes,
  layerTimeRange,
  onHoverMove,
}: {
  sliceResult: SliceResult;
  filamentDiameter?: number;
  startLayer: number;
  currentLayer: number;
  currentLayerMoveCount?: number;
  showTravel: boolean;
  showRetractions: boolean;
  colorMode: PreviewColorMode;
  hiddenTypes: ReadonlySet<string>;
  /** [min, max] layer-time across the visible window — only used in layer-time mode. */
  layerTimeRange: [number, number];
  onHoverMove?: (info: MoveHoverInfo | null) => void;
}) {
  const layers = useMemo(
    () => sliceResult.layers.filter(
      (l) => l.layerIndex >= startLayer && l.layerIndex <= currentLayer,
    ),
    [sliceResult, startLayer, currentLayer],
  );

  return (
    <group>
      {layers.map((layer) => {
        const prevZ = layer.layerIndex > 0
          ? (sliceResult.layers[layer.layerIndex - 1]?.z ?? 0)
          : 0;
        const layerH = Math.max(0.05, layer.z - prevZ);
        const span = Math.max(1e-9, layerTimeRange[1] - layerTimeRange[0]);
        const layerTimeT = colorMode === 'layer-time'
          ? Math.max(0, Math.min(1, (layer.layerTime - layerTimeRange[0]) / span))
          : undefined;
        return (
          <LayerLines
            key={layer.layerIndex}
            layer={layer}
            layerHeight={layerH}
            filamentDiameter={filamentDiameter ?? DEFAULT_FILAMENT_DIAMETER_MM}
            isCurrentLayer={layer.layerIndex === currentLayer}
            currentLayerMoveCount={currentLayerMoveCount}
            showTravel={showTravel}
            showRetractions={showRetractions}
            colorMode={colorMode}
            hiddenTypes={hiddenTypes}
            layerTimeT={layerTimeT}
            onHoverMove={layer.layerIndex === currentLayer ? onHoverMove : undefined}
          />
        );
      })}
    </group>
  );
}
