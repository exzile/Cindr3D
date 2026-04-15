import { Fragment, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Wrench, XCircle, Droplets, Fan, Package } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  compactPanelInputStyle as inputStyle,
  dashboardButtonStyle as btnStyle,
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../../utils/printerPanelStyles';
import {
  HEATER_CHART_COLORS,
  heaterStateColor,
  toolStateColor,
} from './helpers';

export default function ToolSelectorPanel() {
  const model = usePrinterStore((s) => s.model);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const filaments = usePrinterStore((s) => s.filaments);
  const loadFilament = usePrinterStore((s) => s.loadFilament);
  const unloadFilament = usePrinterStore((s) => s.unloadFilament);
  const changeFilament = usePrinterStore((s) => s.changeFilament);
  const tools = model.tools ?? [];
  const heaters = model.heat?.heaters ?? [];
  const fans = model.fans ?? [];
  const extrudersModel = model.move?.extruders ?? [];
  const currentTool = model.state?.currentTool ?? -1;

  const [editingTemps, setEditingTemps] = useState<Record<string, string>>({});

  const handleSelectTool = useCallback((toolNumber: number) => {
    sendGCode(`T${toolNumber}`);
  }, [sendGCode]);

  const handleDeselectTool = useCallback(() => {
    sendGCode('T-1');
  }, [sendGCode]);

  const handleTempChange = useCallback((toolNumber: number, heaterIdx: number, value: number, standby: boolean) => {
    const tool = (usePrinterStore.getState().model.tools ?? []).find((t) => t.number === toolNumber);
    if (!tool) return;
    const letter = standby ? 'R' : 'S';
    const temps = standby ? [...tool.standby] : [...tool.active];
    temps[heaterIdx] = value;
    const tempStr = temps.join(':');
    sendGCode(`G10 P${toolNumber} ${letter}${tempStr}`);
  }, [sendGCode]);

  const handleTempSubmit = useCallback((key: string, toolNumber: number, heaterIdx: number, standby: boolean) => {
    const val = parseFloat(editingTemps[key] ?? '');
    if (isNaN(val)) return;
    handleTempChange(toolNumber, heaterIdx, val, standby);
    setEditingTemps((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, [editingTemps, handleTempChange]);

  if (tools.length === 0) return null;

  return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="duet-dash-tools-header-row">
        <div className="duet-dash-section-title-row">
          <Wrench size={14} /> Tools
        </div>
        {currentTool >= 0 && (
          <button
            style={{
              ...btnStyle('default', true),
              fontSize: 10,
              textTransform: 'uppercase' as CSSProperties['textTransform'],
              letterSpacing: '0.04em',
            }}
            onClick={handleDeselectTool}
            title="Deselect current tool (T-1)"
          >
            <XCircle size={11} /> Deselect
          </button>
        )}
      </div>

      {tools.map((tool) => {
        const isActive = tool.number === currentTool;
        const toolName = tool.name || `Tool ${tool.number}`;

        return (
          <div
            key={tool.number}
            className="duet-dash-tool-card"
            style={{
              '--duet-tool-card-bg': isActive ? 'rgba(80, 120, 255, 0.12)' : COLORS.surface,
              '--duet-tool-card-border': isActive ? COLORS.accent : COLORS.panelBorder,
            } as CSSProperties}
          >
            <div className="duet-dash-tool-card-header">
              <button
                style={{
                  ...btnStyle(isActive ? 'accent' : 'default', true),
                  fontWeight: 700,
                  fontSize: 12,
                  minWidth: 36,
                }}
                onClick={() => handleSelectTool(tool.number)}
                title={`Select ${toolName}`}
              >
                T{tool.number}
              </button>
              <span className="duet-dash-tool-name">{toolName}</span>
              <div className="duet-dash-tool-state-wrap">
                <div
                  className="duet-dash-tool-state-dot"
                  style={{
                    '--duet-tool-state-color': toolStateColor(tool.state),
                    '--duet-tool-state-glow': tool.state !== 'off' ? `0 0 6px ${toolStateColor(tool.state)}` : 'none',
                  } as CSSProperties}
                />
                <span className="duet-dash-tool-state-text" style={{ '--duet-tool-state-color': toolStateColor(tool.state) } as CSSProperties}>
                  {tool.state}
                </span>
              </div>
            </div>

            {tool.heaters.length > 0 && (
              <div className="duet-dash-tool-section">
                <div className="duet-dash-tool-section-title">Heaters</div>
                <div className="duet-dash-tool-heaters-grid">
                  <span className="duet-dash-tool-heaters-col">Heater</span>
                  <span className="duet-dash-tool-heaters-col">Current</span>
                  <span className="duet-dash-tool-heaters-col">Active</span>
                  <span className="duet-dash-tool-heaters-col">Standby</span>

                  {tool.heaters.map((hIdx, hi) => {
                    const h = heaters[hIdx];
                    if (!h) return null;
                    const activeKey = `t${tool.number}-h${hi}-active`;
                    const standbyKey = `t${tool.number}-h${hi}-standby`;

                    return (
                      <Fragment key={hIdx}>
                        <span
                          className="duet-dash-tool-heater-name"
                          style={{ '--duet-heater-color': HEATER_CHART_COLORS[hIdx % HEATER_CHART_COLORS.length] } as CSSProperties}
                        >
                          H{hIdx}
                          <span
                            className="duet-dash-tool-heater-dot"
                            style={{ '--duet-heater-state': heaterStateColor(h.state) } as CSSProperties}
                          />
                        </span>
                        <span className="duet-dash-tool-heater-current">
                          {h.current.toFixed(1)}&deg;
                        </span>
                        <input
                          style={inputStyle(58)}
                          type="number"
                          step={1}
                          value={editingTemps[activeKey] ?? (tool.active[hi] ?? h.active).toString()}
                          onChange={(e) => setEditingTemps((p) => ({ ...p, [activeKey]: e.target.value }))}
                          onBlur={() => handleTempSubmit(activeKey, tool.number, hi, false)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleTempSubmit(activeKey, tool.number, hi, false); }}
                          title="Active temperature"
                        />
                        <input
                          style={inputStyle(58)}
                          type="number"
                          step={1}
                          value={editingTemps[standbyKey] ?? (tool.standby[hi] ?? h.standby).toString()}
                          onChange={(e) => setEditingTemps((p) => ({ ...p, [standbyKey]: e.target.value }))}
                          onBlur={() => handleTempSubmit(standbyKey, tool.number, hi, true)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleTempSubmit(standbyKey, tool.number, hi, true); }}
                          title="Standby temperature"
                        />
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            )}

            {tool.offsets && tool.offsets.some((o) => o !== 0) && (
              <div className="duet-dash-tool-section">
                <div className="duet-dash-tool-section-title">Offsets</div>
                <div className="duet-dash-tool-offsets">
                  {tool.offsets.map((offset, idx) => {
                    const axisLetter = ['X', 'Y', 'Z', 'U', 'V', 'W', 'A', 'B', 'C'][idx] ?? `#${idx}`;
                    return (
                      <div key={idx} className="duet-dash-tool-offset-chip" style={{ background: COLORS.inputBg }}>
                        <span className="duet-dash-tool-offset-axis">{axisLetter}:</span>{' '}
                        <span className="duet-dash-tool-offset-value">{offset.toFixed(3)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tool.extruders.length > 0 && (() => {
              const extruderIdx = tool.filamentExtruder >= 0
                ? tool.filamentExtruder
                : tool.extruders[0];
              const loaded = extrudersModel[extruderIdx]?.filament ?? '';
              return (
                <div className="duet-dash-tool-section">
                  <div className="duet-dash-tool-section-title">Filament</div>
                  <div className="duet-dash-tool-filament-row">
                    <Package size={12} color={COLORS.textDim} />
                    <select
                      style={{
                        ...inputStyle(),
                        flex: 1,
                        minWidth: 0,
                        width: 'auto',
                      }}
                      value={loaded}
                      onChange={(e) => {
                        const name = e.target.value;
                        if (!name) return;
                        if (loaded) changeFilament(tool.number, name);
                        else loadFilament(tool.number, name);
                      }}
                      title={loaded ? `Loaded: ${loaded} (pick another to swap)` : 'No filament loaded'}
                    >
                      <option value="">{loaded ? loaded : '— none —'}</option>
                      {filaments
                        .filter((n) => n !== loaded)
                        .map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                    <button
                      style={btnStyle('default', true)}
                      onClick={() => unloadFilament(tool.number)}
                      disabled={!loaded}
                      title="Unload filament (M702)"
                    >
                      Unload
                    </button>
                  </div>
                </div>
              );
            })()}

            <div className="duet-dash-tool-assigned-row">
              {tool.extruders.length > 0 && (
                <div className="duet-dash-tool-assigned-item">
                  <Droplets size={11} color={COLORS.textDim} />
                  <span className="duet-dash-tool-assigned-label">Extruders:</span>
                  <span>{tool.extruders.join(', ')}</span>
                </div>
              )}
              {tool.fans.length > 0 && (
                <div className="duet-dash-tool-assigned-item">
                  <Fan size={11} color={COLORS.textDim} />
                  <span className="duet-dash-tool-assigned-label">Fans:</span>
                  <span>
                    {tool.fans.map((fIdx) => {
                      const f = fans[fIdx];
                      return f?.name || `Fan ${fIdx}`;
                    }).join(', ')}
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
