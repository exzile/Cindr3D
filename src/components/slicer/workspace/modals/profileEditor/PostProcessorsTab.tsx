import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { colors, sharedStyles } from '../../../../../utils/theme';
import type { LayerProcessor, LayerProcessorKind } from '../../../../../types/slicer/profiles/print';
import { fieldRow, inputStyle, labelStyle, selectStyle } from './shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const KIND_LABELS: Record<LayerProcessorKind, string> = {
  'change-at-z':       'Change settings at Z',
  'pause-at-z':        'Pause at Z',
  'filament-change':   'Filament change at Z',
  'tuning-tower':      'Tuning tower (ramp)',
  'search-replace':    'Search & replace',
  'timelapse':         'Timelapse capture',
  'custom-gcode-at-z': 'Custom G-code at Z',
  'print-from-height': 'Print from height',
};

const ALL_KINDS: LayerProcessorKind[] = [
  'change-at-z', 'pause-at-z', 'filament-change', 'tuning-tower',
  'search-replace', 'timelapse', 'custom-gcode-at-z', 'print-from-height',
];

function makeDefault(kind: LayerProcessorKind): LayerProcessor {
  const base: LayerProcessor = { id: uid(), enabled: true, kind, triggerMode: 'z', triggerZ: 5 };
  switch (kind) {
    case 'change-at-z':
      return { ...base, changeTemperature: true, changeTemperatureValue: 210 };
    case 'pause-at-z':
      return { ...base, pauseCommand: 'M0', displayText: 'Paused' };
    case 'filament-change':
      return { ...base, displayText: 'Change filament' };
    case 'tuning-tower':
      return {
        ...base,
        triggerMode: undefined,
        triggerZ: undefined,
        tuningParameter: 'temperature',
        tuningStartZ: 0,
        tuningEndZ: 50,
        tuningStartValue: 230,
        tuningEndValue: 200,
        tuningStepSize: 5,
      };
    case 'search-replace':
      return { ...base, triggerMode: undefined, triggerZ: undefined, searchPattern: '', searchFlags: 'g', replaceWith: '' };
    case 'timelapse':
      return { ...base, triggerMode: undefined, triggerZ: undefined, timelapseCommand: 'M240', timelapseStartLayer: 0 };
    case 'custom-gcode-at-z':
      return { ...base, customGcode: '; custom gcode here' };
    case 'print-from-height':
      return { ...base, triggerMode: undefined, triggerZ: undefined, printFromZ: 0 };
  }
}

// ── Inline style constants ────────────────────────────────────────────────────

const cardStyle = {
  border: `1px solid ${colors.panelBorder}`,
  borderRadius: 6,
  marginBottom: 8,
  background: colors.elevated,
  overflow: 'hidden' as const,
};

const cardHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  cursor: 'pointer',
  userSelect: 'none' as const,
};

const cardBodyStyle = {
  padding: '10px 12px 12px',
  borderTop: `1px solid ${colors.panelBorder}`,
  background: colors.panel,
};

const kindBadgeStyle = {
  fontSize: 10,
  color: colors.textDim,
  background: colors.panelBorder,
  borderRadius: 3,
  padding: '1px 5px',
  marginLeft: 'auto',
};

const iconBtnStyle = {
  background: 'none',
  border: 'none',
  padding: 4,
  cursor: 'pointer',
  color: colors.textDim,
  display: 'flex',
  alignItems: 'center',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle as React.CSSProperties,
  width: '100%',
  minHeight: 80,
  fontFamily: 'monospace',
  fontSize: 11,
  resize: 'vertical',
};

// ── Sub-editors per kind ──────────────────────────────────────────────────────

function TriggerFields({ p, upd }: { p: LayerProcessor; upd: (patch: Partial<LayerProcessor>) => void }) {
  return (
    <>
      <div style={fieldRow}>
        <div style={labelStyle}>Trigger by</div>
        <select
          style={selectStyle}
          value={p.triggerMode ?? 'z'}
          onChange={(e) => upd({ triggerMode: e.target.value as 'z' | 'layer' })}
        >
          <option value="z">Z height (mm)</option>
          <option value="layer">Layer number</option>
        </select>
      </div>
      {(p.triggerMode ?? 'z') === 'z' ? (
        <div style={fieldRow}>
          <div style={labelStyle}>Z height (mm)</div>
          <input
            type="number"
            style={inputStyle}
            step={0.1}
            min={0}
            value={p.triggerZ ?? 0}
            onChange={(e) => upd({ triggerZ: parseFloat(e.target.value) || 0 })}
          />
        </div>
      ) : (
        <div style={fieldRow}>
          <div style={labelStyle}>Layer number (0-based)</div>
          <input
            type="number"
            style={inputStyle}
            step={1}
            min={0}
            value={p.triggerLayer ?? 0}
            onChange={(e) => upd({ triggerLayer: parseInt(e.target.value) || 0 })}
          />
        </div>
      )}
    </>
  );
}

function ChangeAtZFields({ p, upd }: { p: LayerProcessor; upd: (patch: Partial<LayerProcessor>) => void }) {
  return (
    <>
      <TriggerFields p={p} upd={upd} />
      <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 8 }}>
        Enable the settings you want to change:
      </div>

      <CheckedField
        label="Print temperature (°C)"
        checked={p.changeTemperature ?? false}
        onCheck={(v) => upd({ changeTemperature: v })}
        value={p.changeTemperatureValue ?? 210}
        onValue={(v) => upd({ changeTemperatureValue: v })}
        step={1} min={150} max={320}
      />
      <CheckedField
        label="Bed temperature (°C)"
        checked={p.changeBedTemperature ?? false}
        onCheck={(v) => upd({ changeBedTemperature: v })}
        value={p.changeBedTemperatureValue ?? 60}
        onValue={(v) => upd({ changeBedTemperatureValue: v })}
        step={1} min={0} max={120}
      />
      <CheckedField
        label="Fan speed (0–255)"
        checked={p.changeFanSpeed ?? false}
        onCheck={(v) => upd({ changeFanSpeed: v })}
        value={p.changeFanSpeedValue ?? 255}
        onValue={(v) => upd({ changeFanSpeedValue: v })}
        step={1} min={0} max={255}
      />
      <CheckedField
        label="Print speed override (%)"
        checked={p.changePrintSpeed ?? false}
        onCheck={(v) => upd({ changePrintSpeed: v })}
        value={p.changePrintSpeedValue ?? 100}
        onValue={(v) => upd({ changePrintSpeedValue: v })}
        step={5} min={1} max={500}
      />
      <CheckedField
        label="Flow rate (%)"
        checked={p.changeFlowRate ?? false}
        onCheck={(v) => upd({ changeFlowRate: v })}
        value={p.changeFlowRateValue ?? 100}
        onValue={(v) => upd({ changeFlowRateValue: v })}
        step={1} min={50} max={150}
      />
    </>
  );
}

function CheckedField({
  label, checked, onCheck, value, onValue, step, min, max,
}: {
  label: string;
  checked: boolean;
  onCheck: (v: boolean) => void;
  value: number;
  onValue: (v: number) => void;
  step: number; min: number; max: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheck(e.target.checked)}
        style={{ accentColor: colors.accent, flexShrink: 0 }}
      />
      <span style={{ ...labelStyle as React.CSSProperties, flex: 1, marginBottom: 0 }}>{label}</span>
      <input
        type="number"
        style={{ ...inputStyle as React.CSSProperties, width: 72 }}
        disabled={!checked}
        step={step} min={min} max={max}
        value={value}
        onChange={(e) => onValue(parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}

function PauseAtZFields({ p, upd }: { p: LayerProcessor; upd: (patch: Partial<LayerProcessor>) => void }) {
  return (
    <>
      <TriggerFields p={p} upd={upd} />
      <div style={fieldRow}>
        <div style={labelStyle}>Pause command</div>
        <select
          style={selectStyle}
          value={p.pauseCommand ?? 'M0'}
          onChange={(e) => upd({ pauseCommand: e.target.value as 'M0' | 'M25' | 'M600' })}
        >
          <option value="M0">M0 — unconditional stop</option>
          <option value="M25">M25 — SD card pause</option>
          <option value="M600">M600 — filament change</option>
        </select>
      </div>
      <div style={fieldRow}>
        <div style={labelStyle}>LCD message (optional)</div>
        <input
          style={inputStyle}
          placeholder="e.g. Insert magnet"
          value={p.displayText ?? ''}
          onChange={(e) => upd({ displayText: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ ...fieldRow, flex: 1 }}>
          <div style={labelStyle}>Park X (mm, optional)</div>
          <input
            type="number"
            style={inputStyle}
            placeholder="—"
            value={p.parkX ?? ''}
            onChange={(e) => upd({ parkX: e.target.value !== '' ? parseFloat(e.target.value) : undefined })}
          />
        </div>
        <div style={{ ...fieldRow, flex: 1 }}>
          <div style={labelStyle}>Park Y (mm, optional)</div>
          <input
            type="number"
            style={inputStyle}
            placeholder="—"
            value={p.parkY ?? ''}
            onChange={(e) => upd({ parkY: e.target.value !== '' ? parseFloat(e.target.value) : undefined })}
          />
        </div>
      </div>
    </>
  );
}

function FilamentChangeFields({ p, upd }: { p: LayerProcessor; upd: (patch: Partial<LayerProcessor>) => void }) {
  return (
    <>
      <TriggerFields p={p} upd={upd} />
      <div style={fieldRow}>
        <div style={labelStyle}>LCD message (optional)</div>
        <input
          style={inputStyle}
          placeholder="e.g. Change to white PLA"
          value={p.displayText ?? ''}
          onChange={(e) => upd({ displayText: e.target.value })}
        />
      </div>
    </>
  );
}

function TuningTowerFields({ p, upd }: { p: LayerProcessor; upd: (patch: Partial<LayerProcessor>) => void }) {
  return (
    <>
      <div style={fieldRow}>
        <div style={labelStyle}>Parameter to ramp</div>
        <select
          style={selectStyle}
          value={p.tuningParameter ?? 'temperature'}
          onChange={(e) => upd({ tuningParameter: e.target.value as LayerProcessor['tuningParameter'] })}
        >
          <option value="temperature">Print temperature (°C)</option>
          <option value="bed-temperature">Bed temperature (°C)</option>
          <option value="fan">Fan speed (0–255)</option>
          <option value="speed">Print speed override (%)</option>
          <option value="flow">Flow rate (%)</option>
          <option value="pressure-advance">Pressure advance (0.000–1.000)</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ ...fieldRow, flex: 1 }}>
          <div style={labelStyle}>Start Z (mm)</div>
          <input type="number" style={inputStyle} step={0.5} min={0}
            value={p.tuningStartZ ?? 0}
            onChange={(e) => upd({ tuningStartZ: parseFloat(e.target.value) || 0 })} />
        </div>
        <div style={{ ...fieldRow, flex: 1 }}>
          <div style={labelStyle}>End Z (mm)</div>
          <input type="number" style={inputStyle} step={0.5} min={0}
            value={p.tuningEndZ ?? 50}
            onChange={(e) => upd({ tuningEndZ: parseFloat(e.target.value) || 50 })} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ ...fieldRow, flex: 1 }}>
          <div style={labelStyle}>Value at start Z</div>
          <input type="number" style={inputStyle}
            step={p.tuningParameter === 'pressure-advance' ? 0.001 : 1}
            value={p.tuningStartValue ?? (p.tuningParameter === 'pressure-advance' ? 0 : 230)}
            onChange={(e) => upd({ tuningStartValue: parseFloat(e.target.value) })} />
        </div>
        <div style={{ ...fieldRow, flex: 1 }}>
          <div style={labelStyle}>Value at end Z</div>
          <input type="number" style={inputStyle}
            step={p.tuningParameter === 'pressure-advance' ? 0.001 : 1}
            value={p.tuningEndValue ?? (p.tuningParameter === 'pressure-advance' ? 0.08 : 200)}
            onChange={(e) => upd({ tuningEndValue: parseFloat(e.target.value) })} />
        </div>
      </div>
      <div style={fieldRow}>
        <div style={labelStyle}>Step size (mm, 0 = every layer)</div>
        <input type="number" style={inputStyle} step={1} min={0}
          value={p.tuningStepSize ?? 5}
          onChange={(e) => upd({ tuningStepSize: parseFloat(e.target.value) || 0 })} />
      </div>
    </>
  );
}

function SearchReplaceFields({ p, upd }: { p: LayerProcessor; upd: (patch: Partial<LayerProcessor>) => void }) {
  return (
    <>
      <div style={fieldRow}>
        <div style={labelStyle}>Search pattern (regex)</div>
        <input
          style={{ ...inputStyle as React.CSSProperties, fontFamily: 'monospace' }}
          placeholder="e.g. M104 S210"
          value={p.searchPattern ?? ''}
          onChange={(e) => upd({ searchPattern: e.target.value })}
        />
      </div>
      <div style={fieldRow}>
        <div style={labelStyle}>Regex flags</div>
        <input
          style={{ ...inputStyle as React.CSSProperties, width: 80 }}
          placeholder="g"
          value={p.searchFlags ?? 'g'}
          onChange={(e) => upd({ searchFlags: e.target.value })}
        />
      </div>
      <div style={fieldRow}>
        <div style={labelStyle}>Replace with (supports $1 back-refs)</div>
        <input
          style={{ ...inputStyle as React.CSSProperties, fontFamily: 'monospace' }}
          placeholder="e.g. M104 S215"
          value={p.replaceWith ?? ''}
          onChange={(e) => upd({ replaceWith: e.target.value })}
        />
      </div>
    </>
  );
}

function TimelapseFields({ p, upd }: { p: LayerProcessor; upd: (patch: Partial<LayerProcessor>) => void }) {
  return (
    <>
      <div style={fieldRow}>
        <div style={labelStyle}>Camera shutter G-code</div>
        <input
          style={{ ...inputStyle as React.CSSProperties, fontFamily: 'monospace' }}
          placeholder="M240"
          value={p.timelapseCommand ?? 'M240'}
          onChange={(e) => upd({ timelapseCommand: e.target.value })}
        />
      </div>
      <div style={fieldRow}>
        <div style={labelStyle}>Start capturing at layer (0-based)</div>
        <input
          type="number"
          style={inputStyle}
          step={1} min={0}
          value={p.timelapseStartLayer ?? 0}
          onChange={(e) => upd({ timelapseStartLayer: parseInt(e.target.value) || 0 })}
        />
      </div>
      <div style={{ fontSize: 11, color: colors.textDim }}>
        The command is injected after each layer-change marker.
        Common values: <code>M240</code> (Marlin), <code>SNAPSHOT</code> (Klipper macro).
      </div>
    </>
  );
}

function CustomGcodeAtZFields({ p, upd }: { p: LayerProcessor; upd: (patch: Partial<LayerProcessor>) => void }) {
  return (
    <>
      <TriggerFields p={p} upd={upd} />
      <div style={fieldRow}>
        <div style={labelStyle}>G-code to inject</div>
        <textarea
          style={textareaStyle}
          placeholder={'; e.g.\nM104 S215\nM106 S200'}
          value={p.customGcode ?? ''}
          onChange={(e) => upd({ customGcode: e.target.value })}
        />
      </div>
    </>
  );
}

function PrintFromHeightFields({ p, upd }: { p: LayerProcessor; upd: (patch: Partial<LayerProcessor>) => void }) {
  return (
    <>
      <div style={fieldRow}>
        <div style={labelStyle}>Skip all layers below Z (mm)</div>
        <input
          type="number"
          style={inputStyle}
          step={0.1} min={0}
          value={p.printFromZ ?? 0}
          onChange={(e) => upd({ printFromZ: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <div style={{ fontSize: 11, color: colors.textDim }}>
        Useful for reprinting the top of a failed print. Move/home as normal —
        start-G-code still runs; only layer moves below this Z are suppressed.
      </div>
    </>
  );
}

function ProcessorFields({ p, upd }: { p: LayerProcessor; upd: (patch: Partial<LayerProcessor>) => void }) {
  switch (p.kind) {
    case 'change-at-z':       return <ChangeAtZFields p={p} upd={upd} />;
    case 'pause-at-z':        return <PauseAtZFields p={p} upd={upd} />;
    case 'filament-change':   return <FilamentChangeFields p={p} upd={upd} />;
    case 'tuning-tower':      return <TuningTowerFields p={p} upd={upd} />;
    case 'search-replace':    return <SearchReplaceFields p={p} upd={upd} />;
    case 'timelapse':         return <TimelapseFields p={p} upd={upd} />;
    case 'custom-gcode-at-z': return <CustomGcodeAtZFields p={p} upd={upd} />;
    case 'print-from-height': return <PrintFromHeightFields p={p} upd={upd} />;
  }
}

// ── Processor card ────────────────────────────────────────────────────────────

function ProcessorCard({
  p,
  onChange,
  onDelete,
}: {
  p: LayerProcessor;
  onChange: (updated: LayerProcessor) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const upd = (patch: Partial<LayerProcessor>) => onChange({ ...p, ...patch });

  const triggerLabel = p.triggerMode === 'layer'
    ? `layer ${p.triggerLayer ?? 0}`
    : p.triggerZ != null
      ? `Z ${p.triggerZ.toFixed(1)} mm`
      : '';

  return (
    <div style={cardStyle}>
      {/* Header row */}
      <div style={cardHeaderStyle} onClick={() => setExpanded((v) => !v)}>
        <input
          type="checkbox"
          checked={p.enabled}
          style={{ accentColor: colors.accent, flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => upd({ enabled: e.target.checked })}
        />
        <span style={{ color: p.enabled ? colors.text : colors.textDim, fontSize: 12, fontWeight: 500 }}>
          {KIND_LABELS[p.kind]}
          {triggerLabel && (
            <span style={{ fontWeight: 400, color: colors.textDim }}> · {triggerLabel}</span>
          )}
        </span>
        <span style={kindBadgeStyle}>{p.kind}</span>
        <button
          type="button"
          style={{ ...iconBtnStyle, color: '#e04e4e' }}
          title="Remove"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 size={13} />
        </button>
        {expanded
          ? <ChevronDown size={13} style={{ color: colors.textDim, flexShrink: 0 }} />
          : <ChevronRight size={13} style={{ color: colors.textDim, flexShrink: 0 }} />}
      </div>

      {/* Body */}
      {expanded && (
        <div style={cardBodyStyle}>
          <ProcessorFields p={p} upd={upd} />
        </div>
      )}
    </div>
  );
}

// ── Tab root ──────────────────────────────────────────────────────────────────

export function PostProcessorsTab({
  processors,
  onChange,
}: {
  processors: LayerProcessor[];
  onChange: (updated: LayerProcessor[]) => void;
}) {
  const [newKind, setNewKind] = useState<LayerProcessorKind>('change-at-z');

  const add = () => onChange([...processors, makeDefault(newKind)]);

  const update = (index: number, updated: LayerProcessor) => {
    const next = [...processors];
    next[index] = updated;
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(processors.filter((_, i) => i !== index));
  };

  return (
    <div style={{ padding: 12 }}>
      {/* Description */}
      <p style={{ fontSize: 12, color: colors.textDim, marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        Post-processors modify G-code after slicing. Layer-aware processors
        (ChangeAtZ, pause, timelapse, …) run first; search &amp; replace runs last on
        the assembled string.
      </p>

      {/* Processor list */}
      {processors.length === 0 && (
        <div style={{ fontSize: 12, color: colors.textDim, marginBottom: 12, fontStyle: 'italic' }}>
          No post-processors. Add one below.
        </div>
      )}
      {processors.map((p, i) => (
        <ProcessorCard
          key={p.id}
          p={p}
          onChange={(updated) => update(i, updated)}
          onDelete={() => remove(i)}
        />
      ))}

      {/* Add row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <select
          style={{ ...selectStyle as React.CSSProperties, flex: 1 }}
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as LayerProcessorKind)}
        >
          {ALL_KINDS.map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
        <button
          type="button"
          style={{
            ...sharedStyles.btnAccent as React.CSSProperties,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
            whiteSpace: 'nowrap',
          }}
          onClick={add}
        >
          <Plus size={13} />
          Add
        </button>
      </div>

      {/* Legacy script editor */}
      <details style={{ marginTop: 20 }}>
        <summary style={{ fontSize: 12, color: colors.textDim, cursor: 'pointer', userSelect: 'none' }}>
          Legacy: simple script hooks (prepend:/append:/replace:)
        </summary>
        <div style={{ marginTop: 8, fontSize: 11, color: colors.textDim, lineHeight: 1.5 }}>
          Use the <strong>postProcessingScripts</strong> field in the profile JSON for
          simple <code>prepend:</code>, <code>append:</code>, and{' '}
          <code>replace:/pattern/flags=&gt;text</code> directives.
          These run on the final assembled G-code string after all layer processors.
        </div>
      </details>
    </div>
  );
}
