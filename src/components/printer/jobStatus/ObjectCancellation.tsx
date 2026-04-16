import { useState } from 'react';
import { Box, XCircle } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import '../DuetJobStatus.css';

export function ObjectCancellation() {
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
