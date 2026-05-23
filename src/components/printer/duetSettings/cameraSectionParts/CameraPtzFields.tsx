import type { CameraPtzProvider } from "../../../../utils/duetPrefs";
import { SettingRow } from "../common";
import type { SetSaved } from "./types";

interface CameraPtzFieldsProps {
  draftPtzEnabled: boolean;
  draftPtzMoveUrlTemplate: string;
  draftPtzPresetUrlTemplate: string;
  draftPtzProvider: CameraPtzProvider;
  setDraftPtzMoveUrlTemplate: (value: string) => void;
  setDraftPtzPresetUrlTemplate: (value: string) => void;
  setDraftPtzProvider: (value: CameraPtzProvider) => void;
  setSaved: SetSaved;
}

export function CameraPtzFields({
  draftPtzEnabled,
  draftPtzMoveUrlTemplate,
  draftPtzPresetUrlTemplate,
  draftPtzProvider,
  setDraftPtzMoveUrlTemplate,
  setDraftPtzPresetUrlTemplate,
  setDraftPtzProvider,
  setSaved,
}: CameraPtzFieldsProps) {
  if (!draftPtzEnabled) return null;

  return (
    <>
      <SettingRow
        label="PTZ Provider"
        hint="Amcrest and Reolink have built-in HTTP commands. ONVIF, Tapo, Hikvision, and generic cameras can use local bridge/template URLs."
        control={
          <select
            className="duet-settings__select"
            value={draftPtzProvider}
            onChange={(event) => {
              setDraftPtzProvider(event.target.value as CameraPtzProvider);
              setSaved(false);
            }}
          >
            <option value="generic-http">Generic HTTP template</option>
            <option value="amcrest">Amcrest / Dahua</option>
            <option value="reolink">Reolink</option>
            <option value="tapo">Tapo bridge/template</option>
            <option value="hikvision">Hikvision bridge/template</option>
            <option value="onvif">ONVIF bridge/template</option>
          </select>
        }
      />
      <SettingRow
        label="PTZ Move Template"
        hint="Optional URL template. Tokens: {base}, {direction}, {speed}, {action}, {username}, {password}. Leave blank for built-in Amcrest/Reolink."
        control={
          <input
            className="duet-settings__input"
            type="text"
            value={draftPtzMoveUrlTemplate}
            onChange={(event) => {
              setDraftPtzMoveUrlTemplate(event.target.value);
              setSaved(false);
            }}
            placeholder="{base}/ptz?move={direction}&speed={speed}&action={action}"
          />
        }
      />
      <SettingRow
        label="PTZ Preset Template"
        hint="Optional URL template for saved preset slots. Tokens: {base}, {preset}, {presetName}, {username}, {password}."
        control={
          <input
            className="duet-settings__input"
            type="text"
            value={draftPtzPresetUrlTemplate}
            onChange={(event) => {
              setDraftPtzPresetUrlTemplate(event.target.value);
              setSaved(false);
            }}
            placeholder="{base}/ptz?preset={preset}"
          />
        }
      />
    </>
  );
}
