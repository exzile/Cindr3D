import type { DateFormat, DuetPrefs, TemperatureUnit, Units } from '../../../utils/duetPrefs';
import { SettingRow } from './common';

export function GeneralSection({
  patchPrefs,
  prefs,
}: {
  patchPrefs: (patch: Partial<DuetPrefs>) => void;
  prefs: DuetPrefs;
}) {
  return (
    <>
      <div className="duet-settings__page-title">General</div>
      <SettingRow
        label="Units"
        hint="Preferred unit system for display. Individual panels may override."
        control={
          <select className="duet-settings__select" value={prefs.units} onChange={(e) => patchPrefs({ units: e.target.value as Units })}>
            <option value="metric">Metric (mm)</option>
            <option value="imperial">Imperial (in)</option>
          </select>
        }
      />
      <SettingRow
        label="Temperature Unit"
        hint="Display temperatures in Celsius or Fahrenheit."
        control={
          <select className="duet-settings__select" value={prefs.temperatureUnit} onChange={(e) => patchPrefs({ temperatureUnit: e.target.value as TemperatureUnit })}>
            <option value="C">Celsius (°C)</option>
            <option value="F">Fahrenheit (°F)</option>
          </select>
        }
      />
      <SettingRow
        label="Date Format"
        hint="Show dates as relative (e.g. '2 hours ago') or absolute (e.g. '2026-04-18 14:30')."
        control={
          <select className="duet-settings__select" value={prefs.dateFormat} onChange={(e) => patchPrefs({ dateFormat: e.target.value as DateFormat })}>
            <option value="relative">Relative</option>
            <option value="absolute">Absolute</option>
          </select>
        }
      />
      <SettingRow
        label="Language"
        hint="Additional languages are planned - English only today."
        control={
          <select className="duet-settings__select" value="en" disabled>
            <option value="en">English</option>
          </select>
        }
      />
    </>
  );
}
