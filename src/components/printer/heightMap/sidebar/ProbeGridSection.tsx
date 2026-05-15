import { CheckCircle, Copy, Lock, LockOpen, RotateCcw, Ruler, TriangleAlert } from 'lucide-react';
import { useCopyState } from '../hooks/useCopyState';

interface SafeBounds {
  xMin: number;
  xMax: number | null;
  yMin: number;
  yMax: number | null;
}

/** Probe Grid block in the heightmap sidebar — config.g lock, axis ranges, density, safety warning, M557 preview, M558 live, display toggles. */
export function ProbeGridSection({
  probeFromConfig,
  configM557Line,
  probeGridUnlocked,
  setProbeGridUnlocked,
  probeGridLocked,
  probeXMin, probeXMax, probeYMin, probeYMax, probePoints,
  setProbeXMin, setProbeXMax, setProbeYMin, setProbeYMax, setProbePoints,
  g31Offset,
  resetGrid,
  spacingX, spacingY,
  safeBounds,
  m557Command,
  connected,
  probeMaxCount, probeTol,
}: {
  probeFromConfig: boolean;
  configM557Line: string | null;
  probeGridUnlocked: boolean;
  setProbeGridUnlocked: (next: boolean | ((v: boolean) => boolean)) => void;
  probeGridLocked: boolean;
  probeXMin: number; probeXMax: number; probeYMin: number; probeYMax: number; probePoints: number;
  setProbeXMin: (n: number) => void;
  setProbeXMax: (n: number) => void;
  setProbeYMin: (n: number) => void;
  setProbeYMax: (n: number) => void;
  setProbePoints: (n: number) => void;
  spacingX: string; spacingY: string;
  safeBounds: SafeBounds | null;
  m557Command: string;
  connected: boolean;
  probeMaxCount: number | undefined;
  probeTol: number | undefined;
  g31Offset: { x: number; y: number } | null;
  resetGrid: () => void;
}) {
  const m557Copy = useCopyState();
  const xMinBad = probeXMin < (safeBounds?.xMin ?? (probeXMin === 0 ? 1 : 0));
  const xMaxBad = safeBounds?.xMax != null && probeXMax > safeBounds.xMax;
  const yMinBad = probeYMin < (safeBounds?.yMin ?? (probeYMin === 0 ? 1 : 0));
  const yMaxBad = safeBounds?.yMax != null && probeYMax > safeBounds.yMax;
  const anyBad = xMinBad || xMaxBad || yMinBad || yMaxBad;

  const suggestions: string[] = [];
  if (anyBad) {
    if (xMinBad) suggestions.push(`X min → ${safeBounds?.xMin ?? 10}`);
    if (xMaxBad && safeBounds?.xMax != null) suggestions.push(`X max → ${safeBounds.xMax}`);
    if (yMinBad) suggestions.push(`Y min → ${safeBounds?.yMin ?? 10}`);
    if (yMaxBad && safeBounds?.yMax != null) suggestions.push(`Y max → ${safeBounds.yMax}`);
  }

  return (
    <div className="hm-side-section">
      {/* Section header — title + optional config.g badge + lock/unlock + reset */}
      <div className="hm-side-title">
        <Ruler size={9} style={{ marginRight: 4 }} />Probe Grid
        {probeFromConfig && (
          <>
            <span
              className="hm-probe-config-badge"
              title={configM557Line
                ? `Probe grid loaded from config.g: ${configM557Line}`
                : 'Probe grid loaded from M557 in config.g'}
            >
              <Lock size={8} />config.g
            </span>
            <button
              className={`hm-probe-lock-btn${probeGridUnlocked ? ' is-unlocked' : ''}`}
              onClick={() => {
                if (probeGridUnlocked) resetGrid();
                setProbeGridUnlocked((v) => !v);
              }}
              title={probeGridUnlocked
                ? 'Re-lock — restores config.g values (adjusted for probe offset)'
                : 'Unlock — override for this session only (config.g is unchanged)'}
            >
              {probeGridUnlocked ? <LockOpen size={10} /> : <Lock size={10} />}
            </button>
          </>
        )}
        <button
          className="hm-probe-reset-btn"
          onClick={resetGrid}
          title={probeFromConfig
            ? 'Reset to config.g values'
            : 'Reset to calculated bounds (axis limits + probe offset)'}
          style={{ marginLeft: 'auto' }}
        >
          <RotateCcw size={9} />
          Reset
        </button>
      </div>

      {/* X axis range */}
      <div className="hm-axis-range">
        <span className="hm-axis-label hm-axis-label--x" title="X axis probe range (mm)">X</span>
        <label className="hm-axis-field">
          <span className="hm-axis-field__label">Min</span>
          <input
            className={`hm-grid-input hm-axis-input${probeGridLocked ? ' is-locked' : ''}`}
            type="number" value={probeXMin} min={0} max={probeXMax - 1}
            disabled={probeGridLocked}
            onChange={(e) => setProbeXMin(Number(e.target.value))}
            title={probeGridLocked ? 'X start — set by M557 in config.g (unlock to override)' : 'X axis start position (mm)'}
          />
        </label>
        <span className="hm-axis-sep">→</span>
        <label className="hm-axis-field">
          <span className="hm-axis-field__label">Max</span>
          <input
            className={`hm-grid-input hm-axis-input${probeGridLocked ? ' is-locked' : ''}`}
            type="number" value={probeXMax} min={probeXMin + 1}
            disabled={probeGridLocked}
            onChange={(e) => setProbeXMax(Number(e.target.value))}
            title={probeGridLocked ? 'X end — set by M557 in config.g (unlock to override)' : 'X axis end position (mm)'}
          />
        </label>
        <span className="hm-axis-unit">mm</span>
      </div>

      {/* Y axis range */}
      <div className="hm-axis-range">
        <span className="hm-axis-label hm-axis-label--y" title="Y axis probe range (mm)">Y</span>
        <label className="hm-axis-field">
          <span className="hm-axis-field__label">Min</span>
          <input
            className={`hm-grid-input hm-axis-input${probeGridLocked ? ' is-locked' : ''}`}
            type="number" value={probeYMin} min={0} max={probeYMax - 1}
            disabled={probeGridLocked}
            onChange={(e) => setProbeYMin(Number(e.target.value))}
            title={probeGridLocked ? 'Y start — set by M557 in config.g (unlock to override)' : 'Y axis start position (mm)'}
          />
        </label>
        <span className="hm-axis-sep">→</span>
        <label className="hm-axis-field">
          <span className="hm-axis-field__label">Max</span>
          <input
            className={`hm-grid-input hm-axis-input${probeGridLocked ? ' is-locked' : ''}`}
            type="number" value={probeYMax} min={probeYMin + 1}
            disabled={probeGridLocked}
            onChange={(e) => setProbeYMax(Number(e.target.value))}
            title={probeGridLocked ? 'Y end — set by M557 in config.g (unlock to override)' : 'Y axis end position (mm)'}
          />
        </label>
        <span className="hm-axis-unit">mm</span>
      </div>

      {/* Grid density + spacing */}
      <div className="hm-grid-density-row">
        <span className="hm-grid-density-label">Grid</span>
        <select
          className="hm-select hm-select--density"
          value={probePoints}
          disabled={probeGridLocked}
          onChange={(e) => setProbePoints(Number(e.target.value))}
          title={probeGridLocked
            ? 'Points per axis — set by M557 in config.g (unlock to override)'
            : 'Number of probe points per axis — more points = finer mesh, longer probe time'}
        >
          {[3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
            <option key={n} value={n}>{n}×{n}</option>
          ))}
        </select>
        <span className="hm-grid-density-pts">{probePoints * probePoints} pts</span>
        <span className="hm-grid-density-sep">·</span>
        <span className="hm-grid-density-spacing" title="Approximate spacing between probe points">
          ~{spacingX}×{spacingY} mm
        </span>
      </div>

      {/* Safety warning (conditional) */}
      {anyBad && (
        <div className="hm-probe-origin-warn">
          <TriangleAlert size={11} className="hm-probe-origin-warn__icon" />
          <span className="hm-probe-origin-warn__text">
            Probe grid may be unreachable due to nozzle offset.
            {safeBounds
              ? ` Suggested: ${suggestions.join(', ')}.`
              : ' Set a safe margin above 0 (e.g. 10–30 mm).'}
          </span>
          <button
            type="button"
            className="hm-probe-origin-warn__apply"
            onClick={() => {
              if (probeGridLocked) setProbeGridUnlocked(true);
              if (xMinBad) setProbeXMin(safeBounds?.xMin ?? 10);
              if (xMaxBad && safeBounds?.xMax != null) setProbeXMax(safeBounds.xMax);
              if (yMinBad) setProbeYMin(safeBounds?.yMin ?? 10);
              if (yMaxBad && safeBounds?.yMax != null) setProbeYMax(safeBounds.yMax);
            }}
            title={safeBounds ? 'Apply safe bounds from G31 + axis limits' : 'Apply 10 mm safe minimum'}
          >
            Apply
          </button>
        </div>
      )}

      {/* M557 command preview with copy button */}
      <div className="hm-m557-preview">
        <div className="hm-m557-preview__body">
          <span className="hm-m557-preview__label">M557 command</span>
          <code className="hm-m557-preview__cmd" title="This M557 will be sent to the printer when you probe">
            {m557Command}
          </code>
        </div>
        <button
          className={`hm-m557-preview__copy${m557Copy.copied ? ' is-copied' : ''}`}
          onClick={() => {
            void navigator.clipboard.writeText(m557Command).then(m557Copy.flash);
          }}
          title="Copy M557 command to clipboard"
        >
          {m557Copy.copied ? <CheckCircle size={11} /> : <Copy size={11} />}
        </button>
      </div>

      {/* G31 probe offset parsed from config.g / config-override.g */}
      {g31Offset && (
        <div className="hm-m558-info" title="Probe tip offset parsed from G31 in config.g or config-override.g">
          <span className="hm-m558-info__label">G31 offset</span>
          <span className="hm-m558-info__val">
            X{g31Offset.x >= 0 ? '+' : ''}{g31Offset.x} · Y{g31Offset.y >= 0 ? '+' : ''}{g31Offset.y}
          </span>
        </div>
      )}

      {/* Current M558 probe settings from the live object model */}
      {connected && probeMaxCount != null && (
        <div className="hm-m558-info" title="Current M558 probe settings reported by the firmware">
          <span className="hm-m558-info__label">M558 live</span>
          <span className="hm-m558-info__val">
            A{probeMaxCount}
            {probeMaxCount > 1 && (
              <> · S{probeTol != null ? probeTol.toFixed(3) : '0.010'}</>
            )}
          </span>
        </div>
      )}

    </div>
  );
}
