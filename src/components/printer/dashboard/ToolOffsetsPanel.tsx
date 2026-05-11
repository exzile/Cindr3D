import { useState, useCallback } from 'react';
import { Crosshair } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  compactPanelInputStyle as inputStyle,
  dashboardButtonStyle as btnStyle,
} from '../../../utils/printerPanelStyles';
import { DashboardPanel } from './DashboardPanel';

/** Axis letters used by G10 offset commands — matches the order of DuetTool.offsets[] */
const AXIS_LETTERS = ['X', 'Y', 'Z', 'U', 'V', 'W', 'A', 'B', 'C'];

export default function ToolOffsetsPanel() {
  const model = usePrinterStore((s) => s.model);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const tools = model.tools ?? [];

  // Local editing state keyed by "t{toolNumber}-{axisIndex}"
  const [editing, setEditing] = useState<Record<string, string>>({});

  const applyOffset = useCallback(
    (toolNumber: number) => {
      const tool = (usePrinterStore.getState().model.tools ?? []).find(
        (t) => t.number === toolNumber,
      );
      if (!tool) return;

      // Build G10 command using current offsets merged with any pending edits
      const parts: string[] = [`G10 P${toolNumber}`];
      const numAxes = Math.min(tool.offsets.length, AXIS_LETTERS.length);

      for (let i = 0; i < numAxes; i++) {
        const key = `t${toolNumber}-${i}`;
        const editVal = editing[key];
        const value = editVal !== undefined ? parseFloat(editVal) : tool.offsets[i];
        if (isNaN(value)) continue;
        parts.push(`${AXIS_LETTERS[i]}${value}`);
      }

      sendGCode(parts.join(' '));

      // Clear local edits for this tool
      setEditing((prev) => {
        const next = { ...prev };
        for (let i = 0; i < numAxes; i++) {
          delete next[`t${toolNumber}-${i}`];
        }
        return next;
      });
    },
    [editing, sendGCode],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, toolNumber: number) => {
      if (e.key === 'Enter') {
        applyOffset(toolNumber);
      }
    },
    [applyOffset],
  );

  if (tools.length === 0) return null;

  return (
    <DashboardPanel icon={Crosshair} title="Tool Offsets">

      {tools.map((tool) => {
        const numAxes = Math.min(tool.offsets.length, AXIS_LETTERS.length);
        if (numAxes === 0) return null;

        // Determine which axes are shown — at minimum X/Y/Z (indices 0-2)
        const shownAxes = Math.max(numAxes, 3);

        return (
          <div
            key={tool.number}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.panelBorder}`,
              borderRadius: 8,
              padding: 10,
              marginBottom: 8,
            }}
          >
            {/* Tool header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 12 }}>
                T{tool.number}{' '}
                <span style={{ fontWeight: 400, color: COLORS.textDim }}>
                  {tool.name || `Tool ${tool.number}`}
                </span>
              </span>
              <button
                style={btnStyle('accent', true)}
                onClick={() => applyOffset(tool.number)}
                title={`Send G10 P${tool.number} with current offsets`}
              >
                Apply
              </button>
            </div>

            {/* Offset inputs grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(shownAxes, 3)}, 1fr)`,
                gap: 6,
              }}
            >
              {Array.from({ length: shownAxes }).map((_, i) => {
                const key = `t${tool.number}-${i}`;
                const currentValue = i < tool.offsets.length ? tool.offsets[i] : 0;
                const displayValue =
                  editing[key] !== undefined ? editing[key] : currentValue.toFixed(3);
                const axisLetter = AXIS_LETTERS[i] ?? `#${i}`;

                return (
                  <div key={i}>
                    <div
                      style={{
                        fontSize: 10,
                        color: COLORS.textDim,
                        marginBottom: 2,
                      }}
                    >
                      {axisLetter} offset
                    </div>
                    <input
                      type="number"
                      step={0.01}
                      style={inputStyle()}
                      value={displayValue}
                      onChange={(e) =>
                        setEditing((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      onBlur={() => applyOffset(tool.number)}
                      onKeyDown={(e) => handleKeyDown(e, tool.number)}
                      title={`${axisLetter} offset for T${tool.number}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </DashboardPanel>
  );
}
