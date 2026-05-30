/**
 * useEdgeModValidityProbe — Fusion-360-style live validity preview for the
 * Fillet / Chamfer dialogs.
 *
 * While the dialog is open, this debounces the current value and runs a
 * non-committing OCC dry-run (`probeEdgeModification`). When OCC cannot solve
 * the operation at that value (e.g. a chamfer that runs into an adjacent fillet
 * once it grows past a certain size), it publishes the failure to
 * `edgeModInvalidPreview` — which makes the selected edge(s) flash bright red in
 * the viewport — and raises a small error toast. When the value becomes solvable
 * again the preview clears.
 *
 * The OK button stays enabled (matching Fusion: you can still click it and get
 * the same authoritative error), so this is purely an early, non-blocking warning.
 */
import { useEffect, useRef } from "react";
import { useCADStore } from "../../../../store/cadStore";
import { addToast } from "../../../../store/toastStore";

const PROBE_DEBOUNCE_MS = 350;

export interface EdgeModProbeInput {
  tool: "Fillet" | "Chamfer";
  radius?: number;
  distance?: number;
  distance2?: number;
  angle?: number;
  propagate?: boolean;
  filletParams?: Record<string, unknown>;
  /** Skip probing entirely (e.g. face-picker fillet modes, three-face chamfer). */
  skip?: boolean;
}

export function useEdgeModValidityProbe(
  enabled: boolean,
  edgeIds: string[],
  probe: EdgeModProbeInput,
): void {
  // Track the last toast message so a steady-state invalid value doesn't spam
  // toasts on every keystroke; reset to null when the op becomes valid again.
  const lastToastRef = useRef<string | null>(null);

  // Stable signature for the debounce dependency.
  const signature = JSON.stringify([
    enabled,
    probe.skip ?? false,
    probe.tool,
    edgeIds,
    probe.radius,
    probe.distance,
    probe.distance2,
    probe.angle,
    probe.propagate,
    probe.filletParams ?? null,
  ]);

  useEffect(() => {
    const { setEdgeModInvalidPreview, probeEdgeModification } = useCADStore.getState();

    if (!enabled || probe.skip || edgeIds.length === 0) {
      setEdgeModInvalidPreview(null);
      lastToastRef.current = null;
      return;
    }

    const handle = window.setTimeout(() => {
      const { ok, message } = probeEdgeModification({
        tool: probe.tool,
        edgeIds,
        radius: probe.radius,
        distance: probe.distance,
        distance2: probe.distance2,
        angle: probe.angle,
        propagate: probe.propagate,
        filletParams: probe.filletParams,
      });
      if (ok) {
        useCADStore.getState().setEdgeModInvalidPreview(null);
        lastToastRef.current = null;
        return;
      }
      const msg = message ?? `${probe.tool} can't be solved at this value.`;
      useCADStore.getState().setEdgeModInvalidPreview({ edgeIds, message: msg });
      // Only toast on a NEW message (entering invalid, or the reason changed).
      if (lastToastRef.current !== msg) {
        lastToastRef.current = msg;
        addToast("error", `${probe.tool} not possible at this value`, msg);
      }
    }, PROBE_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Clear the red-flash preview when the dialog unmounts.
  useEffect(
    () => () => {
      useCADStore.getState().setEdgeModInvalidPreview(null);
    },
    [],
  );
}
