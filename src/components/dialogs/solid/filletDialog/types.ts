export type FilletMode = 'constant' | 'variable' | 'full-round' | 'chord-length' | 'asymmetric' | 'rule-fillet';

export type RuleFilletType = 'all-edges' | 'between-faces';

export interface FilletEdgeSet {
  edgeIds: string[];
  type: 'constant' | 'variable' | 'chord-length' | 'asymmetric';
  radius?: number;
  endRadius?: number;
  chordLength?: number;
  offsetOne?: number;
  offsetTwo?: number;
  isFlipped?: boolean;
  radiiPoints?: { t: number; r: number }[];
}

export interface FilletParams {
  radius: number;
  edgeIds: string[];
  mode: FilletMode;
  startRadius?: number;
  endRadius?: number;
  chordLength?: number;
  offsetOne?: number;
  offsetTwo?: number;
  isFlipped?: boolean;
  setback: boolean;
  setbackDistance: number;
  propagate: boolean;
  isG2: boolean;
  tangencyWeight?: number;
  isRollingBallCorner: boolean;
  edgeSets?: FilletEdgeSet[];
  // Full-round fillet face IDs (persisted to feature params for replay)
  centerOccBodyId?: string;
  centerOccFaceId?: number;
  // Legacy single-face per side (still honoured for replay back-compat).
  side1OccFaceId?: number;
  side2OccFaceId?: number;
  // FILLET-8: multi-face per side. When present, take priority over the
  // legacy single-face fields above.
  side1OccFaceIds?: number[];
  side2OccFaceIds?: number[];
  // FILLET-7: Rule fillet.
  ruleType?: RuleFilletType;
  /** AllEdges mode: array of body-face IDs whose edges should be filleted. */
  ruleFaceIds?: number[];
}

