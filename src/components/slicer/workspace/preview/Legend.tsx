import * as React from 'react';
import { Html } from '@react-three/drei';
import type { SliceMove } from '../../../../types/slicer';
import type { PreviewColorMode } from '../../../../types/slicer-preview.types';
import { MOVE_TYPE_COLORS, MOVE_TYPE_LABELS, Z_SEAM_COLOR } from './constants';
import './Legend.css';

interface LegendProps {
  colorMode: PreviewColorMode;
  currentLayer: number;
  currentZ: number;
  layerTime: number;
  range: [number, number];
  /** Total layer count for the `Layer N / M` badge — Cura/Orca-style. */
  totalLayers?: number;
  /** Per-layer time series for the mini-chart at the bottom of the legend.
   *  Short (~10-15px tall) sparkline that highlights the current layer. */
  layerTimeSeries?: number[];
  /** Per-layer filament-usage series (mm of filament). Sister chart to
   *  the time sparkline — spikes show layers with extra skin or
   *  multi-color transitions. Beyond Cura/Orca. */
  layerFilamentSeries?: number[];
  /** Per-layer travel-ratio (0..1). Drawn as a thin bar under the time
   *  sparkline to surface fragmented-infill / island-heavy layers. */
  layerTravelRatioSeries?: number[];
  /** Width samples for the current layer when in 'width' color mode —
   *  Arachne variable-width walls produce non-trivial distributions, so
   *  showing a histogram (instead of just min/max like Cura/Orca) helps
   *  debug transition-zone emission. Empty for non-Arachne / single-
   *  width slices. */
  widthSamples?: number[];
  /** Move count breakdown for the current layer (extrusion vs travel) —
   *  shown as a "147 extrude · 32 travel" summary line at the bottom of
   *  the legend. Beyond Cura/Orca: makes it easy to spot layers with
   *  excessive travel ratio (cooling time issues, sub-optimal seam). */
  layerMoveCounts?: { extrude: number; travel: number };
}

// Per-mode gradient colours for the legend bar (must match constants.ts ramps).
const LEGEND_GRADIENT: Record<string, string> = {
  speed:        'linear-gradient(to right, #2255cc, #cc2222)',
  flow:         'linear-gradient(to right, #22bb44, #cc2222)',
  width:        'linear-gradient(to right, #2255cc, #cc6600)',
  'layer-time': 'linear-gradient(to right, #22bb44, #cc2222)',
};

export function Legend({
  colorMode, currentLayer, currentZ, layerTime, range,
  totalLayers, layerTimeSeries, widthSamples, layerMoveCounts,
  layerFilamentSeries, layerTravelRatioSeries,
}: LegendProps) {
  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const gradientStyle = LEGEND_GRADIENT[colorMode];

  return (
    <React.Fragment>
      <Html
        position={[0, 0, 0]}
        transform={false}
        calculatePosition={() => [16, 16]}
      >
        <div className="slicer-preview-legend-anchor">
          <div className="slicer-preview-legend">
            <div className="slicer-preview-legend__layer">
              <div className="slicer-preview-legend__layer-title">
            Layer {currentLayer}{totalLayers !== undefined ? ` / ${totalLayers}` : ''}
                {currentLayer === 0 && (
                  <span style={{ marginLeft: 6, padding: '1px 5px', background: '#cc6600', color: '#fff', borderRadius: 3, fontSize: 9, fontWeight: 600, letterSpacing: 0.4 }}>
                    FIRST LAYER
                  </span>
                )}
              </div>
              <div>Z: {currentZ.toFixed(2)} mm</div>
              <div>Layer time: {formatTime(layerTime)}</div>
              {layerMoveCounts && (
                <div style={{ opacity: 0.7, fontSize: 10 }}>
                  {layerMoveCounts.extrude} extrude · {layerMoveCounts.travel} travel
                  {' · '}
                  {((layerMoveCounts.travel / Math.max(1, layerMoveCounts.extrude + layerMoveCounts.travel)) * 100).toFixed(0)}% travel
                </div>
              )}
              {layerTimeSeries && layerTimeSeries.length > 1 && (
                <Sparkline
                  series={layerTimeSeries} currentLayer={currentLayer}
                  stroke="#bbb" label="Layer time histogram"
                />
              )}
              {layerFilamentSeries && layerFilamentSeries.length > 1 && (
                <Sparkline
                  series={layerFilamentSeries} currentLayer={currentLayer}
                  stroke="#dbb068" label="Layer filament usage"
                />
              )}
              {layerTravelRatioSeries && layerTravelRatioSeries.length > 1 && (
                <Sparkline
                  series={layerTravelRatioSeries} currentLayer={currentLayer}
                  stroke="#88aacc" label="Layer travel ratio" hardMax={1}
                />
              )}
            </div>

            {colorMode === 'type' && (
              <div>
                {(Object.keys(MOVE_TYPE_COLORS) as SliceMove['type'][]).map((type) => (
                  <div key={type} className="slicer-preview-legend__row">
                    <div className="slicer-preview-legend__swatch" style={{ backgroundColor: MOVE_TYPE_COLORS[type] }} />
                    <span>{MOVE_TYPE_LABELS[type]}</span>
                  </div>
                ))}
              </div>
            )}

            {colorMode === 'speed' && (
              <div>
                <div className="slicer-preview-legend__mode-title">Speed</div>
                <div className="slicer-preview-legend__range">
                  <span>{range[0].toFixed(0)}</span>
                  <div className="slicer-preview-legend__gradient" style={{ background: gradientStyle }} />
                  <span>{range[1].toFixed(0)}</span>
                </div>
                <div className="slicer-preview-legend__units">mm/s</div>
              </div>
            )}

            {colorMode === 'flow' && (
              <div>
                <div className="slicer-preview-legend__mode-title">Flow (extrusion)</div>
                <div className="slicer-preview-legend__range">
                  <span>{range[0].toFixed(3)}</span>
                  <div className="slicer-preview-legend__gradient" style={{ background: gradientStyle }} />
                  <span>{range[1].toFixed(3)}</span>
                </div>
                <div className="slicer-preview-legend__units">mm</div>
              </div>
            )}

            {colorMode === 'width' && (
              <div>
                <div className="slicer-preview-legend__mode-title">Line Width</div>
                <div className="slicer-preview-legend__range">
                  <span>{range[0].toFixed(2)}</span>
                  <div className="slicer-preview-legend__gradient" style={{ background: gradientStyle }} />
                  <span>{range[1].toFixed(2)}</span>
                </div>
                <div className="slicer-preview-legend__units">mm · thin → thick</div>
                {widthSamples && widthSamples.length > 5 && (
                  <WidthHistogram samples={widthSamples} range={range} />
                )}
              </div>
            )}

            {colorMode === 'layer-time' && (
              <div>
                <div className="slicer-preview-legend__mode-title">Layer Time</div>
                <div className="slicer-preview-legend__range">
                  <span>{formatTime(range[0])}</span>
                  <div className="slicer-preview-legend__gradient" style={{ background: gradientStyle }} />
                  <span>{formatTime(range[1])}</span>
                </div>
                <div className="slicer-preview-legend__units">fast → slow</div>
              </div>
            )}

            {colorMode === 'wall-quality' && (
              <div>
                <div className="slicer-preview-legend__mode-title">Wall Quality</div>
                <div style={{ fontSize: 10, opacity: 0.85, marginTop: 4, lineHeight: 1.5 }}>
                  <div><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgb(102,140,217)', marginRight: 4, verticalAlign: 'middle' }} /> Under-extrusion (narrower)</div>
                  <div><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgb(76,217,102)', marginRight: 4, verticalAlign: 'middle' }} /> At target (±5%)</div>
                  <div><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgb(242,140,51)', marginRight: 4, verticalAlign: 'middle' }} /> Over-extrusion (wider)</div>
                  <div style={{ marginTop: 3, opacity: 0.6 }}>Reference: layer median wall width</div>
                </div>
              </div>
            )}

            {colorMode === 'seam' && (
              <div>
                <div className="slicer-preview-legend__mode-title">Seam</div>
                <div className="slicer-preview-legend__row">
                  <div
                    className="slicer-preview-legend__swatch"
                    style={{ backgroundColor: Z_SEAM_COLOR, borderRadius: '50%' }}
                  />
                  <span>Z seam starts</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </Html>
    </React.Fragment>
  );
}

/**
 * Inline SVG histogram of wall widths in the current layer. Beyond
 * Cura/Orca: with libArachne variable-width walls our slicer emits a
 * distribution rather than a fixed nominal width, and seeing that
 * distribution makes Arachne's transition-zone behaviour visible at a
 * glance — gaps in the histogram = sharp transitions, broad histogram
 * = many bead-count regions.
 */
function WidthHistogram({
  samples, range,
}: { samples: number[]; range: [number, number] }) {
  const W = 140, H = 24, BINS = 14;
  const [lo, hi] = range;
  const span = Math.max(1e-6, hi - lo);
  const bins = new Array(BINS).fill(0);
  for (const w of samples) {
    const t = Math.max(0, Math.min(1, (w - lo) / span));
    const i = Math.min(BINS - 1, Math.floor(t * BINS));
    bins[i]++;
  }
  const maxCount = Math.max(1, ...bins);
  const barW = W / BINS;
  return (
    <svg width={W} height={H} style={{ marginTop: 4, display: 'block' }} role="img" aria-label="Wall width distribution">
      {bins.map((count, i) => {
        const h = (count / maxCount) * H;
        return (
          <rect
            key={i}
            x={i * barW + 1}
            y={H - h}
            width={Math.max(1, barW - 2)}
            height={h}
            fill="#dbb068"
          />
        );
      })}
    </svg>
  );
}

/**
 * Inline SVG sparkline. Generic — used for layer time, filament-per-
 * layer, travel-ratio. The current-layer marker is an orange vertical
 * line so the user always knows where in the print they are.
 */
function Sparkline({
  series, currentLayer, stroke, label, hardMax,
}: { series: number[]; currentLayer: number; stroke: string; label: string; hardMax?: number }) {
  const W = 140, H = 22;
  const max = hardMax ?? Math.max(1e-3, ...series);
  const stepX = W / Math.max(1, series.length - 1);
  const path = series.map((t, i) =>
    `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${(H - Math.min(1, t / max) * H).toFixed(1)}`,
  ).join(' ');
  const cx = Math.max(0, Math.min(series.length - 1, currentLayer)) * stepX;
  return (
    <svg width={W} height={H} style={{ marginTop: 3, display: 'block' }} role="img" aria-label={label}>
      <path d={path} fill="none" stroke={stroke} strokeWidth={1} />
      <line x1={cx} x2={cx} y1={0} y2={H} stroke="#ffaa44" strokeWidth={1.5} />
    </svg>
  );
}
