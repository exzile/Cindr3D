import { BarChart3, Grid3x3, Loader2, Map } from 'lucide-react';
import type { LevelBedProgress } from '../../../store/printerStore';

interface ProbeProgress {
  pass: number;
  totalPasses: number;
  done: number;
  total: number | null;
}

type SmartCalPhase = 'homing' | 'leveling' | 'probing' | 'datum' | null;

/**
 * Top bar above the heightmap viewport — view-mode toggle, colour-mode
 * toggle, and live progress pills (probing / leveling / Smart Cal).
 */
export function HeightMapTopbar({
  viewMode,
  setViewMode,
  useDiverging,
  setDiverging,
  compareMode,
  probing,
  probeProgress,
  leveling,
  levelBedProgress,
  smartCalRunning,
  smartCalPhase,
}: {
  viewMode: '3d' | '2d';
  setViewMode: (mode: '3d' | '2d') => void;
  useDiverging: boolean;
  setDiverging: (b: boolean) => void;
  compareMode: boolean;
  probing: boolean;
  probeProgress: ProbeProgress | null;
  leveling: boolean;
  levelBedProgress: LevelBedProgress | null;
  smartCalRunning: boolean;
  smartCalPhase: SmartCalPhase;
}) {
  return (
    <div className="hm-topbar">
      <Map size={13} className="hm-topbar__icon" />
      <span className="hm-topbar__title">Bed Height Map</span>

      <div className="hm-topbar__div" />

      {/* 3D / 2D toggle */}
      <div className="hm-view-toggle hm-topbar__ctrl">
        <button
          className={`hm-toggle-btn${viewMode === '3d' ? ' is-active' : ''}`}
          onClick={() => setViewMode('3d')}
          title="3D surface view — drag to rotate, scroll to zoom, Shift+drag to pan"
        >
          <BarChart3 size={12} /> 3D
        </button>
        <button
          className={`hm-toggle-btn${viewMode === '2d' ? ' is-active' : ''}`}
          onClick={() => setViewMode('2d')}
          title="2D top-down heatmap — hover cells for exact values"
        >
          <Grid3x3 size={12} /> 2D
        </button>
      </div>

      {/* Dev / Div color mode */}
      <div className="hm-view-toggle hm-topbar__ctrl">
        <button
          className={`hm-toggle-btn${!useDiverging ? ' is-active' : ''}`}
          onClick={() => !compareMode && setDiverging(false)}
          disabled={compareMode}
          title="Deviation palette — green = flat, yellow/red = warped"
        >Dev</button>
        <button
          className={`hm-toggle-btn${useDiverging ? ' is-active' : ''}`}
          onClick={() => !compareMode && setDiverging(true)}
          disabled={compareMode}
          title="Diverging palette — blue = low, red = high, white = zero"
        >Div</button>
      </div>

      {/* Spacer — pushes progress indicators to the right */}
      <div style={{ flex: 1 }} />

      {probing && (
        <span className="hm-topbar__probing">
          <Loader2 size={11} className="hm-spin" />
          {probeProgress ? (
            <>
              {probeProgress.totalPasses > 1 && (
                <span className="hm-topbar__progress-pill">
                  Pass {probeProgress.pass}/{probeProgress.totalPasses}
                </span>
              )}
              {probeProgress.done > 0 && (
                <span className="hm-topbar__progress-pill">
                  Probe&nbsp;
                  {probeProgress.total != null
                    ? `${probeProgress.done}/${probeProgress.total}`
                    : probeProgress.done}
                </span>
              )}
              {probeProgress.done === 0 && probeProgress.totalPasses <= 1 && 'Probing bed…'}
            </>
          ) : (
            'Probing bed…'
          )}
        </span>
      )}
      {leveling && (
        <span className="hm-topbar__probing hm-topbar__probing--level">
          <Loader2 size={11} className="hm-spin" />
          {levelBedProgress ? (
            <>
              <span className="hm-topbar__progress-pill">
                Run {levelBedProgress.currentRun}/{levelBedProgress.totalRuns}
              </span>
              {levelBedProgress.probesDone > 0 && (
                <span className="hm-topbar__progress-pill">
                  Probe&nbsp;
                  {levelBedProgress.probesTotal != null
                    ? `${levelBedProgress.probesDone}/${levelBedProgress.probesTotal}`
                    : levelBedProgress.probesDone}
                </span>
              )}
            </>
          ) : (
            'Leveling bed…'
          )}
        </span>
      )}
      {smartCalRunning && (
        <span className="hm-topbar__probing hm-topbar__probing--smartcal">
          <Loader2 size={11} className="hm-spin" />
          <span className="hm-topbar__progress-pill">Smart Cal</span>
          {smartCalPhase === 'homing'   && 'Homing…'}
          {smartCalPhase === 'leveling' && 'Leveling…'}
          {smartCalPhase === 'probing'  && 'Probing…'}
          {smartCalPhase === 'datum'    && 'Calibrating Z datum…'}
          {smartCalPhase === null       && 'Running…'}
        </span>
      )}
    </div>
  );
}
