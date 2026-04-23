import {
  BoardsPanel,
  DriversPanel,
  MachineSummaryPanel,
  NetworkPanel,
} from './duetStatus/infoPanels';
import {
  AnalogSensorsPanel,
  EndstopsPanel,
  GpioPanel,
  LaserPanel,
  ProbesPanel,
  SpindlePanel,
} from './duetStatus/sensorPanels';

export default function DuetStatus() {
  return (
    <div className="duet-status-grid">
      <MachineSummaryPanel />
      <EndstopsPanel />
      <ProbesPanel />
      <AnalogSensorsPanel />
      <SpindlePanel />
      <LaserPanel />
      <BoardsPanel />
      <NetworkPanel />
      <DriversPanel />
      <GpioPanel />
    </div>
  );
}
