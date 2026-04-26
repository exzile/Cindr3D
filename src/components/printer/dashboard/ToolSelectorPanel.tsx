import { Fragment, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { Wrench, XCircle, Droplets, Fan, Package, Snowflake, Flame } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { panelStyle, sectionTitleStyle as labelStyle } from '../../../utils/printerPanelStyles';
import { HEATER_CHART_COLORS, heaterStateColor, toolStateColor } from './helpers';

const MATERIAL_PRESETS: { name: string; tool: number; bed: number; color: string }[] = [
  { name: 'PLA',  tool: 200, bed: 60,  color: 'rgb(110,200,120)' },
  { name: 'PETG', tool: 240, bed: 80,  color: 'rgb(80,170,230)'  },
  { name: 'ABS',  tool: 245, bed: 100, color: 'rgb(230,140,80)'  },
  { name: 'TPU',  tool: 225, bed: 50,  color: 'rgb(200,130,220)' },
];

function HeatProgress({ current, active, state }: { current: number; active: number; state: string }) {
  if (active <= 0) {
    return <div className="ts-heatbar ts-heatbar--off" />;
  }
  const pct = Math.min(100, Math.max(0, (current / active) * 100));
  const delta = active - current;
  const atTemp = Math.abs(delta) < 3;
  const heating = state === 'active' && delta > 3;
  const cooling = state !== 'active' && current > 40;
  const cls =
    atTemp ? 'ts-heatbar ts-heatbar--ready'
    : heating ? 'ts-heatbar ts-heatbar--heating'
    : cooling ? 'ts-heatbar ts-heatbar--cooling'
    : 'ts-heatbar';
  return (
    <div className={cls}>
      <div className="ts-heatbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ToolSelectorPanel() {
  const model          = usePrinterStore((s) => s.model);
  const sendGCode      = usePrinterStore((s) => s.sendGCode);
  const setBedTemp     = usePrinterStore((s) => s.setBedTemp);
  const filaments      = usePrinterStore((s) => s.filaments);
  const loadFilament   = usePrinterStore((s) => s.loadFilament);
  const unloadFilament = usePrinterStore((s) => s.unloadFilament);
  const changeFilament = usePrinterStore((s) => s.changeFilament);

  const tools         = useMemo(() => model.tools ?? [], [model.tools]);
  const heaters       = model.heat?.heaters ?? [];
  const fans          = model.fans ?? [];
  const extrudersModel = model.move?.extruders ?? [];
  const currentTool   = model.state?.currentTool ?? -1;
  const hasBed        = (model.heat?.bedHeaters ?? []).some((i) => i >= 0);

  const [editingTemps, setEditingTemps] = useState<Record<string, string>>({});

  const handleSelectTool   = useCallback((n: number) => sendGCode(`T${n}`),   [sendGCode]);
  const handleDeselectTool = useCallback(()            => sendGCode('T-1'),   [sendGCode]);

  const applyPreset = useCallback((toolTemp: number, bedTemp: number) => {
    tools.forEach((t) => {
      const temps = t.heaters.map(() => toolTemp).join(':');
      if (temps) sendGCode(`G10 P${t.number} S${temps}`);
    });
    if (hasBed) setBedTemp(bedTemp);
  }, [tools, sendGCode, setBedTemp, hasBed]);

  const coolAll = useCallback(() => {
    tools.forEach((t) => {
      const zeros = t.heaters.map(() => 0).join(':');
      if (zeros) sendGCode(`G10 P${t.number} S${zeros} R${zeros}`);
    });
    if (hasBed) setBedTemp(0);
  }, [tools, sendGCode, setBedTemp, hasBed]);

  const handleTempChange = useCallback((toolNumber: number, heaterIdx: number, value: number, standby: boolean) => {
    const tool = (usePrinterStore.getState().model.tools ?? []).find((t) => t.number === toolNumber);
    if (!tool) return;
    const letter = standby ? 'R' : 'S';
    const temps  = standby ? [...tool.standby] : [...tool.active];
    temps[heaterIdx] = value;
    sendGCode(`G10 P${toolNumber} ${letter}${temps.join(':')}`);
  }, [sendGCode]);

  const handleTempSubmit = useCallback((key: string, toolNumber: number, heaterIdx: number, standby: boolean) => {
    const val = parseFloat(editingTemps[key] ?? '');
    if (isNaN(val)) return;
    handleTempChange(toolNumber, heaterIdx, val, standby);
    setEditingTemps((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, [editingTemps, handleTempChange]);

  if (tools.length === 0) return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <Wrench size={14} /> Tools
      </div>
      <div className="ts-empty">No tools detected</div>
    </div>
  );

  return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="ts-header">
        <div className="duet-dash-section-title-row">
          <Wrench size={14} /> Tools
        </div>
        {currentTool >= 0 && (
          <button className="ts-deselect-btn" onClick={handleDeselectTool} title="T-1">
            <XCircle size={11} /> Deselect
          </button>
        )}
      </div>

      <div className="ts-presets">
        {MATERIAL_PRESETS.map((p) => (
          <button
            key={p.name}
            className="ts-preset-btn"
            style={{ '--ts-preset-color': p.color } as CSSProperties}
            onClick={() => applyPreset(p.tool, p.bed)}
            title={`Set all tools to ${p.tool}°${hasBed ? ` and bed to ${p.bed}°` : ''}`}
          >
            <Flame size={11} />
            <span className="ts-preset-name">{p.name}</span>
            <span className="ts-preset-temp">{p.tool}°{hasBed ? `/${p.bed}°` : ''}</span>
          </button>
        ))}
        <button className="ts-preset-btn ts-preset-btn--cool" onClick={coolAll} title="Cool all heaters">
          <Snowflake size={11} /> Cool
        </button>
      </div>

      {tools.map((tool) => {
        const isActive = tool.number === currentTool;
        const toolName = tool.name || `Tool ${tool.number}`;
        const stateColor = toolStateColor(tool.state);

        return (
          <div
            key={tool.number}
            className={`ts-tool-card${isActive ? ' ts-tool-card--active' : ''}`}
          >
            {/* ---- card header ---- */}
            <div className="ts-card-header">
              <button
                className={`ts-select-btn${isActive ? ' ts-select-btn--active' : ''}`}
                onClick={() => handleSelectTool(tool.number)}
                title={`Select ${toolName}`}
              >
                T{tool.number}
              </button>
              <span className="ts-tool-name">{toolName}</span>
              <div className="ts-state-badge" style={{ '--ts-state-color': stateColor } as CSSProperties}>
                <span className="ts-state-dot" />
                {tool.state}
              </div>
            </div>

            {/* ---- heaters ---- */}
            {tool.heaters.length > 0 && (
              <div className="ts-section">
                <div className="ts-section-label">Heaters</div>
                <div className="ts-heater-grid">
                  <span className="ts-heater-col-hdr">Heater</span>
                  <span className="ts-heater-col-hdr">Current</span>
                  <span className="ts-heater-col-hdr">Active</span>
                  <span className="ts-heater-col-hdr">Standby</span>

                  {tool.heaters.map((hIdx, hi) => {
                    const h = heaters[hIdx];
                    if (!h) return null;
                    const activeKey  = `t${tool.number}-h${hi}-active`;
                    const standbyKey = `t${tool.number}-h${hi}-standby`;
                    return (
                      <Fragment key={hIdx}>
                        <span
                          className="ts-heater-name"
                          style={{ '--ts-heater-color': HEATER_CHART_COLORS[hIdx % HEATER_CHART_COLORS.length] } as CSSProperties}
                        >
                          H{hIdx}
                          <span className="ts-heater-state-dot" style={{ '--ts-heater-state': heaterStateColor(h.state) } as CSSProperties} />
                        </span>
                        <span className="ts-heater-current">{h.current.toFixed(1)}&deg;</span>
                        <input
                          className="ts-input"
                          type="number" step={1}
                          value={editingTemps[activeKey] ?? (tool.active[hi] ?? h.active).toString()}
                          onChange={(e) => setEditingTemps((p) => ({ ...p, [activeKey]: e.target.value }))}
                          onBlur={() => handleTempSubmit(activeKey, tool.number, hi, false)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleTempSubmit(activeKey, tool.number, hi, false); }}
                          title="Active Â°C"
                        />
                        <input
                          className="ts-input"
                          type="number" step={1}
                          value={editingTemps[standbyKey] ?? (tool.standby[hi] ?? h.standby).toString()}
                          onChange={(e) => setEditingTemps((p) => ({ ...p, [standbyKey]: e.target.value }))}
                          onBlur={() => handleTempSubmit(standbyKey, tool.number, hi, true)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleTempSubmit(standbyKey, tool.number, hi, true); }}
                          title="Standby Â°C"
                        />
                        <HeatProgress current={h.current} active={tool.active[hi] ?? h.active} state={h.state} />
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ---- offsets ---- */}
            {tool.offsets && tool.offsets.some((o) => o !== 0) && (
              <div className="ts-section">
                <div className="ts-section-label">Offsets</div>
                <div className="ts-offsets">
                  {tool.offsets.map((offset, idx) => {
                    const axis = ['X', 'Y', 'Z', 'U', 'V', 'W', 'A', 'B', 'C'][idx] ?? `#${idx}`;
                    return (
                      <div key={idx} className="ts-offset-chip">
                        <span className="ts-offset-axis">{axis}: </span>
                        <span className="ts-offset-val">{offset.toFixed(3)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ---- filament ---- */}
            {tool.extruders.length > 0 && (() => {
              const extruderIdx = tool.filamentExtruder >= 0 ? tool.filamentExtruder : tool.extruders[0];
              const loaded = extrudersModel[extruderIdx]?.filament ?? '';
              return (
                <div className="ts-section">
                  <div className="ts-section-label">Filament</div>
                  <div className="ts-filament-row">
                    <Package size={12} style={{ color: 'rgba(180,180,200,0.5)', flexShrink: 0 }} />
                    <select
                      className="ts-select"
                      value={loaded}
                      onChange={(e) => {
                        const name = e.target.value;
                        if (!name) return;
                        if (loaded) changeFilament(tool.number, name);
                        else loadFilament(tool.number, name);
                      }}
                      title={loaded ? `Loaded: ${loaded}` : 'No filament loaded'}
                    >
                      <option value="">{loaded || 'â€” none â€”'}</option>
                      {filaments.filter((n) => n !== loaded).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <button
                      className="ts-unload-btn"
                      onClick={() => unloadFilament(tool.number)}
                      disabled={!loaded}
                      title="Unload (M702)"
                    >
                      Unload
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* ---- assigned extruders/fans ---- */}
            <div className="ts-assigned-row">
              {tool.extruders.length > 0 && (
                <div className="ts-assigned-item">
                  <Droplets size={11} />
                  <span className="ts-assigned-label">Extruders:</span>
                  <span className="ts-assigned-val">{tool.extruders.join(', ')}</span>
                </div>
              )}
              {tool.fans.length > 0 && (
                <div className="ts-assigned-item">
                  <Fan size={11} />
                  <span className="ts-assigned-label">Fans:</span>
                  <span className="ts-assigned-val">
                    {tool.fans.map((fIdx) => fans[fIdx]?.name || `Fan ${fIdx}`).join(', ')}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
