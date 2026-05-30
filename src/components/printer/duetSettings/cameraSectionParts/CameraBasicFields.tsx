import type { CameraStreamRole } from "../../../../utils/duetPrefs";
import { SettingRow, ToggleRow } from "../common";
import type { SetSaved } from "./types";

interface CameraBasicFieldsProps {
  draftCameraId: string;
  draftEnabled: boolean;
  draftLabel: string;
  draftResolution: string;
  draftRole: CameraStreamRole;
  setDraftEnabled: (value: boolean) => void;
  setDraftLabel: (value: string) => void;
  setDraftResolution: (value: string) => void;
  setDraftRole: (value: CameraStreamRole) => void;
  setSaved: SetSaved;
}

export function CameraBasicFields({
  draftCameraId,
  draftEnabled,
  draftLabel,
  draftResolution,
  draftRole,
  setDraftEnabled,
  setDraftLabel,
  setDraftResolution,
  setDraftRole,
  setSaved,
}: CameraBasicFieldsProps) {
  return (
    <>
      <SettingRow
        label="Camera Label"
        hint="Name shown in camera tabs and dashboard selectors."
        control={
          <input
            className="duet-settings__input"
            type="text"
            value={draftLabel}
            onChange={(event) => {
              setDraftLabel(event.target.value);
              setSaved(false);
            }}
            placeholder="Top, side, nozzle, custom"
          />
        }
      />

      <SettingRow
        label="Camera Role"
        hint="Use roles to organize common farm camera positions."
        control={
          <select
            className="duet-settings__select"
            value={draftRole}
            onChange={(event) => {
              setDraftRole(event.target.value as CameraStreamRole);
              setSaved(false);
            }}
          >
            <option value="top">Top</option>
            <option value="side">Side</option>
            <option value="nozzle">Nozzle</option>
            <option value="custom">Custom</option>
          </select>
        }
      />

      <SettingRow
        label="Resolution"
        hint="Informational resolution label used by dashboard cards."
        control={
          <select
            className="duet-settings__select"
            value={draftResolution}
            onChange={(event) => {
              setDraftResolution(event.target.value);
              setSaved(false);
            }}
          >
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="1440p">1440p</option>
            <option value="4K">4K</option>
          </select>
        }
      />

      <ToggleRow
        id={`camera-enabled-${draftCameraId}`}
        checked={draftEnabled}
        onChange={(value) => {
          setDraftEnabled(value);
          setSaved(false);
        }}
        label="Enable this camera"
        hint="Disabled cameras stay saved but are hidden from monitoring views."
      />
    </>
  );
}
