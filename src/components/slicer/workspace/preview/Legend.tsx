import * as React from 'react';
import { Html } from '@react-three/drei';
import type { SliceMove } from '../../../../types/slicer';
import { MOVE_TYPE_COLORS, MOVE_TYPE_LABELS } from './constants';
import './Legend.css';

interface LegendProps {
  colorMode: 'type' | 'speed' | 'flow';
  currentLayer: number;
  currentZ: number;
  layerTime: number;
  range: [number, number];
}

export function Legend({ colorMode, currentLayer, currentZ, layerTime, range }: LegendProps) {
  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

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
            Layer {currentLayer}
              </div>
              <div>Z: {currentZ.toFixed(2)} mm</div>
              <div>Layer time: {formatTime(layerTime)}</div>
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
                  <div className="slicer-preview-legend__gradient" />
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
                  <div className="slicer-preview-legend__gradient" />
                  <span>{range[1].toFixed(3)}</span>
                </div>
                <div className="slicer-preview-legend__units">mm</div>
              </div>
            )}
          </div>
        </div>
      </Html>
    </React.Fragment>
  );
}
