/**
 * useProbeGridConfig — owns the probe-grid state and the two effects that
 * derive it from firmware state:
 *
 *   1. On connect, parse `0:/sys/config.g` (with `0:/sys/config-override.g`
 *      fallback for G31 only) for `M557` + `G31` lines. M557 populates the
 *      grid; G31 populates `g31Offset` which the caller can use for safety
 *      bounds. The fetch is cancellable — an in-flight download whose host
 *      unmounts no longer leaks setState calls.
 *   2. When no config.g M557 is present, fall back to the axis limits from
 *      the live object model. Only fires while the user has NOT unlocked
 *      the grid for manual override.
 *
 * The host component owns the unlocked flag + its persistence; the hook
 * just reads it (via a ref) so it can skip the auto-syncs that would
 * stomp manual edits.
 *
 * Extracted out of DuetHeightMap.tsx + BedCompensationPanel.tsx where the
 * same ~70 lines of effect/refs lived in both files.
 */

import {
  useCallback, useEffect, useRef, useState,
  type MutableRefObject,
} from 'react';
import type { DuetService } from '../../../../services/DuetService';
import type { DuetAxis } from '../../../../types/duet';
import { parseM557, parseProbeOffset } from '../utils';

export interface ProbeGridState {
  probeXMin: number;
  probeXMax: number;
  probeYMin: number;
  probeYMax: number;
  probePoints: number;
}

export interface ConfigGridSnapshot {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  numPoints: number;
}

export interface UseProbeGridConfigDeps {
  service: DuetService | null;
  connected: boolean;
  axes: DuetAxis[] | undefined;
  /** Seed values (typically from localStorage). */
  initial: ProbeGridState;
  /** Current unlocked state — when true, all auto-syncs are skipped. */
  unlocked: boolean;
}

export interface UseProbeGridConfigApi extends ProbeGridState {
  setProbeXMin: (n: number) => void;
  setProbeXMax: (n: number) => void;
  setProbeYMin: (n: number) => void;
  setProbeYMax: (n: number) => void;
  setProbePoints: (n: number) => void;
  /** True once an M557 line has been successfully parsed from config.g. */
  probeFromConfig: boolean;
  /** Raw M557 line from config.g for display. */
  configM557Line: string | null;
  /** Snapshot of the parsed M557 ranges (mutated only when config.g re-parses). */
  configGridRef: MutableRefObject<ConfigGridSnapshot | null>;
  /** G31 probe-tip offset parsed from config.g (or config-override.g). */
  g31Offset: { x: number; y: number } | null;
  /** Re-applies the canonical grid values: config.g M557 if available, otherwise
   *  axis limits adjusted for the G31 probe offset. Clears any stale localStorage
   *  seed on next persist cycle. */
  resetGrid: () => void;
}

export function useProbeGridConfig(deps: UseProbeGridConfigDeps): UseProbeGridConfigApi {
  const { service, connected, axes, initial, unlocked } = deps;

  const [probeXMin, setProbeXMin] = useState(initial.probeXMin);
  const [probeXMax, setProbeXMax] = useState(initial.probeXMax);
  const [probeYMin, setProbeYMin] = useState(initial.probeYMin);
  const [probeYMax, setProbeYMax] = useState(initial.probeYMax);
  const [probePoints, setProbePoints] = useState(initial.probePoints);

  const [probeFromConfig, setProbeFromConfig] = useState(false);
  const [configM557Line, setConfigM557Line] = useState<string | null>(null);
  const [g31Offset, setG31Offset] = useState<{ x: number; y: number } | null>(null);
  const configGridRef = useRef<ConfigGridSnapshot | null>(null);

  const m557LoadedRef = useRef(false);
  const unlockedRef = useRef(unlocked);
  useEffect(() => { unlockedRef.current = unlocked; }, [unlocked]);

  /* ── Load M557 + G31 from config.g on connect ── */
  useEffect(() => {
    if (!connected || !service) {
      // Allow re-read on the next connect; the user's unlock state survives.
      m557LoadedRef.current = false;
      setProbeFromConfig(false);
      setConfigM557Line(null);
      return;
    }
    if (m557LoadedRef.current) return;

    let cancelled = false;
    void (async () => {
      try {
        const blob = await service.downloadFile('0:/sys/config.g');
        if (cancelled) return;
        const text = await blob.text();
        if (cancelled) return;

        // G31 probe offset: config.g may only have a partial G31 (e.g. Z only, or Y
        // without X). config-override.g is written by M500 with the fully-calibrated
        // values — always check it and prefer it over config.g when present.
        let g31 = parseProbeOffset(text);
        try {
          const overrideBlob = await service.downloadFile('0:/sys/config-override.g');
          if (cancelled) return;
          const overrideG31 = parseProbeOffset(await overrideBlob.text());
          if (overrideG31) g31 = overrideG31; // override wins — it's M500-calibrated
        } catch { /* config-override.g is optional */ }
        if (cancelled) return;
        if (g31) setG31Offset({ x: g31.xOffset, y: g31.yOffset });

        const parsed = parseM557(text);
        if (!parsed) return;
        m557LoadedRef.current = true;
        configGridRef.current = {
          xMin: parsed.xMin, xMax: parsed.xMax,
          yMin: parsed.yMin, yMax: parsed.yMax,
          numPoints: parsed.numPoints,
        };
        setProbeFromConfig(true);
        setConfigM557Line(parsed.rawLine);
        // Only overwrite manual edits when the grid is locked.
        if (!unlockedRef.current) {
          // Adjust by G31 probe offset so the probe tip stays within bed bounds.
          // e.g. G31 X-25 → nozzle must be ≥25 mm from bed edge when probe is at X=0.
          const ox = g31?.xOffset ?? 0;
          const oy = g31?.yOffset ?? 0;
          setProbeXMin(parsed.xMin + Math.max(0, -ox));
          setProbeXMax(parsed.xMax + Math.min(0, -ox));
          setProbeYMin(parsed.yMin + Math.max(0, -oy));
          setProbeYMax(parsed.yMax + Math.min(0, -oy));
          setProbePoints(parsed.numPoints);
        }
      } catch {
        // config.g not accessible — fall through to axes fallback.
      }
    })();

    return () => { cancelled = true; };
  }, [connected, service]);

  /* ── Axes fallback when no M557 was found ── */
  // Track the last seeded values (axes + g31 offset) so we only re-seed when
  // something actually changes. The object model re-emits identical values on
  // every poll; g31Offset arrives asynchronously after the first axes read.
  const lastAxesSeedRef = useRef<{ xMax: number; yMax: number; g31x: number; g31y: number } | null>(null);
  useEffect(() => {
    if (m557LoadedRef.current) return;
    if (unlockedRef.current) return;
    if (!axes || axes.length < 2) return;
    const xAxis = axes.find((a) => a.letter === 'X') ?? axes[0];
    const yAxis = axes.find((a) => a.letter === 'Y') ?? axes[1];
    if (!xAxis || !yAxis) return;
    const xMax = xAxis.max ?? 0;
    const yMax = yAxis.max ?? 0;
    // Skip when firmware reports zero — it's typically uninitialised.
    if (xMax <= 10 || yMax <= 10) return;
    const ox = g31Offset?.x ?? 0;
    const oy = g31Offset?.y ?? 0;
    const last = lastAxesSeedRef.current;
    if (last && last.xMax === xMax && last.yMax === yMax && last.g31x === ox && last.g31y === oy) return;
    lastAxesSeedRef.current = { xMax, yMax, g31x: ox, g31y: oy };
    // Apply G31 probe offset so the probe tip stays within bed bounds.
    //   safe_min = axisMin + max(0, -offset)  — probe left/front of nozzle: push min inward
    //   safe_max = axisMax + min(0, -offset)  — probe right/back of nozzle: pull max inward
    setProbeXMin((xAxis.min ?? 0) + Math.max(0, -ox));
    setProbeXMax(xMax + Math.min(0, -ox));
    setProbeYMin((yAxis.min ?? 0) + Math.max(0, -oy));
    setProbeYMax(yMax + Math.min(0, -oy));
  }, [axes, g31Offset]);

  /** Re-applies canonical values from config.g or the axes+G31 fallback. */
  const resetGrid = useCallback(() => {
    // Prefer the config.g M557 snapshot — it's the authoritative source.
    if (configGridRef.current) {
      const g = configGridRef.current;
      const ox = g31Offset?.x ?? 0;
      const oy = g31Offset?.y ?? 0;
      setProbeXMin(g.xMin + Math.max(0, -ox));
      setProbeXMax(g.xMax + Math.min(0, -ox));
      setProbeYMin(g.yMin + Math.max(0, -oy));
      setProbeYMax(g.yMax + Math.min(0, -oy));
      setProbePoints(g.numPoints);
      return;
    }
    // Fall back to axis limits + G31 offset calculation.
    // Clear the guard ref so the axes effect re-seeds even if axes haven't changed.
    lastAxesSeedRef.current = null;
    const ox = g31Offset?.x ?? 0;
    const oy = g31Offset?.y ?? 0;
    // We can't re-trigger the useEffect imperatively, so compute directly here.
    // The hook's `axes` dep is from the closure — read the latest value via the ref if needed.
    // Since resetGrid is called from a user interaction, `axes` in the closure is current.
    if (!axes || axes.length < 2) return;
    const xAxis = axes.find((a) => a.letter === 'X') ?? axes[0];
    const yAxis = axes.find((a) => a.letter === 'Y') ?? axes[1];
    if (!xAxis || !yAxis) return;
    const xMax = xAxis.max ?? 0;
    const yMax = yAxis.max ?? 0;
    if (xMax <= 10 || yMax <= 10) return;
    setProbeXMin((xAxis.min ?? 0) + Math.max(0, -ox));
    setProbeXMax(xMax + Math.min(0, -ox));
    setProbeYMin((yAxis.min ?? 0) + Math.max(0, -oy));
    setProbeYMax(yMax + Math.min(0, -oy));
  }, [axes, g31Offset]);

  return {
    probeXMin, probeXMax, probeYMin, probeYMax, probePoints,
    setProbeXMin, setProbeXMax, setProbeYMin, setProbeYMax, setProbePoints,
    probeFromConfig, configM557Line, configGridRef, g31Offset,
    resetGrid,
  };
}
