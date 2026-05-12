import { useCallback } from 'react';
import { ArrowUpDown, Minus, Plus, RotateCcw } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  dashboardButtonStyle as btnStyle,
} from '../../../utils/printerPanelStyles';
import { DashboardPanel } from './DashboardPanel';

export default function BabySteppingPanel() {
  const model = usePrinterStore((s) => s.model);
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  // Current baby step offset from Z axis (user vs machine position difference)
  const zAxis = model.move?.axes?.find((a) => a.letter === 'Z');
  const currentOffset = zAxis ? zAxis.userPosition - zAxis.machinePosition : 0;

  const stepRelative = useCallback(
    (value: number) => {
      sendGCode(`M290 S${value}`);
    },
    [sendGCode],
  );

  const resetOffset = useCallback(() => {
    sendGCode('M290 R0 S0');
  }, [sendGCode]);

  return (
    <DashboardPanel icon={ArrowUpDown} title="Baby Stepping">

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '4px 0 8px',
        }}
      >
        {/* -0.05 */}
        <button
          style={{
            ...btnStyle('default', true),
            width: 32,
            height: 32,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => stepRelative(-0.05)}
          title="Lower Z by 0.05mm"
        >
          <Minus size={10} />
          <Minus size={10} />
        </button>

        {/* -0.02 */}
        <button
          style={{
            ...btnStyle('default', true),
            width: 32,
            height: 32,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => stepRelative(-0.02)}
          title="Lower Z by 0.02mm"
        >
          <Minus size={12} />
        </button>

        {/* Current offset display */}
        <div style={{ textAlign: 'center', minWidth: 80 }}>
          <div style={{ fontSize: 9, color: COLORS.textDim, marginBottom: 1 }}>
            Z Offset
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: COLORS.text,
              fontFamily: 'monospace',
            }}
          >
            {currentOffset >= 0 ? '+' : ''}
            {currentOffset.toFixed(3)}
          </div>
          <div style={{ fontSize: 9, color: COLORS.textDim }}>mm</div>
        </div>

        {/* +0.02 */}
        <button
          style={{
            ...btnStyle('default', true),
            width: 32,
            height: 32,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => stepRelative(0.02)}
          title="Raise Z by 0.02mm"
        >
          <Plus size={12} />
        </button>

        {/* +0.05 */}
        <button
          style={{
            ...btnStyle('default', true),
            width: 32,
            height: 32,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => stepRelative(0.05)}
          title="Raise Z by 0.05mm"
        >
          <Plus size={10} />
          <Plus size={10} />
        </button>
      </div>

      {/* Reset button */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          style={btnStyle('danger', true)}
          onClick={resetOffset}
          title="Reset baby step offset to 0 (M290 R0 S0)"
        >
          <RotateCcw size={10} /> Reset
        </button>
      </div>
    </DashboardPanel>
  );
}
