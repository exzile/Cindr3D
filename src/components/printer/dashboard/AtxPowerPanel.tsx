import { Zap, Power } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  dashboardButtonStyle as btnStyle,
  panelStyle,
} from '../../../utils/printerPanelStyles';

export default function AtxPowerPanel() {
  const model = usePrinterStore((s) => s.model);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const atxPower = model.state?.atxPower ?? false;

  return (
    <div style={panelStyle()} className="duet-dash-atx-row">
      <div className="duet-dash-atx-title">
        <Zap size={14} color={atxPower ? COLORS.success : COLORS.textDim} />
        <span className="duet-dash-atx-name">ATX Power</span>
      </div>
      <button
        style={{
          ...btnStyle(atxPower ? 'danger' : 'success'),
          minWidth: 60,
        }}
        className="duet-dash-atx-btn"
        onClick={() => sendGCode(atxPower ? 'M81' : 'M80')}
      >
        <Power size={13} />
        {atxPower ? 'Off' : 'On'}
      </button>
    </div>
  );
}
