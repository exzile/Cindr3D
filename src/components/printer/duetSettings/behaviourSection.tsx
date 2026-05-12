import type { DuetPrefs } from '../../../utils/duetPrefs';
import { SafetyLimitsSection } from './safetySection';
import { ToggleRow } from './common';

export function BehaviourSection({
  patchPrefs,
  prefs,
}: {
  patchPrefs: (patch: Partial<DuetPrefs>) => void;
  prefs: DuetPrefs;
}) {
  return (
    <>
      <div className="duet-settings__page-title">Behaviour</div>
      <ToggleRow
        id="confirm-tool-change"
        checked={prefs.confirmToolChange}
        onChange={(value) => patchPrefs({ confirmToolChange: value })}
        label="Confirm tool changes"
        hint="Ask for confirmation before switching the active tool."
      />
      <ToggleRow
        id="silent-prompts"
        checked={prefs.silentPrompts}
        onChange={(value) => patchPrefs({ silentPrompts: value })}
        label="Silent prompts"
        hint="Suppress beeps for routine firmware message dialogs."
      />
      <ToggleRow
        id="auto-reconnect"
        checked={prefs.autoReconnect}
        onChange={(value) => patchPrefs({ autoReconnect: value })}
        label="Auto-reconnect"
        hint="Automatically reconnect on startup and when the connection drops. Configure interval and retries in the Connection tab."
      />
      <SafetyLimitsSection prefs={prefs} patchPrefs={patchPrefs} />
    </>
  );
}
