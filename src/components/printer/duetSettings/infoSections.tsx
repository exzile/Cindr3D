import React from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Cpu,
  Gauge,
  Home,
  Info,
  RefreshCw,
  Thermometer,
  Zap,
} from 'lucide-react';
import type { ImportResult } from '../../../utils/settingsExport';
import type { DuetBoard, PrinterBoardType } from '../../../types/duet';
import type { DuetPrefs, KinematicsType, MachineConfig } from '../../../types/duet-prefs.types';
import { SettingRow, ToggleRow } from './common';
import { usePrinterStore } from '../../../store/printerStore';

interface AxisInfo {
  acceleration?: number;
  homed?: boolean;
  jerk?: number;
  letter?: string;
  machinePosition?: number;
  max?: number;
  min?: number;
  speed?: number;
}

const KINEMATICS_OPTIONS: { value: KinematicsType; label: string }[] = [
  { value: 'cartesian', label: 'Cartesian' },
  { value: 'corexy', label: 'CoreXY' },
  { value: 'delta', label: 'Delta' },
  { value: 'other', label: 'Other' },
];

function NumberInput({ value, onChange, min, step, unit, disabled }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        className="duet-settings__input"
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min ?? 0}
        step={step ?? 1}
        style={{ width: 90 }}
        disabled={disabled}
      />
      {unit && <span className="duet-settings__dim-text">{unit}</span>}
    </div>
  );
}

function MachineConfigForm({ mc, onChange }: {
  mc: MachineConfig;
  onChange: (patch: Partial<MachineConfig>) => void;
}) {
  return (
    <>
      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Build Volume</div>
        <SettingRow label="X" hint="Width" control={<NumberInput value={mc.buildVolumeX} onChange={(v) => onChange({ buildVolumeX: v })} unit="mm" />} />
        <SettingRow label="Y" hint="Depth" control={<NumberInput value={mc.buildVolumeY} onChange={(v) => onChange({ buildVolumeY: v })} unit="mm" />} />
        <SettingRow label="Z" hint="Height" control={<NumberInput value={mc.buildVolumeZ} onChange={(v) => onChange({ buildVolumeZ: v })} unit="mm" />} />
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Extruder &amp; Bed</div>
        <SettingRow label="Nozzle Diameter" hint="Installed nozzle size" control={<NumberInput value={mc.nozzleDiameter} onChange={(v) => onChange({ nozzleDiameter: v })} step={0.05} unit="mm" />} />
        <SettingRow label="Extruder Count" hint="Number of extruders" control={<NumberInput value={mc.extruderCount} onChange={(v) => onChange({ extruderCount: v })} min={1} />} />
        <ToggleRow id="mc-heated-bed" label="Heated Bed" hint="Printer has a heated print bed" checked={mc.hasHeatedBed} onChange={(v) => onChange({ hasHeatedBed: v })} />
        <ToggleRow id="mc-heated-chamber" label="Heated Chamber" hint="Printer has an enclosed heated chamber" checked={mc.hasHeatedChamber} onChange={(v) => onChange({ hasHeatedChamber: v })} />
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Kinematics</div>
        <SettingRow
          label="Type"
          hint="Motion system type"
          control={
            <select className="duet-settings__select" value={mc.kinematics} onChange={(e) => onChange({ kinematics: e.target.value as KinematicsType })}>
              {KINEMATICS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          }
        />
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Max Feed Rates</div>
        <SettingRow label="X" hint="Maximum X speed" control={<NumberInput value={mc.maxFeedRateX} onChange={(v) => onChange({ maxFeedRateX: v })} unit="mm/s" />} />
        <SettingRow label="Y" hint="Maximum Y speed" control={<NumberInput value={mc.maxFeedRateY} onChange={(v) => onChange({ maxFeedRateY: v })} unit="mm/s" />} />
        <SettingRow label="Z" hint="Maximum Z speed" control={<NumberInput value={mc.maxFeedRateZ} onChange={(v) => onChange({ maxFeedRateZ: v })} unit="mm/s" />} />
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Max Acceleration</div>
        <SettingRow label="X" hint="Maximum X acceleration" control={<NumberInput value={mc.maxAccelX} onChange={(v) => onChange({ maxAccelX: v })} unit="mm/s²" />} />
        <SettingRow label="Y" hint="Maximum Y acceleration" control={<NumberInput value={mc.maxAccelY} onChange={(v) => onChange({ maxAccelY: v })} unit="mm/s²" />} />
        <SettingRow label="Z" hint="Maximum Z acceleration" control={<NumberInput value={mc.maxAccelZ} onChange={(v) => onChange({ maxAccelZ: v })} unit="mm/s²" />} />
      </div>
    </>
  );
}

function LiveBoardInfo({ board, connected }: { board?: DuetBoard; connected: boolean }) {
  const mcuOk = board?.mcuTemp?.current !== undefined && board.mcuTemp.current < 70;
  const vinOk = board?.vIn?.current !== undefined && board.vIn.current >= 22 && board.vIn.current <= 26;

  return (
    <div className="ds-machine-hero">
      <div className="ds-machine-hero-head">
        <div className="ds-machine-hero-icon"><Cpu size={22} /></div>
        <div className="ds-machine-hero-title">
          <div className="ds-machine-hero-name">
            {board?.name ?? board?.shortName ?? (connected ? 'Unknown board' : 'Not connected')}
          </div>
          <div className="ds-machine-hero-fw">
            {board ? (
              <>
                <span>{board.firmwareName} <strong>{board.firmwareVersion}</strong></span>
                {board.firmwareDate && <span className="ds-machine-hero-date"> · {board.firmwareDate}</span>}
              </>
            ) : (
              <span className="duet-settings__dim-text">No firmware information</span>
            )}
          </div>
        </div>
        <span className={`ds-status-pill ds-status-pill--${connected ? 'ok' : 'off'}`}>
          <span className="ds-status-dot" />
          {connected ? 'online' : 'offline'}
        </span>
      </div>

      <div className="ds-metric-grid">
        {board?.mcuTemp?.current !== undefined && (
          <div className={`ds-metric${mcuOk ? '' : ' ds-metric--warn'}`}>
            <div className="ds-metric-icon"><Thermometer size={14} /></div>
            <div className="ds-metric-body">
              <div className="ds-metric-label">MCU Temp</div>
              <div className="ds-metric-value">{board.mcuTemp.current.toFixed(1)}<small>°C</small></div>
            </div>
          </div>
        )}
        {board?.vIn?.current !== undefined && (
          <div className={`ds-metric${vinOk ? '' : ' ds-metric--warn'}`}>
            <div className="ds-metric-icon"><Zap size={14} /></div>
            <div className="ds-metric-body">
              <div className="ds-metric-label">VIN</div>
              <div className="ds-metric-value">{board.vIn.current.toFixed(1)}<small>V</small></div>
            </div>
          </div>
        )}
        {board?.v12?.current !== undefined && (
          <div className="ds-metric">
            <div className="ds-metric-icon"><Zap size={14} /></div>
            <div className="ds-metric-body">
              <div className="ds-metric-label">12V Rail</div>
              <div className="ds-metric-value">{board.v12.current.toFixed(1)}<small>V</small></div>
            </div>
          </div>
        )}
        {board?.maxMotors !== undefined && (
          <div className="ds-metric">
            <div className="ds-metric-icon"><Activity size={14} /></div>
            <div className="ds-metric-body">
              <div className="ds-metric-label">Max Motors</div>
              <div className="ds-metric-value">{board.maxMotors}</div>
            </div>
          </div>
        )}
        {board?.maxHeaters !== undefined && (
          <div className="ds-metric">
            <div className="ds-metric-icon"><Thermometer size={14} /></div>
            <div className="ds-metric-body">
              <div className="ds-metric-label">Max Heaters</div>
              <div className="ds-metric-value">{board.maxHeaters}</div>
            </div>
          </div>
        )}
        {board?.canAddress !== undefined && (
          <div className="ds-metric">
            <div className="ds-metric-icon"><Activity size={14} /></div>
            <div className="ds-metric-body">
              <div className="ds-metric-label">CAN Address</div>
              <div className="ds-metric-value">{board.canAddress}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LiveAxesSection({ axes }: { axes: AxisInfo[] }) {
  return (
    <div className="duet-settings__section">
      <div className="duet-settings__section-title ds-section-title-row">
        <Home size={14} /> Axes &amp; Motion (live)
        {axes.length > 0 && <span className="ds-section-count">{axes.length}</span>}
      </div>
      {axes.length === 0 ? (
        <div className="ds-empty-hint">No axes reported.</div>
      ) : (
        <div className="ds-axes-grid">
          {axes.map((axis, index) => {
            const min = axis.min ?? 0;
            const max = axis.max ?? 0;
            const range = max - min;
            const position = axis.machinePosition ?? min;
            const percent = range > 0 ? Math.max(0, Math.min(100, ((position - min) / range) * 100)) : 0;
            return (
              <div key={index} className="ds-axis-card">
                <div className="ds-axis-head">
                  <span className="ds-axis-letter">{axis.letter ?? `#${index}`}</span>
                  <span className={`ds-status-pill ds-status-pill--${axis.homed ? 'ok' : 'warn'} ds-status-pill--sm`}>
                    <Home size={9} /> {axis.homed ? 'homed' : 'not homed'}
                  </span>
                </div>
                <div className="ds-axis-range">
                  <div className="ds-axis-range-bar">
                    <div className="ds-axis-range-fill" style={{ width: `${percent}%` }} />
                    <div className="ds-axis-range-marker" style={{ left: `${percent}%` }} />
                  </div>
                  <div className="ds-axis-range-labels">
                    <span>{min.toFixed(0)}</span>
                    <span className="ds-axis-range-current">{position.toFixed(1)} mm</span>
                    <span>{max.toFixed(0)}</span>
                  </div>
                </div>
                <div className="ds-axis-stats">
                  <div className="ds-axis-stat">
                    <Gauge size={10} />
                    <span className="ds-axis-stat-label">Speed</span>
                    <span className="ds-axis-stat-value">{axis.speed?.toFixed(0) ?? '—'}<small> mm/s</small></span>
                  </div>
                  <div className="ds-axis-stat">
                    <Activity size={10} />
                    <span className="ds-axis-stat-label">Accel</span>
                    <span className="ds-axis-stat-value">{axis.acceleration?.toFixed(0) ?? '—'}<small> mm/s²</small></span>
                  </div>
                  <div className="ds-axis-stat">
                    <Zap size={10} />
                    <span className="ds-axis-stat-label">Jerk</span>
                    <span className="ds-axis-stat-value">{axis.jerk?.toFixed(0) ?? '—'}<small> mm/s</small></span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Map a firmware kinematics name to our persisted KinematicsType. */
function mapKinematics(name: string): KinematicsType {
  const n = name.toLowerCase();
  if (n === 'cartesian') return 'cartesian';
  if (n.startsWith('corexy') || n === 'corexy') return 'corexy';
  if (n === 'delta') return 'delta';
  return 'other';
}

export function MachineSection({
  axes,
  board,
  boardType,
  connected,
  prefs,
  patchPrefs,
}: {
  axes: AxisInfo[];
  board?: DuetBoard;
  boardType: PrinterBoardType;
  connected: boolean;
  prefs: DuetPrefs;
  patchPrefs: (patch: Partial<DuetPrefs>) => void;
}) {
  // Read the full live model directly — avoids threading many more props.
  const model = usePrinterStore((s) => s.model);

  const mc = prefs.machineConfig;
  const patchMc = (patch: Partial<MachineConfig>) => {
    patchPrefs({ machineConfig: { ...mc, ...patch } });
  };

  // Derive sync readiness from live model.
  const xAxis = axes.find((a) => a.letter === 'X') ?? axes[0];
  const yAxis = axes.find((a) => a.letter === 'Y') ?? axes[1];
  const zAxis = axes.find((a) => a.letter === 'Z') ?? axes[2];
  const canSync = connected && (xAxis?.max ?? 0) > 10 && (yAxis?.max ?? 0) > 10;

  const handleSyncAll = canSync
    ? () => {
        const move  = model.move;
        const heat  = model.heat;
        const patch: Partial<MachineConfig> = {};

        // ── Build volume ────────────────────────────────────────────
        patch.buildVolumeX = Math.round((xAxis!.max ?? 0) - (xAxis!.min ?? 0));
        patch.buildVolumeY = Math.round((yAxis!.max ?? 0) - (yAxis!.min ?? 0));
        if (zAxis && (zAxis.max ?? 0) > 0) {
          patch.buildVolumeZ = Math.round((zAxis.max ?? 0) - (zAxis.min ?? 0));
        }

        // ── Max feed rates (mm/s) ────────────────────────────────────
        if ((xAxis!.speed ?? 0) > 0) patch.maxFeedRateX = Math.round(xAxis!.speed!);
        if ((yAxis!.speed ?? 0) > 0) patch.maxFeedRateY = Math.round(yAxis!.speed!);
        if (zAxis && (zAxis.speed ?? 0) > 0) patch.maxFeedRateZ = Math.round(zAxis.speed!);

        // ── Max acceleration (mm/s²) ─────────────────────────────────
        if ((xAxis!.acceleration ?? 0) > 0) patch.maxAccelX = Math.round(xAxis!.acceleration!);
        if ((yAxis!.acceleration ?? 0) > 0) patch.maxAccelY = Math.round(yAxis!.acceleration!);
        if (zAxis && (zAxis.acceleration ?? 0) > 0) patch.maxAccelZ = Math.round(zAxis.acceleration!);

        // ── Kinematics ───────────────────────────────────────────────
        const kinName = move?.kinematics?.name;
        if (kinName) patch.kinematics = mapKinematics(kinName);

        // ── Extruder count ───────────────────────────────────────────
        const extruderCount = move?.extruders?.length ?? 0;
        if (extruderCount > 0) patch.extruderCount = extruderCount;

        // ── Heated bed / chamber ─────────────────────────────────────
        if (heat) {
          patch.hasHeatedBed     = (heat.bedHeaters     ?? []).some((h) => h >= 0);
          patch.hasHeatedChamber = (heat.chamberHeaters ?? []).some((h) => h >= 0);
        }

        patchMc(patch);
      }
    : undefined;

  return (
    <>
      <div className="duet-settings__page-title ds-machine-title-row">
        Machine
        {handleSyncAll && (
          <button
            className="duet-settings__btn duet-settings__btn--xs ds-sync-btn"
            onClick={handleSyncAll}
            title="Read all machine parameters from the connected firmware and populate the fields below"
          >
            <RefreshCw size={11} />
            Sync from Machine
          </button>
        )}
      </div>

      {connected && <LiveBoardInfo board={board} connected={connected} />}
      {connected && axes.length > 0 && <LiveAxesSection axes={axes} />}

      {!connected && (
        <div className="duet-settings__banner duet-settings__banner--info">
          <Info size={16} /> {boardType === 'duet'
            ? 'Connect to populate settings from your board, or enter them manually below.'
            : 'Enter your machine settings below. These will be used for visualization and slicing.'}
        </div>
      )}

      {connected && (
        <div className="duet-settings__banner duet-settings__banner--success" style={{ marginTop: 8 }}>
          <Info size={16} /> Live values shown above. You can override manual settings below for use when offline.
        </div>
      )}

      <MachineConfigForm mc={mc} onChange={patchMc} />
    </>
  );
}

export function BackupSection({
  downloadSettings,
  handleImport,
  importInputRef,
  importResult,
  importing,
}: {
  downloadSettings: () => void;
  handleImport: React.ChangeEventHandler<HTMLInputElement>;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  importResult: ImportResult | null;
  importing: boolean;
}) {
  return (
    <>
      <div className="duet-settings__page-title">Backup &amp; Restore</div>
      <p className="duet-settings__about-text">
        Export all your workspace preferences to a <code>.json</code> file and import them on any device or browser - even after clearing site data. Model geometry and plate objects are <strong>not</strong> included; use the <em>Save (.dzn)</em> button for those.
      </p>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">What is exported</div>
        <ul className="duet-settings__about-text" style={{ paddingLeft: 18, margin: 0 }}>
          <li>Design workspace - grid, units, visual style, viewport layout, tolerances</li>
          <li>Prepare workspace - all slicer profiles (printer, material, print) &amp; active selections</li>
          <li>3D Print workspace - printer connection config &amp; all UI preferences</li>
          <li>Theme (light / dark)</li>
        </ul>
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Export</div>
        <button className="duet-settings__btn duet-settings__btn--primary" onClick={downloadSettings} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={14} /> Download settings file
        </button>
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Import</div>
        <input ref={importInputRef} type="file" accept=".json,application/json" hidden onChange={handleImport} />
        <button className="duet-settings__btn duet-settings__btn--secondary" onClick={() => importInputRef.current?.click()} disabled={importing} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {importing ? <Zap size={14} className="spin" /> : <CheckCircle size={14} />}
          {importing ? 'Importing...' : 'Choose settings file...'}
        </button>

        {importResult && (
          <div className={`duet-settings__banner duet-settings__banner--${importResult.ok ? 'success' : 'error'}`} style={{ marginTop: 12 }}>
            {importResult.ok ? (
              <>
                <CheckCircle size={14} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Import successful</strong>
                  <div style={{ marginTop: 4, fontSize: 12 }}>Applied: {importResult.appliedSections.join(', ')}</div>
                  {importResult.warnings.map((warning, index) => (
                    <div key={index} style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
                      {warning}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <div><strong>Import failed</strong> - {importResult.error}</div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function AboutSection({ board }: { board?: DuetBoard }) {
  return (
    <>
      <div className="duet-settings__page-title">About</div>
      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Cindr3D - Printer Panel</div>
        <p className="duet-settings__about-text">
          Supports Duet3D (RepRapFirmware), Klipper (via Moonraker), Marlin (via OctoPrint or serial), Smoothieware, grbl, Repetier, and other G-code-based 3D printer controllers. Duet boards support both standalone and SBC (DuetSoftwareFramework) modes.
        </p>
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Firmware</div>
        {board ? (
          <div className="duet-settings__info-grid">
            <span className="duet-settings__dim-text">Board</span>
            <span className="duet-settings__mono">{board.name ?? board.shortName ?? '—'}</span>
            <span className="duet-settings__dim-text">Firmware</span>
            <span className="duet-settings__mono">{board.firmwareName} {board.firmwareVersion}</span>
            {board.firmwareDate && (
              <>
                <span className="duet-settings__dim-text">Build date</span>
                <span className="duet-settings__mono">{board.firmwareDate}</span>
              </>
            )}
          </div>
        ) : (
          <div className="duet-settings__dim-text">Not connected.</div>
        )}
      </div>
    </>
  );
}
