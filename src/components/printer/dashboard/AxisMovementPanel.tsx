import type { CSSProperties } from 'react';
import {
  Home, MoveHorizontal, RotateCcw,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
} from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import { DashboardPanel } from './DashboardPanel';

const DEFAULT_AXES = ['X', 'Y', 'Z'];
const PLANAR_AXES = ['X', 'Y'];
const Z_AXIS = 'Z';

const AXIS_ACCENT: Record<string, string> = {
  X: '#9b8fe8',
  Y: '#56c98a',
  Z: '#e8b84b',
};

const NEG_AMOUNTS = [-100, -10, -1, -0.1];
const POS_AMOUNTS = [0.1, 1, 10, 100];

export default function AxisMovementPanel() {
  const model = usePrinterStore((s) => s.model);
  const connected = usePrinterStore((s) => s.connected);
  const moveAxis = usePrinterStore((s) => s.moveAxis);
  const homeAxes = usePrinterStore((s) => s.homeAxes);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const jogDistance = usePrinterStore((s) => s.jogDistance);
  const setJogDistance = usePrinterStore((s) => s.setJogDistance);

  const liveAxes = model.move?.axes ?? [];
  const jogDistances = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100];

  const zAxis = liveAxes.find((a) => a.letter === 'Z');
  const babyOffset = zAxis ? zAxis.userPosition - zAxis.machinePosition : 0;

  const axisLetters: string[] = liveAxes.length > 0
    ? liveAxes.map((a) => a.letter)
    : DEFAULT_AXES;

  const getAxisData = (letter: string) => liveAxes.find((a) => a.letter === letter);
  const extraAxes = axisLetters.filter((l) => !PLANAR_AXES.includes(l) && l !== Z_AXIS);

  return (
    <DashboardPanel icon={MoveHorizontal} title="Axes & Movement" className="ax-panel">

      {/* ============================================================
          Position cards
      ============================================================ */}
      <div className="ax-pos-row">
        {axisLetters.map((letter, axIdx) => {
          const ax = getAxisData(letter);
          const accent = AXIS_ACCENT[letter] ?? '#888899';
          const endstops = model.sensors?.endstops ?? [];
          const endstop = endstops[axIdx];
          let dotColor = 'rgba(136,136,170,0.4)';
          let dotTitle = 'No endstop';
          if (endstop?.triggered) { dotColor = COLORS.danger; dotTitle = 'Triggered'; }
          else if (endstop?.type && endstop.type !== 'unknown' && endstop.type !== '') {
            dotColor = COLORS.success; dotTitle = 'OK';
          }
          return (
            <div
              key={letter}
              className="ax-pos-card"
              style={{ '--ax': accent } as CSSProperties}
            >
              <div className="ax-pos-card-top">
                <span className="ax-pos-label">{letter}</span>
                <div className="ax-pos-indicators">
                  {ax && !ax.homed && <span className="ax-unhomed" title="Not homed">!</span>}
                  <span className="ax-dot" style={{ background: dotColor }} title={dotTitle} />
                </div>
              </div>
              <div className="ax-pos-value">{ax ? ax.userPosition.toFixed(2) : '--'}</div>
              <div className="ax-pos-unit">mm</div>
            </div>
          );
        })}
      </div>

      {/* ============================================================
          Home + mesh row
      ============================================================ */}
      <div className="ax-toolbar">
        {(() => {
          const compType = model.move?.compensation?.type;
          const on = compType && compType !== 'none' && compType !== '';
          return (
            <span className={`ax-mesh-badge${on ? ' ax-mesh-badge--on' : ''}`}>
              {on ? 'Mesh On' : 'Mesh Off'}
            </span>
          );
        })()}
        <div className="ax-home-row">
          <button className="ax-btn ax-btn--home-all" disabled={!connected} onClick={() => homeAxes()}>
            <Home size={12} /> All
          </button>
          {axisLetters.map((letter) => (
            <button
              key={letter}
              className="ax-btn ax-btn--home"
              style={{ '--ax': AXIS_ACCENT[letter] ?? '#888' } as CSSProperties}
              disabled={!connected}
              onClick={() => homeAxes([letter])}
            >
              <Home size={11} /> {letter}
            </button>
          ))}
        </div>
      </div>

      <div className="ax-motion-workspace">
        <div className="ax-card ax-card--jog">
          <div className="ax-jog-sections">

            {/* XY */}
            <div className="ax-jog-section">
              <div className="ax-card-label" style={{ textAlign: 'center' }}>XY Plane</div>
              <div className="ax-cross">
                <button className="ax-cross-btn" style={{ gridArea: 'yp' }}
                  disabled={!connected} title={`Y +${jogDistance}`}
                  onClick={() => moveAxis('Y', jogDistance)}>
                  <ArrowUp size={17} />
                </button>
                <button className="ax-cross-btn" style={{ gridArea: 'xn' }}
                  disabled={!connected} title={`X -${jogDistance}`}
                  onClick={() => moveAxis('X', -jogDistance)}>
                  <ArrowLeft size={17} />
                </button>
                <button className="ax-cross-home" style={{ gridArea: 'ct' }}
                  disabled={!connected} title="Home XY"
                  onClick={() => homeAxes(['X', 'Y'])}>
                  <Home size={14} />
                </button>
                <button className="ax-cross-btn" style={{ gridArea: 'xp' }}
                  disabled={!connected} title={`X +${jogDistance}`}
                  onClick={() => moveAxis('X', jogDistance)}>
                  <ArrowRight size={17} />
                </button>
                <button className="ax-cross-btn" style={{ gridArea: 'yn' }}
                  disabled={!connected} title={`Y -${jogDistance}`}
                  onClick={() => moveAxis('Y', -jogDistance)}>
                  <ArrowDown size={17} />
                </button>
              </div>
              <div className="ax-cross-foot">
                <span style={{ color: AXIS_ACCENT['X'] }}>X</span>
                <span style={{ color: AXIS_ACCENT['Y'] }}>Y</span>
              </div>
            </div>

            {/* Z */}
            <div className="ax-jog-section">
              <div className="ax-card-label" style={{ textAlign: 'center' }}>Z Axis</div>
              <div className="ax-z-col">
                <button className="ax-z-btn ax-z-btn--up" disabled={!connected}
                  title={`Z +${jogDistance}`} onClick={() => moveAxis('Z', jogDistance)}>
                  <ArrowUp size={16} />
                  <span>Z+</span>
                </button>
                <button className="ax-z-home" disabled={!connected}
                  title="Home Z" onClick={() => homeAxes(['Z'])}>
                  <Home size={13} />
                </button>
                <button className="ax-z-btn ax-z-btn--down" disabled={!connected}
                  title={`Z -${jogDistance}`} onClick={() => moveAxis('Z', -jogDistance)}>
                  <ArrowDown size={16} />
                  <span>Z-</span>
                </button>
              </div>
            </div>

          </div>
        </div>

        <div className="ax-card ax-card--step ax-step-rail">
          <div className="ax-card-label">Step size &mdash; mm</div>
          <div className="ax-step-row">
            {jogDistances.map((d) => (
              <button
                key={d}
                className={`ax-step-btn${d === jogDistance ? ' is-active' : ''}`}
                onClick={() => setJogDistance(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ax-card ax-card--qm">
        <div className="ax-card-label">Quick Move &mdash; mm</div>
        <div className="ax-qm-block">
          {['X', 'Y', 'Z'].map((letter) => (
            <div key={letter} className="ax-qm-row">
              <span className="ax-qm-label" style={{ color: AXIS_ACCENT[letter] }}>{letter}</span>
              {NEG_AMOUNTS.map((amt) => (
                <button key={amt} className="ax-qm-btn ax-qm-btn--neg"
                  disabled={!connected} onClick={() => moveAxis(letter, amt)}>
                  {amt}
                </button>
              ))}
              <div className="ax-qm-sep" />
              {POS_AMOUNTS.map((amt) => (
                <button key={amt} className="ax-qm-btn ax-qm-btn--pos"
                  disabled={!connected} onClick={() => moveAxis(letter, amt)}>
                  +{amt}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Extra axes */}
      {extraAxes.length > 0 && (
        <div className="ax-card">
          {extraAxes.map((letter) => (
            <div key={letter} className="ax-extra-row">
              <button className="ax-btn ax-btn--jog-neg" disabled={!connected}
                onClick={() => moveAxis(letter, -jogDistance)}>
                <ArrowDown size={12} /> -{jogDistance}
              </button>
              <span className="ax-extra-label">{letter}</span>
              <button className="ax-btn ax-btn--jog-pos" disabled={!connected}
                onClick={() => moveAxis(letter, jogDistance)}>
                <ArrowUp size={12} /> +{jogDistance}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ============================================================
          Baby stepping
      ============================================================ */}
      <div className="ax-card ax-card--baby ax-baby-card">
        <div className="ax-card-label">Baby Step Z</div>
        <div className="ax-baby-row">
          <button className="ax-btn ax-btn--baby" disabled={!connected}
            title="Z -0.05 mm" onClick={() => sendGCode('M290 S-0.05')}>
            −−
          </button>
          <button className="ax-btn ax-btn--baby" disabled={!connected}
            title="Z -0.02 mm" onClick={() => sendGCode('M290 S-0.02')}>
            −0.02
          </button>
          <div className="ax-baby-display">
            <span style={{ fontSize: 8, color: COLORS.textDim, lineHeight: 1 }}>Z Offset</span>
            <span className="ax-baby-num">
              {babyOffset >= 0 ? '+' : ''}{babyOffset.toFixed(3)}
            </span>
            <span className="ax-baby-unit">mm</span>
          </div>
          <button className="ax-btn ax-btn--baby" disabled={!connected}
            title="Z +0.02 mm" onClick={() => sendGCode('M290 S0.02')}>
            +0.02
          </button>
          <button className="ax-btn ax-btn--baby" disabled={!connected}
            title="Z +0.05 mm" onClick={() => sendGCode('M290 S0.05')}>
            ++
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 5 }}>
          <button
            className="ax-btn"
            style={{ fontSize: 9, height: 22, color: COLORS.danger, borderColor: `${COLORS.danger}44` }}
            disabled={!connected}
            title="Reset baby step offset (M290 R0 S0)"
            onClick={() => sendGCode('M290 R0 S0')}
          >
            <RotateCcw size={10} /> Reset
          </button>
        </div>
      </div>

    </DashboardPanel>
  );
}
