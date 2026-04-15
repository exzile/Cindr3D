import { usePrinterStore } from '../../store/printerStore';
import { colors as COLORS } from '../../utils/theme';
import DuetCustomButtons from './DuetCustomButtons';
import MachineStatusHeader from './dashboard/MachineStatusHeader';
import TemperaturePanel from './dashboard/TemperaturePanel';
import AxisMovementPanel from './dashboard/AxisMovementPanel';
import ExtruderControlPanel from './dashboard/ExtruderControlPanel';
import SpeedFlowPanel from './dashboard/SpeedFlowPanel';
import FanControlPanel from './dashboard/FanControlPanel';
import SystemInfoPanel from './dashboard/SystemInfoPanel';
import AtxPowerPanel from './dashboard/AtxPowerPanel';
import MacroPanel from './dashboard/MacroPanel';
import ToolSelectorPanel from './dashboard/ToolSelectorPanel';

export default function DuetDashboard() {
  const error = usePrinterStore((s) => s.error);
  const setError = usePrinterStore((s) => s.setError);

  return (
    <div className="duet-dash-root" style={{ background: COLORS.bg }}>
      {error && (
        <div className="duet-dash-error-banner" style={{ borderColor: COLORS.danger, color: COLORS.danger }}>
          <span>{error}</span>
          <button
            className="duet-dash-error-dismiss"
            style={{ color: COLORS.danger }}
            onClick={() => setError(null)}
          >
            &times;
          </button>
        </div>
      )}

      <div className="duet-dash-layout">
        <div className="duet-dash-span-full">
          <MachineStatusHeader />
        </div>

        <div className="duet-dash-span-full">
          <ToolSelectorPanel />
        </div>

        <div className="duet-dash-col">
          <TemperaturePanel />
          <SpeedFlowPanel />
          <FanControlPanel />
        </div>

        <div className="duet-dash-col">
          <AxisMovementPanel />
          <ExtruderControlPanel />
          <AtxPowerPanel />
          <MacroPanel />
        </div>

        <div className="duet-dash-span-full">
          <DuetCustomButtons />
        </div>

        <div className="duet-dash-span-full">
          <SystemInfoPanel />
        </div>
      </div>
    </div>
  );
}
