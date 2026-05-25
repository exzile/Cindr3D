import { useCADStore } from "../../../../store/cadStore";
import type { FilletMode } from "./types";
import type { FilletDialogState } from "./useFilletDialogState";
import { NumberInput } from "../edgeDialog/NumberInput";

interface FilletModeFieldsProps {
  dialog: FilletDialogState;
}

function FullRoundFacePickerRow({
  slot,
  label,
  faceId,
  isActive,
  onActivate,
  onClear,
}: {
  slot: 'center' | 'side1' | 'side2';
  label: string;
  faceId: string | null;
  isActive: boolean;
  onActivate: () => void;
  onClear: () => void;
}) {
  void slot;
  return (
    <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ flex: 1, fontSize: 12 }}>{label}</span>
      {faceId ? (
        <>
          <span style={{ fontSize: 11, color: '#4caf50' }}>&#10003; Picked</span>
          <button type="button" className="tp-btn-secondary" style={{ padding: '2px 6px', fontSize: 11 }} onClick={onClear}>
            Clear
          </button>
        </>
      ) : (
        <button
          type="button"
          className={isActive ? 'tp-btn-primary' : 'tp-btn-secondary'}
          style={{ padding: '2px 8px', fontSize: 11 }}
          onClick={onActivate}
        >
          {isActive ? 'Click a face...' : 'Pick'}
        </button>
      )}
    </div>
  );
}

export function FilletModeFields({ dialog }: FilletModeFieldsProps) {
  const filletFullRoundCenterFaceId = useCADStore((s) => s.filletFullRoundCenterFaceId);
  const filletFullRoundSide1FaceId = useCADStore((s) => s.filletFullRoundSide1FaceId);
  const filletFullRoundSide2FaceId = useCADStore((s) => s.filletFullRoundSide2FaceId);
  const filletFullRoundPickSlot = useCADStore((s) => s.filletFullRoundPickSlot);
  const setFilletFullRoundPickSlot = useCADStore((s) => s.setFilletFullRoundPickSlot);
  const setFilletFullRoundFace = useCADStore((s) => s.setFilletFullRoundFace);

  return (
    <>
      <div className="form-group">
        <label>Type</label>
        <select
          value={dialog.mode}
          onChange={(e) => dialog.setMode(e.target.value as FilletMode)}
        >
          <option value="constant">Constant Radius</option>
          <option value="variable">Variable Radius</option>
          <option value="chord-length">Chord Length</option>
          <option value="asymmetric">Asymmetric</option>
          <option value="full-round">Full Round</option>
        </select>
      </div>

      {dialog.mode === "full-round" && (
        <>
          <p className="dialog-hint">
            Select the center face and two adjacent side faces. The fillet radius
            is computed automatically from the boundary edge midpoints.
          </p>
          <FullRoundFacePickerRow
            slot="center"
            label="Center face"
            faceId={filletFullRoundCenterFaceId}
            isActive={filletFullRoundPickSlot === 'center'}
            onActivate={() => setFilletFullRoundPickSlot('center')}
            onClear={() => setFilletFullRoundFace('center', null, null, null)}
          />
          <FullRoundFacePickerRow
            slot="side1"
            label="Side face 1"
            faceId={filletFullRoundSide1FaceId}
            isActive={filletFullRoundPickSlot === 'side1'}
            onActivate={() => setFilletFullRoundPickSlot('side1')}
            onClear={() => setFilletFullRoundFace('side1', null, null, null)}
          />
          <FullRoundFacePickerRow
            slot="side2"
            label="Side face 2"
            faceId={filletFullRoundSide2FaceId}
            isActive={filletFullRoundPickSlot === 'side2'}
            onActivate={() => setFilletFullRoundPickSlot('side2')}
            onClear={() => setFilletFullRoundFace('side2', null, null, null)}
          />
        </>
      )}

      {dialog.mode === "constant" && (
        <NumberInput
          label="Radius (mm)"
          value={dialog.radius}
          onChange={dialog.setRadiusAndLive}
          min={0.01}
          max={500}
          step={0.5}
          fallback={2}
        />
      )}

      {dialog.mode === "variable" && (
        <div className="settings-grid">
          <NumberInput
            label="Start Radius (mm)"
            value={dialog.startRadius}
            onChange={dialog.setStartRadius}
            min={0.01}
            max={500}
            step={0.5}
            fallback={1}
          />
          <NumberInput
            label="End Radius (mm)"
            value={dialog.endRadius}
            onChange={dialog.setEndRadius}
            min={0.01}
            max={500}
            step={0.5}
            fallback={4}
          />
        </div>
      )}

      {dialog.mode === "chord-length" && (
        <div className="form-group">
          <NumberInput
            label="Chord Length (mm)"
            value={dialog.chordLength}
            onChange={dialog.setChordLength}
            min={0.01}
            max={1000}
            step={0.5}
            fallback={5}
          />
          <p className="dialog-hint" style={{ marginTop: 4 }}>
            Chord length controls the width of the fillet arc rather than its
            radius. r = chordLen / (2 cos(phi/2)) for the edge dihedral angle
            phi used by the geometry solver.
          </p>
        </div>
      )}

      {dialog.mode === "asymmetric" && (
        <>
          <div className="settings-grid">
            <NumberInput
              label="Offset 1 (mm)"
              value={dialog.offsetOne}
              onChange={dialog.setOffsetOne}
              min={0.01}
              max={500}
              step={0.5}
              fallback={2}
            />
            <NumberInput
              label="Offset 2 (mm)"
              value={dialog.offsetTwo}
              onChange={dialog.setOffsetTwo}
              min={0.01}
              max={500}
              step={0.5}
              fallback={3}
            />
          </div>
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={dialog.isFlipped}
                onChange={(e) => dialog.setIsFlipped(e.target.checked)}
              />
              Flip Faces
            </label>
          </div>
        </>
      )}
    </>
  );
}
