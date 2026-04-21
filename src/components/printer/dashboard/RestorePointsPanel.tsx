import { RotateCcw } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../../utils/printerPanelStyles';

/** G60 restore point labels */
const RESTORE_POINT_LABELS = ['S0', 'S1', 'S2'] as const;

export default function RestorePointsPanel() {
  const model = usePrinterStore((s) => s.model);
  const axes = model.move?.axes ?? [];
  const restorePoints = (model.move as unknown as Record<string, unknown>)?.restorePoints as
    | Array<{ coords: number[]; feedRate?: number; extruderPos?: number }> | undefined;

  // Collect visible axis letters for column headers
  const visibleAxes = axes.filter((a) => a.visible !== false);

  // Build restore point rows from either restorePoints or machinePositions
  const rows: { label: string; coords: Record<string, number | null> }[] = [];

  if (restorePoints && restorePoints.length > 0) {
    // Use the explicit restorePoints array (newer firmware)
    for (let i = 0; i < Math.min(restorePoints.length, 3); i++) {
      const rp = restorePoints[i];
      if (!rp) continue;
      const coords: Record<string, number | null> = {};
      for (let j = 0; j < visibleAxes.length; j++) {
        coords[visibleAxes[j].letter] = rp.coords?.[j] ?? null;
      }
      rows.push({ label: RESTORE_POINT_LABELS[i], coords });
    }
  }

  // If no restore points data is available at all, show empty state
  if (rows.length === 0) {
    return (
      <div style={panelStyle()}>
        <div style={labelStyle()} className="duet-dash-section-title-row">
          <RotateCcw size={14} /> Restore Points (G60)
        </div>
        <div style={{ color: COLORS.textDim, fontSize: 12, textAlign: 'center', padding: '12px 0' }}>
          No restore points saved
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <RotateCcw size={14} /> Restore Points (G60)
      </div>

      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.panelBorder}`,
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: '6px 10px',
                  fontSize: 10,
                  fontWeight: 600,
                  color: COLORS.textDim,
                  borderBottom: `1px solid ${COLORS.panelBorder}`,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Point
              </th>
              {visibleAxes.map((axis) => (
                <th
                  key={axis.letter}
                  style={{
                    textAlign: 'right',
                    padding: '6px 10px',
                    fontSize: 10,
                    fontWeight: 600,
                    color: COLORS.textDim,
                    borderBottom: `1px solid ${COLORS.panelBorder}`,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {axis.letter}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.label}
                style={{
                  borderBottom:
                    idx < rows.length - 1
                      ? `1px solid ${COLORS.panelBorder}`
                      : undefined,
                }}
              >
                <td
                  style={{
                    padding: '5px 10px',
                    fontWeight: 600,
                    color: COLORS.accent,
                    fontFamily: 'monospace',
                  }}
                >
                  G60 {row.label}
                </td>
                {visibleAxes.map((axis) => {
                  const val = row.coords[axis.letter];
                  return (
                    <td
                      key={axis.letter}
                      style={{
                        padding: '5px 10px',
                        textAlign: 'right',
                        fontFamily: 'monospace',
                        fontWeight: 600,
                        color: val != null ? COLORS.text : COLORS.textDim,
                      }}
                    >
                      {val != null ? val.toFixed(3) : '--'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
