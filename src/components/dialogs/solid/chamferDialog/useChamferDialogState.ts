import { useEffect, useMemo, useState } from "react";
import { useCADStore } from "../../../../store/cadStore";
import type { ChamferCornerType, ChamferMode, ChamferParams } from "./types";
import { resolveChamferDistances } from "./chamferDistances";
import { useEdgeModValidityProbe } from "../edgeDialog/useEdgeModValidityProbe";

export function useChamferDialogState(
  onConfirm: (params: ChamferParams) => void,
  initialParams?: Record<string, unknown>,
  /** Effective selected edge IDs (live selection or, when editing, stored ones). */
  probeEdgeIds: string[] = [],
) {
  const chamferLiveDistance = useCADStore((s) => s.chamferLiveDistance);
  const setChamferLiveDistance = useCADStore((s) => s.setChamferLiveDistance);
  const [mode, setMode] = useState<ChamferMode>(
    () => (initialParams?.mode as ChamferMode | undefined) ?? "equal-dist",
  );
  const [distance, setDistance] = useState(
    () =>
      (initialParams?.distance as number | undefined) ?? chamferLiveDistance,
  );
  const [distance2, setDistance2] = useState(
    () => (initialParams?.distance2 as number | undefined) ?? 2,
  );
  const [angle, setAngle] = useState(
    () => (initialParams?.angle as number | undefined) ?? 45,
  );
  const [propagate, setPropagate] = useState(
    () => (initialParams?.propagate as boolean | undefined) ?? true,
  );
  const [isFlipped, setIsFlipped] = useState(
    () => (initialParams?.isFlipped as boolean | undefined) ?? false,
  );
  const [cornerType, setCornerType] = useState<ChamferCornerType>(
    () =>
      (initialParams?.cornerType as ChamferCornerType | undefined) ?? "patch",
  );

  useEffect(() => {
    if (initialParams) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setDistance(chamferLiveDistance);
    });
    return () => {
      cancelled = true;
    };
  }, [chamferLiveDistance, initialParams]);

  const setDistanceAndLive = (value: number) => {
    setDistance(value);
    setChamferLiveDistance(value);
  };

  const previewParams = useMemo<ChamferParams>(() => {
    const params: ChamferParams = {
      mode,
      distance,
      edgeIds: [],
      propagate,
      cornerType,
    };
    if (mode === "two-dist") {
      params.distance2 = distance2;
      params.isFlipped = isFlipped;
    }
    if (mode === "dist-angle") {
      params.angle = angle;
      params.isFlipped = isFlipped;
    }
    return params;
  }, [angle, cornerType, distance, distance2, isFlipped, mode, propagate]);

  const buildParams = (): ChamferParams => previewParams;

  // Fusion-style live validity preview: dry-run the chamfer at the current value
  // so the selected edge flashes red + a toast appears before the user clicks OK.
  // Resolve distances exactly as the commit does so the preview matches reality.
  const [probeD1, probeD2] = resolveChamferDistances({ mode, distance, distance2, angle, isFlipped });
  const probeAngle = mode === "dist-angle" ? angle : undefined;
  useEdgeModValidityProbe(true, probeEdgeIds, {
    tool: "Chamfer",
    distance: probeD1,
    distance2: probeAngle === undefined ? probeD2 : undefined,
    angle: probeAngle,
    propagate,
    skip: mode === "three-face",
  });

  const handleConfirm = () => {
    onConfirm(buildParams());
  };

  return {
    mode,
    setMode,
    distance,
    setDistanceAndLive,
    distance2,
    setDistance2,
    angle,
    setAngle,
    propagate,
    setPropagate,
    isFlipped,
    setIsFlipped,
    cornerType,
    setCornerType,
    handleConfirm,
  };
}

export type ChamferDialogState = ReturnType<typeof useChamferDialogState>;
