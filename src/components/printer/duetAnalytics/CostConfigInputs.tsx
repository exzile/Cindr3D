/**
 * CostConfigInputs — the four "what does a print cost?" numeric inputs
 * (printer draw W, electricity rate $/kWh, filament g/h, CO2 kg/kWh)
 * plus the rolling total readout. Each onChange both updates the
 * component state and mirrors to localStorage so the next page-load
 * picks the values back up.
 */
import { fmtMoney } from './helpers';

function saveNumber(key: string, value: number, setter: (next: number) => void): void {
  const next = Math.max(0, Number(value) || 0);
  setter(next);
  try { localStorage.setItem(key, String(next)); } catch { /* ignore */ }
}

export interface CostConfigInputsProps {
  printerWatts: number;
  setPrinterWatts: (v: number) => void;
  electricityRate: number;
  setElectricityRate: (v: number) => void;
  filamentGPerHour: number;
  setFilamentGPerHour: (v: number) => void;
  co2KgPerKwh: number;
  setCo2KgPerKwh: (v: number) => void;
  totalCost: number;
  windowDays: number;
}

export function CostConfigInputs(props: CostConfigInputsProps) {
  const {
    printerWatts, setPrinterWatts,
    electricityRate, setElectricityRate,
    filamentGPerHour, setFilamentGPerHour,
    co2KgPerKwh, setCo2KgPerKwh,
    totalCost, windowDays,
  } = props;

  return (
    <div className="duet-analytics__cost">
      <label>
        Printer draw
        <input
          type="number"
          min={0}
          step={10}
          value={printerWatts}
          onChange={(e) => saveNumber('cindr3d-cost-watts', Number(e.target.value), setPrinterWatts)}
        />
        <span>W</span>
      </label>
      <label>
        Rate
        <input
          type="number"
          min={0}
          step={0.01}
          value={electricityRate}
          onChange={(e) => saveNumber('cindr3d-cost-rate', Number(e.target.value), setElectricityRate)}
        />
        <span>$/kWh</span>
      </label>
      <label>
        Filament
        <input
          type="number"
          min={0}
          step={1}
          value={filamentGPerHour}
          onChange={(e) => saveNumber('cindr3d-cost-filament-gph', Number(e.target.value), setFilamentGPerHour)}
        />
        <span>g/h</span>
      </label>
      <label>
        CO2
        <input
          type="number"
          min={0}
          step={0.01}
          value={co2KgPerKwh}
          onChange={(e) => saveNumber('cindr3d-cost-co2', Number(e.target.value), setCo2KgPerKwh)}
        />
        <span>kg/kWh</span>
      </label>
      <span className="duet-analytics__cost-value">
        {fmtMoney(totalCost)} over {windowDays} days
      </span>
    </div>
  );
}
