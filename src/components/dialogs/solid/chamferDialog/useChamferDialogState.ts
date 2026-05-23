import { useEffect, useState } from "react";
import { useCADStore } from "../../../../store/cadStore";
import type { ChamferCornerType, ChamferMode, ChamferParams } from "./types";

export function useChamferDialogState(
  onConfirm: (params: ChamferParams) => void,
) {
  const chamferLiveDistance = useCADStore((s) => s.chamferLiveDistance);
  const setChamferLiveDistance = useCADStore((s) => s.setChamferLiveDistance);
  const [mode, setMode] = useState<ChamferMode>("equal-dist");
  const [distance, setDistance] = useState(() => chamferLiveDistance);
  const [distance2, setDistance2] = useState(2);
  const [angle, setAngle] = useState(45);
  const [propagate, setPropagate] = useState(true);
  const [isFlipped, setIsFlipped] = useState(false);
  const [cornerType, setCornerType] = useState<ChamferCornerType>("patch");

  useEffect(() => {
    setDistance(chamferLiveDistance);
  }, [chamferLiveDistance]);

  const setDistanceAndLive = (value: number) => {
    setDistance(value);
    setChamferLiveDistance(value);
  };

  const handleConfirm = () => {
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
    onConfirm(params);
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
