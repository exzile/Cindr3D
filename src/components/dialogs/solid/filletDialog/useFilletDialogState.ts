import { useEffect, useState } from "react";
import { useCADStore } from "../../../../store/cadStore";
import type { FilletEdgeSet, FilletMode, FilletParams } from "./types";

export function useFilletDialogState(
  onConfirm: (params: FilletParams) => void,
  initialParams?: Record<string, unknown>,
) {
  const filletLiveRadius = useCADStore((s) => s.filletLiveRadius);
  const setFilletLiveRadius = useCADStore((s) => s.setFilletLiveRadius);
  const filletPickMode = useCADStore((s) => s.filletPickMode);
  const setFilletPickMode = useCADStore((s) => s.setFilletPickMode);
  const setFilletPreviewParams = useCADStore((s) => s.setFilletPreviewParams);

  const [radius, setRadius] = useState(
    () => (initialParams?.radius as number | undefined) ?? filletLiveRadius,
  );
  const [mode, setMode] = useState<FilletMode>(
    () => (initialParams?.mode as FilletMode | undefined) ?? "constant",
  );
  const [startRadius, setStartRadius] = useState(
    () => (initialParams?.startRadius as number | undefined) ?? 1,
  );
  const [endRadius, setEndRadius] = useState(
    () => (initialParams?.endRadius as number | undefined) ?? 4,
  );
  const [chordLength, setChordLength] = useState(
    () => (initialParams?.chordLength as number | undefined) ?? 5,
  );
  const [offsetOne, setOffsetOne] = useState(
    () => (initialParams?.offsetOne as number | undefined) ?? 2,
  );
  const [offsetTwo, setOffsetTwo] = useState(
    () => (initialParams?.offsetTwo as number | undefined) ?? 3,
  );
  const [isFlipped, setIsFlipped] = useState(
    () => (initialParams?.isFlipped as boolean | undefined) ?? false,
  );
  const [setback, setSetback] = useState(
    () => (initialParams?.setback as boolean | undefined) ?? false,
  );
  const [setbackDistance, setSetbackDistance] = useState(
    () => (initialParams?.setbackDistance as number | undefined) ?? 1,
  );
  const [isRollingBallCorner, setIsRollingBallCorner] = useState(
    () => (initialParams?.isRollingBallCorner as boolean | undefined) ?? false,
  );
  const [propagate, setPropagate] = useState(
    () => (initialParams?.propagate as boolean | undefined) ?? true,
  );
  const [isG2, setIsG2] = useState(
    () => (initialParams?.isG2 as boolean | undefined) ?? false,
  );
  const [tangencyWeight, setTangencyWeight] = useState(
    () => (initialParams?.tangencyWeight as number | undefined) ?? 1.0,
  );
  const [edgeSets, setEdgeSets] = useState<FilletEdgeSet[]>(
    () => (initialParams?.edgeSets as FilletEdgeSet[] | undefined) ?? [],
  );
  const [showEdgeSets, setShowEdgeSets] = useState(false);

  useEffect(() => {
    if (initialParams) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setRadius(filletLiveRadius);
    });
    return () => {
      cancelled = true;
    };
  }, [filletLiveRadius, initialParams]);

  useEffect(() => {
    if (mode === "full-round") setFilletPickMode("face");
    else if (filletPickMode === "face") setFilletPickMode("edge");
  }, [mode, filletPickMode, setFilletPickMode]);

  const setRadiusAndLive = (value: number) => {
    setRadius(value);
    setFilletLiveRadius(value);
  };

  const addEdgeSet = () => {
    setEdgeSets((prev) => [
      ...prev,
      { edgeIds: [], type: "constant", radius: 2 },
    ]);
    setShowEdgeSets(true);
  };

  const removeEdgeSet = (i: number) =>
    setEdgeSets((prev) => prev.filter((_, idx) => idx !== i));

  const updateEdgeSet = (i: number, patch: Partial<FilletEdgeSet>) =>
    setEdgeSets((prev) =>
      prev.map((set, idx) => (idx === i ? { ...set, ...patch } : set)),
    );

  const buildParams = (): FilletParams => {
    const params: FilletParams = {
      radius,
      edgeIds: [],
      mode,
      setback,
      setbackDistance: setback ? setbackDistance : 0,
      propagate,
      isG2,
      tangencyWeight: tangencyWeight !== 1.0 ? tangencyWeight : undefined,
      isRollingBallCorner: setback && isRollingBallCorner,
    };
    if (mode === "variable") {
      params.startRadius = startRadius;
      params.endRadius = endRadius;
    }
    if (mode === "chord-length") params.chordLength = chordLength;
    if (mode === "asymmetric") {
      params.offsetOne = offsetOne;
      params.offsetTwo = offsetTwo;
      params.isFlipped = isFlipped;
    }
    if (edgeSets.length > 0) params.edgeSets = edgeSets;
    return params;
  };

  useEffect(() => {
    setFilletPreviewParams(buildParams() as unknown as Record<string, unknown>);
  });

  useEffect(
    () => () => setFilletPreviewParams(undefined),
    [setFilletPreviewParams],
  );

  const handleConfirm = () => {
    onConfirm(buildParams());
  };

  return {
    mode,
    setMode,
    radius,
    setRadiusAndLive,
    startRadius,
    setStartRadius,
    endRadius,
    setEndRadius,
    chordLength,
    setChordLength,
    offsetOne,
    setOffsetOne,
    offsetTwo,
    setOffsetTwo,
    isFlipped,
    setIsFlipped,
    setback,
    setSetback,
    setbackDistance,
    setSetbackDistance,
    isRollingBallCorner,
    setIsRollingBallCorner,
    propagate,
    setPropagate,
    isG2,
    setIsG2,
    tangencyWeight,
    setTangencyWeight,
    edgeSets,
    showEdgeSets,
    addEdgeSet,
    removeEdgeSet,
    updateEdgeSet,
    filletPickMode,
    setFilletPickMode,
    handleConfirm,
  };
}

export type FilletDialogState = ReturnType<typeof useFilletDialogState>;
