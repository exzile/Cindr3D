import { useState, useCallback } from 'react';
import { Activity } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  compactPanelInputStyle as inputStyle,
  dashboardButtonStyle as btnStyle,
} from '../../../utils/printerPanelStyles';
import { DashboardPanel } from './DashboardPanel';

export default function PressureAdvancePanel() {
  const model = usePrinterStore((s) => s.model);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const extruders = model.move?.extruders ?? [];

  // Local editing state keyed by extruder index
  const [editing, setEditing] = useState<Record<number, string>>({});

  const applyPressureAdvance = useCallback(
    (index: number) => {
      const key = index;
      const raw = editing[key];
      if (raw === undefined) return;
      const value = parseFloat(raw);
      if (isNaN(value) || value < 0) return;
      sendGCode(`M572 D${index} S${value}`);
      setEditing((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [editing, sendGCode],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === 'Enter') {
        applyPressureAdvance(index);
      }
    },
    [applyPressureAdvance],
  );

  if (extruders.length === 0) return null;

  return (
    <DashboardPanel icon={Activity} title="Pressure Advance">

      {extruders.map((ext, i) => {
        const currentValue = ext.pressure ?? 0;
        const displayValue =
          editing[i] !== undefined ? editing[i] : currentValue.toFixed(3);

        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: i < extruders.length - 1 ? 8 : 0,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: COLORS.textDim,
                minWidth: 24,
                fontWeight: 600,
              }}
            >
              D{i}
            </span>
            <input
              type="number"
              step={0.005}
              min={0}
              style={inputStyle(80)}
              value={displayValue}
              onChange={(e) =>
                setEditing((prev) => ({ ...prev, [i]: e.target.value }))
              }
              onBlur={() => applyPressureAdvance(i)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              title={`Pressure advance for extruder ${i}`}
            />
            <span style={{ fontSize: 10, color: COLORS.textDim }}>s</span>
            <button
              style={btnStyle('accent', true)}
              onClick={() => applyPressureAdvance(i)}
              title={`Send M572 D${i} S${displayValue}`}
            >
              Set
            </button>
          </div>
        );
      })}
    </DashboardPanel>
  );
}
