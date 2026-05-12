import { useState, useCallback } from 'react';
import { Waves } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  compactPanelInputStyle as inputStyle,
  dashboardButtonStyle as btnStyle,
} from '../../../utils/printerPanelStyles';
import { DashboardPanel } from './DashboardPanel';

const SHAPER_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'mzv', label: 'MZV' },
  { value: 'zvd', label: 'ZVD' },
  { value: 'zvdd', label: 'ZVDD' },
  { value: 'zvddd', label: 'ZVDDD' },
  { value: 'ei', label: 'EI' },
  { value: 'ei2', label: '2HEI' },
  { value: 'ei3', label: '3HEI' },
];

export default function InputShaperPanel() {
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const [frequency, setFrequency] = useState<string>('40');
  const [damping, setDamping] = useState<string>('0.1');
  const [shaperType, setShaperType] = useState<string>('mzv');

  const apply = useCallback(() => {
    const freq = parseFloat(frequency);
    const damp = parseFloat(damping);
    if (isNaN(freq) || freq <= 0) return;

    const parts: string[] = ['M593'];
    parts.push(`P"${shaperType}"`);
    parts.push(`F${freq}`);
    if (!isNaN(damp) && damp >= 0) {
      parts.push(`S${damp}`);
    }

    sendGCode(parts.join(' '));
  }, [frequency, damping, shaperType, sendGCode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') apply();
    },
    [apply],
  );

  return (
    <DashboardPanel icon={Waves} title="Input Shaper">

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 10,
        }}
      >
        {/* Frequency */}
        <div>
          <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 2 }}>
            Frequency (Hz)
          </div>
          <input
            type="number"
            step={1}
            min={0}
            style={inputStyle()}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            onKeyDown={handleKeyDown}
            title="Shaper frequency in Hz"
          />
        </div>

        {/* Damping */}
        <div>
          <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 2 }}>
            Damping
          </div>
          <input
            type="number"
            step={0.01}
            min={0}
            max={1}
            style={inputStyle()}
            value={damping}
            onChange={(e) => setDamping(e.target.value)}
            onKeyDown={handleKeyDown}
            title="Damping ratio (0 to 1)"
          />
        </div>
      </div>

      {/* Shaper Type */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 2 }}>
          Type
        </div>
        <select
          value={shaperType}
          onChange={(e) => setShaperType(e.target.value)}
          style={{
            background: COLORS.inputBg,
            border: `1px solid ${COLORS.inputBorder}`,
            borderRadius: 4,
            color: COLORS.text,
            padding: '4px 6px',
            fontSize: 12,
            width: '100%',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        >
          {SHAPER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <button
        style={btnStyle('accent', false)}
        onClick={apply}
        title="Send M593 with current settings"
      >
        Apply Input Shaper
      </button>
    </DashboardPanel>
  );
}
