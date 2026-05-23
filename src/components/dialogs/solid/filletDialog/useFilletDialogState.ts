import { useEffect, useState } from 'react';
import { useCADStore } from '../../../../store/cadStore';
import type { FilletEdgeSet, FilletMode, FilletParams } from './types';

export function useFilletDialogState(onConfirm: (params: FilletParams) => void) {
  const filletLiveRadius = useCADStore((s) => s.filletLiveRadius);
  const setFilletLiveRadius = useCADStore((s) => s.setFilletLiveRadius);
  const filletPickMode = useCADStore((s) => s.filletPickMode);
  const setFilletPickMode = useCADStore((s) => s.setFilletPickMode);

  const [radius, setRadius] = useState(() => filletLiveRadius);
  const [mode, setMode] = useState<FilletMode>('constant');
  const [startRadius, setStartRadius] = useState(1);
  const [endRadius, setEndRadius] = useState(4);
  const [chordLength, setChordLength] = useState(5);
  const [offsetOne, setOffsetOne] = useState(2);
  const [offsetTwo, setOffsetTwo] = useState(3);
  const [isFlipped, setIsFlipped] = useState(false);
  const [setback, setSetback] = useState(false);
  const [setbackDistance, setSetbackDistance] = useState(1);
  const [isRollingBallCorner, setIsRollingBallCorner] = useState(true);
  const [propagate, setPropagate] = useState(true);
  const [isG2, setIsG2] = useState(false);
  const [tangencyWeight, setTangencyWeight] = useState(1.0);
  const [edgeSets, setEdgeSets] = useState<FilletEdgeSet[]>([]);
  const [showEdgeSets, setShowEdgeSets] = useState(false);

  useEffect(() => { setRadius(filletLiveRadius); }, [filletLiveRadius]);

  useEffect(() => {
    if (mode === 'full-round') setFilletPickMode('face');
    else if (filletPickMode === 'face') setFilletPickMode('edge');
  }, [mode, filletPickMode, setFilletPickMode]);

  const setRadiusAndLive = (value: number) => {
    setRadius(value);
    setFilletLiveRadius(value);
  };

  const addEdgeSet = () => {
    setEdgeSets((prev) => [...prev, { edgeIds: [], type: 'constant', radius: 2 }]);
    setShowEdgeSets(true);
  };

  const removeEdgeSet = (i: number) => setEdgeSets((prev) => prev.filter((_, idx) => idx !== i));

  const updateEdgeSet = (i: number, patch: Partial<FilletEdgeSet>) =>
    setEdgeSets((prev) => prev.map((set, idx) => idx === i ? { ...set, ...patch } : set));

  const handleConfirm = () => {
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
    if (mode === 'variable') {
      params.startRadius = startRadius;
      params.endRadius = endRadius;
    }
    if (mode === 'chord-length') params.chordLength = chordLength;
    if (mode === 'asymmetric') {
      params.offsetOne = isFlipped ? offsetTwo : offsetOne;
      params.offsetTwo = isFlipped ? offsetOne : offsetTwo;
      params.isFlipped = isFlipped;
    }
    if (edgeSets.length > 0) params.edgeSets = edgeSets;
    onConfirm(params);
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

