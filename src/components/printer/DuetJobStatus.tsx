import { useState, useCallback } from 'react';
import {
  Play, Pause, Square, FileText, Clock, Layers,
  Gauge, Droplets, Video, ArrowUpDown, Minus, Plus, Timer, Thermometer,
  Box, XCircle,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { formatDurationClock, formatFileSize, formatFilamentLength } from '../../utils/printerFormat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatTime = (seconds: number | undefined | null) => formatDurationClock(seconds, '--:--:--');

const formatBytes = (bytes: number | undefined | null) => formatFileSize(bytes, '0 B');
const formatFilament = (mm: number | undefined | null) => formatFilamentLength(mm, '0 mm');

function estimatedCompletion(remainingSeconds: number | undefined | null): string {
  if (!remainingSeconds || remainingSeconds <= 0) return '--:--';
  const completionDate = new Date(Date.now() + remainingSeconds * 1000);
  return completionDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NoJobMessage() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '48px 24px', color: '#666680',
    }}>
      <FileText size={48} strokeWidth={1} />
      <p style={{ margin: 0, fontSize: 16 }}>No print job active</p>
      <p style={{ margin: 0, fontSize: 12, color: '#555' }}>
        Start a print from the Files tab to monitor progress here.
      </p>
    </div>
  );
}

// --- Print Status Header ---------------------------------------------------

function PrintStatusHeader() {
  const model = usePrinterStore((s) => s.model);
  const pausePrint = usePrinterStore((s) => s.pausePrint);
  const resumePrint = usePrinterStore((s) => s.resumePrint);
  const cancelPrint = usePrinterStore((s) => s.cancelPrint);

  const job = model.job;
  const status = model.state?.status ?? 'idle';
  const fileName = job?.file?.fileName ?? 'Unknown file';
  const shortName = fileName.split('/').pop() ?? fileName;

  const isPrinting = status === 'processing';
  const isPaused = status === 'paused' || status === 'pausing';
  const isSimulating = status === 'simulating';
  const isActive = isPrinting || isPaused || isSimulating;

  const statusLabel = isPrinting
    ? 'Printing'
    : isPaused
      ? 'Paused'
      : isSimulating
        ? 'Simulating'
        : status.charAt(0).toUpperCase() + status.slice(1);

  const statusColor = isPrinting
    ? '#44cc88'
    : isPaused
      ? '#ffaa44'
      : isSimulating
        ? '#44aaff'
        : '#666680';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', background: '#1a1a2e', borderRadius: 8, marginBottom: 12,
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 14, fontWeight: 600, color: '#e0e0ff',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }} title={fileName}>
          <FileText size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
          {shortName}
        </div>
        <div style={{ fontSize: 12, marginTop: 2 }}>
          <span style={{ color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
        </div>
      </div>

      {isActive && (
        <div style={{ display: 'flex', gap: 6, marginLeft: 12, flexShrink: 0 }}>
          {isPrinting && (
            <button className="control-btn" title="Pause print" onClick={() => pausePrint()}>
              <Pause size={16} />
            </button>
          )}
          {isPaused && (
            <button className="control-btn success" title="Resume print" onClick={() => resumePrint()}>
              <Play size={16} />
            </button>
          )}
          <button
            className="control-btn danger"
            title="Cancel print"
            onClick={() => {
              if (confirm('Cancel the current print?')) cancelPrint();
            }}
          >
            <Square size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// --- Progress Section ------------------------------------------------------

function ProgressSection() {
  const model = usePrinterStore((s) => s.model);
  const job = model.job;
  if (!job) return null;

  const fileSize = job.file?.size ?? 0;
  const filePos = job.filePosition ?? 0;
  const pct = fileSize > 0 ? (filePos / fileSize) * 100 : 0;
  const currentLayer = job.layer ?? 0;
  const totalLayers = job.file?.numLayers ?? 0;
  const layerHeight = job.file?.layerHeight ?? 0;
  const currentHeight = currentLayer > 0
    ? (job.file?.firstLayerHeight ?? layerHeight) + (currentLayer - 1) * layerHeight
    : 0;

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Layers size={14} /> Progress
      </div>
      {/* Large progress bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', marginBottom: 4,
          fontSize: 12, color: '#aaaacc',
        }}>
          <span>Overall</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#e0e0ff' }}>
            {pct.toFixed(1)}%
          </span>
        </div>
        <div style={{
          height: 10, background: '#1a1a2e', borderRadius: 5, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${Math.min(100, pct)}%`,
            background: 'linear-gradient(90deg, #44aaff, #44cc88)',
            borderRadius: 5, transition: 'width 0.5s ease',
          }} />
        </div>
      </div>
      {/* Detail rows */}
      <div className="job-detail-grid">
        <JobDetailRow label="File progress" value={`${formatBytes(filePos)} / ${formatBytes(fileSize)}`} />
        <JobDetailRow label="Layer" value={`${currentLayer} / ${totalLayers}`} />
        <JobDetailRow label="Current height" value={`${currentHeight.toFixed(2)} mm`} />
      </div>
    </div>
  );
}

// --- Job Info (slicer, layer heights, simulated time, file size) ----------

function JobInfo() {
  const model = usePrinterStore((s) => s.model);
  const job = model.job;
  if (!job?.file) return null;

  const f = job.file;
  const objectCount = job.build?.objects?.length ?? 0;
  const slicer = f.generatedBy?.trim();
  const sliceTime = f.simulatedTime > 0 ? f.simulatedTime : f.printTime;

  return (
    <div className="job-section">
      <div className="job-section-title">
        <FileText size={14} /> Job Info
      </div>
      <div className="job-detail-grid">
        {slicer && <JobDetailRow label="Slicer" value={slicer} />}
        {sliceTime > 0 && (
          <JobDetailRow
            label={f.simulatedTime > 0 ? 'Simulated time' : 'Estimated time'}
            value={formatTime(sliceTime)}
          />
        )}
        {f.layerHeight > 0 && (
          <JobDetailRow label="Layer height" value={`${f.layerHeight.toFixed(2)} mm`} />
        )}
        {f.firstLayerHeight > 0 && (
          <JobDetailRow label="First layer" value={`${f.firstLayerHeight.toFixed(2)} mm`} />
        )}
        {f.height > 0 && (
          <JobDetailRow label="Object height" value={`${f.height.toFixed(2)} mm`} />
        )}
        {f.size > 0 && <JobDetailRow label="File size" value={formatBytes(f.size)} />}
        {objectCount > 0 && (
          <JobDetailRow label="Objects" value={String(objectCount)} />
        )}
      </div>
    </div>
  );
}

// --- Time Estimates --------------------------------------------------------

function TimeEstimates() {
  const model = usePrinterStore((s) => s.model);
  const job = model.job;
  if (!job) return null;

  const elapsed = job.duration ?? 0;
  const warmUp = job.warmUpDuration ?? 0;
  const layerTime = job.layerTime ?? 0;
  const layers = job.layers ?? [];
  const avgLayerTime = layers.length > 0
    ? layers.reduce((sum, l) => sum + (l.duration ?? 0), 0) / layers.length
    : 0;
  const tl = job.timesLeft;

  // Pick best remaining estimate (prefer file, then slicer, then filament, then layer)
  const bestRemaining = tl
    ? (tl.file > 0 ? tl.file : tl.slicer > 0 ? tl.slicer : tl.filament > 0 ? tl.filament : tl.layer > 0 ? tl.layer : 0)
    : 0;

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Clock size={14} /> Time Estimates
      </div>
      <div className="job-detail-grid">
        <JobDetailRow label="Elapsed" value={formatTime(elapsed)} />
        {layerTime > 0 && (
          <JobDetailRow label="Current layer time" value={formatTime(layerTime)} />
        )}
        {avgLayerTime > 0 && (
          <JobDetailRow label="Avg layer time" value={formatTime(avgLayerTime)} />
        )}
        {tl && tl.file > 0 && (
          <JobDetailRow label="Remaining (file)" value={formatTime(tl.file)} />
        )}
        {tl && tl.filament > 0 && (
          <JobDetailRow label="Remaining (filament)" value={formatTime(tl.filament)} />
        )}
        {tl && tl.slicer > 0 && (
          <JobDetailRow label="Remaining (slicer)" value={formatTime(tl.slicer)} />
        )}
        {tl && tl.layer > 0 && (
          <JobDetailRow label="Remaining (layer)" value={formatTime(tl.layer)} />
        )}
        {bestRemaining > 0 && (
          <JobDetailRow
            label="Est. completion"
            value={estimatedCompletion(bestRemaining)}
            highlight
          />
        )}
        {warmUp > 0 && (
          <JobDetailRow label="Warm-up duration" value={formatTime(warmUp)} />
        )}
      </div>
    </div>
  );
}

// --- Filament Usage --------------------------------------------------------

function FilamentUsage() {
  const model = usePrinterStore((s) => s.model);
  const job = model.job;
  if (!job) return null;

  const requiredFilament = job.file?.filament ?? [];
  const totalRequired = requiredFilament.reduce((a, b) => a + b, 0);

  // Per-extruder used totals from layer data
  const perExtruderUsed: number[] = [];
  for (const layer of job.layers ?? []) {
    const f = layer.filament ?? [];
    for (let i = 0; i < f.length; i++) {
      perExtruderUsed[i] = (perExtruderUsed[i] ?? 0) + f[i];
    }
  }
  const usedFilament = perExtruderUsed.reduce((a, b) => a + b, 0);

  if (totalRequired <= 0 && usedFilament <= 0) return null;

  // Show per-extruder rows when there's more than one extruder
  const multiExtruder = requiredFilament.length > 1 || perExtruderUsed.length > 1;

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Droplets size={14} /> Filament Usage
      </div>
      <div className="job-detail-grid">
        {totalRequired > 0 && (
          <JobDetailRow label="Required" value={formatFilament(totalRequired)} />
        )}
        <JobDetailRow label="Used so far" value={formatFilament(usedFilament)} />
        {totalRequired > 0 && usedFilament > 0 && (
          <JobDetailRow
            label="Remaining"
            value={formatFilament(Math.max(0, totalRequired - usedFilament))}
          />
        )}
        {multiExtruder && requiredFilament.map((req, i) => {
          const used = perExtruderUsed[i] ?? 0;
          return (
            <JobDetailRow
              key={i}
              label={`E${i}`}
              value={`${formatFilament(used)} / ${formatFilament(req)}`}
            />
          );
        })}
      </div>
    </div>
  );
}

// --- Temperature Chart -----------------------------------------------------

function TemperatureChart() {
  const history = usePrinterStore((s) => s.temperatureHistory);

  if (history.length < 2) return null;

  const W = 480;
  const H = 160;
  const PAD = { top: 10, right: 10, bottom: 24, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Flatten all temperatures to compute Y range
  const allTemps: number[] = [];
  for (const s of history) {
    for (const h of s.heaters ?? []) {
      if (h.current != null) allTemps.push(h.current);
      if (h.active != null && h.active > 0) allTemps.push(h.active);
    }
  }
  if (allTemps.length === 0) return null;

  const minT = 0;
  const maxT = Math.max(50, ...allTemps) + 10;
  const tStart = history[0].timestamp;
  const tEnd = history[history.length - 1].timestamp;
  const tRange = Math.max(tEnd - tStart, 1);

  const toX = (ts: number) => PAD.left + ((ts - tStart) / tRange) * plotW;
  const toY = (temp: number) => PAD.top + plotH - ((temp - minT) / (maxT - minT)) * plotH;

  // Build polylines per heater index
  const heaterIndices = new Set<number>();
  for (const s of history) {
    for (const h of s.heaters ?? []) heaterIndices.add(h.index);
  }
  const colors = ['#ff8844', '#44aaff', '#44cc88', '#cc66ff', '#ffcc44'];

  const lines: { idx: number; path: string; color: string }[] = [];
  let ci = 0;
  for (const idx of heaterIndices) {
    const pts = history
      .map((s) => {
        const h = s.heaters?.find((x) => x.index === idx);
        return h ? { x: toX(s.timestamp), y: toY(h.current) } : null;
      })
      .filter(Boolean) as { x: number; y: number }[];
    if (pts.length > 1) {
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      lines.push({ idx, path: d, color: colors[ci % colors.length] });
    }
    ci++;
  }

  // Y-axis gridlines
  const yTicks: number[] = [];
  const step = maxT <= 100 ? 25 : maxT <= 300 ? 50 : 100;
  for (let t = 0; t <= maxT; t += step) yTicks.push(t);

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Thermometer size={14} /> Temperature History
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Grid */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left} y1={toY(t)} x2={W - PAD.right} y2={toY(t)}
              stroke="#2a2a4a" strokeWidth={0.5}
            />
            <text x={PAD.left - 4} y={toY(t) + 3} fill="#666680" fontSize={9} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {/* Lines */}
        {lines.map((l) => (
          <path key={l.idx} d={l.path} fill="none" stroke={l.color} strokeWidth={1.5} />
        ))}
        {/* Legend */}
        {lines.map((l, i) => (
          <g key={`leg-${l.idx}`}>
            <rect x={PAD.left + i * 80} y={H - 14} width={10} height={10} rx={2} fill={l.color} />
            <text
              x={PAD.left + i * 80 + 14} y={H - 5}
              fill="#aaaacc" fontSize={9}
            >
              Heater {l.idx}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// --- Layer Duration Chart --------------------------------------------------

function LayerDurationChart() {
  const model = usePrinterStore((s) => s.model);
  const layers = model.job?.layers;

  if (!layers || layers.length < 2) return null;

  const W = 480;
  const H = 120;
  const PAD = { top: 10, right: 10, bottom: 20, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxDur = Math.max(...layers.map((l) => l.duration), 1);
  const barW = Math.max(1, plotW / layers.length - 1);

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Timer size={14} /> Layer Duration
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {layers.map((layer, i) => {
          const barH = (layer.duration / maxDur) * plotH;
          const x = PAD.left + (i / layers.length) * plotW;
          const y = PAD.top + plotH - barH;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={Math.max(barW, 1)}
              height={barH}
              fill="#44aaff"
              opacity={0.8}
              rx={1}
            >
              <title>Layer {i + 1}: {formatTime(layer.duration)}</title>
            </rect>
          );
        })}
        {/* X axis label */}
        <text x={W / 2} y={H - 3} fill="#666680" fontSize={9} textAnchor="middle">
          Layer
        </text>
        {/* Y axis ticks */}
        {[0, 0.5, 1].map((frac) => {
          const val = frac * maxDur;
          const y = PAD.top + plotH - frac * plotH;
          return (
            <g key={frac}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#2a2a4a" strokeWidth={0.5} />
              <text x={PAD.left - 4} y={y + 3} fill="#666680" fontSize={9} textAnchor="end">
                {formatTime(val)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// --- Baby Stepping ---------------------------------------------------------

function BabySteppingControls() {
  const model = usePrinterStore((s) => s.model);
  const setBabyStep = usePrinterStore((s) => s.setBabyStep);

  // Current baby step offset from move axes Z
  const zAxis = model.move?.axes?.find((a) => a.letter === 'Z');
  const currentOffset = zAxis ? (zAxis.userPosition - zAxis.machinePosition) : 0;

  return (
    <div className="job-section">
      <div className="job-section-title">
        <ArrowUpDown size={14} /> Baby Stepping (Z Offset)
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '8px 0',
      }}>
        <button
          className="control-btn"
          title="Lower Z by 0.02mm"
          onClick={() => setBabyStep(-0.02)}
          style={{ width: 40, height: 40 }}
        >
          <Minus size={16} />
        </button>
        <div style={{
          textAlign: 'center', minWidth: 100,
        }}>
          <div style={{ fontSize: 10, color: '#666680', marginBottom: 2 }}>Z Offset</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#e0e0ff', fontFamily: 'monospace' }}>
            {currentOffset >= 0 ? '+' : ''}{currentOffset.toFixed(3)} mm
          </div>
        </div>
        <button
          className="control-btn"
          title="Raise Z by 0.02mm"
          onClick={() => setBabyStep(0.02)}
          style={{ width: 40, height: 40 }}
        >
          <Plus size={16} />
        </button>
      </div>
      <div style={{ fontSize: 10, color: '#555', textAlign: 'center' }}>
        Step: 0.02 mm
      </div>
    </div>
  );
}

// --- Speed/Flow Override ---------------------------------------------------

function SpeedFlowOverride() {
  const model = usePrinterStore((s) => s.model);
  const setSpeedFactor = usePrinterStore((s) => s.setSpeedFactor);
  const setExtrusionFactor = usePrinterStore((s) => s.setExtrusionFactor);

  const speedFactor = (model.move?.speedFactor ?? 1) * 100;
  const extruders = model.move?.extruders ?? [];

  const [localSpeed, setLocalSpeed] = useState<number | null>(null);
  const [localFlow, setLocalFlow] = useState<number | null>(null);

  const displaySpeed = localSpeed ?? Math.round(speedFactor);
  const firstExtruderFactor = extruders.length > 0 ? (extruders[0].factor ?? 1) * 100 : 100;
  const displayFlow = localFlow ?? Math.round(firstExtruderFactor);

  const handleSpeedChange = useCallback((value: number) => {
    setLocalSpeed(value);
  }, []);

  const handleSpeedCommit = useCallback((value: number) => {
    setLocalSpeed(null);
    setSpeedFactor(value);
  }, [setSpeedFactor]);

  const handleFlowChange = useCallback((value: number) => {
    setLocalFlow(value);
  }, []);

  const handleFlowCommit = useCallback((value: number) => {
    setLocalFlow(null);
    setExtrusionFactor(0, value);
  }, [setExtrusionFactor]);

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Gauge size={14} /> Speed / Flow Override
      </div>
      <div style={{ padding: '4px 0' }}>
        <SliderRow
          label="Speed"
          value={displaySpeed}
          min={10}
          max={300}
          unit="%"
          onChange={handleSpeedChange}
          onCommit={handleSpeedCommit}
        />
        <SliderRow
          label="Flow"
          value={displayFlow}
          min={50}
          max={200}
          unit="%"
          onChange={handleFlowChange}
          onCommit={handleFlowCommit}
        />
      </div>
    </div>
  );
}

// --- Webcam View -----------------------------------------------------------

function WebcamView() {
  const service = usePrinterStore((s) => s.service);

  if (!service) return null;

  const webcamUrl = service.getWebcamUrl();

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Video size={14} /> Webcam
      </div>
      <div style={{
        borderRadius: 6, overflow: 'hidden', background: '#000', border: '1px solid #2a2a4a',
      }}>
        <img
          src={webcamUrl}
          alt="Printer webcam"
          style={{ width: '100%', display: 'block' }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function JobDetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '3px 0', fontSize: 12,
    }}>
      <span style={{ color: '#888899' }}>{label}</span>
      <span style={{
        color: highlight ? '#44cc88' : '#e0e0ff',
        fontWeight: highlight ? 600 : 400,
        fontFamily: 'monospace',
      }}>
        {value}
      </span>
    </div>
  );
}

function SliderRow({
  label, value, min, max, unit, onChange, onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0',
    }}>
      <span style={{ fontSize: 12, color: '#888899', width: 44, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        style={{ flex: 1, accentColor: '#44aaff' }}
      />
      <span style={{
        fontSize: 13, color: '#e0e0ff', fontFamily: 'monospace', width: 52, textAlign: 'right',
      }}>
        {value}{unit}
      </span>
    </div>
  );
}

// --- Object Cancellation (M486) -------------------------------------------

function ObjectCancellation() {
  const model = usePrinterStore((s) => s.model);
  const cancelObject = usePrinterStore((s) => s.cancelObject);
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);

  const objects = model.job?.build?.objects;
  const currentObject = model.job?.build?.currentObject ?? -1;

  if (!objects || objects.length === 0) return null;

  // Compute SVG bounding box from all objects
  const allX: number[] = [];
  const allY: number[] = [];
  for (const obj of objects) {
    if (obj.x) allX.push(...obj.x);
    if (obj.y) allY.push(...obj.y);
  }
  const hasBounds = allX.length > 0 && allY.length > 0;
  const minX = hasBounds ? Math.min(...allX) : 0;
  const maxX = hasBounds ? Math.max(...allX) : 100;
  const minY = hasBounds ? Math.min(...allY) : 0;
  const maxY = hasBounds ? Math.max(...allY) : 100;
  const rangeX = Math.max(maxX - minX, 1);
  const rangeY = Math.max(maxY - minY, 1);
  const SVG_W = 240;
  const SVG_H = 240;
  const PAD = 16;
  const plotW = SVG_W - PAD * 2;
  const plotH = SVG_H - PAD * 2;

  const toSvgX = (x: number) => PAD + ((x - minX) / rangeX) * plotW;
  const toSvgY = (y: number) => PAD + plotH - ((y - minY) / rangeY) * plotH;

  const handleCancel = (index: number) => {
    cancelObject(index);
    setConfirmIndex(null);
  };

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Box size={14} /> Object Cancellation
      </div>

      {/* Mini 2D overhead view */}
      {hasBounds && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            style={{ width: SVG_W, height: SVG_H, background: '#12122a', borderRadius: 6, border: '1px solid #2a2a4a' }}
          >
            {/* Bed outline */}
            <rect
              x={PAD} y={PAD} width={plotW} height={plotH}
              fill="none" stroke="#2a2a4a" strokeWidth={1} strokeDasharray="4 2"
            />
            {/* Object bounding boxes */}
            {objects.map((obj, i) => {
              if (!obj.x || obj.x.length < 2 || !obj.y || obj.y.length < 2) return null;
              const x1 = toSvgX(obj.x[0]);
              const x2 = toSvgX(obj.x[1]);
              const y1 = toSvgY(obj.y[1]);
              const y2 = toSvgY(obj.y[0]);
              const isCurrent = i === currentObject;
              const fill = obj.cancelled
                ? 'rgba(255, 68, 68, 0.25)'
                : isCurrent
                  ? 'rgba(68, 170, 255, 0.3)'
                  : 'rgba(68, 204, 136, 0.2)';
              const stroke = obj.cancelled
                ? '#ff4444'
                : isCurrent
                  ? '#44aaff'
                  : '#44cc88';
              return (
                <g key={i}>
                  <rect
                    x={Math.min(x1, x2)} y={Math.min(y1, y2)}
                    width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)}
                    fill={fill} stroke={stroke} strokeWidth={1.5} rx={2}
                  />
                  <text
                    x={(x1 + x2) / 2} y={(y1 + y2) / 2 + 3}
                    fill={stroke} fontSize={9} textAnchor="middle" fontWeight={500}
                  >
                    {obj.name || `#${i}`}
                  </text>
                  {obj.cancelled && (
                    <line
                      x1={Math.min(x1, x2)} y1={Math.min(y1, y2)}
                      x2={Math.max(x1, x2)} y2={Math.max(y1, y2)}
                      stroke="#ff4444" strokeWidth={1} opacity={0.6}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Object list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {objects.map((obj, i) => {
          const isCurrent = i === currentObject;
          const name = obj.name || `Object ${i}`;
          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 10px', borderRadius: 6,
                background: isCurrent ? 'rgba(68, 170, 255, 0.1)' : '#1a1a2e',
                border: isCurrent ? '1px solid rgba(68, 170, 255, 0.3)' : '1px solid transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                <span style={{
                  fontSize: 10, color: '#666680', fontFamily: 'monospace', flexShrink: 0,
                }}>
                  #{i}
                </span>
                <span style={{
                  fontSize: 12, fontWeight: isCurrent ? 600 : 400,
                  color: obj.cancelled ? '#ff4444' : isCurrent ? '#44aaff' : '#e0e0ff',
                  textDecoration: obj.cancelled ? 'line-through' : 'none',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {name}
                </span>
                {isCurrent && !obj.cancelled && (
                  <span style={{
                    fontSize: 9, color: '#44aaff', background: 'rgba(68, 170, 255, 0.15)',
                    padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                  }}>
                    PRINTING
                  </span>
                )}
                {obj.cancelled && (
                  <span style={{
                    fontSize: 9, color: '#ff4444', background: 'rgba(255, 68, 68, 0.15)',
                    padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                  }}>
                    CANCELLED
                  </span>
                )}
              </div>

              {!obj.cancelled && (
                <div style={{ flexShrink: 0, marginLeft: 8 }}>
                  {confirmIndex === i ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: '#ffaa44' }}>Cancel?</span>
                      <button
                        className="control-btn danger"
                        style={{ width: 28, height: 28, fontSize: 10 }}
                        title="Confirm cancel"
                        onClick={() => handleCancel(i)}
                      >
                        Yes
                      </button>
                      <button
                        className="control-btn"
                        style={{ width: 28, height: 28, fontSize: 10 }}
                        title="Abort"
                        onClick={() => setConfirmIndex(null)}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      className="control-btn danger"
                      style={{ width: 28, height: 28 }}
                      title={`Cancel ${name}`}
                      onClick={() => setConfirmIndex(i)}
                    >
                      <XCircle size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DuetJobStatus() {
  const model = usePrinterStore((s) => s.model);

  const status = model.state?.status ?? 'idle';
  const hasJob = status === 'processing' || status === 'paused' || status === 'pausing'
    || status === 'resuming' || status === 'simulating' || status === 'cancelling';

  if (!hasJob) {
    return <NoJobMessage />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '12px 0' }}>
      <PrintStatusHeader />
      <ProgressSection />
      <ObjectCancellation />
      <JobInfo />
      <TimeEstimates />
      <FilamentUsage />
      <TemperatureChart />
      <LayerDurationChart />
      <BabySteppingControls />
      <SpeedFlowOverride />
      <WebcamView />
    </div>
  );
}
