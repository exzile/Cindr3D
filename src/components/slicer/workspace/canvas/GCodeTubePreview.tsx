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
import { buildChainTube, TUBE_MATERIAL, TUBE_RADIAL_SEGMENTS } from './tubeGeometry';

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

type ColorMode = 'type' | 'speed' | 'flow' | 'width' | 'layer-time';

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

    const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(a.x - b.x) <= PREVIEW_JOIN_EPSILON
      && Math.abs(a.y - b.y) <= PREVIEW_JOIN_EPSILON;

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

      const lw = (move.lineWidth ?? 0.4) * PREVIEW_LINE_SCALE;
      const col = colorOf(move);
      const ref: ShaftMoveData = {
        type: move.type,
        speed: move.speed,
        extrusion: move.extrusion,
        lineWidth: move.lineWidth ?? 0.4,
        length: segLen,
      };

      // Decide whether to extend the current chain, or break it and start
      // fresh. A chain is "extendable" only when the new segment matches the
      // previous segment's type/endpoint AND the bend at the shared vertex
      // is gentle enough to miter without spike artefacts.
      let extendable = current !== null
        && current.type === move.type
        && samePoint(current.points[current.points.length - 1], move.from);

      if (extendable && current!.points.length >= 2) {
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
        current.points.push({ x: move.to.x, y: move.to.y, lw });
        current.segColors.push(col);
        current.moveRefs.push(ref);
      } else {
        current = {
          type: move.type,
          points: [
            { x: move.from.x, y: move.from.y, lw },
            { x: move.to.x,   y: move.to.y,   lw },
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

    // Build a tube for each chain.
    const beadHeight = Math.max(0.02, layerHeight);
    const tubeList: Array<{
      geometry: THREE.BufferGeometry;
      type: string;
      moveRefs: ShaftMoveData[];
    }> = [];
    for (const chain of chains) {
      const geo = buildChainTube(chain, beadHeight, layer.z);
      if (!geo) continue;
      tubeList.push({ geometry: geo, type: chain.type, moveRefs: chain.moveRefs });
    }

    const tg = travPos.length > 0 ? new THREE.BufferGeometry() : null;
    if (tg) tg.setAttribute('position', new THREE.Float32BufferAttribute(travPos, 3));

    const rg = retractPos.length > 0 ? new THREE.BufferGeometry() : null;
    if (rg) rg.setAttribute('position', new THREE.Float32BufferAttribute(retractPos, 3));

    return { tubes: tubeList, travelGeo: tg, retractGeo: rg };
  }, [layer, layerHeight, isCurrentLayer, currentLayerMoveCount, showTravel, colorMode, hiddenTypes, layerTimeT]);

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
          material={TUBE_MATERIAL}
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
        <points key={`${layer.layerIndex}-retract`} geometry={retractGeo} renderOrder={2}>
          <pointsMaterial color="#ff3333" size={1.2} sizeAttenuation transparent opacity={0.9} depthWrite={false} />
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
