import ExpressionInput from '../../../ui/ExpressionInput';
import type { ExtrudeDirection } from '../../../../store/cadStore';

export function GeometrySection({
  clearStartFace,
  clearToEntityFace,
  direction,
  distance,
  distance2,
  effectiveBodyKind,
  extentType,
  extentType2,
  extrudeSymmetricFullLength,
  setDistance,
  setDistance2,
  setDirection,
  setExtentType,
  setExtentType2,
  setExtrudeSymmetricFullLength,
  setStartOffset,
  setStartType,
  setTaperAngle,
  setTaperAngle2,
  setToObjectFlip,
  startFaceCentroid,
  startOffset,
  startType,
  taperAngle,
  taperAngle2,
  toEntityFaceId,
  toObjectFlip,
  units,
}: {
  clearStartFace: () => void;
  clearToEntityFace: () => void;
  direction: ExtrudeDirection;
  distance: number;
  distance2: number;
  effectiveBodyKind: 'solid' | 'surface';
  extentType: 'distance' | 'all' | 'to-object';
  extentType2: 'distance' | 'all' | 'to-object';
  extrudeSymmetricFullLength: boolean;
  setDistance: (value: number) => void;
  setDistance2: (value: number) => void;
  setDirection: (value: ExtrudeDirection) => void;
  setExtentType: (value: 'distance' | 'all' | 'to-object') => void;
  setExtentType2: (value: 'distance' | 'all' | 'to-object') => void;
  setExtrudeSymmetricFullLength: (value: boolean) => void;
  setStartOffset: (value: number) => void;
  setStartType: (value: 'profile' | 'offset' | 'entity') => void;
  setTaperAngle: (value: number) => void;
  setTaperAngle2: (value: number) => void;
  setToObjectFlip: (value: boolean) => void;
  startFaceCentroid: [number, number, number] | null;
  startOffset: number;
  startType: 'profile' | 'offset' | 'entity';
  taperAngle: number;
  taperAngle2: number;
  toEntityFaceId: string | null;
  toObjectFlip: boolean;
  units: string;
}) {
  const renderToObjectFacePicker = (hint: string, flipLabel = 'Flip Direction') => (
    <>
      <div className="tp-row">
        {toEntityFaceId ? (
          <>
            <span className="tp-label" style={{ color: '#55cc88' }}>✓ Face selected</span>
            <button
              style={{ fontSize: 10, background: 'none', border: 'none', color: '#5588ff', cursor: 'pointer', padding: 0 }}
              onClick={clearToEntityFace}
            >
              Clear
            </button>
          </>
        ) : (
          <span className="tp-label" style={{ fontSize: 10, color: '#aaaacc' }}>{hint}</span>
        )}
      </div>
      {toEntityFaceId && (
        <div className="tp-row">
          <span className="tp-label">{flipLabel}</span>
          <label className="tp-toggle">
            <input type="checkbox" checked={toObjectFlip} onChange={() => setToObjectFlip(!toObjectFlip)} />
            <span className="tp-toggle-track" />
          </label>
        </div>
      )}
    </>
  );

  const renderTaperInput = (
    label: string,
    value: number,
    onChange: (value: number) => void,
  ) => (
    <div className="tp-row">
      <span className="tp-label">{label}</span>
      <div className="tp-input-group">
        <input
          type="number"
          step="0.5"
          min="-89"
          max="89"
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isNaN(next)) onChange(Math.max(-89, Math.min(89, next)));
          }}
        />
        <span className="tp-unit">°</span>
      </div>
    </div>
  );

  return (
    <div className="tp-section">
      <div className="tp-section-title">Geometry</div>

      <div className="tp-row">
        <span className="tp-label">Direction</span>
        <select
          className="tp-select"
          value={direction}
          onChange={(event) => setDirection(event.target.value as ExtrudeDirection)}
        >
          <option value="positive">One Side</option>
          <option value="symmetric">Symmetric</option>
          <option value="negative">Reversed</option>
          <option value="two-sides">Two Sides</option>
        </select>
      </div>

      {direction !== 'two-sides' ? (
        <>
          <div className="tp-row">
            <span className="tp-label">Extent</span>
            <select
              className="tp-select"
              value={extentType}
              onChange={(event) => setExtentType(event.target.value as 'distance' | 'all' | 'to-object')}
            >
              <option value="distance">Distance</option>
              <option value="all">All</option>
              <option value="to-object">To Object</option>
            </select>
          </div>

          {extentType === 'distance' && (
            <>
              <div className="tp-row">
                <span className="tp-label">Distance</span>
                <div className="tp-input-group">
                  <ExpressionInput value={distance} onChange={setDistance} step={0.1} />
                  <span className="tp-unit">{units}</span>
                </div>
              </div>
              {direction === 'symmetric' && (
                <div className="tp-row">
                  <span className="tp-label">Full Length</span>
                  <label className="tp-toggle">
                    <input
                      type="checkbox"
                      checked={extrudeSymmetricFullLength}
                      onChange={() => setExtrudeSymmetricFullLength(!extrudeSymmetricFullLength)}
                    />
                    <span className="tp-toggle-track" />
                  </label>
                </div>
              )}
            </>
          )}

          {extentType === 'to-object' &&
            renderToObjectFacePicker('Click a face in viewport to set terminus')}
        </>
      ) : (
        <>
          <div className="tp-row">
            <span className="tp-label">Side 1 Extent</span>
            <select
              className="tp-select"
              value={extentType}
              onChange={(event) => setExtentType(event.target.value as 'distance' | 'all' | 'to-object')}
            >
              <option value="distance">Distance</option>
              <option value="all">All</option>
              <option value="to-object">To Object</option>
            </select>
          </div>
          {extentType === 'distance' && (
            <div className="tp-row">
              <span className="tp-label">Side 1 Dist</span>
              <div className="tp-input-group">
                <ExpressionInput value={distance} onChange={setDistance} step={0.1} />
                <span className="tp-unit">{units}</span>
              </div>
            </div>
          )}
          {extentType === 'to-object' && renderToObjectFacePicker('Click a face in viewport', 'Flip Dir')}

          <div className="tp-row">
            <span className="tp-label">Side 2 Extent</span>
            <select
              className="tp-select"
              value={extentType2}
              onChange={(event) => setExtentType2(event.target.value as 'distance' | 'all' | 'to-object')}
            >
              <option value="distance">Distance</option>
              <option value="all">All</option>
              <option value="to-object">To Object</option>
            </select>
          </div>
          {extentType2 === 'distance' && (
            <div className="tp-row">
              <span className="tp-label">Side 2 Dist</span>
              <div className="tp-input-group">
                <ExpressionInput value={distance2} onChange={setDistance2} step={0.1} />
                <span className="tp-unit">{units}</span>
              </div>
            </div>
          )}
          {extentType2 === 'to-object' && renderToObjectFacePicker('Click a face in viewport', 'Flip Dir')}
        </>
      )}

      <div className="tp-row">
        <span className="tp-label">Start</span>
        <select
          className="tp-select"
          value={startType}
          onChange={(event) => setStartType(event.target.value as 'profile' | 'offset' | 'entity')}
        >
          <option value="profile">Profile Plane</option>
          <option value="offset">Offset</option>
          <option value="entity">From Entity</option>
        </select>
      </div>

      {startType === 'offset' && (
        <div className="tp-row">
          <span className="tp-label">Offset</span>
          <div className="tp-input-group">
            <ExpressionInput value={startOffset} onChange={setStartOffset} step={0.1} />
            <span className="tp-unit">{units}</span>
          </div>
        </div>
      )}

      {startType === 'entity' && (
        <div className="tp-row">
          {startFaceCentroid ? (
            <>
              <span className="tp-label" style={{ color: '#55cc88' }}>✓ Start face selected</span>
              <button
                style={{ fontSize: 10, background: 'none', border: 'none', color: '#5588ff', cursor: 'pointer', padding: 0 }}
                onClick={clearStartFace}
              >
                Clear
              </button>
            </>
          ) : (
            <span className="tp-label" style={{ fontSize: 10, color: '#aaaacc' }}>
              Click a face/plane in viewport to set start entity
            </span>
          )}
        </div>
      )}

      {effectiveBodyKind === 'solid' &&
        (direction === 'two-sides' ? (
          <>
            {renderTaperInput('Taper 1', taperAngle, setTaperAngle)}
            {renderTaperInput('Taper 2', taperAngle2, setTaperAngle2)}
          </>
        ) : (
          renderTaperInput('Taper', taperAngle, setTaperAngle)
        ))}

      {effectiveBodyKind === 'solid' &&
        (Math.abs(taperAngle) >= 45 || (direction === 'two-sides' && Math.abs(taperAngle2) >= 45)) && (
          <div className="tp-row" style={{ color: '#ffaa44', fontSize: 10, gap: 4 }}>
            <span>⚠ Taper ≥ 45° may collapse the profile.</span>
          </div>
        )}
    </div>
  );
}
