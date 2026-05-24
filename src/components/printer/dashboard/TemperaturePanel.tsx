import { Fragment, useState, useMemo, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Flame, Play, Snowflake, Square, Thermometer } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { useChamberControlStore } from '../../../store/chamberControlStore';
import { DEFAULT_DOOR_SENSOR, useDoorSensorStore } from '../../../store/doorSensorStore';
import { resolveChamberReading } from '../../../services/integrations/chamberControl';
import {
  compactPanelInputStyle as inputStyle,
} from '../../../utils/printerPanelStyles';
import { DashboardPanel } from './DashboardPanel';
import {
  heaterStateColor,
  tempBarGradient,
  useHeaterRows,
  type HeaterRow,
} from './helpers';
import { TemperatureChart } from './TemperatureChart';
import { heaterRowColor, heaterRowKey } from './temperaturePanelHelpers';

export default function TemperaturePanel() {
  const model = usePrinterStore((s) => s.model);
  const temperatureHistory = usePrinterStore((s) => s.temperatureHistory);
  const setToolTemp = usePrinterStore((s) => s.setToolTemp);
  const setBedTemp = usePrinterStore((s) => s.setBedTemp);
  const setChamberTemp = usePrinterStore((s) => s.setChamberTemp);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const chamberControl = useChamberControlStore();
  // Select the stored entry directly; calling getDoorSensor() inside the selector
  // creates a new object every run which causes an infinite re-render loop.
  const doorSensor = useDoorSensorStore((s) => activePrinterId ? s.printers[activePrinterId] : null) ?? DEFAULT_DOOR_SENSOR;
  const updateDoorSensor = useDoorSensorStore((s) => s.updateDoorSensor);
  const heaters = model.heat?.heaters ?? [];
  const rows = useHeaterRows();
  const chamberReading = useMemo(() => resolveChamberReading(model, chamberControl), [model, chamberControl]);
  const showChamberControls = chamberControl.enabled || rows.some((row) => row.kind === 'chamber') || chamberReading.source !== 'none';

  const [editingTemps, setEditingTemps] = useState<Record<string, string>>({});

  const handleTempSubmit = useCallback((row: HeaterRow, field: 'active' | 'standby') => {
    const key = `${row.index}-${field}`;
    const val = parseFloat(editingTemps[key] ?? '');
    if (Number.isNaN(val)) return;
    if (row.kind === 'bed') {
      setBedTemp(val);
    } else if (row.kind === 'chamber') {
      setChamberTemp(val);
    } else if (row.kind === 'tool' && row.toolIndex !== undefined) {
      setToolTemp(row.toolIndex, row.heaterIndexInTool ?? 0, val);
    }
    setEditingTemps((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, [editingTemps, setBedTemp, setChamberTemp, setToolTemp]);

  const updateChamberControl = chamberControl.updateChamberControl;
  const targetInput = editingTemps.chamberTarget ?? chamberControl.targetTemperatureC.toString();
  const rampStartInput = editingTemps.chamberRampStart ?? chamberControl.rampStartTemperatureC.toString();
  const rampStepInput = editingTemps.chamberRampStep ?? chamberControl.rampStepC.toString();
  const rampMinutesInput = editingTemps.chamberRampMinutes ?? chamberControl.rampStepMinutes.toString();

  const commitChamberNumber = useCallback((
    key: string,
    fallback: number,
    onValue: (value: number) => void,
  ) => {
    const raw = editingTemps[key];
    if (raw !== undefined && raw.trim() === '') {
      setEditingTemps((prev) => { const next = { ...prev }; delete next[key]; return next; });
      return;
    }
    const value = Number(raw ?? fallback);
    if (Number.isFinite(value)) onValue(value);
    setEditingTemps((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }, [editingTemps]);

  const applyChamberTarget = useCallback(() => {
    commitChamberNumber('chamberTarget', chamberControl.targetTemperatureC, (value) => {
      updateChamberControl({ targetTemperatureC: value });
      void setChamberTemp(value);
    });
  }, [chamberControl.targetTemperatureC, commitChamberNumber, setChamberTemp, updateChamberControl]);

  const coolDownChamber = useCallback(() => {
    chamberControl.stopRamp();
    updateChamberControl({ targetTemperatureC: 0 });
    void setChamberTemp(0);
  }, [chamberControl, setChamberTemp, updateChamberControl]);

  return (
    <DashboardPanel icon={Thermometer} title="Temperatures">

      <div className="duet-dash-heater-grid">
        <span className="duet-dash-heater-col">Heater</span>
        <span className="duet-dash-heater-col">Current</span>
        <span className="duet-dash-heater-col">Active</span>
        <span className="duet-dash-heater-col">Standby</span>
        <span className="duet-dash-heater-col">Bar</span>
        <span className="duet-dash-heater-col">State</span>

        {rows.map((row) => {
          const h = heaters[row.index];
          if (!h) return null;
          const current = h.current;
          const activeKey = `${row.index}-active`;
          const standbyKey = `${row.index}-standby`;
          const barPct = Math.min(100, Math.max(0, (current / 300) * 100));

          return (
            <Fragment key={heaterRowKey(row)}>
              <span
                className="duet-dash-heater-label"
                style={{ '--duet-heater-color': heaterRowColor(row) } as CSSProperties}
              >
                {row.label}
              </span>
              <span className="duet-dash-heater-current">{current.toFixed(1)}&deg;C</span>

              <input
                style={inputStyle(70)}
                type="number"
                step={1}
                value={editingTemps[activeKey] ?? h.active.toString()}
                onChange={(e) => setEditingTemps((p) => ({ ...p, [activeKey]: e.target.value }))}
                onBlur={() => handleTempSubmit(row, 'active')}
                onKeyDown={(e) => { if (e.key === 'Enter') handleTempSubmit(row, 'active'); }}
              />

              <input
                style={inputStyle(70)}
                type="number"
                step={1}
                value={editingTemps[standbyKey] ?? h.standby.toString()}
                onChange={(e) => setEditingTemps((p) => ({ ...p, [standbyKey]: e.target.value }))}
                onBlur={() => handleTempSubmit(row, 'standby')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseFloat(editingTemps[standbyKey] ?? '');
                    if (!Number.isNaN(val) && row.kind === 'tool' && row.toolIndex !== undefined) {
                      usePrinterStore.getState().sendGCode(`G10 P${row.toolIndex} R${val}`);
                    }
                    setEditingTemps((prev) => { const n = { ...prev }; delete n[standbyKey]; return n; });
                  }
                }}
              />

              <div className="duet-dash-tempbar-wrap">
                <div style={{
                  height: '100%', width: `${barPct}%`, borderRadius: 4,
                  background: tempBarGradient(current),
                  transition: 'width 0.3s ease',
                }} />
              </div>

              <div
                className="duet-dash-heater-state"
                style={{
                  '--duet-heater-state': heaterStateColor(h.state),
                  '--duet-heater-glow': h.state !== 'off' ? `0 0 6px ${heaterStateColor(h.state)}` : 'none',
                } as CSSProperties}
                title={h.state}
              />
            </Fragment>
          );
        })}
      </div>

      {showChamberControls && (
        <div className="duet-dash-chamber">
          <div className="duet-dash-chamber__header">
            <div>
              <span>Chamber</span>
              <strong>
                {chamberReading.temperatureC !== null ? `${chamberReading.temperatureC.toFixed(1)}C` : '--'}
              </strong>
            </div>
            <label className="duet-dash-toggle">
              <input
                type="checkbox"
                checked={chamberControl.enabled}
                onChange={(event) => updateChamberControl({ enabled: event.target.checked })}
              />
              <span>Control</span>
            </label>
          </div>

          <div className="duet-dash-chamber__grid">
            <label>
              <span>Source</span>
              <select
                value={chamberControl.source}
                onChange={(event) => updateChamberControl({ source: event.target.value as typeof chamberControl.source })}
              >
                <option value="auto">Auto</option>
                <option value="rrf">RRF heater</option>
                <option value="klipper">Klipper sensor</option>
                <option value="mqtt">MQTT topic</option>
              </select>
            </label>
            <label>
              <span>MQTT topic</span>
              <input
                value={chamberControl.mqttTopic}
                onChange={(event) => updateChamberControl({ mqttTopic: event.target.value })}
                placeholder="shop/printer/chamber"
              />
            </label>
            <label>
              <span>Target</span>
              <input
                type="number"
                step={1}
                value={targetInput}
                onChange={(event) => setEditingTemps((prev) => ({ ...prev, chamberTarget: event.target.value }))}
                onBlur={() => commitChamberNumber('chamberTarget', chamberControl.targetTemperatureC, (value) => updateChamberControl({ targetTemperatureC: value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') applyChamberTarget(); }}
              />
            </label>
            <button className="duet-dash-chamber__button" type="button" onClick={applyChamberTarget}>
              <Flame size={13} /> Apply
            </button>
          </div>

          <div className="duet-dash-chamber__grid duet-dash-chamber__grid--ramp">
            <label>
              <span>Ramp start</span>
              <input
                type="number"
                step={1}
                value={rampStartInput}
                onChange={(event) => setEditingTemps((prev) => ({ ...prev, chamberRampStart: event.target.value }))}
                onBlur={() => commitChamberNumber('chamberRampStart', chamberControl.rampStartTemperatureC, (value) => updateChamberControl({ rampStartTemperatureC: value }))}
              />
            </label>
            <label>
              <span>Step C</span>
              <input
                type="number"
                step={1}
                value={rampStepInput}
                onChange={(event) => setEditingTemps((prev) => ({ ...prev, chamberRampStep: event.target.value }))}
                onBlur={() => commitChamberNumber('chamberRampStep', chamberControl.rampStepC, (value) => updateChamberControl({ rampStepC: value }))}
              />
            </label>
            <label>
              <span>Step min</span>
              <input
                type="number"
                step={1}
                value={rampMinutesInput}
                onChange={(event) => setEditingTemps((prev) => ({ ...prev, chamberRampMinutes: event.target.value }))}
                onBlur={() => commitChamberNumber('chamberRampMinutes', chamberControl.rampStepMinutes, (value) => updateChamberControl({ rampStepMinutes: value }))}
              />
            </label>
            <button
              className="duet-dash-chamber__button"
              type="button"
              onClick={() => chamberControl.rampActive ? chamberControl.stopRamp() : chamberControl.startRamp()}
            >
              {chamberControl.rampActive ? <Square size={13} /> : <Play size={13} />}
              {chamberControl.rampActive ? 'Stop' : 'Ramp'}
            </button>
          </div>

          <div className="duet-dash-chamber__policies">
            <span title={chamberReading.label}>{chamberReading.label}</span>
            <label><input type="checkbox" checked={chamberControl.preheatBeforePrint} onChange={(event) => updateChamberControl({ preheatBeforePrint: event.target.checked })} /> Preheat</label>
            <label><input type="checkbox" checked={chamberControl.cooldownOnDone} onChange={(event) => updateChamberControl({ cooldownOnDone: event.target.checked })} /> Cooldown done</label>
            <label><input type="checkbox" checked={chamberControl.cooldownOnDoorOpen} onChange={(event) => updateChamberControl({ cooldownOnDoorOpen: event.target.checked })} /> Door safety</label>
            <label><input type="checkbox" checked={doorSensor.isOpen} onChange={(event) => {
              if (!activePrinterId) return;
              updateDoorSensor(activePrinterId, { isOpen: event.target.checked, updatedAt: Date.now() });
              updateChamberControl({ doorOpen: event.target.checked });
            }} /> Door open</label>
            <button className="duet-dash-chamber__cool" type="button" onClick={coolDownChamber}>
              <Snowflake size={13} /> Cool
            </button>
          </div>

          {activePrinterId && (
            <div className="duet-dash-door">
              <label>
                <span>Door source</span>
                <select
                  value={doorSensor.source}
                  onChange={(event) => updateDoorSensor(activePrinterId, { source: event.target.value as typeof doorSensor.source })}
                >
                  <option value="manual">Manual</option>
                  <option value="rrf">RRF GPIO</option>
                  <option value="klipper">Klipper GPIO</option>
                  <option value="mqtt">MQTT reed switch</option>
                </select>
              </label>
              <label>
                <span>Door topic</span>
                <input
                  value={doorSensor.mqttTopic}
                  onChange={(event) => updateDoorSensor(activePrinterId, { mqttTopic: event.target.value })}
                  placeholder="shop/printer/door"
                />
              </label>
              <label><input type="checkbox" checked={doorSensor.enabled} onChange={(event) => updateDoorSensor(activePrinterId, { enabled: event.target.checked })} /> Monitor</label>
              <label><input type="checkbox" checked={doorSensor.pauseOnOpen} onChange={(event) => updateDoorSensor(activePrinterId, { pauseOnOpen: event.target.checked })} /> Pause on open</label>
              <label><input type="checkbox" checked={doorSensor.preventPrintStart} onChange={(event) => updateDoorSensor(activePrinterId, { preventPrintStart: event.target.checked })} /> Start lock</label>
            </div>
          )}
        </div>
      )}

      <TemperatureChart rows={rows} temperatureHistory={temperatureHistory} heaters={heaters} />
    </DashboardPanel>
  );
}
