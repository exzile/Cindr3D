import { useState, useEffect, useRef } from 'react';
import { Timer } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import '../DuetJobStatus.css';

export function PauseAtTrigger() {
  const model = usePrinterStore((s) => s.model);
  const pausePrint = usePrinterStore((s) => s.pausePrint);

  const [pauseAtLayer, setPauseAtLayer] = useState<number | null>(null);
  const [pauseAtHeight, setPauseAtHeight] = useState<number | null>(null);
  const [triggered, setTriggered] = useState(false);
  const prevLayerRef = useRef<number>(0);

  const status = model.state?.status ?? 'idle';
  const currentLayer = model.job?.layer ?? 0;
  const isPrinting = status === 'processing';

  // Compute current Z height from layer info
  const firstLayerHeight = model.job?.file?.firstLayerHeight ?? 0;
  const layerHeight = model.job?.file?.layerHeight ?? 0;
  const currentHeight =
    currentLayer <= 1
      ? firstLayerHeight * currentLayer
      : firstLayerHeight + (currentLayer - 1) * layerHeight;

  // Monitor layer / height triggers
  useEffect(() => {
    if (triggered || !isPrinting) {
      prevLayerRef.current = currentLayer;
      return;
    }

    const layerMatch = pauseAtLayer !== null && pauseAtLayer > 0 && currentLayer >= pauseAtLayer && prevLayerRef.current < pauseAtLayer;
    const heightMatch = pauseAtHeight !== null && pauseAtHeight > 0 && currentHeight >= pauseAtHeight && prevLayerRef.current < currentLayer;

    if (layerMatch || heightMatch) {
      pausePrint();
      setTriggered(true); // eslint-disable-line react-hooks/set-state-in-effect -- sync with external print state
    }

    prevLayerRef.current = currentLayer;
  }, [triggered, isPrinting, currentLayer, currentHeight, pauseAtLayer, pauseAtHeight, pausePrint]);

  // Reset triggered flag when a new print starts
  useEffect(() => {
    if (currentLayer <= 1) {
      setTriggered(false); // eslint-disable-line react-hooks/set-state-in-effect -- sync with external print state
    }
  }, [currentLayer]);

  const hasAnyTrigger = (pauseAtLayer !== null && pauseAtLayer > 0) || (pauseAtHeight !== null && pauseAtHeight > 0);

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Timer size={14} /> Pause at Layer / Height
      </div>

      {/* Layer trigger */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 12, color: '#e0e0ff', marginBottom: 4,
      }}>
        <label style={{ whiteSpace: 'nowrap' }}>Pause at layer:</label>
        <input
          type="number"
          min={1}
          value={pauseAtLayer ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            setPauseAtLayer(v === '' ? null : Math.max(1, parseInt(v, 10) || 0));
            setTriggered(false);
          }}
          placeholder="--"
          style={{
            width: 60, padding: '2px 6px', fontSize: 12,
            background: '#1a1a2e', border: '1px solid #333355',
            borderRadius: 3, color: '#e0e0ff', fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Height trigger */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 12, color: '#e0e0ff',
      }}>
        <label style={{ whiteSpace: 'nowrap' }}>Pause at height:</label>
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={pauseAtHeight ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            setPauseAtHeight(v === '' ? null : Math.max(0.1, parseFloat(v) || 0));
            setTriggered(false);
          }}
          placeholder="--"
          style={{
            width: 60, padding: '2px 6px', fontSize: 12,
            background: '#1a1a2e', border: '1px solid #333355',
            borderRadius: 3, color: '#e0e0ff', fontFamily: 'inherit',
          }}
        />
        <span style={{ fontSize: 11, color: '#888899' }}>mm</span>
      </div>

      {/* Status line */}
      {triggered && (
        <div style={{ fontSize: 11, color: '#ffaa44', fontWeight: 500, marginTop: 6 }}>
          Paused at trigger
        </div>
      )}
      {!triggered && hasAnyTrigger && isPrinting && (
        <div style={{ fontSize: 11, color: '#888899', marginTop: 6 }}>
          Monitoring layer {currentLayer} / height {currentHeight.toFixed(1)} mm...
        </div>
      )}
    </div>
  );
}
