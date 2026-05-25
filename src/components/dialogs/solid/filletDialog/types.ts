export type FilletMode = 'constant' | 'variable' | 'full-round' | 'chord-length' | 'asymmetric';

export interface FilletEdgeSet {
  edgeIds: string[];
  type: 'constant' | 'variable' | 'chord-length';
  radius?: number;
  endRadius?: number;
  chordLength?: number;
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
  side1OccFaceId?: number;
  side2OccFaceId?: number;
}

