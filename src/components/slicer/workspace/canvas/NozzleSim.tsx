import { useEffect, useMemo } from 'react';
import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MoveTimeline } from './previewTimeline';

// Nozzle trail — max extrusion moves to glow behind the nozzle during sim.
// Lower = only shows very recent path; higher = shows longer history.
const NOZZLE_TRAIL_MOVE_COUNT = 120;

// Scratch position for NozzleSimulator ONLY — reused across useMemo calls so
// we don't allocate a new Vector3 on every simTime tick (~60/s during
// playback). No other component may write to this scratch; if another consumer
// ever needs one, give it its own module-level scratch rather than sharing.
const _nozzlePos = new THREE.Vector3();

// ---------------------------------------------------------------------------
// NozzleTrail
// ---------------------------------------------------------------------------

/**
 * Renders the last NOZZLE_TRAIL_MOVE_COUNT extrusion segments behind the nozzle
 * as a gradient lineSegments buffer — bright orange at the tip fading to dark
 * red at the tail. Travel and retract moves are skipped so only printed
 * material is highlighted.
 */
export function NozzleTrail({
  timeline,
  simTime,
}: {
  timeline: MoveTimeline;
  simTime: number;
}) {
  const geo = useMemo(() => {
    if (timeline.moves.length === 0) return null;
    const cum = timeline.cumulative;
    const clampedT = Math.max(0, Math.min(simTime, timeline.total));
    if (clampedT <= 0) return null;

    // Binary search for the current move index.
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < clampedT) lo = mid + 1;
      else hi = mid;
    }

    const positions: number[] = [];
    const colors: number[] = [];
    let count = 0;

    for (let i = lo; i >= 0 && count < NOZZLE_TRAIL_MOVE_COUNT; i--) {
      const { move, z } = timeline.moves[i];
      if (move.extrusion <= 0) continue; // skip travel/retract

      let toX = move.to.x;
      let toY = move.to.y;
      if (i === lo) {
        // Partial move: only draw up to the current nozzle position.
        const prevCum = i > 0 ? cum[i - 1] : 0;
        const dur = Math.max(1e-6, cum[i] - prevCum);
        const alpha = Math.max(0, Math.min(1, (clampedT - prevCum) / dur));
        toX = move.from.x + (move.to.x - move.from.x) * alpha;
        toY = move.from.y + (move.to.y - move.from.y) * alpha;
      }

      // age: 0 = newest (nozzle tip), 1 = oldest (trail tail).
      const age = count / NOZZLE_TRAIL_MOVE_COUNT;
      const brightness = 1 - age;
      // Bright orange (#ff8800) → dark red (#330000).
      const r = 0.2 + brightness * 0.8;
      const g = brightness * 0.533;
      const b = 0.0;

      positions.push(move.from.x, move.from.y, z + 0.15, toX, toY, z + 0.15);
      colors.push(r, g, b, r, g, b);
      count++;
    }

    if (positions.length === 0) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geom;
  }, [timeline, simTime]);

  useEffect(() => () => { geo?.dispose(); }, [geo]);

  if (!geo) return null;
  return (
    <lineSegments geometry={geo} renderOrder={3}>
      <lineBasicMaterial vertexColors />
    </lineSegments>
  );
}

// ---------------------------------------------------------------------------
// NozzleSimulator
// ---------------------------------------------------------------------------

/**
 * Draws the glowing nozzle marker + guide line, and advances sim time when
 * playing. Uses frameloop="demand" via invalidate() so we don't burn GPU
 * cycles when paused.
 */
export function NozzleSimulator({
  timeline,
  simTime,
  playing,
  speed,
  onAdvance,
}: {
  timeline: MoveTimeline;
  simTime: number;
  playing: boolean;
  speed: number;
  onAdvance: (deltaSeconds: number) => void;
}) {
  const { invalidate } = useThree();

  // Playback loop — delegates clamping/pausing to the store setter.
  useFrame((_, delta) => {
    if (!playing) return;
    onAdvance(delta * speed);
    invalidate();
  });

  // Binary search over cumulative times → current nozzle position.
  // Writes into the module-level _nozzlePos scratch instead of allocating a
  // new Vector3 on every simTime tick.
  const pos = useMemo(() => {
    if (timeline.moves.length === 0) return _nozzlePos.set(0, 0, 0.2);
    const cum = timeline.cumulative;
    const clampedT = Math.max(0, Math.min(simTime, timeline.total));
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < clampedT) lo = mid + 1;
      else hi = mid;
    }
    const { move, z } = timeline.moves[lo];
    const prevCum = lo > 0 ? cum[lo - 1] : 0;
    const moveDur = Math.max(1e-6, cum[lo] - prevCum);
    const alpha = Math.max(0, Math.min(1, (clampedT - prevCum) / moveDur));
    const x = move.from.x + (move.to.x - move.from.x) * alpha;
    const y = move.from.y + (move.to.y - move.from.y) * alpha;
    return _nozzlePos.set(x, y, z + 0.2);
  }, [timeline, simTime]);

  return (
    <group>
      {/* Glowing nozzle marker */}
      <mesh position={pos}>
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshStandardMaterial
          color="#ffcc00"
          emissive="#ff8800"
          emissiveIntensity={0.8}
        />
      </mesh>
      {/* Guide line to bed */}
      <Line
        points={[[pos.x, pos.y, 0], [pos.x, pos.y, pos.z]]}
        color="#ffcc00"
        lineWidth={0.5}
        transparent
        opacity={0.35}
      />
    </group>
  );
}
