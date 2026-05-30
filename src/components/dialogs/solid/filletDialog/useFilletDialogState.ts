import { useEffect, useMemo, useState } from "react";
import { useCADStore } from "../../../../store/cadStore";
import type { FilletEdgeSet, FilletMidRadius, FilletMode, FilletParams, RuleFilletTopology, RuleFilletType } from "./types";
import { useEdgeModValidityProbe } from "../edgeDialog/useEdgeModValidityProbe";

export function useFilletDialogState(
  onConfirm: (params: FilletParams) => void,
  initialParams?: Record<string, unknown>,
  /** Effective selected edge IDs (live selection or, when editing, stored ones). */
  probeEdgeIds: string[] = [],
) {
  const filletLiveRadius = useCADStore((s) => s.filletLiveRadius);
  const setFilletLiveRadius = useCADStore((s) => s.setFilletLiveRadius);

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
    () => (initialParams?.isRollingBallCorner as boolean | undefined) ?? true,
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
  const [midRadii, setMidRadii] = useState<FilletMidRadius[]>(
    () => (initialParams?.midRadii as FilletMidRadius[] | undefined) ?? [],
  );
  const [ruleType, setRuleType] = useState<RuleFilletType>(
    () => (initialParams?.ruleType as RuleFilletType | undefined) ?? 'all-edges',
  );
  const [ruleFilletTopology, setRuleFilletTopology] = useState<RuleFilletTopology>(
    () => (initialParams?.ruleFilletTopology as RuleFilletTopology | undefined) ?? 'all',
  );

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

  const setRadiusAndLive = (value: number) => {
    setRadius(value);
    setFilletLiveRadius(value);
  };

  const addMidRadius = () =>
    setMidRadii((prev) => [
      ...prev,
      { position: parseFloat(((prev.length + 1) / (prev.length + 2)).toFixed(2)), radius: (startRadius + endRadius) / 2 },
    ]);
  const removeMidRadius = (i: number) =>
    setMidRadii((prev) => prev.filter((_, idx) => idx !== i));
  const updateMidRadius = (i: number, patch: Partial<FilletMidRadius>) =>
    setMidRadii((prev) => prev.map((pt, idx) => (idx === i ? { ...pt, ...patch } : pt)));

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

  const previewParams = useMemo<FilletParams>(() => {
    const params: FilletParams = {
      radius,
      edgeIds: [],
      mode,
      setback,
      setbackDistance: setback ? setbackDistance : 0,
      propagate,
      isG2,
      tangencyWeight: tangencyWeight !== 1.0 ? tangencyWeight : undefined,
      isRollingBallCorner,
    };
    if (mode === "variable") {
      params.startRadius = startRadius;
      params.endRadius = endRadius;
      if (midRadii.length > 0) params.midRadii = midRadii;
    }
    if (mode === "chord-length") params.chordLength = chordLength;
    if (mode === "asymmetric") {
      params.offsetOne = offsetOne;
      params.offsetTwo = offsetTwo;
      params.isFlipped = isFlipped;
    }
    if (mode === "rule-fillet") {
      params.ruleType = ruleType;
      if (ruleFilletTopology !== 'all') params.ruleFilletTopology = ruleFilletTopology;
    }
    if (edgeSets.length > 0) params.edgeSets = edgeSets;
    return params;
  }, [
    chordLength,
    edgeSets,
    endRadius,
    isFlipped,
    isG2,
    isRollingBallCorner,
    midRadii,
    mode,
    offsetOne,
    offsetTwo,
    propagate,
    radius,
    ruleFilletTopology,
    ruleType,
    setback,
    setbackDistance,
    startRadius,
    tangencyWeight,
  ]);

  const buildParams = (): FilletParams => previewParams;

  // Fusion-style live validity preview: dry-run the fillet at the current radius
  // so the selected edge flashes red + a toast appears before the user clicks OK.
  // Face-picker modes (full-round / rule-fillet) don't go through the edge-list
  // apply path, so they are skipped.
  useEdgeModValidityProbe(true, probeEdgeIds, {
    tool: "Fillet",
    radius,
    filletParams: previewParams,
    skip: mode === "full-round" || mode === "rule-fillet",
  });

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
    midRadii,
    addMidRadius,
    removeMidRadius,
    updateMidRadius,
    ruleType,
    setRuleType,
    ruleFilletTopology,
    setRuleFilletTopology,
    handleConfirm,
  };
}

export type FilletDialogState = ReturnType<typeof useFilletDialogState>;
