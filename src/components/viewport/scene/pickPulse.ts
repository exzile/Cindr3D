/**
 * pickPulse — shared visual-feedback helpers for face/edge pickers.
 *
 * Provides a crosshair cursor hook for "pickable target hovered" feedback and
 * a pure, allocation-free pulse generator for animating highlight opacity /
 * emissive intensity. Pure module: no JSX, safe for both face and edge pickers.
 */

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';

// ---------------------------------------------------------------------------
// usePickCursor
// ---------------------------------------------------------------------------

/**
 * Sets the canvas cursor to `crosshair` while a picker is active AND a
 * pickable target is hovered, restoring it otherwise and on unmount.
 *
 * Mirrors the cursor-effect pattern in SketchPlaneSelector.tsx (effect-driven,
 * not render-driven) so the `react-hooks/immutability` lint stays scoped.
 */
export function usePickCursor(active: boolean, hovering: boolean): void {
  const { gl } = useThree();
  useEffect(() => {
    if (!active) return;
    /* eslint-disable react-hooks/immutability -- canvas DOM style, not React state */
    gl.domElement.style.cursor = hovering ? 'crosshair' : '';
    return () => {
      gl.domElement.style.cursor = '';
    };
    /* eslint-enable react-hooks/immutability */
  }, [active, hovering, gl]);
}

// ---------------------------------------------------------------------------
// pulseFactor
// ---------------------------------------------------------------------------

const TWO_PI = Math.PI * 2;

/**
 * Pure 0..1 sine pulse driven by wall-clock time. No allocation, no state —
 * safe to call every frame inside useFrame. `periodMs` is one full cycle
 * (default ~900ms).
 */
export function pulseFactor(tNowMs: number, periodMs = 900): number {
  // (1 - cos)/2 maps to a smooth 0→1→0 triangle-ish curve over one period.
  const phase = ((tNowMs % periodMs) / periodMs) * TWO_PI;
  return (1 - Math.cos(phase)) * 0.5;
}

// ---------------------------------------------------------------------------
// applyLinePulse
// ---------------------------------------------------------------------------

const MIN_PULSE_OPACITY = 0.45;

/**
 * Mutates a line's material opacity between ~0.45 and 1.0 using pulseFactor.
 * ASSUMPTION: `line.material` is a per-instance material (or a safely-cloned
 * one) — never a shared module-level singleton; callers must clone shared
 * materials once per component and dispose the clone themselves.
 */
export function applyLinePulse(line: THREE.Line, baseOpacity: number, tNowMs: number): void {
  const mat = line.material as THREE.Material;
  const f = pulseFactor(tNowMs);
  // Lerp between MIN_PULSE_OPACITY and baseOpacity (clamped to >= min).
  const top = Math.max(baseOpacity, MIN_PULSE_OPACITY);
  mat.opacity = MIN_PULSE_OPACITY + (top - MIN_PULSE_OPACITY) * f;
  mat.transparent = true;
}
