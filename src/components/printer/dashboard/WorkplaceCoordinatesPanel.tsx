import { useState, useCallback } from 'react';
import { MapPin } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  compactPanelInputStyle as inputStyle,
  dashboardButtonStyle as btnStyle,
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../../utils/printerPanelStyles';

/** G54-G59 workspace names, indexed 0-5 */
const WORKSPACE_NAMES = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'] as const;

export default function WorkplaceCoordinatesPanel() {
  const model = usePrinterStore((s) => s.model);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const axes = model.move?.axes ?? [];

  const [selectedWorkspace, setSelectedWorkspace] = useState(0);

  // Local editing state keyed by "ws{workspace}-ax{axisIndex}"
  const [editing, setEditing] = useState<Record<string, string>>({});

  const applyOffsets = useCallback(() => {
    const currentAxes = usePrinterStore.getState().model.move?.axes ?? [];
    // Build G10 L2 P{workspace+1} command with axis offsets
    const parts: string[] = [`G10 L2 P${selectedWorkspace + 1}`];

    for (let i = 0; i < currentAxes.length; i++) {
      const axis = currentAxes[i];
      if (!axis.letter) continue;
      const key = `ws${selectedWorkspace}-ax${i}`;
      const editVal = editing[key];
      const offsets = axis.workplaceOffsets ?? [];
      const currentValue = offsets[selectedWorkspace] ?? 0;
      const value = editVal !== undefined ? parseFloat(editVal) : currentValue;
      if (isNaN(value)) continue;
      parts.push(`${axis.letter}${value}`);
    }

    sendGCode(parts.join(' '));

    // Clear local edits
    setEditing((prev) => {
      const next = { ...prev };
      for (let i = 0; i < currentAxes.length; i++) {
        delete next[`ws${selectedWorkspace}-ax${i}`];
      }
      return next;
    });
  }, [selectedWorkspace, editing, sendGCode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        applyOffsets();
      }
    },
    [applyOffsets],
  );

  // Only show axes that are visible
  const visibleAxes = axes.filter((a) => a.visible !== false);
  if (visibleAxes.length === 0) return null;

  return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <MapPin size={14} /> Workplace Coordinates
      </div>

      {/* Workspace selector buttons */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        {WORKSPACE_NAMES.map((name, idx) => (
          <button
            key={name}
            style={{
              ...btnStyle(idx === selectedWorkspace ? 'accent' : 'default', true),
              flex: '1 1 auto',
              minWidth: 40,
            }}
            onClick={() => {
              setSelectedWorkspace(idx);
              // Send the workspace G-code to make it active
              sendGCode(name);
            }}
            title={`Switch to ${name} workspace`}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Offset values for the selected workspace */}
      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.panelBorder}`,
          borderRadius: 8,
          padding: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 12 }}>
            {WORKSPACE_NAMES[selectedWorkspace]} Offsets
          </span>
          <button
            style={btnStyle('accent', true)}
            onClick={applyOffsets}
            title={`Apply offsets for ${WORKSPACE_NAMES[selectedWorkspace]}`}
          >
            Apply
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(visibleAxes.length, 3)}, 1fr)`,
            gap: 6,
          }}
        >
          {visibleAxes.map((axis) => {
            const axisIndex = axes.indexOf(axis);
            const key = `ws${selectedWorkspace}-ax${axisIndex}`;
            const offsets = axis.workplaceOffsets ?? [];
            const currentValue = offsets[selectedWorkspace] ?? 0;
            const displayValue =
              editing[key] !== undefined
                ? editing[key]
                : currentValue.toFixed(3);

            return (
              <div key={axis.letter}>
                <div
                  style={{
                    fontSize: 10,
                    color: COLORS.textDim,
                    marginBottom: 2,
                  }}
                >
                  {axis.letter} offset
                </div>
                <input
                  type="number"
                  step={0.01}
                  style={inputStyle()}
                  value={displayValue}
                  onChange={(e) =>
                    setEditing((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  onBlur={() => applyOffsets()}
                  onKeyDown={handleKeyDown}
                  title={`${axis.letter} offset for ${WORKSPACE_NAMES[selectedWorkspace]}`}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
