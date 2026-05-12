/** Shared types for the heightmap modals and Smart Cal flow. */

import type { HeightMapStats } from './utils';

export interface ProbeOpts {
  homeFirst: boolean;
  /** Run G30 S-1 at bed centre before probing. Dashboard variants omit this. */
  calibrateZDatum?: boolean;
  probesPerPoint: number;
  /** M558 S value — max acceptable spread between probe dives (mm). Only applied when probesPerPoint > 1. */
  probeTolerance?: number;
  mode: 'fixed' | 'converge';
  passes: number;
  maxPasses: number;
  targetDiff: number;
}

/** |mean| above this threshold triggers the auto-suggest for Z datum calibration. */
export const Z_DATUM_SUGGEST_THRESHOLD = 0.3;

export interface SmartCalOpts {
  homeFirst: boolean;
  maxIterations: number;
  /** Adjust Z datum when |mean| >= this (mm). Default 0.15. */
  targetMean: number;
  /** Re-level when RMS >= this (mm). Default 0.05. */
  targetDeviation: number;
  probesPerPoint: number;
  probeTolerance: number;
}

export type SmartCalStepKind = 'level' | 'probe' | 'datum' | 'decision' | 'done' | 'info';
export type SmartCalQuality  = 'good' | 'warn' | 'bad' | 'info';
export type SmartCalPreset   = 'quick' | 'balanced' | 'precise' | 'custom';

export interface SmartCalStep {
  kind:    SmartCalStepKind;
  label:   string;
  detail?: string;
  quality: SmartCalQuality;
}

export interface SmartCalResult {
  steps:      SmartCalStep[];
  finalStats: HeightMapStats | null;
  stopReason: 'converged' | 'maxIterations' | 'failed';
}
