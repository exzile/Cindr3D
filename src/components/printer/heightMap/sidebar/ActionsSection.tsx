import {
  Crosshair, Download, Home, Loader2, RefreshCw, Save, TriangleAlert, Wand2, X,
} from 'lucide-react';
import { exportHeightMapCSV } from '../utils';
import type { DuetHeightMap as HeightMapData } from '../../../../types/duet';

/** Actions block in the heightmap sidebar — primary ribbon (probe/level/smartCal), secondary (load/export/save), error, compensation toggle. */
export function ActionsSection({
  connected,
  loading,
  probing,
  leveling,
  smartCalRunning,
  smartCalActive,
  gridLabel,
  spacingX,
  spacingY,
  loadError,
  heightMap,
  isCompensationEnabled,
  onProbe,
  onLevel,
  onSmartCal,
  onLoad,
  onSaveAs,
  onDismissError,
  onCompensationToggle,
}: {
  connected: boolean;
  loading: boolean;
  probing: boolean;
  leveling: boolean;
  smartCalRunning: boolean;
  smartCalActive: boolean;
  gridLabel: string;
  spacingX: string;
  spacingY: string;
  loadError: string | null;
  heightMap: HeightMapData | null;
  isCompensationEnabled: boolean;
  onProbe: () => void;
  onLevel: () => void;
  onSmartCal: () => void;
  onLoad: () => void;
  onSaveAs: () => void;
  onDismissError: () => void;
  onCompensationToggle: () => void;
}) {
  return (
    <div className="hm-side-section hm-side-section--actions">
      <div className="hm-side-title">
        <span className={`hm-conn-dot${connected ? ' is-live' : ''}`} />
        Actions
      </div>

      {/* Primary ribbon buttons — Probe + Level + Smart Cal */}
      <div className="hm-ribbon-primary hm-ribbon-primary--three">
        <button
          className={`hm-ribbon-btn hm-ribbon-btn--probe${probing ? ' is-active' : ''}`}
          onClick={onProbe}
          disabled={loading || probing || leveling || smartCalRunning || !connected}
          title="Probe the bed surface to measure deviation (M557 + G29)"
        >
          <span className="hm-ribbon-btn__icon">
            {probing ? <Loader2 size={20} className="hm-spin" /> : <Crosshair size={20} />}
          </span>
          <span className="hm-ribbon-btn__label">{probing ? 'Probing…' : 'Probe Bed'}</span>
          <span className="hm-ribbon-btn__sub">{gridLabel} · {spacingX}×{spacingY} mm</span>
        </button>

        <button
          className={`hm-ribbon-btn hm-ribbon-btn--level${leveling ? ' is-active' : ''}`}
          onClick={onLevel}
          disabled={loading || probing || leveling || smartCalRunning || !connected}
          title="Run true bed leveling using independent Z motors (G32)"
        >
          <span className="hm-ribbon-btn__icon">
            {leveling ? <Loader2 size={20} className="hm-spin" /> : <Home size={20} />}
          </span>
          <span className="hm-ribbon-btn__label">{leveling ? 'Leveling…' : 'Level Bed'}</span>
          <span className="hm-ribbon-btn__sub">G32 · tilt correction</span>
        </button>

        <button
          className={`hm-ribbon-btn hm-ribbon-btn--smartcal${smartCalActive ? ' is-active' : ''}`}
          onClick={onSmartCal}
          disabled={loading || probing || leveling || smartCalRunning || !connected}
          title="Smart closed-loop calibration: level → probe → diagnose → repeat until converged"
        >
          <span className="hm-ribbon-btn__icon">
            {smartCalRunning ? <Loader2 size={20} className="hm-spin" /> : <Wand2 size={20} />}
          </span>
          <span className="hm-ribbon-btn__label">{smartCalRunning ? 'Calibrating…' : 'Smart Cal'}</span>
          <span className="hm-ribbon-btn__sub">Auto · Closed loop</span>
        </button>
      </div>

      {/* Secondary ribbon buttons — Load / Export / Save As */}
      <div className="hm-ribbon-secondary">
        <button
          className="hm-ribbon-btn hm-ribbon-btn--sm"
          onClick={onLoad}
          disabled={loading || probing}
          title="Load height map from printer"
        >
          <span className="hm-ribbon-btn__icon">
            {loading ? <Loader2 size={15} className="hm-spin" /> : <RefreshCw size={15} />}
          </span>
          <span className="hm-ribbon-btn__label">Load</span>
        </button>
        <button
          className="hm-ribbon-btn hm-ribbon-btn--sm"
          onClick={() => heightMap && exportHeightMapCSV(heightMap)}
          disabled={!heightMap}
          title="Export height map as CSV to your computer"
        >
          <span className="hm-ribbon-btn__icon"><Download size={15} /></span>
          <span className="hm-ribbon-btn__label">Export</span>
        </button>
        <button
          className="hm-ribbon-btn hm-ribbon-btn--sm"
          onClick={onSaveAs}
          disabled={!heightMap || !connected}
          title="Save a backup copy of the height map on the printer filesystem"
        >
          <span className="hm-ribbon-btn__icon"><Save size={15} /></span>
          <span className="hm-ribbon-btn__label">Save As</span>
        </button>
      </div>

      {loadError && (
        <div className="hm-load-error" role="alert">
          <TriangleAlert size={12} className="hm-load-error__icon" />
          <span>{loadError}</span>
          <button className="hm-load-error__dismiss" onClick={onDismissError} title="Dismiss">
            <X size={11} />
          </button>
        </div>
      )}

      <button
        className={`hm-comp-btn${isCompensationEnabled ? ' is-on' : ''}`}
        onClick={onCompensationToggle}
        title={isCompensationEnabled
          ? 'Disable mesh bed compensation — M561 clears the active bed transform. The height map file stays on the printer and can be re-enabled with G29 S1.'
          : 'Enable mesh bed compensation — loads and applies the height map (G29 S1)'}
      >
        <span className={`hm-pill-switch${isCompensationEnabled ? ' is-on' : ''}`}><span className="hm-pill-switch__thumb" /></span>
        <span className="hm-comp-label">Mesh Compensation</span>
        <span className={`hm-comp-badge${isCompensationEnabled ? ' is-on' : ''}`}>{isCompensationEnabled ? 'ON' : 'OFF'}</span>
      </button>
    </div>
  );
}
