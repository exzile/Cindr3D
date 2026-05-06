import { useState } from 'react';
import { AudioLines, Save, SlidersHorizontal, Trash2, Zap } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { useStepperTuningStore, type StepperMode } from '../../../store/stepperTuningStore';
import { buildStepperTuningCommands, buildStepperWiggleCommands } from '../../../services/integrations/stepperTuning';

const DEFAULT_AXES = ['X', 'Y', 'Z', 'E'];
const MICROSTEP_OPTIONS = [8, 16, 32, 64, 128, 256];

export default function StepperTuningPanel() {
  const model = usePrinterStore((s) => s.model);
  const config = usePrinterStore((s) => s.config);
  const connected = usePrinterStore((s) => s.connected);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const getAxisTuning = useStepperTuningStore((s) => s.getAxisTuning);
  const updateAxisTuning = useStepperTuningStore((s) => s.updateAxisTuning);
  const savePreset = useStepperTuningStore((s) => s.savePreset);
  const applyPreset = useStepperTuningStore((s) => s.applyPreset);
  const removePreset = useStepperTuningStore((s) => s.removePreset);
  const presets = useStepperTuningStore((s) => activePrinterId ? s.presets[activePrinterId] ?? [] : []);
  const [presetName, setPresetName] = useState('Quiet ABS');

  const axes = model.move?.axes?.length
    ? model.move.axes.map((axis, index) => ({ letter: axis.letter.toUpperCase(), driverIndex: axis.drives?.[0] ?? index }))
    : DEFAULT_AXES.map((letter, index) => ({ letter, driverIndex: index }));

  const sendCommands = async (commands: string[]) => {
    for (const command of commands) {
      await sendGCode(command);
    }
  };

  if (!activePrinterId) {
    return <div className="st-empty">Connect a printer before tuning stepper drivers.</div>;
  }

  return (
    <div className="st-panel">
      <div className="st-toolbar">
        <div className="st-title"><SlidersHorizontal size={14} /> Driver tuning</div>
        <div className="st-presets">
          <input value={presetName} onChange={(event) => setPresetName(event.target.value)} />
          <button type="button" onClick={() => savePreset(activePrinterId, presetName)}>
            <Save size={12} /> Save
          </button>
        </div>
      </div>

      {presets.length > 0 && (
        <div className="st-preset-row">
          {presets.map((preset) => (
            <span key={preset.id} className="st-preset">
              <button type="button" onClick={() => applyPreset(activePrinterId, preset.id)}>{preset.name}</button>
              <button type="button" title="Remove preset" onClick={() => removePreset(activePrinterId, preset.id)}>
                <Trash2 size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="st-grid">
        {axes.map(({ letter, driverIndex }) => {
          const tuning = getAxisTuning(activePrinterId, letter, driverIndex);
          const isKlipper = config.boardType === 'klipper';
          return (
            <div key={letter} className="st-axis">
              <div className="st-axis__head">
                <strong>{letter}</strong>
                <span>Driver {tuning.driverIndex}</span>
              </div>
              <label>
                <span>Current mA</span>
                <input
                  type="number"
                  value={tuning.currentMa}
                  onChange={(event) => updateAxisTuning(activePrinterId, letter, { currentMa: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Microsteps</span>
                <select
                  value={tuning.microsteps}
                  onChange={(event) => updateAxisTuning(activePrinterId, letter, { microsteps: Number(event.target.value) })}
                  disabled={isKlipper}
                  title={isKlipper ? 'Klipper microsteps are configured in printer.cfg' : undefined}
                >
                  {MICROSTEP_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                <span>Mode</span>
                <select
                  value={tuning.mode}
                  onChange={(event) => updateAxisTuning(activePrinterId, letter, { mode: event.target.value as StepperMode })}
                >
                  <option value="stealthchop">StealthChop</option>
                  <option value="spreadcycle">SpreadCycle</option>
                </select>
              </label>
              <label>
                <span>Driver index</span>
                <input
                  type="number"
                  value={tuning.driverIndex}
                  onChange={(event) => updateAxisTuning(activePrinterId, letter, { driverIndex: Number(event.target.value) })}
                />
              </label>
              <div className="st-actions">
                <button
                  type="button"
                  disabled={!connected}
                  onClick={() => void sendCommands(buildStepperTuningCommands(config.boardType, letter, tuning))}
                >
                  <Zap size={12} /> Apply
                </button>
                <button
                  type="button"
                  disabled={!connected}
                  onClick={() => void sendCommands(buildStepperWiggleCommands(letter))}
                >
                  <AudioLines size={12} /> Wiggle
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
