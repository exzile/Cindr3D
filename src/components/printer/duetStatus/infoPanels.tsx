import type { CSSProperties } from 'react';
import { Fragment } from 'react';
import { CircuitBoard, Cpu, Gauge, Network } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  panelStyle,
  sectionTitleStyle as sectionTitle,
  twoColRowGridStyle as rowGrid,
} from '../../../utils/printerPanelStyles';

const EMPTY_ARRAY: readonly never[] = [];

function driverBadge(status?: string): { text: string; color: string; bg: string } {
  if (!status) return { text: 'OK', color: COLORS.success, bg: 'rgba(76,175,80,0.12)' };
  const normalized = status.toLowerCase();
  if (normalized === 'stall' || normalized === 'stalled' || normalized === 'standstill') {
    return { text: 'STALL', color: COLORS.danger, bg: 'rgba(244,67,54,0.12)' };
  }
  if (
    normalized.includes('overtemp')
    || normalized.includes('over_temp')
    || normalized.includes('overtemperature')
  ) {
    return { text: 'OVER-TEMP', color: COLORS.warning, bg: 'rgba(255,152,0,0.12)' };
  }
  if (normalized.includes('openload') || normalized.includes('open_load') || normalized === 'openload') {
    return { text: 'OPEN LOAD', color: COLORS.warning, bg: 'rgba(255,152,0,0.12)' };
  }
  if (normalized === 'ok' || normalized === 'good') {
    return { text: 'OK', color: COLORS.success, bg: 'rgba(76,175,80,0.12)' };
  }
  return { text: status.toUpperCase(), color: COLORS.warning, bg: 'rgba(255,152,0,0.12)' };
}

export function BoardsPanel() {
  const rawBoards = usePrinterStore((s) => s.model.boards ?? EMPTY_ARRAY);
  const boards = rawBoards.filter((board): board is NonNullable<typeof board> => board != null);

  if (boards.length === 0) {
    return (
      <div style={panelStyle()}>
        <div style={sectionTitle()}><CircuitBoard size={14} /> Boards</div>
        <div className="duet-status-dim">No board info reported.</div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><CircuitBoard size={14} /> Boards</div>
      {boards.map((board, index) => (
        <div key={index} className={index < boards.length - 1 ? 'duet-status-block' : undefined}>
          <div className="duet-status-board-title">
            {board.name || board.shortName || `Board ${index}`}
            {index > 0 && (board as unknown as Record<string, unknown>).canAddress != null && (
              <span className="duet-status-dim" style={{ fontWeight: 400, marginLeft: 6 }}>
                (CAN {String((board as unknown as Record<string, unknown>).canAddress)})
              </span>
            )}
          </div>
          <div style={rowGrid()}>
            {index > 0 && (board as unknown as Record<string, unknown>).canAddress != null && (
              <>
                <span className="duet-status-dim">CAN address</span>
                <span className="duet-status-mono">{String((board as unknown as Record<string, unknown>).canAddress)}</span>
              </>
            )}
            <span className="duet-status-dim">Firmware</span>
            <span className="duet-status-mono">{board.firmwareName} {board.firmwareVersion}</span>
            {board.firmwareDate && (
              <>
                <span className="duet-status-dim">Build date</span>
                <span className="duet-status-mono">{board.firmwareDate}</span>
              </>
            )}
            {board.mcuTemp && (
              <>
                <span className="duet-status-dim">MCU temp</span>
                <span className="duet-status-mono">
                  {board.mcuTemp.current?.toFixed(1)}° (min {board.mcuTemp.min?.toFixed(0)}°, max {board.mcuTemp.max?.toFixed(0)}°)
                </span>
              </>
            )}
            {board.vIn && (
              <>
                <span className="duet-status-dim">VIN</span>
                <span className="duet-status-mono">
                  {board.vIn.current?.toFixed(1)} V (min {board.vIn.min?.toFixed(1)}, max {board.vIn.max?.toFixed(1)})
                </span>
              </>
            )}
            {board.v12 && (
              <>
                <span className="duet-status-dim">V12</span>
                <span className="duet-status-mono">{board.v12.current?.toFixed(1)} V</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DriversPanel() {
  const axes = usePrinterStore((s) => s.model.move?.axes ?? EMPTY_ARRAY);
  const extruders = usePrinterStore((s) => s.model.move?.extruders ?? EMPTY_ARRAY);

  const rows: { label: string; driver: string; status?: string }[] = [];
  for (const axis of axes) {
    if (!axis.letter) continue;
    const axisAny = axis as unknown as Record<string, unknown>;
    const driverIds = Array.isArray(axis.drives) ? axis.drives.map(String).join(', ') : '';
    rows.push({
      label: axis.letter,
      driver: driverIds,
      status: typeof axisAny.status === 'string' ? axisAny.status : undefined,
    });
  }
  for (let index = 0; index < extruders.length; index += 1) {
    const extruder = extruders[index];
    const extruderAny = extruder as unknown as Record<string, unknown> | undefined;
    rows.push({
      label: `E${index}`,
      driver: extruder?.driver ?? '',
      status: typeof extruderAny?.status === 'string' ? extruderAny.status : undefined,
    });
  }

  if (rows.length === 0) return null;

  const badgeStyle = (badge: ReturnType<typeof driverBadge>): CSSProperties => ({
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.03em',
    color: badge.color,
    background: badge.bg,
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  });

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Cpu size={14} /> Motor Drivers</div>
      <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: '6px 12px', fontSize: 12, alignItems: 'center' }}>
        {rows.map((row, index) => {
          const badge = driverBadge(row.status);
          return (
            <Fragment key={index}>
              <span style={{ fontWeight: 600 }}>{row.label}</span>
              <span className="duet-status-mono">{row.driver || '—'}</span>
              <span style={badgeStyle(badge)}>{badge.text}</span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function NetworkPanel() {
  const interfaces = usePrinterStore((s) => s.model.network?.interfaces ?? EMPTY_ARRAY);
  const populated = interfaces.filter((iface): iface is NonNullable<typeof iface> => iface != null);

  if (populated.length === 0) {
    return (
      <div style={panelStyle()}>
        <div style={sectionTitle()}><Network size={14} /> Network</div>
        <div className="duet-status-dim">No network interfaces reported.</div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Network size={14} /> Network</div>
      {populated.map((iface, index) => (
        <div key={index} className={index < populated.length - 1 ? 'duet-status-block' : undefined}>
          <div className="duet-status-board-title">
            {iface.type}{iface.speed ? ` (${iface.speed} Mbps)` : ''}
          </div>
          <div style={rowGrid()}>
            <span className="duet-status-dim">IP address</span>
            <span className="duet-status-mono">{iface.actualIP || '—'}</span>
            <span className="duet-status-dim">Subnet</span>
            <span className="duet-status-mono">{iface.subnet || '—'}</span>
            <span className="duet-status-dim">Gateway</span>
            <span className="duet-status-mono">{iface.gateway || '—'}</span>
            <span className="duet-status-dim">MAC address</span>
            <span className="duet-status-mono">{iface.mac || '—'}</span>
            {iface.dnsServer && (
              <>
                <span className="duet-status-dim">DNS server</span>
                <span className="duet-status-mono">{iface.dnsServer}</span>
              </>
            )}
            {iface.ssid && (
              <>
                <span className="duet-status-dim">WiFi SSID</span>
                <span className="duet-status-mono">{iface.ssid}</span>
              </>
            )}
            {iface.signal != null && (
              <>
                <span className="duet-status-dim">WiFi signal</span>
                <span className="duet-status-mono">{iface.signal} dBm</span>
              </>
            )}
            <span className="duet-status-dim">State</span>
            <span className={`duet-status-flag ${iface.state === 'active' ? 'success' : ''}`}>
              {iface.state || '—'}
            </span>
            {iface.activeProtocols.length > 0 && (
              <>
                <span className="duet-status-dim">Active protocols</span>
                <span className="duet-status-mono">{iface.activeProtocols.join(', ')}</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MachineSummaryPanel() {
  const state = usePrinterStore((s) => s.model.state);
  const move = usePrinterStore((s) => s.model.move);

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Gauge size={14} /> Machine Summary</div>
      <div style={rowGrid()}>
        <span className="duet-status-dim">Status</span>
        <span className="duet-status-mono">{state?.status ?? 'unknown'}</span>
        <span className="duet-status-dim">Current tool</span>
        <span className="duet-status-mono">{(state?.currentTool ?? -1) >= 0 ? `T${state?.currentTool}` : 'none'}</span>
        <span className="duet-status-dim">Compensation</span>
        <span className="duet-status-mono">{move?.compensation?.type ?? 'none'}</span>
        <span className="duet-status-dim">Workplace</span>
        <span className="duet-status-mono">G54</span>
      </div>
    </div>
  );
}
