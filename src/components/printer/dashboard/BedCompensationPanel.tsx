import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Layers, RefreshCcw, Crosshair, Loader2, Download,
  ToggleLeft, ToggleRight, AlertCircle, FolderOpen, X,
  Home, ScanLine, TriangleAlert,
} from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { computeStats, deviationColor, exportHeightMapCSV } from '../heightMap/utils';
import type { DuetHeightMap } from '../../../types/duet';

/* ─── demo mesh shown when no real map is loaded ───────────────── */

const DEMO_HEIGHT_MAP: DuetHeightMap = {
  xMin: 0, xMax: 235, xSpacing: 47,
  yMin: 0, yMax: 235, ySpacing: 47,
  radius: -1,
  numX: 6, numY: 6,
  points: [
    [ 0.042,  0.018, -0.008, -0.021, -0.012,  0.031],
    [ 0.029,  0.011, -0.019, -0.038, -0.024,  0.014],
    [ 0.007, -0.013, -0.031, -0.047, -0.033, -0.006],
    [-0.014, -0.029, -0.048, -0.062, -0.044, -0.018],
    [-0.008, -0.021, -0.037, -0.051, -0.038, -0.011],
    [ 0.023,  0.004, -0.015, -0.026, -0.019,  0.016],
  ],
};

/* ─── probe confirm modal ──────────────────────────────────────── */

function ProbeConfirmModal({ onConfirm, onCancel }: { onConfirm: (homeFirst: boolean) => void; onCancel: () => void }) {
  const [homeFirst, setHomeFirst] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm(homeFirst);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel, homeFirst]);

  return createPortal(
    <div className="bc-modal-overlay" onClick={onCancel}>
      <div className="bc-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="bc-modal-title">
        <div className="bc-modal-header">
          <div className="bc-modal-title-row">
            <TriangleAlert size={15} className="bc-modal-warn-icon" />
            <span id="bc-modal-title" className="bc-modal-title">Probe Bed Mesh</span>
          </div>
          <button className="bc-modal-close" onClick={onCancel} title="Cancel">
            <X size={13} />
          </button>
        </div>

        <div className="bc-modal-body">
          <p className="bc-modal-desc">
            This will move the toolhead across the bed to measure surface deviation.
            Make sure the bed is clear before continuing.
          </p>

          <div className="bc-modal-steps">
            <label className={`bc-modal-step bc-modal-step--toggle${homeFirst ? '' : ' is-disabled'}`}>
              <input
                type="checkbox"
                className="bc-modal-checkbox"
                checked={homeFirst}
                onChange={(e) => setHomeFirst(e.target.checked)}
              />
              <Home size={12} className="bc-modal-step-icon" />
              <div>
                <span className="bc-modal-step-label">Home all axes</span>
                <span className="bc-modal-step-cmd">G28</span>
              </div>
            </label>
            <div className="bc-modal-step-arrow">↓</div>
            <div className="bc-modal-step">
              <ScanLine size={12} className="bc-modal-step-icon" />
              <div>
                <span className="bc-modal-step-label">Probe bed mesh</span>
                <span className="bc-modal-step-cmd">G29</span>
              </div>
            </div>
          </div>

          <ul className="bc-modal-checklist">
            <li>Bed is clear of all objects and clips</li>
            <li>Nozzle is clean — no filament blobs</li>
            <li>Bed is at print temperature (if using thermal expansion)</li>
          </ul>
        </div>

        <div className="bc-modal-footer">
          <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="bc-modal-btn bc-modal-btn--confirm" onClick={() => onConfirm(homeFirst)} autoFocus>
            <Crosshair size={13} />
            {homeFirst ? 'Home & Probe' : 'Probe'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── mini heatmap ─────────────────────────────────────────────── */

function MiniHeatmap({ heightMap }: { heightMap: DuetHeightMap }) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stats      = useMemo(() => computeStats(heightMap), [heightMap]);

  const drawRef = useRef<() => void>(() => {});
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cellW = W / heightMap.numX;
    const cellH = H / heightMap.numY;
    for (let y = 0; y < heightMap.numY; y++) {
      for (let x = 0; x < heightMap.numX; x++) {
        const val = heightMap.points[y]?.[x] ?? 0;
        ctx.fillStyle = deviationColor(val, stats.min, stats.max);
        ctx.fillRect(
          Math.floor(x * cellW),
          Math.floor(y * cellH),
          Math.ceil(cellW),
          Math.ceil(cellH),
        );
      }
    }
  }, [heightMap, stats]);

  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas  = canvasRef.current;
    if (!wrapper || !canvas) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 4 || rect.height < 4) return;
      canvas.width  = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
      drawRef.current();
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="bc-canvas-wrap">
      <canvas ref={canvasRef} className="bc-canvas" title="Bed mesh deviation heatmap" />
    </div>
  );
}

/* ─── scale legend ─────────────────────────────────────────────── */

function ScaleLegend({ min, max }: { min: number; max: number }) {
  const steps = 5;
  return (
    <div className="bc-legend">
      {Array.from({ length: steps }, (_, i) => {
        const t   = i / (steps - 1);
        const val = min + t * (max - min);
        return (
          <div key={i} className="bc-legend-step">
            <div className="bc-legend-swatch" style={{ background: deviationColor(val, min, max) }} />
            <span className="bc-legend-label">{val >= 0 ? '+' : ''}{val.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── main panel ───────────────────────────────────────────────── */

export default function BedCompensationPanel() {
  const heightMap        = usePrinterStore((s) => s.heightMap);
  const loadHeightMap    = usePrinterStore((s) => s.loadHeightMap);
  const probeGrid        = usePrinterStore((s) => s.probeGrid);
  const sendGCode        = usePrinterStore((s) => s.sendGCode);
  const service          = usePrinterStore((s) => s.service);
  const connected        = usePrinterStore((s) => s.connected);
  const compensationType = usePrinterStore((s) => s.model?.move?.compensation?.type);

  const [csvFiles,     setCsvFiles]     = useState<string[]>([]);
  const [selectedCsv,  setSelectedCsv]  = useState('0:/sys/heightmap.csv');
  const [loadingCsv,   setLoadingCsv]   = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [probing,      setProbing]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [showProbeModal, setShowProbeModal] = useState(false);

  const isEnabled = !!compensationType && compensationType !== 'none';
  const activeMap = heightMap ?? DEMO_HEIGHT_MAP;
  const isDemo    = !heightMap;
  const stats     = useMemo(() => computeStats(activeMap), [activeMap]);

  const compensationLabel = (() => {
    if (!compensationType || compensationType === 'none') return 'None';
    if (compensationType === 'mesh') return 'Mesh';
    if (compensationType.includes('point') || compensationType === '3point') return '3-Point';
    return compensationType;
  })();

  const refreshCsvList = useCallback(async () => {
    if (!service) return;
    setLoadingCsv(true);
    try {
      const entries = await service.listFiles('0:/sys');
      const csvs = entries
        .filter((e) => e.type === 'f' && e.name.toLowerCase().endsWith('.csv'))
        .map((e) => e.name)
        .sort();
      setCsvFiles(csvs);
      if (csvs.length > 0 && !csvs.includes('heightmap.csv')) {
        setSelectedCsv(`0:/sys/${csvs[0]}`);
      }
    } catch {
      setCsvFiles([]);
    } finally {
      setLoadingCsv(false);
    }
  }, [service]);

  useEffect(() => {
    if (connected) {
      void refreshCsvList();
      void loadHeightMap();
    }
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { await loadHeightMap(selectedCsv); }
    catch { setError('Failed to load height map'); }
    finally { setLoading(false); }
  }, [loadHeightMap, selectedCsv]);

  const runProbe = useCallback(async (homeFirst: boolean) => {
    setShowProbeModal(false);
    setProbing(true);
    setError(null);
    try {
      if (homeFirst) {
        await sendGCode('G28');
      }
      await probeGrid();
    }
    catch { setError('Probing failed'); }
    finally { setProbing(false); }
  }, [probeGrid, sendGCode]);

  const handleToggle = useCallback(() => {
    void sendGCode(isEnabled ? 'G29 S2' : 'G29 S1');
  }, [sendGCode, isEnabled]);

  return (
    <div className="bc-panel">

      {showProbeModal && (
        <ProbeConfirmModal
          onConfirm={(homeFirst) => void runProbe(homeFirst)}
          onCancel={() => setShowProbeModal(false)}
        />
      )}

      {/* ── status bar ── */}
      <div className="bc-status-bar">
        <div className="bc-status-left">
          <Layers size={13} className={`bc-status-icon${isEnabled ? ' bc-status-icon--on' : ''}`} />
          <span className={`bc-type-badge${isEnabled ? ' bc-type-badge--on' : ''}`}>
            {compensationLabel}
          </span>
          <span className="bc-rms-badge" title="RMS deviation">
            ±{stats.rms.toFixed(3)} mm
          </span>
        </div>
        <button
          className={`bc-toggle-btn${isEnabled ? ' bc-toggle-btn--on' : ''}`}
          onClick={handleToggle}
          disabled={!connected}
          title={isEnabled ? 'Disable (G29 S2)' : 'Enable (G29 S1)'}
        >
          {isEnabled ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
          {isEnabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      {/* ── heatmap + stats ── */}
      <div className="bc-viz-row">
        <div className="bc-canvas-col">
          <MiniHeatmap heightMap={activeMap} />
          {isDemo && <span className="bc-demo-badge">demo</span>}
        </div>
        <div className="bc-right-col">
          <div className="bc-stats">
            <div className="bc-stat">
              <span className="bc-stat-label">Min</span>
              <span className="bc-stat-val bc-stat-val--low">{stats.min >= 0 ? '+' : ''}{stats.min.toFixed(3)}</span>
            </div>
            <div className="bc-stat">
              <span className="bc-stat-label">Max</span>
              <span className="bc-stat-val bc-stat-val--high">{stats.max >= 0 ? '+' : ''}{stats.max.toFixed(3)}</span>
            </div>
            <div className="bc-stat">
              <span className="bc-stat-label">Mean</span>
              <span className="bc-stat-val">{stats.mean >= 0 ? '+' : ''}{stats.mean.toFixed(3)}</span>
            </div>
            <div className="bc-stat">
              <span className="bc-stat-label">RMS</span>
              <span className="bc-stat-val">{stats.rms.toFixed(3)}</span>
            </div>
            <div className="bc-stat">
              <span className="bc-stat-label">Grid</span>
              <span className="bc-stat-val">{isDemo ? '6 × 6' : stats.gridDimensions}</span>
            </div>
            <div className="bc-stat">
              <span className="bc-stat-label">Points</span>
              <span className="bc-stat-val">{isDemo ? '—' : stats.probePoints}</span>
            </div>
          </div>
          <ScaleLegend min={stats.min} max={stats.max} />
        </div>
      </div>

      {/* ── error ── */}
      {error && (
        <div className="bc-error">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {/* ── file selector ── */}
      <div className="bc-file-row">
        <FolderOpen size={12} className="bc-file-icon" />
        <select
          className="bc-select"
          value={selectedCsv}
          onChange={(e) => setSelectedCsv(e.target.value)}
          disabled={loadingCsv || csvFiles.length === 0}
        >
          {csvFiles.length === 0
            ? <option value="0:/sys/heightmap.csv">heightmap.csv</option>
            : csvFiles.map((f) => (
                <option key={f} value={`0:/sys/${f}`}>{f}</option>
              ))
          }
        </select>
        <button
          className="bc-icon-btn"
          onClick={() => void refreshCsvList()}
          disabled={!connected || loadingCsv}
          title="Refresh file list"
        >
          {loadingCsv ? <Loader2 size={11} className="bc-spin" /> : <RefreshCcw size={11} />}
        </button>
      </div>

      {/* ── actions ── */}
      <div className="bc-actions">
        <button
          className="bc-btn"
          onClick={() => void handleLoad()}
          disabled={!connected || loading || probing}
          title="Load selected height map from printer"
        >
          {loading ? <Loader2 size={12} className="bc-spin" /> : <RefreshCcw size={12} />}
          Load Map
        </button>
        <button
          className="bc-btn bc-btn--probe"
          onClick={() => setShowProbeModal(true)}
          disabled={!connected || loading || probing}
          title="Home axes then probe bed mesh (G28 + G29)"
        >
          {probing ? <Loader2 size={12} className="bc-spin" /> : <Crosshair size={12} />}
          {probing ? 'Probing…' : 'Probe Bed'}
        </button>
        <button
          className="bc-btn"
          onClick={() => heightMap && exportHeightMapCSV(heightMap)}
          disabled={!heightMap}
          title="Export height map as CSV"
        >
          <Download size={12} />
          Export
        </button>
      </div>

    </div>
  );
}
