import { Fragment } from 'react';
import { CircuitBoard, Cpu, Gauge, Network } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { DashboardPanel } from '../dashboard/DashboardPanel';

const EMPTY_ARRAY: readonly never[] = [];

function driverBadge(status?: string): 'ok' | 'err' | 'warn' {
  if (!status) return 'ok';
  const normalized = status.toLowerCase();
  if (normalized === 'stall' || normalized === 'stalled' || normalized === 'standstill') return 'err';
  if (
    normalized.includes('overtemp')
    || normalized.includes('over_temp')
    || normalized.includes('overtemperature')
  ) return 'warn';
  if (normalized.includes('openload') || normalized.includes('open_load') || normalized === 'openload') return 'warn';
  if (normalized === 'ok' || normalized === 'good') return 'ok';
  return 'warn';
}

function driverBadgeText(status?: string): string {
  if (!status) return 'OK';
  const normalized = status.toLowerCase();
  if (normalized === 'stall' || normalized === 'stalled' || normalized === 'standstill') return 'STALL';
  if (
    normalized.includes('overtemp')
    || normalized.includes('over_temp')
    || normalized.includes('overtemperature')
  ) return 'OVER-TEMP';
  if (normalized.includes('openload') || normalized.includes('open_load') || normalized === 'openload') return 'OPEN LOAD';
  if (normalized === 'ok' || normalized === 'good') return 'OK';
  return status.toUpperCase();
}

function statusColor(status: string | undefined): string {
  const s = (status ?? '').toLowerCase();
  if (s === 'idle') return '#22c55e';
  if (s === 'printing' || s === 'processing') return '#3b82f6';
  if (s === 'busy') return '#f59e0b';
  if (s === 'error' || s === 'halted') return '#ef4444';
  return '#94a3b8';
}

export function BoardsPanel() {
  const rawBoards = usePrinterStore((s) => s.model.boards ?? EMPTY_ARRAY);
  const boards = rawBoards.filter((board): board is NonNullable<typeof board> => board != null);

  if (boards.length === 0) {
    return (
      <DashboardPanel icon={CircuitBoard} title="Boards">
        <div className="ds-kv__key">No board info reported.</div>
      </DashboardPanel>
    );
  }

  return (
    <DashboardPanel icon={CircuitBoard} title="Boards">
      {boards.map((board, index) => (
        <Fragment key={index}>
          {index > 0 && <hr className="ds-sep" />}
          <div className="ds-sub-title">
            {board.name || board.shortName || `Board ${index}`}
            {index > 0 && (board as unknown as Record<string, unknown>).canAddress != null && (
              <span className="ds-kv__key" style={{ fontWeight: 400, marginLeft: 6 }}>
                (CAN {String((board as unknown as Record<string, unknown>).canAddress)})
              </span>
            )}
          </div>
          <div className="ds-kv">
            {index > 0 && (board as unknown as Record<string, unknown>).canAddress != null && (
              <>
                <span className="ds-kv__key">CAN address</span>
                <span className="ds-kv__val">{String((board as unknown as Record<string, unknown>).canAddress)}</span>
              </>
            )}
            <span className="ds-kv__key">Firmware</span>
            <span className="ds-kv__val">{board.firmwareName} {board.firmwareVersion}</span>
            {board.firmwareDate && (
              <>
                <span className="ds-kv__key">Build date</span>
                <span className="ds-kv__val">{board.firmwareDate}</span>
              </>
            )}
            {board.mcuTemp && (
              <>
                <span className="ds-kv__key">MCU temp</span>
                <span
                  className="ds-kv__val"
                  style={{
                    color: (board.mcuTemp.current ?? 0) > 60 ? '#f59e0b' : undefined,
                  }}
                >
                  {board.mcuTemp.current?.toFixed(1)}° (min {board.mcuTemp.min?.toFixed(0)}°, max {board.mcuTemp.max?.toFixed(0)}°)
                </span>
              </>
            )}
            {board.vIn && (
              <>
                <span className="ds-kv__key">VIN</span>
                <span
                  className="ds-kv__val"
                  style={{
                    color:
                      (board.vIn.current ?? 0) < 11 || (board.vIn.current ?? 0) > 26
                        ? '#f59e0b'
                        : undefined,
                  }}
                >
                  {board.vIn.current?.toFixed(1)} V (min {board.vIn.min?.toFixed(1)}, max {board.vIn.max?.toFixed(1)})
                </span>
              </>
            )}
            {board.v12 && (
              <>
                <span className="ds-kv__key">V12</span>
                <span className="ds-kv__val">{board.v12.current?.toFixed(1)} V</span>
              </>
            )}
          </div>
        </Fragment>
      ))}
    </DashboardPanel>
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

  return (
    <DashboardPanel icon={Cpu} title="Motor Drivers">
      <div className="ds-driver-row">
        {rows.map((row, index) => {
          const variant = driverBadge(row.status);
          const text = driverBadgeText(row.status);
          return (
            <Fragment key={index}>
              <span className="ds-driver-axis">{row.label}</span>
              <span className="ds-kv__val">{row.driver || '—'}</span>
              <span className={`ds-badge ds-badge--${variant}`}>{text}</span>
            </Fragment>
          );
        })}
      </div>
    </DashboardPanel>
  );
}

export function NetworkPanel() {
  const interfaces = usePrinterStore((s) => s.model.network?.interfaces ?? EMPTY_ARRAY);
  const populated = interfaces.filter((iface): iface is NonNullable<typeof iface> => iface != null);

  if (populated.length === 0) {
    return (
      <DashboardPanel icon={Network} title="Network">
        <div className="ds-kv__key">No network interfaces reported.</div>
      </DashboardPanel>
    );
  }

  return (
    <DashboardPanel icon={Network} title="Network">
      {populated.map((iface, index) => (
        <Fragment key={index}>
          {index > 0 && <hr className="ds-sep" />}
          <div className="ds-sub-title">
            {iface.type}{iface.speed ? ` (${iface.speed} Mbps)` : ''}
          </div>
          <div className="ds-kv">
            <span className="ds-kv__key">IP address</span>
            <span className="ds-kv__val">{iface.actualIP || '—'}</span>
            <span className="ds-kv__key">Subnet</span>
            <span className="ds-kv__val">{iface.subnet || '—'}</span>
            <span className="ds-kv__key">Gateway</span>
            <span className="ds-kv__val">{iface.gateway || '—'}</span>
            <span className="ds-kv__key">MAC address</span>
            <span className="ds-kv__val">{iface.mac || '—'}</span>
            {iface.dnsServer && (
              <>
                <span className="ds-kv__key">DNS server</span>
                <span className="ds-kv__val">{iface.dnsServer}</span>
              </>
            )}
            {iface.ssid && (
              <>
                <span className="ds-kv__key">WiFi SSID</span>
                <span className="ds-kv__val">{iface.ssid}</span>
              </>
            )}
            {iface.signal != null && (
              <>
                <span className="ds-kv__key">WiFi signal</span>
                <span className="ds-kv__val">{iface.signal} dBm</span>
              </>
            )}
            <span className="ds-kv__key">State</span>
            <span className={`ds-badge ${iface.state === 'active' ? 'ds-badge--ok' : 'ds-badge--dim'}`}>
              {iface.state || '—'}
            </span>
            {iface.activeProtocols.length > 0 && (
              <>
                <span className="ds-kv__key">Active protocols</span>
                <span className="ds-kv__val">{iface.activeProtocols.join(', ')}</span>
              </>
            )}
          </div>
        </Fragment>
      ))}
    </DashboardPanel>
  );
}

export function MachineSummaryPanel() {
  const state = usePrinterStore((s) => s.model.state);
  const move = usePrinterStore((s) => s.model.move);

  const heroColor = statusColor(state?.status);
  const isPrinting = state?.status === 'printing' || state?.status === 'processing';

  return (
    <DashboardPanel icon={Gauge} title="Machine Summary">
      <div
        className="ds-status-hero"
        style={{ '--hero-color': heroColor } as React.CSSProperties}
      >
        <div className={`ds-status-hero__dot${isPrinting ? ' ds-status-hero__dot--pulse' : ''}`} />
        <span className="ds-status-hero__label">{state?.status ?? 'unknown'}</span>
      </div>
      <div className="ds-kpi-row">
        <div className="ds-kpi">
          <span className="ds-kpi__label">Tool</span>
          <span className="ds-kpi__val">
            {(state?.currentTool ?? -1) >= 0 ? `T${state?.currentTool}` : 'none'}
          </span>
        </div>
        <div className="ds-kpi">
          <span className="ds-kpi__label">Compensation</span>
          <span className="ds-kpi__val">{move?.compensation?.type ?? 'none'}</span>
        </div>
        <div className="ds-kpi">
          <span className="ds-kpi__label">Workplace</span>
          <span className="ds-kpi__val">G54</span>
        </div>
      </div>
    </DashboardPanel>
  );
}
