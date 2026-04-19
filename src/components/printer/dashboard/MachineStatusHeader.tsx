import type { CSSProperties } from 'react';
import { Cpu, Clock, Activity } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { panelStyle } from '../../../utils/printerPanelStyles';
import { formatUptime, statusColor } from './helpers';

const STATUS_BG: Record<string, string> = {
  idle:        'rgba(86,201,138,0.1)',
  processing:  'rgba(100,160,255,0.1)',
  printing:    'rgba(100,160,255,0.1)',
  paused:      'rgba(232,184,75,0.1)',
  error:       'rgba(220,80,80,0.1)',
  halted:      'rgba(220,80,80,0.1)',
};

const STATUS_BORDER: Record<string, string> = {
  idle:        'rgba(86,201,138,0.35)',
  processing:  'rgba(100,160,255,0.35)',
  printing:    'rgba(100,160,255,0.35)',
  paused:      'rgba(232,184,75,0.35)',
  error:       'rgba(220,80,80,0.35)',
  halted:      'rgba(220,80,80,0.35)',
};

export default function MachineStatusHeader() {
  const model  = usePrinterStore((s) => s.model);
  const status = model.state?.status ?? 'disconnected';
  const board  = model.boards?.[0];
  const upTime = model.state?.upTime ?? 0;
  const color  = statusColor(status);
  const bg     = STATUS_BG[status]     ?? 'rgba(120,120,140,0.08)';
  const border = STATUS_BORDER[status] ?? 'rgba(155,155,200,0.2)';

  return (
    <div style={panelStyle()} className="ms-root">
      <div className="ms-status-row">
        <div
          className="ms-badge"
          style={{ '--ms-color': color, background: bg, borderColor: border } as CSSProperties}
        >
          <Activity size={12} style={{ color }} />
          <span className="ms-status-text">{status}</span>
        </div>
        <div className="ms-uptime">
          <Clock size={11} />
          <span>{formatUptime(upTime)}</span>
        </div>
      </div>

      {board && (
        <div className="ms-board-row">
          <Cpu size={11} />
          <span className="ms-board-name">{board.name || board.shortName}</span>
          <span className="ms-sep">·</span>
          <span className="ms-firmware">{board.firmwareName} {board.firmwareVersion}</span>
        </div>
      )}
    </div>
  );
}
