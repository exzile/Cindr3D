import { SettingRow } from "../common";
import type { SetSaved, SetTestState } from "./types";

interface CameraCredentialFieldsProps {
  draftPassword: string;
  draftUsername: string;
  setDraftPassword: (value: string) => void;
  setDraftUsername: (value: string) => void;
  setSaved: SetSaved;
  setTestState: SetTestState;
}

export function CameraCredentialFields({
  draftPassword,
  draftUsername,
  setDraftPassword,
  setDraftUsername,
  setSaved,
  setTestState,
}: CameraCredentialFieldsProps) {
  return (
    <>
      <SettingRow
        label="Camera Username"
        hint="Optional. Use this for cameras that require HTTP basic authentication."
        control={
          <input
            className="duet-settings__input"
            type="text"
            value={draftUsername}
            onChange={(event) => {
              setDraftUsername(event.target.value);
              setSaved(false);
              setTestState({ status: "idle" });
            }}
            placeholder="Camera username"
            autoComplete="off"
          />
        }
      />

      <SettingRow
        label="Camera Password"
        hint="Optional. Stored with this printer's local preferences."
        control={
          <input
            className="duet-settings__input"
            type="password"
            value={draftPassword}
            onChange={(event) => {
              setDraftPassword(event.target.value);
              setSaved(false);
              setTestState({ status: "idle" });
            }}
            placeholder="Camera password"
            autoComplete="new-password"
          />
        }
      />
    </>
  );
}
