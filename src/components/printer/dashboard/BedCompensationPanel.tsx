import { Layers, ToggleLeft, ToggleRight } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  dashboardButtonStyle as btnStyle,
  panelStyle,
} from '../../../utils/printerPanelStyles';

/** Map raw compensation type strings to user-friendly labels */
function compensationLabel(type: string | undefined): string {
  if (!type || type === 'none') return 'None';
  if (type === 'mesh') return 'Mesh';
  if (type.includes('point') || type === '3point') return '3-Point';
  return type;
}

/** Determine badge color based on compensation type */
function badgeColor(type: string | undefined): string {
  if (!type || type === 'none') return COLORS.textDim;
  return COLORS.success;
}

export default function BedCompensationPanel() {
  const compensationType = usePrinterStore(
    (s) => s.model.move?.compensation?.type,
  );
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const isEnabled = !!compensationType && compensationType !== 'none';
  const label = compensationLabel(compensationType);

  return (
    <div style={panelStyle()} className="duet-dash-atx-row">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flex: 1,
        }}
      >
        <Layers size={14} color={badgeColor(compensationType)} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Bed Compensation</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: badgeColor(compensationType),
            background: COLORS.surface,
            border: `1px solid ${COLORS.panelBorder}`,
            borderRadius: 4,
            padding: '2px 8px',
            fontFamily: 'monospace',
          }}
        >
          {label}
        </span>
      </div>

      <button
        style={{
          ...btnStyle(isEnabled ? 'danger' : 'success', true),
          minWidth: 70,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
        onClick={() => sendGCode(isEnabled ? 'G29 S2' : 'G29 S1')}
        title={
          isEnabled
            ? 'Disable bed compensation (G29 S2)'
            : 'Enable bed compensation (G29 S1)'
        }
      >
        {isEnabled ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
        {isEnabled ? 'Disable' : 'Enable'}
      </button>
    </div>
  );
}
