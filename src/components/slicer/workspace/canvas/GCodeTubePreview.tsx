import { useEffect, useMemo } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { SliceLayer, SliceMove, SliceResult } from '../../../../types/slicer';
import type { MoveHoverInfo, ShaftMoveData, TubeChain } from '../../../../types/slicer-preview.types';
import {
  MOVE_TYPE_THREE_COLORS,
  WIDTH_LOW_COLOR, WIDTH_HIGH_COLOR,
  LAYER_TIME_LOW_COLOR, LAYER_TIME_HIGH_COLOR,
} from '../preview/constants';
import {
  buildChainTube,
  DENSE_FILL_TUBE_MATERIAL,
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
const PREVIEW_LOOP_CLOSE_LW_FACTOR = 0.2;
const PREVIEW_LOOP_CLOSE_MAX_MM = 0.08;
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

type ColorMode = 'type' | 'speed' | 'flow' | 'width' | 'layer-time' | 'wall-quality';

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

// ---------------------------------------------------------------------------
// LayerLines — chain-based tube rendering for a single layer
// ---------------------------------------------------------------------------
//
// Walks the layer's moves once, groups consecutive extrusion moves of the
// same type whose endpoints chain together into a polyline, then builds one
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
  colorMode: ColorMode;
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

    // Chain detection: walk moves in order. A new chain starts on any of:
    //   • travel / retraction move (chain break, travel line recorded)
    //   • hidden type                     • zero-length segment
    //   • type change vs current chain    • from point doesn't match last to
    const travPos: number[] = [];
    const retractPos: number[] = [];
    const chains: TubeChain[] = [];
    let current: TubeChain | null = null;
    const denseSkinPitchWidths = inferDenseSkinPitchWidths(moves);

    const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(a.x - b.x) <= PREVIEW_JOIN_EPSILON
      && Math.abs(a.y - b.y) <= PREVIEW_JOIN_EPSILON;

    const lineWidthFromGCode = (move: SliceMove, segmentLength: number): number => {
      const nominal = Math.max(MIN_PREVIEW_LINE_WIDTH_MM, move.lineWidth ?? 0.4);
      if (move.type === 'top-bottom') {
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
    };

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];

      if (move.type === 'travel') {
        if (showTravel) {
          travPos.push(move.from.x, move.from.y, layer.z, move.to.x, move.to.y, layer.z);
        }
        if (move.extrusion < 0) {
          retractPos.push(move.from.x, move.from.y, layer.z);
        }
        current = null;
        continue;
      }
      if (hiddenTypes.has(move.type)) { current = null; continue; }
      if (move.extrusion <= 0)        { current = null; continue; }

      const segLen = Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y);
      if (segLen < 1e-6) continue;

      const lw = lineWidthFromGCode(move, segLen);
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
      // fresh. A chain is "extendable" only when the new segment matches the
      // previous segment's type/endpoint AND the bend at the shared vertex
      // is gentle enough to miter without spike artefacts.
      let extendable = current !== null
        && current.type === move.type
        && samePoint(current.points[current.points.length - 1], move.from);

      if (extendable && current!.points.length >= 2 && !TRIMMED_FILL_TYPES.has(current!.type)) {
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
        current.points.push({ x: move.to.x, y: move.to.y, lw: renderLw });
        current.segColors.push(col);
        current.moveRefs.push(ref);
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

    // Detect loop closure: first point matches last point (or is visually
    // within a small fraction of bead width) -> closed chain.
    // But ONLY close the loop if the bend at the closure vertex is also
    // gentle enough to miter — otherwise the closure produces the same spike
    // artefact we fought off elsewhere. For sharp closure bends, leave the
    // chain open (the first-point and last-point bevel rings will sit flush
    // against each other, no miter spike).
    for (const c of chains) {
      if (c.points.length < 3) continue;
      const first = c.points[0];
      const last = c.points[c.points.length - 1];
      const closeTol = Math.max(
        PREVIEW_JOIN_EPSILON,
        Math.min(PREVIEW_LOOP_CLOSE_MAX_MM, Math.min(first.lw, last.lw) * PREVIEW_LOOP_CLOSE_LW_FACTOR),
      );
      if (Math.hypot(first.x - last.x, first.y - last.y) > closeTol) continue;

      // Closure bend: in_dir = last segment (points[n-2] → points[n-1]),
      // out_dir = first segment (points[0] → points[1]). Both evaluated at
      // the shared closure vertex.
      const n = c.points.length;
      const inDx = last.x - c.points[n - 2].x;
      const inDy = last.y - c.points[n - 2].y;
      const inLen = Math.hypot(inDx, inDy);
      const outDx = c.points[1].x - first.x;
      const outDy = c.points[1].y - first.y;
      const outLen = Math.hypot(outDx, outDy);
      if (inLen > 1e-6 && outLen > 1e-6) {
        const dotInOut = (inDx * outDx + inDy * outDy) / (inLen * outLen);
        if (dotInOut < CHAIN_BREAK_DOT_THRESHOLD) continue; // too sharp — stay open
      }
      first.x = (first.x + last.x) * 0.5;
      first.y = (first.y + last.y) * 0.5;
      c.points.pop();
      c.isClosed = true;
    }

    // Drop wall "flap" stubs — short isolated chains (typically 2 points,
    // total length < ~1× lw) that Arachne's pure-JS variable-width pass
    // emits at sharp polygon corners. They render as small tubes poking
    // perpendicular to the main wall ring and read as visible "teeth"
    // around circular features. OrcaSlicer's libArachne hides them by
    // merging the flap into the main bead; until we wire libArachne in,
    // we filter them at preview time so the visual matches Orca's
    // smooth-tube look. Closed chains and non-wall chains are kept.
    const isWallType = (t: string) => t === 'wall-outer' || t === 'wall-inner';
    const FLAP_LENGTH_LW_RATIO = 1.0;
    const filteredChains: TubeChain[] = [];
    for (const chain of chains) {
      if (!chain.isClosed && isWallType(chain.type)) {
        let totalLen = 0;
        for (let i = 0; i < chain.points.length - 1; i++) {
          totalLen += Math.hypot(
            chain.points[i + 1].x - chain.points[i].x,
            chain.points[i + 1].y - chain.points[i].y,
          );
        }
        let avgLw = 0;
        for (const p of chain.points) avgLw += p.lw;
        avgLw /= chain.points.length;
        if (totalLen < avgLw * FLAP_LENGTH_LW_RATIO) continue;
      }
      filteredChains.push(chain);
    }

    // Build a tube for each chain.
    const beadHeight = Math.max(0.02, layerHeight);
    const tubeList: Array<{
      geometry: THREE.BufferGeometry;
      type: string;
      moveRefs: ShaftMoveData[];
    }> = [];
    for (const chain of filteredChains) {
      const geo = buildChainTube(chain, beadHeight, layer.z);
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
          material={TRIMMED_FILL_TYPES.has(t.type) ? DENSE_FILL_TUBE_MATERIAL : TUBE_MATERIAL}
          renderOrder={TRIMMED_FILL_TYPES.has(t.type) ? 0 : 2}
          frustumCulled={false}
          onPointerMove={onHoverMove ? (e: ThreeEvent<PointerEvent>) => {
            // Hover inspect: each segment owns RADIAL × 2 triangles
            // (RADIAL quads × 2 tri). Face index → segment index.
            const faceIdx = e.faceIndex ?? undefined;
            if (faceIdx === undefined) return;
            const segIdx = Math.floor(faceIdx / (TUBE_RADIAL_SEGMENTS * 2));
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
  colorMode: ColorMode;
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
            onHoverMove={onHoverMove}
          />
        );
      })}
    </group>
  );
}
