/** Dashboard-panel probe options (smaller surface than the heightMap probe modal). */

export interface ProbeOpts {
  homeFirst: boolean;
  probesPerPoint: number;
  mode: 'fixed' | 'converge';
  passes: number;
  maxPasses: number;
  targetDiff: number;
}
