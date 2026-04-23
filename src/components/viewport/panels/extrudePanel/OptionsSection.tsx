import { ParticipantBodyPicker } from '../../../ui/ParticipantBodyPicker';
import type { ExtrudeOperation } from '../../../../store/cadStore';

export function OptionsSection({
  allClosedProfiles,
  baseFeatureContainers,
  confinedFaceIds,
  creationOccurrence,
  effectiveBodyKind,
  occurrenceList,
  operation,
  participantBodyIds,
  setBodyKind,
  setConfinedFaceIds,
  setCreationOccurrence,
  setOperation,
  setParticipantBodyIds,
  setTargetBaseFeature,
  setThinEnabled,
  setThinSide,
  setThinSide2,
  setThinThickness,
  setThinThickness2,
  targetBaseFeature,
  thinEnabled,
  thinSide,
  thinSide2,
  thinThickness,
  thinThickness2,
  units,
  direction,
}: {
  allClosedProfiles: boolean;
  baseFeatureContainers: { id: string; name: string }[];
  confinedFaceIds: string[];
  creationOccurrence: string | null;
  effectiveBodyKind: 'solid' | 'surface';
  occurrenceList: { id: string; name: string }[];
  operation: ExtrudeOperation;
  participantBodyIds: string[];
  setBodyKind: (value: 'solid' | 'surface') => void;
  setConfinedFaceIds: (ids: string[]) => void;
  setCreationOccurrence: (id: string | null) => void;
  setOperation: (value: ExtrudeOperation) => void;
  setParticipantBodyIds: (ids: string[]) => void;
  setTargetBaseFeature: (id: string | null) => void;
  setThinEnabled: (value: boolean) => void;
  setThinSide: (value: 'side1' | 'side2' | 'center') => void;
  setThinSide2: (value: 'side1' | 'side2' | 'center') => void;
  setThinThickness: (value: number) => void;
  setThinThickness2: (value: number) => void;
  targetBaseFeature: string | null;
  thinEnabled: boolean;
  thinSide: 'side1' | 'side2' | 'center';
  thinSide2: 'side1' | 'side2' | 'center';
  thinThickness: number;
  thinThickness2: number;
  units: string;
  direction: 'positive' | 'negative' | 'symmetric' | 'two-sides';
}) {
  const renderThinThickness = (
    label: string,
    value: number,
    onChange: (value: number) => void,
  ) => (
    <div className="tp-row">
      <span className="tp-label">{label}</span>
      <div className="tp-input-group">
        <input
          type="number"
          step="0.1"
          min="0.01"
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isNaN(next) && next > 0) onChange(next);
          }}
        />
        <span className="tp-unit">{units}</span>
      </div>
    </div>
  );

  const renderThinSide = (
    label: string,
    value: 'side1' | 'side2' | 'center',
    onChange: (value: 'side1' | 'side2' | 'center') => void,
  ) => (
    <div className="tp-row">
      <span className="tp-label">{label}</span>
      <select
        className="tp-select"
        value={value}
        onChange={(event) => onChange(event.target.value as 'side1' | 'side2' | 'center')}
      >
        <option value="side1">Side 1</option>
        <option value="side2">Side 2</option>
        <option value="center">Center</option>
      </select>
    </div>
  );

  return (
    <div className="tp-section">
      <div className="tp-section-title">Options</div>

      {effectiveBodyKind === 'solid' && (
        <>
          <div className="tp-row">
            <span className="tp-label">Operation</span>
            <select
              className="tp-select"
              value={operation}
              onChange={(event) => setOperation(event.target.value as ExtrudeOperation)}
            >
              <option value="new-body">New Body</option>
              <option value="join">Join</option>
              <option value="cut">Cut</option>
              <option value="intersect">Intersect</option>
              <option value="new-component">New Component</option>
            </select>
          </div>

          <div className="tp-row">
            <span className="tp-label">Thin</span>
            <label className="tp-toggle">
              <input type="checkbox" checked={thinEnabled} onChange={() => setThinEnabled(!thinEnabled)} />
              <span className="tp-toggle-track" />
            </label>
          </div>

          {thinEnabled && (
            <>
              {renderThinThickness(direction === 'two-sides' ? 'Thickness 1' : 'Thickness', thinThickness, setThinThickness)}
              {renderThinSide(direction === 'two-sides' ? 'Side 1 Loc' : 'Side', thinSide, setThinSide)}
              {direction === 'two-sides' && (
                <>
                  {renderThinThickness('Thickness 2', thinThickness2, setThinThickness2)}
                  {renderThinSide('Side 2 Loc', thinSide2, setThinSide2)}
                </>
              )}
            </>
          )}
        </>
      )}

      <div className="tp-row">
        <span className="tp-label">Output</span>
        <select
          className="tp-select"
          value={effectiveBodyKind}
          onChange={(event) => setBodyKind(event.target.value as 'solid' | 'surface')}
        >
          <option value="solid" disabled={!allClosedProfiles}>Solid Body</option>
          <option value="surface">Surface Body</option>
        </select>
      </div>

      {(operation === 'cut' || operation === 'intersect') && (
        <div className="tp-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <ParticipantBodyPicker
            selectedIds={participantBodyIds}
            onChange={setParticipantBodyIds}
            label="Participant Bodies"
          />
        </div>
      )}

      <div className="tp-row">
        <label className="tp-checkbox-label">
          <input
            type="checkbox"
            checked={confinedFaceIds.length > 0}
            onChange={(event) => {
              if (!event.target.checked) setConfinedFaceIds([]);
            }}
          />
          <span>Confined Faces</span>
        </label>
      </div>

      {confinedFaceIds.length > 0 ? (
        <div style={{ fontSize: 10, color: '#888', padding: '0 6px 4px' }}>
          {confinedFaceIds.length} bounding face{confinedFaceIds.length > 1 ? 's' : ''} selected
          <button
            style={{ marginLeft: 6, fontSize: 10, background: 'none', border: 'none', color: '#5588ff', cursor: 'pointer', padding: 0 }}
            onClick={() => setConfinedFaceIds([])}
          >
            Clear
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 10, color: '#666', padding: '0 6px 4px' }}>
          Enable to limit extrude to selected bounding faces (face-pick via viewport)
        </div>
      )}

      {occurrenceList.length > 0 && (
        <div className="tp-row">
          <label className="tp-label">Occurrence</label>
          <select
            className="tp-select"
            value={creationOccurrence ?? ''}
            onChange={(event) => setCreationOccurrence(event.target.value || null)}
            style={{ flex: 1 }}
          >
            <option value="">(Active component)</option>
            {occurrenceList.map((occurrence) => (
              <option key={occurrence.id} value={occurrence.id}>
                {occurrence.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {baseFeatureContainers.length > 0 && (
        <div className="tp-row">
          <label className="tp-label">Base Feature</label>
          <select
            className="tp-select"
            value={targetBaseFeature ?? ''}
            onChange={(event) => setTargetBaseFeature(event.target.value || null)}
            style={{ flex: 1 }}
          >
            <option value="">(Parametric — none)</option>
            {baseFeatureContainers.map((feature) => (
              <option key={feature.id} value={feature.id}>
                {feature.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
