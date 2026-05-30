/**
 * OccLoadingModal — loading overlay while the OCC WASM engine initialises.
 * Scattered line segments progressively assemble into a 3-D 9-tooth gear.
 * At ≥ 95 % the gear is fully formed and pulses green; percentage is centred
 * inside the open bore throughout.
 */
import { useEffect, useRef, useState } from 'react';
import { getOccLoadLabel, getOccLoadProgress, isOccStarted, subscribeOccLoadProgress } from '../../engine/occ/loader';
import './OccLoadingModal.css';

// ── Gear geometry (120 × 120 viewBox, centre at 60 60) ───────────────────────
const CX = 60, CY = 60;
const R_OUTER    = 53;     // tooth-tip radius
const R_INNER    = 41;     // tooth-valley radius
const R_BORE     = 19;     // centre bore (open space — large enough to hold "100%")
const TEETH      = 9;
const DEG_STEP   = 360 / TEETH;   // 40 ° per tooth
const DEPTH_X    = 4;              // 3-D extrusion vector x
const DEPTH_Y    = 5.5;            // 3-D extrusion vector y
const TOOTH_HALF = 6.5;            // ± ° at outer radius for tooth-top edges
const FLANK_DEG  = 10.5;           // ± ° at inner radius for flank bases

/** Polar → cartesian; 0 ° = 12 o'clock. */
function pol(r: number, deg: number): [number, number] {
  const rad = (deg - 90) * (Math.PI / 180);
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
}

type Variant = 'main' | 'bore' | 'depth';
interface Seg { x1: number; y1: number; x2: number; y2: number; variant: Variant }

function buildGearLines(): Seg[] {
  const s: Seg[] = [];

  // ① Outer gear profile — 4 segments per tooth
  //    right-flank base → tip  /  tooth top  /  left-flank tip → base  /  valley
  for (let i = 0; i < TEETH; i++) {
    const b = i * DEG_STEP;
    const [rf0x, rf0y] = pol(R_INNER, b - FLANK_DEG);
    const [rf1x, rf1y] = pol(R_OUTER, b - TOOTH_HALF);
    const [lt0x, lt0y] = pol(R_OUTER, b + TOOTH_HALF);
    const [lt1x, lt1y] = pol(R_INNER, b + FLANK_DEG);
    const [nxx,  nxy ] = pol(R_INNER, b + DEG_STEP - FLANK_DEG);
    s.push({ x1: rf0x, y1: rf0y, x2: rf1x, y2: rf1y, variant: 'main' });
    s.push({ x1: rf1x, y1: rf1y, x2: lt0x, y2: lt0y, variant: 'main' });
    s.push({ x1: lt0x, y1: lt0y, x2: lt1x, y2: lt1y, variant: 'main' });
    s.push({ x1: lt1x, y1: lt1y, x2: nxx,  y2: nxy,  variant: 'main' });
  }

  // ② Centre bore — 6 chord arcs outlining the open hole
  for (let i = 0; i < 6; i++) {
    const b = i * 60;
    const [b0x, b0y] = pol(R_BORE, b);
    const [b1x, b1y] = pol(R_BORE, b + 60);
    s.push({ x1: b0x, y1: b0y, x2: b1x, y2: b1y, variant: 'bore' });
  }

  // ③ 3-D depth lines — visible on the bottom-right half of the gear
  for (let i = 0; i < TEETH; i++) {
    const b    = i * DEG_STEP;
    const norm = ((b % 360) + 360) % 360;
    if (norm > 20 && norm < 235) {
      const [rf1x, rf1y] = pol(R_OUTER, b - TOOTH_HALF);
      const [lt0x, lt0y] = pol(R_OUTER, b + TOOTH_HALF);
      // Leading edge drops to back face
      s.push({ x1: rf1x, y1: rf1y, x2: rf1x + DEPTH_X, y2: rf1y + DEPTH_Y, variant: 'depth' });
      // Trailing edge — partially hidden, shorter drop
      s.push({ x1: lt0x, y1: lt0y, x2: lt0x + DEPTH_X * 0.55, y2: lt0y + DEPTH_Y * 0.55, variant: 'depth' });
    }
  }

  return s;
}

const GEAR_SEGS = buildGearLines();
const N_SEGS    = GEAR_SEGS.length;

// ── Seeded scatter positions (deterministic across renders) ───────────────────
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xffffffff; };
}

interface ScatterSeg { x1: number; y1: number; x2: number; y2: number; op: number }

const SCATTER: ScatterSeg[] = (() => {
  const rand = lcg(0xCA7BF0DA);
  return GEAR_SEGS.map((seg) => {
    const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    const cx  = 10 + rand() * 100;   // scatter within the 120 × 120 viewBox
    const cy  = 10 + rand() * 100;
    const ang = rand() * Math.PI * 2;
    const hx  = (Math.cos(ang) * len) / 2;
    const hy  = (Math.sin(ang) * len) / 2;
    return { x1: cx - hx, y1: cy - hy, x2: cx + hx, y2: cy + hy, op: 0.18 + rand() * 0.38 };
  });
})();

// ── Easing ───────────────────────────────────────────────────────────────────
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ── GearAssembly ─────────────────────────────────────────────────────────────
const ASSEMBLE_END = 0.95;   // all lines fully settled at this progress value
const WIN          = 0.15;   // each line's individual assembly window
// Stagger formula: t0 = i/N * (ASSEMBLE_END - WIN)
// guarantees the LAST line finishes at exactly ASSEMBLE_END.

function GearAssembly({ progress }: { progress: number }) {
  const assembled = progress >= ASSEMBLE_END;

  return (
    <svg
      className={`occ-gear-svg${assembled ? ' occ-gear-svg--assembled' : ''}`}
      viewBox="0 0 120 120"
      width="120"
      height="120"
      aria-hidden="true"
    >
      {GEAR_SEGS.map((seg, i) => {
        const t0 = (i / N_SEGS) * (ASSEMBLE_END - WIN);
        const t  = easeOutCubic(Math.max(0, Math.min(1, (progress - t0) / WIN)));

        const sc      = SCATTER[i];
        const x1      = sc.x1 + (seg.x1 - sc.x1) * t;
        const y1      = sc.y1 + (seg.y1 - sc.y1) * t;
        const x2      = sc.x2 + (seg.x2 - sc.x2) * t;
        const y2      = sc.y2 + (seg.y2 - sc.y2) * t;
        const opacity = sc.op + (1 - sc.op) * t;

        const isDepth = seg.variant === 'depth';
        const isBore  = seg.variant === 'bore';

        return (
          <line
            key={i}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={
              isDepth
                ? 'color-mix(in srgb, var(--accent, #0078d7) 50%, black)'
                : isBore
                  ? 'color-mix(in srgb, var(--accent, #0078d7) 60%, white)'
                  : 'var(--accent, #0078d7)'
            }
            strokeWidth={isDepth ? 1.5 : isBore ? 1.3 : 2}
            strokeLinecap="round"
            opacity={opacity}
          />
        );
      })}
    </svg>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export default function OccLoadingModal() {
  const targetRef = useRef(getOccLoadProgress());
  const [displayProgress, setDisplayProgress] = useState(getOccLoadProgress);
  const [label, setLabel] = useState(getOccLoadLabel);
  const [phase, setPhase] = useState<'in' | 'visible' | 'out' | 'gone'>(() =>
    getOccLoadProgress() >= 1 ? 'gone' : 'in',
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Smooth lerp loop — displayProgress chases targetRef at ~60 fps.
  // setState with same value → React bails out → zero idle re-renders.
  useEffect(() => {
    let id: number;
    const loop = () => {
      setDisplayProgress((prev) => {
        const d = targetRef.current - prev;
        return Math.abs(d) < 0.001 ? targetRef.current : prev + d * 0.09;
      });
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const p0 = getOccLoadProgress();
    if (p0 >= 1) return;

    // Only show the modal once loading has actually started.
    // If getOcc() hasn't been called yet we wait for the first progress event.
    let t: ReturnType<typeof setTimeout> | undefined;
    const scheduleShow = () => {
      if (t !== undefined) return;
      t = setTimeout(() => { if (mountedRef.current) setPhase('visible'); }, 16);
    };

    if (isOccStarted()) scheduleShow();

    const unsub = subscribeOccLoadProgress((next, nextLabel) => {
      if (!mountedRef.current) return;
      scheduleShow(); // no-op after the first call
      targetRef.current = next;
      setLabel(nextLabel);
      if (next >= 1) {
        // Hold long enough to see the full green pulse before fading.
        setTimeout(() => {
          if (mountedRef.current) setPhase('out');
          setTimeout(() => {
            if (mountedRef.current) setPhase('gone');
          }, 350);
        }, 1200);
      }
    });

    return () => { clearTimeout(t); unsub(); };
  }, []);

  if (phase === 'gone') return null;

  const pct = Math.round(Math.min(100, displayProgress * 100));

  return (
    <div className={`occ-loading-backdrop occ-loading-backdrop--${phase}`} role="status">
      <div className="occ-loading-card">
        <div className={`occ-loading-gear-wrap${displayProgress >= ASSEMBLE_END ? ' occ-loading-gear-wrap--assembled' : ''}`}>
          <GearAssembly progress={displayProgress} />
          <span className="occ-loading-pct">{pct}%</span>
        </div>
        <div className="occ-loading-text">
          <span className="occ-loading-title">Loading CAD Engine</span>
          <span className="occ-loading-sub">
            {label || 'Initialising'}
            <span className="occ-loading-dots" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  );
}
