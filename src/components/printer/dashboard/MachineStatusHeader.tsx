import type { CSSProperties } from 'react';
import { Cpu, Clock } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { panelStyle } from '../../../utils/printerPanelStyles';
import { formatUptime, statusColor } from './helpers';

export default function MachineStatusHeader() {
  const model = usePrinterStore((s) => s.model);
  const status = model.state?.status ?? 'disconnected';
  const board = model.boards?.[0];
  const upTime = model.state?.upTime ?? 0;

  return (
    <div style={panelStyle()} className="duet-dash-status-header">
      <div className="duet-dash-status-main">
        <div
          className="duet-dash-status-dot"
          style={{
            '--duet-status-dot': statusColor(status),
          } as CSSProperties}
        />
        <span className="duet-dash-status-text">{status}</span>
      </div>
      {board && (
        <>
          <div className="duet-dash-muted-row">
            <Cpu size={13} />
            <span>{board.name || board.shortName}</span>
          </div>
          <div className="duet-dash-muted-text">
            {board.firmwareName} {board.firmwareVersion}
          </div>
        </>
      )}
      <div className="duet-dash-muted-row duet-dash-uptime">
        <Clock size={13} />
        <span>{formatUptime(upTime)}</span>
      </div>
    </div>
  );
}
