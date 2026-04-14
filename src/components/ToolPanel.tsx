import { useState, useRef, useCallback, useEffect } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import { useCADStore } from '../store/cadStore';
import type { Tool } from '../types/cad';

// ── Tool definitions ──────────────────────────────────────────────────────────

interface ToolConfig {
  label: string;
  instructions: string;
  fields: FieldDef[];
}

interface FieldDef {
  key: string;
  label: string;
  type: 'number' | 'toggle' | 'select';
  defaultValue: number | boolean | string;
  options?: string[];       // for select
  unit?: string;
  min?: number;
  step?: number;
}

const TOOL_CONFIGS: Partial<Record<Tool, ToolConfig>> = {
  line: {
    label: 'Line',
    instructions: 'Click to set start point, click again to set end point. ESC to cancel.',
    fields: [
      { key: 'construction', label: 'Construction', type: 'toggle', defaultValue: false },
    ],
  },
  circle: {
    label: 'Circle',
    instructions: 'Click to set center, click again to set radius.',
    fields: [
      { key: 'radiusInput', label: 'Radius', type: 'number', defaultValue: 10, unit: 'mm', min: 0.01, step: 0.5 },
      { key: 'fixedRadius', label: 'Fixed Radius', type: 'toggle', defaultValue: false },
    ],
  },
  rectangle: {
    label: 'Rectangle',
    instructions: 'Click first corner, click opposite corner.',
    fields: [
      { key: 'widthInput', label: 'Width', type: 'number', defaultValue: 20, unit: 'mm', min: 0.01, step: 1 },
      { key: 'heightInput', label: 'Height', type: 'number', defaultValue: 20, unit: 'mm', min: 0.01, step: 1 },
      { key: 'centered', label: 'Centered', type: 'toggle', defaultValue: false },
    ],
  },
  arc: {
    label: 'Arc',
    instructions: 'Click center, then start point, then end point.',
    fields: [
      { key: 'radiusInput', label: 'Radius', type: 'number', defaultValue: 10, unit: 'mm', min: 0.01, step: 0.5 },
    ],
  },
  polygon: {
    label: 'Polygon',
    instructions: 'Click center, then set radius.',
    fields: [
      { key: 'sides', label: 'Sides', type: 'number', defaultValue: 6, min: 3, step: 1 },
      { key: 'inscribed', label: 'Mode', type: 'select', defaultValue: 'inscribed', options: ['inscribed', 'circumscribed'] },
    ],
  },
  spline: {
    label: 'Spline',
    instructions: 'Click to add control points. Double-click or press Enter to finish.',
    fields: [],
  },
  slot: {
    label: 'Slot',
    instructions: 'Click center-left, then center-right.',
    fields: [
      { key: 'widthInput', label: 'Width', type: 'number', defaultValue: 20, unit: 'mm', min: 0.01, step: 1 },
      { key: 'radiusInput', label: 'Radius', type: 'number', defaultValue: 5, unit: 'mm', min: 0.01, step: 0.5 },
    ],
  },
  'construction-line': {
    label: 'Construction Line',
    instructions: 'Click to set start point, click again to set end point.',
    fields: [],
  },
  dimension: {
    label: 'Dimension',
    instructions: 'Click an entity to add a dimension.',
    fields: [
      { key: 'dimType', label: 'Type', type: 'select', defaultValue: 'linear', options: ['linear', 'angular', 'radial', 'diameter'] },
    ],
  },
};

// ── Draggable panel ──────────────────────────────────────────────────────────

export default function ToolPanel() {
  const activeTool = useCADStore((s) => s.activeTool);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const setActiveTool = useCADStore((s) => s.setActiveTool);

  const config = TOOL_CONFIGS[activeTool];

  // Only show while in sketch mode with a tool that has a config
  const visible = !!activeSketch && !!config;

  // Field values
  const [values, setValues] = useState<Record<string, number | boolean | string>>({});
  const [dismissed, setDismissed] = useState<Tool | null>(null);

  // Reset dismissal when tool changes
  useEffect(() => {
    if (dismissed !== activeTool) setDismissed(null);
    // Initialize defaults
    if (config) {
      const defaults: Record<string, number | boolean | string> = {};
      for (const f of config.fields) defaults[f.key] = f.defaultValue;
      setValues(defaults);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // Dragging
  const panelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [pos, setPos] = useState({ x: 16, y: -1 }); // -1 means use default bottom offset

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      setPos({ x: dragState.current.origX + dx, y: dragState.current.origY + dy });
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  if (!visible || dismissed === activeTool || !config) return null;

  const posStyle: React.CSSProperties = pos.y === -1
    ? { left: pos.x, bottom: 48 }          // default: bottom-left
    : { left: pos.x, top: pos.y };          // after first drag: fixed position

  const setValue = (key: string, val: number | boolean | string) =>
    setValues(prev => ({ ...prev, [key]: val }));

  return (
    <div ref={panelRef} className="tool-panel" style={{ ...posStyle, position: 'absolute' }}>
      {/* Header */}
      <div className="tool-panel-header" onMouseDown={onDragStart}>
        <GripHorizontal size={12} className="tool-panel-grip" />
        <span className="tool-panel-title">{config.label}</span>
        <button className="tool-panel-close" onMouseDown={e => e.stopPropagation()} onClick={() => setDismissed(activeTool)}>
          <X size={11} />
        </button>
      </div>

      {/* Body */}
      <div className="tool-panel-body">
        <p className="tool-panel-hint">{config.instructions}</p>

        {config.fields.length > 0 && (
          <div className="tool-panel-fields">
            {config.fields.map(field => (
              <div key={field.key} className="tool-panel-field">
                <label className="tool-panel-label">{field.label}</label>
                {field.type === 'toggle' && (
                  <button
                    className={`tool-panel-toggle ${values[field.key] ? 'active' : ''}`}
                    onClick={() => setValue(field.key, !values[field.key])}
                  >
                    {values[field.key] ? 'On' : 'Off'}
                  </button>
                )}
                {field.type === 'number' && (
                  <div className="tool-panel-num-wrap">
                    <input
                      type="number"
                      className="tool-panel-num"
                      value={values[field.key] as number}
                      onChange={e => setValue(field.key, parseFloat(e.target.value) || 0)}
                      min={field.min ?? 0}
                      step={field.step ?? 1}
                    />
                    {field.unit && <span className="tool-panel-unit">{field.unit}</span>}
                  </div>
                )}
                {field.type === 'select' && (
                  <select
                    className="tool-panel-select"
                    value={values[field.key] as string}
                    onChange={e => setValue(field.key, e.target.value)}
                  >
                    {field.options!.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Quick tool switch */}
        <div className="tool-panel-tools">
          {(Object.keys(TOOL_CONFIGS) as Tool[]).map(t => (
            <button
              key={t}
              className={`tool-panel-tool-btn ${activeTool === t ? 'active' : ''}`}
              onClick={() => setActiveTool(t)}
              title={TOOL_CONFIGS[t]!.label}
            >
              {TOOL_CONFIGS[t]!.label.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
