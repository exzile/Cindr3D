import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Home, MoveHorizontal, ChevronUp, ChevronDown } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  dashboardButtonStyle as btnStyle,
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../../utils/printerPanelStyles';

export default function AxisMovementPanel() {
  const model = usePrinterStore((s) => s.model);
  const moveAxis = usePrinterStore((s) => s.moveAxis);
  const homeAxes = usePrinterStore((s) => s.homeAxes);
  const setBabyStep = usePrinterStore((s) => s.setBabyStep);
  const jogDistance = usePrinterStore((s) => s.jogDistance);
  const setJogDistance = usePrinterStore((s) => s.setJogDistance);

  const axes = model.move?.axes ?? [];
  const jogDistances = [0.05, 0.1, 0.5, 1, 5, 10, 50, 100];
  const jogButtons = [-100, -10, -1, -0.1, 0.1, 1, 10, 100];

  const [babyStepValue, setBabyStepValue] = useState(0);

  return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <MoveHorizontal size={14} /> Axes &amp; Movement
      </div>

      <div className="duet-dash-axis-pos-wrap">
        {axes.map((ax, axIdx) => {
          const endstops = model.sensors?.endstops ?? [];
          const endstop = endstops[axIdx];
          let endstopColor = '#555577';
          let endstopTitle = 'No endstop configured';
          if (endstop) {
            if (endstop.type === 'unknown' || endstop.type === '') {
              endstopColor = '#555577';
              endstopTitle = 'No endstop configured';
            } else if (endstop.triggered) {
              endstopColor = COLORS.danger;
              endstopTitle = 'Endstop triggered';
            } else {
              endstopColor = COLORS.success;
              endstopTitle = 'Endstop not triggered';
            }
          }
          return (
            <div key={ax.letter} className="duet-dash-axis-card" style={{ background: COLORS.surface }}>
              <div className="duet-dash-axis-card-head">
                {ax.letter}
                {!ax.homed && <span className="duet-dash-axis-unhomed" style={{ color: COLORS.warning }}>?</span>}
                <div
                  className="duet-dash-axis-endstop-dot"
                  style={{
                    '--duet-axis-endstop': endstopColor,
                    '--duet-axis-endstop-glow': endstop?.triggered ? `0 0 5px ${endstopColor}` : 'none',
                  } as CSSProperties}
                  title={endstopTitle}
                />
              </div>
              <div className="duet-dash-axis-value">
                {ax.userPosition.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>

      {(() => {
        const compType = model.move?.compensation?.type;
        const hasComp = compType && compType !== 'none' && compType !== '';
        return (
          <div className="duet-dash-comp-row">
            <span
              className="duet-dash-comp-badge"
              style={{
                '--duet-comp-bg': hasComp ? 'rgba(34,197,94,0.15)' : 'rgba(136,136,170,0.15)',
                '--duet-comp-color': hasComp ? COLORS.success : COLORS.textDim,
                '--duet-comp-border': hasComp ? 'rgba(34,197,94,0.3)' : 'rgba(136,136,170,0.2)',
              } as CSSProperties}
            >
              Mesh Comp: {hasComp ? 'Active' : 'Off'}
            </span>
          </div>
        );
      })()}

      <div className="duet-dash-home-row">
        <button style={btnStyle('accent')} onClick={() => homeAxes()}>
          <Home size={13} /> Home All
        </button>
        {axes.map((ax) => (
          <button key={ax.letter} style={btnStyle()} onClick={() => homeAxes([ax.letter])}>
            <Home size={11} /> {ax.letter}
          </button>
        ))}
      </div>

      <div className="duet-dash-step-block">
        <div className="duet-dash-label-xs">Step Size (mm)</div>
        <div className="duet-dash-step-options">
          {jogDistances.map((d) => (
            <button
              key={d}
              style={{
                ...btnStyle(d === jogDistance ? 'accent' : 'default', true),
                fontFamily: 'monospace',
              }}
              onClick={() => setJogDistance(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {axes.map((ax) => (
        <div key={ax.letter} className="duet-dash-jog-row">
          <span className="duet-dash-jog-axis">{ax.letter}</span>
          {jogButtons.map((j) => (
            <button
              key={j}
              style={{
                ...btnStyle(j < 0 ? 'default' : 'default', true),
                fontFamily: 'monospace', minWidth: 44,
                background: j < 0 ? '#1a1a3a' : '#1a2a1a',
                color: j < 0 ? '#8888cc' : '#88cc88',
              }}
              onClick={() => moveAxis(ax.letter, j)}
            >
              {j > 0 ? `+${j}` : j}
            </button>
          ))}
        </div>
      ))}

      <div className="duet-dash-baby-block" style={{ borderTopColor: COLORS.panelBorder }}>
        <div className="duet-dash-label-xs duet-dash-baby-label">Baby Stepping (Z offset)</div>
        <div className="duet-dash-baby-row">
          <button style={btnStyle()} onClick={() => { setBabyStep(-0.02); setBabyStepValue((v) => v - 0.02); }}>
            <ChevronDown size={12} /> -0.02
          </button>
          <span className="duet-dash-baby-value">
            {babyStepValue.toFixed(3)} mm
          </span>
          <button style={btnStyle()} onClick={() => { setBabyStep(0.02); setBabyStepValue((v) => v + 0.02); }}>
            <ChevronUp size={12} /> +0.02
          </button>
        </div>
      </div>
    </div>
  );
}
