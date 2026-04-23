import { CollapsibleSection } from '../../common/CollapsibleSection';
import { SegmentedIconGroup } from '../../common/SegmentedIconGroup';
import { FaceSelector } from '../../common/FaceSelector';
import { PLACEMENT_OPTIONS, type Placement } from './types';

interface PlacementSectionProps {
  placement: Placement;
  setPlacement: (value: Placement) => void;
  holeFaceId: string | null;
  clearHoleFace: () => void;
  offsetDist1: number;
  setOffsetDist1: (value: number) => void;
  offsetDist2: number;
  setOffsetDist2: (value: number) => void;
  edgeParam: number;
  setEdgeParam: (value: number) => void;
}

export function PlacementSection({
  placement,
  setPlacement,
  holeFaceId,
  clearHoleFace,
  offsetDist1,
  setOffsetDist1,
  offsetDist2,
  setOffsetDist2,
  edgeParam,
  setEdgeParam,
}: PlacementSectionProps) {
  return (
    <CollapsibleSection title="Placement">
      <div className="tp-row">
        <span className="tp-label">Placement</span>
        <SegmentedIconGroup
          value={placement}
          onChange={setPlacement}
          options={PLACEMENT_OPTIONS}
          ariaLabel="Placement"
        />
      </div>
      <div className="tp-row">
        <span className="tp-label">Face</span>
        <FaceSelector
          selected={!!holeFaceId}
          pickActive={!holeFaceId}
          onClear={clearHoleFace}
          selectedLabel="1 selected"
          emptyLabel="Select"
        />
      </div>

      {placement === 'plane-offsets' && (
        <>
          <div className="tp-row">
            <span className="tp-label">Ref 1</span>
            <FaceSelector selected={false} pickActive={false} onClear={() => {}} emptyLabel="Select edge/face" />
          </div>
          <div className="tp-row">
            <span className="tp-label">Offset 1</span>
            <div className="tp-input-group">
              <input
                type="number"
                value={offsetDist1}
                step={0.5}
                min={0}
                onChange={(e) => setOffsetDist1(parseFloat(e.target.value) || 0)}
                aria-label="Offset from reference 1 (mm)"
              />
              <span className="tp-unit">mm</span>
            </div>
          </div>
          <div className="tp-row">
            <span className="tp-label">Ref 2</span>
            <FaceSelector selected={false} pickActive={false} onClear={() => {}} emptyLabel="Select edge/face" />
          </div>
          <div className="tp-row">
            <span className="tp-label">Offset 2</span>
            <div className="tp-input-group">
              <input
                type="number"
                value={offsetDist2}
                step={0.5}
                min={0}
                onChange={(e) => setOffsetDist2(parseFloat(e.target.value) || 0)}
                aria-label="Offset from reference 2 (mm)"
              />
              <span className="tp-unit">mm</span>
            </div>
          </div>
        </>
      )}

      {placement === 'on-edge' && (
        <>
          <div className="tp-row">
            <span className="tp-label">Edge</span>
            <FaceSelector selected={false} pickActive={false} onClear={() => {}} emptyLabel="Select edge" />
          </div>
          <div className="tp-row">
            <span className="tp-label">Position</span>
            <div className="tp-input-group">
              <input
                type="number"
                value={edgeParam}
                step={0.01}
                min={0}
                max={1}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (Number.isFinite(value)) setEdgeParam(Math.max(0, Math.min(1, value)));
                }}
                aria-label="Position along edge (0-1)"
              />
              <span className="tp-unit">t</span>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#888', padding: '0 6px 4px' }}>
            t = 0 to start of edge, t = 1 to end of edge
          </div>
        </>
      )}

      {(placement === 'single' || placement === 'multiple') && (
        <>
          <div className="tp-row">
            <span className="tp-label">Reference</span>
            <FaceSelector selected={false} pickActive={false} onClear={() => {}} emptyLabel="Select" />
          </div>
          <div className="tp-row">
            <span className="tp-label">Reference</span>
            <FaceSelector selected={false} pickActive={false} onClear={() => {}} emptyLabel="Select" />
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
