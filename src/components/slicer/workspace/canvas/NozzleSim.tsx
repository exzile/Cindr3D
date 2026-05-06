import { useEffect, useMemo, useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MoveTimeline } from './previewTimeline';

// Nozzle trail — max extrusion moves to glow behind the nozzle during sim.
// Lower = only shows very recent path; higher = shows longer history.
const NOZZLE_TRAIL_MOVE_COUNT = 120;
const TOOLHEAD_Z_OFFSET = 0.35;

// Scratch position for NozzleSimulator ONLY — reused across useMemo calls so
// we don't allocate a new Vector3 on every simTime tick (~60/s during
// playback). No other component may write to this scratch; if another consumer
// ever needs one, give it its own module-level scratch rather than sharing.
const _nozzlePos = new THREE.Vector3();

type NozzlePose = {
  position: [number, number, number];
  heading: number;
};

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
      const { move, z, layerChange } = timeline.moves[i];
      if (layerChange || move.extrusion <= 0) continue; // skip travel/retract/Z-only moves

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
  const resumingRef = useRef(false);

  // Playback loop — delegates clamping/pausing to the store setter.
  useFrame((_, delta) => {
    if (!playing) {
      // Mark that the next playing frame needs its delta discarded.
      resumingRef.current = true;
      return;
    }
    // With frameloop="demand", frames stop while paused. The first frame after
    // resuming carries delta = wall-time-since-last-frame, which can be many
    // seconds. Skip it so the sim continues exactly where it left off.
    if (resumingRef.current) {
      resumingRef.current = false;
      invalidate(); // schedule the real first frame immediately
      return;
    }
    // Also clamp delta to 100ms so a slow frame at high speed never jumps
    // more than 0.1 * speed seconds of sim time in one tick.
    onAdvance(Math.min(delta, 0.1) * speed);
    invalidate();
  });

  // Binary search over cumulative times → current nozzle position.
  // Writes into the module-level _nozzlePos scratch instead of allocating a
  // new Vector3 on every simTime tick.
  const pose = useMemo<NozzlePose>(() => {
    if (timeline.moves.length === 0) {
      _nozzlePos.set(0, 0, TOOLHEAD_Z_OFFSET);
      return { position: [_nozzlePos.x, _nozzlePos.y, _nozzlePos.z], heading: 0 };
    }
    const cum = timeline.cumulative;
    const clampedT = Math.max(0, Math.min(simTime, timeline.total));
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < clampedT) lo = mid + 1;
      else hi = mid;
    }
    const { move, z, fromZ, toZ } = timeline.moves[lo];
    const prevCum = lo > 0 ? cum[lo - 1] : 0;
    const moveDur = Math.max(1e-6, cum[lo] - prevCum);
    const alpha = Math.max(0, Math.min(1, (clampedT - prevCum) / moveDur));
    const x = move.from.x + (move.to.x - move.from.x) * alpha;
    const y = move.from.y + (move.to.y - move.from.y) * alpha;
    const currentZ = fromZ !== undefined && toZ !== undefined
      ? fromZ + (toZ - fromZ) * alpha
      : z;
    const dx = move.to.x - move.from.x;
    const dy = move.to.y - move.from.y;
    const heading = Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6
      ? Math.atan2(dy, dx)
      : 0;
    _nozzlePos.set(x, y, currentZ + TOOLHEAD_Z_OFFSET);
    return { position: [_nozzlePos.x, _nozzlePos.y, _nozzlePos.z], heading };
  }, [timeline, simTime]);

  return (
    <group>
      <ExtruderToolhead position={pose.position} heading={pose.heading} />
      {/* Guide line to bed */}
      <Line
        points={[[pose.position[0], pose.position[1], 0], pose.position]}
        color="#ffcc00"
        lineWidth={0.5}
        transparent
        opacity={0.35}
      />
    </group>
  );
}

function ExtruderToolhead({
  position,
  heading,
}: {
  position: [number, number, number];
  heading: number;
}) {
  return (
    <group position={position} rotation={[0, 0, heading]}>
      <pointLight position={[0, 0, 1.2]} color="#ff9f1c" intensity={0.9} distance={16} />

      <mesh position={[0, 0, 1.25]} castShadow>
        <boxGeometry args={[4.4, 3.4, 1.8]} />
        <meshStandardMaterial
          color="#d7f4ff"
          emissive="#0ea5e9"
          emissiveIntensity={0.1}
          metalness={0.05}
          roughness={0.03}
          transparent
          opacity={0.34}
          depthWrite={false}
        />
      </mesh>

      <mesh position={[1.25, 0, 1.33]} rotation={[Math.PI / 2, 0, 0.18]} castShadow>
        <cylinderGeometry args={[0.86, 0.86, 0.28, 28]} />
        <meshStandardMaterial
          color="#ecfeff"
          emissive="#0891b2"
          emissiveIntensity={0.12}
          metalness={0.05}
          roughness={0.08}
          transparent
          opacity={0.42}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[1.25, 0, 1.33]} rotation={[Math.PI / 2, 0, 0.18]}>
        <torusGeometry args={[0.62, 0.055, 8, 24]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#67e8f9"
          emissiveIntensity={0.55}
          transparent
          opacity={0.72}
          depthWrite={false}
        />
      </mesh>

      <mesh position={[0, 0, 2.55]} castShadow>
        <cylinderGeometry args={[0.56, 0.56, 1.55, 20]} />
        <meshStandardMaterial
          color="#f8fafc"
          metalness={0.15}
          roughness={0.04}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>

      <mesh position={[-1.55, 0, 1.32]} castShadow>
        <boxGeometry args={[0.7, 2.45, 1.18]} />
        <meshStandardMaterial
          color="#bae6fd"
          emissive="#0284c7"
          emissiveIntensity={0.08}
          metalness={0.05}
          roughness={0.05}
          transparent
          opacity={0.3}
          depthWrite={false}
        />
      </mesh>

      <mesh position={[0, 0, 0.25]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.62, 1.15, 24]} />
        <meshStandardMaterial
          color="#d97706"
          emissive="#f97316"
          emissiveIntensity={0.28}
          metalness={0.72}
          roughness={0.18}
        />
      </mesh>

      <mesh position={[0, 0, -0.36]}>
        <sphereGeometry args={[0.34, 16, 12]} />
        <meshStandardMaterial
          color="#ffd166"
          emissive="#ff7a00"
          emissiveIntensity={1.1}
        />
      </mesh>
    </group>
  );
}
