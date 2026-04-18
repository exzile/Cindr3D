import { useState, useEffect, useRef } from 'react';
import { Scan } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import '../DuetJobStatus.css';

export function FirstLayerInspection() {
  const model = usePrinterStore((s) => s.model);
  const pausePrint = usePrinterStore((s) => s.pausePrint);

  const [enabled, setEnabled] = useState(false);
  const [paused, setPaused] = useState(false);
  const prevLayerRef = useRef<number>(0);

  const status = model.state?.status ?? 'idle';
  const currentLayer = model.job?.layer ?? 0;
  const isPrinting = status === 'processing';

  // Monitor layer transitions: when layer goes from 1 to 2, send pause
  useEffect(() => {
    if (!enabled || paused || !isPrinting) {
      prevLayerRef.current = currentLayer;
      return;
    }

    if (prevLayerRef.current === 1 && currentLayer >= 2) {
      pausePrint();
      setPaused(true); // eslint-disable-line react-hooks/set-state-in-effect -- sync with external print state
    }

    prevLayerRef.current = currentLayer;
  }, [enabled, paused, isPrinting, currentLayer, pausePrint]);

  // Reset paused flag when a new print starts (layer goes back to 0 or 1)
  useEffect(() => {
    if (currentLayer <= 1) {
      setPaused(false); // eslint-disable-line react-hooks/set-state-in-effect -- sync with external print state
    }
  }, [currentLayer]);

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Scan size={14} /> First Layer Inspection
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 12,
      }}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer', color: '#e0e0ff',
        }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              if (!e.target.checked) setPaused(false);
            }}
            style={{ accentColor: '#44aaff' }}
          />
          Pause after first layer
        </label>
        {paused && (
          <span style={{
            fontSize: 11, color: '#ffaa44', fontWeight: 500,
          }}>
            Paused for inspection
          </span>
        )}
        {enabled && !paused && isPrinting && currentLayer >= 1 && (
          <span style={{
            fontSize: 11, color: '#888899',
          }}>
            Monitoring layer {currentLayer}...
          </span>
        )}
      </div>
      {enabled && (
        <div style={{
          fontSize: 11, color: '#888899', marginTop: 6,
        }}>
          Print will pause automatically when layer 2 begins, allowing you to inspect the first layer.
        </div>
      )}
    </div>
  );
}
