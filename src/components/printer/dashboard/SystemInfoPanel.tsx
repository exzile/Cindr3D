import type { CSSProperties } from 'react';
import { Cpu, Clock, Zap, Server, HardDrive, Wifi } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../../utils/printerPanelStyles';
import {
  formatBytes,
  formatUptime,
  tempColorIndicator,
  vinColorIndicator,
} from './helpers';

export default function SystemInfoPanel() {
  const model = usePrinterStore((s) => s.model);
  const board = model.boards?.[0];
  const network = model.network;
  const volumes = model.volumes ?? [];
  const upTime = model.state?.upTime ?? 0;

  if (!board) return null;

  const mcuTemp = board.mcuTemp;
  const vIn = board.vIn;
  const v12 = board.v12;
  const iface = network?.interfaces?.[0];

  return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <Server size={14} /> System Info
      </div>

      <div className="duet-dash-sys-grid">
        <div className="duet-dash-sys-card duet-dash-sys-span-full" style={{ background: COLORS.surface }}>
          <div className="duet-dash-sys-label">Board</div>
          <div className="duet-dash-sys-strong">{board.name || board.shortName}</div>
          <div className="duet-dash-sys-subtext">
            {board.firmwareName} {board.firmwareVersion}
          </div>
          {board.firmwareDate && (
            <div className="duet-dash-sys-subtext duet-dash-sys-subtext-tight">
              Built: {board.firmwareDate}
            </div>
          )}
        </div>

        {mcuTemp && (
          <div className="duet-dash-sys-card" style={{ background: COLORS.surface }}>
            <div className="duet-dash-sys-head-row">
              <Cpu size={10} /> MCU Temp
            </div>
            <div className="duet-dash-sys-value-row">
              <div className="duet-dash-sys-dot" style={{
                '--duet-sys-dot': tempColorIndicator(mcuTemp.current),
              } as CSSProperties} />
              <span className="duet-dash-sys-mono-lg">
                {mcuTemp.current.toFixed(1)}&deg;C
              </span>
            </div>
            <div className="duet-dash-sys-subtext-top">
              Min: {mcuTemp.min.toFixed(1)}&deg;C / Max: {mcuTemp.max.toFixed(1)}&deg;C
            </div>
          </div>
        )}

        {vIn && (
          <div className="duet-dash-sys-card" style={{ background: COLORS.surface }}>
            <div className="duet-dash-sys-head-row">
              <Zap size={10} /> Vin
            </div>
            <div className="duet-dash-sys-value-row">
              <div className="duet-dash-sys-dot" style={{
                '--duet-sys-dot': vinColorIndicator(vIn.current),
              } as CSSProperties} />
              <span className="duet-dash-sys-mono-lg">
                {vIn.current.toFixed(1)}V
              </span>
            </div>
            <div className="duet-dash-sys-subtext-top">
              Min: {vIn.min.toFixed(1)}V / Max: {vIn.max.toFixed(1)}V
            </div>
          </div>
        )}

        {v12 && (
          <div className="duet-dash-sys-card" style={{ background: COLORS.surface }}>
            <div className="duet-dash-sys-head-row">
              <Zap size={10} /> 5V Rail
            </div>
            <div className="duet-dash-sys-mono-lg">
              {v12.current.toFixed(2)}V
            </div>
            <div className="duet-dash-sys-subtext-top">
              Min: {v12.min.toFixed(2)}V / Max: {v12.max.toFixed(2)}V
            </div>
          </div>
        )}

        <div className="duet-dash-sys-card" style={{ background: COLORS.surface }}>
          <div className="duet-dash-sys-head-row">
            <Clock size={10} /> Uptime
          </div>
          <div className="duet-dash-sys-mono">
            {formatUptime(upTime)}
          </div>
        </div>

        {network && (
          <div className="duet-dash-sys-card" style={{ background: COLORS.surface }}>
            <div className="duet-dash-sys-head-row">
              <Wifi size={10} /> Network
            </div>
            <div className="duet-dash-sys-strong-sm">{network.hostname || network.name}</div>
            {iface && (
              <>
                <div className="duet-dash-sys-subtext duet-dash-sys-subtext-top-tight">
                  {iface.actualIP}
                </div>
                <div className="duet-dash-sys-subtext">
                  {iface.type} {iface.speed > 0 ? `(${iface.speed}Mbps)` : ''}
                </div>
              </>
            )}
          </div>
        )}

        {volumes.length > 0 && (
          <div className="duet-dash-sys-card duet-dash-sys-span-full" style={{ background: COLORS.surface }}>
            <div className="duet-dash-sys-head-row">
              <HardDrive size={10} /> Storage
            </div>
            <div className="duet-dash-sys-storage-wrap">
              {volumes.filter((v) => v.mounted).map((vol, i) => {
                const usedPct = vol.totalSpace > 0 ? ((vol.totalSpace - vol.freeSpace) / vol.totalSpace) * 100 : 0;
                return (
                  <div key={i} className="duet-dash-sys-storage-item">
                    <div className="duet-dash-sys-storage-name">{vol.path || vol.name || `Volume ${i}`}</div>
                    <div className="duet-dash-sys-subtext duet-dash-sys-subtext-top-tight">
                      {formatBytes(vol.freeSpace)} free / {formatBytes(vol.totalSpace)}
                    </div>
                    <div className="duet-dash-sys-storage-bar" style={{ background: COLORS.inputBg }}>
                      <div style={{
                        height: '100%', width: `${usedPct}%`, borderRadius: 2,
                        background: usedPct > 90 ? COLORS.danger : usedPct > 75 ? COLORS.warning : COLORS.accent,
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
