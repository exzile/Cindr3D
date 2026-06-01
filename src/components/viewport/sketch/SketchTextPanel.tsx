import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Type, X, Bold, Italic,
  FlipHorizontal2, FlipVertical2,
  AlignLeft, AlignCenter, AlignRight,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  Info,
} from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { useDraggablePanel } from './useDraggablePanel';
import { FONT_FAMILY_OPTIONS } from '../../../utils/fontRegistry';
import '../../dialogs/common/ToolPanel.css';

const FONT_OPTIONS = FONT_FAMILY_OPTIONS;

const PARAMETRIC_INFO = `Wrap plain text in single quotes ('').
To concatenate parameters, use + between each name.

Example 1: 'Example text'
Example 2: 'Hello' + NameParam`;

// Default position: to the LEFT of the Sketch Palette (right ≈ 12 + 240 + 13 gap)
const DEFAULT_STYLE: CSSProperties = {
  position: 'fixed',
  right: 265,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 1001,
};

export default function SketchTextPanel() {
  const { dragHandleProps, isDragging, panelEventProps, panelRef, panelStyle } = useDraggablePanel();
  const [showFxInfo, setShowFxInfo] = useState(false);

  const activeTool      = useCADStore((s) => s.activeTool);
  const textContent     = useCADStore((s) => s.sketchTextContent);
  const setTextContent  = useCADStore((s) => s.setSketchTextContent);
  const textHeight      = useCADStore((s) => s.sketchTextHeight);
  const setTextHeight   = useCADStore((s) => s.setSketchTextHeight);
  const textFont        = useCADStore((s) => s.sketchTextFont);
  const setTextFont     = useCADStore((s) => s.setSketchTextFont);
  const textBold        = useCADStore((s) => s.sketchTextBold);
  const setTextBold     = useCADStore((s) => s.setSketchTextBold);
  const textItalic      = useCADStore((s) => s.sketchTextItalic);
  const setTextItalic   = useCADStore((s) => s.setSketchTextItalic);
  const textType        = useCADStore((s) => s.sketchTextType);
  const setTextType     = useCADStore((s) => s.setSketchTextType);
  const charSpacing     = useCADStore((s) => s.sketchTextCharSpacing);
  const setCharSpacing  = useCADStore((s) => s.setSketchTextCharSpacing);
  const flipH           = useCADStore((s) => s.sketchTextFlipH);
  const setFlipH        = useCADStore((s) => s.setSketchTextFlipH);
  const flipV           = useCADStore((s) => s.sketchTextFlipV);
  const setFlipV        = useCADStore((s) => s.setSketchTextFlipV);
  const hAlign          = useCADStore((s) => s.sketchTextHAlign);
  const setHAlign       = useCADStore((s) => s.setSketchTextHAlign);
  const vAlign          = useCADStore((s) => s.sketchTextVAlign);
  const setVAlign       = useCADStore((s) => s.setSketchTextVAlign);
  const editingGroupId  = useCADStore((s) => s.editingTextGroupId);
  const commitEdit      = useCADStore((s) => s.commitSketchTextEdit);
  const cancel          = useCADStore((s) => s.cancelSketchTextTool);
  const isEditing       = editingGroupId !== null;

  if (activeTool !== 'sketch-text') return null;

  return (
    <div
      ref={panelRef}
      className={`tool-panel${isDragging ? ' is-dragging' : ''}`}
      style={panelStyle ?? DEFAULT_STYLE}
      {...panelEventProps}
    >
      {/* Header — drag handle */}
      <div
        className="tp-header"
        {...dragHandleProps}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <div className="tp-header-icon" style={{ background: '#3b82f6' }}>
          <Type size={12} />
        </div>
        <span className="tp-header-title">TEXT</span>
        <button className="tp-close" onClick={cancel} title="Cancel">
          <X size={13} />
        </button>
      </div>

      <div className="tp-body">
        <div className="tp-section">

          {/* Type */}
          <div className="tp-row">
            <span className="tp-label">Type</span>
            <div className="tp-seg-icons">
              <button
                className={`tp-seg-icons__btn${textType === 'standard' ? ' active' : ''}`}
                title="Standard text"
                onClick={() => setTextType('standard')}
                style={{ fontFamily: 'serif', fontWeight: 700, fontSize: 14, width: 30, height: 28 }}
              >A</button>
              <button
                className={`tp-seg-icons__btn${textType === 'along-path' ? ' active' : ''}`}
                title="Text along path"
                onClick={() => setTextType('along-path')}
                style={{ fontFamily: 'serif', fontStyle: 'italic', fontSize: 14, width: 30, height: 28 }}
              >A</button>
            </div>
          </div>

          {/* Text textarea with fx inside */}
          <div className="tp-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <span className="tp-label">Text</span>
            <div style={{ position: 'relative' }}>
              <textarea
                value={textContent}
                rows={4}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Sample Text"
                spellCheck={false}
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical',
                  background: 'var(--bg-input)', border: '1px solid var(--border-light)',
                  borderBottom: '2px solid var(--accent)', borderRadius: 4,
                  color: 'var(--text-primary)', fontSize: 11, fontFamily: 'inherit',
                  padding: '6px 8px 24px 8px', outline: 'none',
                }}
              />
              <button
                onClick={() => setShowFxInfo(!showFxInfo)}
                title="Parametric Text"
                style={{
                  position: 'absolute', bottom: 6, right: 6, padding: '2px 6px',
                  fontSize: 10, fontStyle: 'italic', fontFamily: 'serif',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
                  borderRadius: 3, color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1.4,
                }}
              >fx</button>
              {showFxInfo && (
                <div onClick={() => setShowFxInfo(false)} style={{
                  position: 'absolute', right: 0, bottom: 36, zIndex: 300,
                  background: 'var(--bg-primary)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '10px 12px', width: 250, fontSize: 11,
                  lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)', cursor: 'pointer',
                }}>
                  <strong style={{ display: 'block', marginBottom: 4, color: 'var(--text-primary)' }}>
                    Parametric Text
                  </strong>
                  {PARAMETRIC_INFO}
                </div>
              )}
            </div>
          </div>

          {/* Font */}
          <div className="tp-row">
            <span className="tp-label">Font</span>
            <select className="tp-select" value={textFont} onChange={(e) => setTextFont(e.target.value)}>
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* Typeface */}
          <div className="tp-row">
            <span className="tp-label">Typeface</span>
            <div className="tp-seg-icons">
              <button className={`tp-seg-icons__btn${textBold ? ' active' : ''}`} title="Bold" onClick={() => setTextBold(!textBold)}>
                <Bold size={13} />
              </button>
              <button className={`tp-seg-icons__btn${textItalic ? ' active' : ''}`} title="Italic" onClick={() => setTextItalic(!textItalic)}>
                <Italic size={13} />
              </button>
            </div>
          </div>

          {/* Height */}
          <div className="tp-row">
            <span className="tp-label">Height</span>
            <div className="tp-input-group">
              <input type="number" value={textHeight} min={0.1} step={1}
                onChange={(e) => setTextHeight(Math.max(0.1, Number(e.target.value)))} />
              <span className="tp-unit">mm</span>
            </div>
          </div>

          {/* Character Spacing */}
          <div className="tp-row">
            <span className="tp-label">Character Sp.</span>
            <div className="tp-input-group">
              <input type="number" value={charSpacing} step={0.1}
                onChange={(e) => setCharSpacing(Number(e.target.value))} />
            </div>
          </div>

          {/* Flip */}
          <div className="tp-row">
            <span className="tp-label">Flip</span>
            <div className="tp-seg-icons">
              <button className={`tp-seg-icons__btn${flipV ? ' active' : ''}`} title="Flip vertical" onClick={() => setFlipV(!flipV)}>
                <FlipVertical2 size={14} />
              </button>
              <button className={`tp-seg-icons__btn${flipH ? ' active' : ''}`} title="Flip horizontal" onClick={() => setFlipH(!flipH)}>
                <FlipHorizontal2 size={14} />
              </button>
            </div>
          </div>

          {/* Alignment */}
          <div className="tp-row" style={{ alignItems: 'flex-start' }}>
            <span className="tp-label" style={{ paddingTop: 4 }}>Alignment</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="tp-seg-icons">
                <button className={`tp-seg-icons__btn${hAlign === 'left' ? ' active' : ''}`} title="Left" onClick={() => setHAlign('left')}><AlignLeft size={14} /></button>
                <button className={`tp-seg-icons__btn${hAlign === 'center' ? ' active' : ''}`} title="Center" onClick={() => setHAlign('center')}><AlignCenter size={14} /></button>
                <button className={`tp-seg-icons__btn${hAlign === 'right' ? ' active' : ''}`} title="Right" onClick={() => setHAlign('right')}><AlignRight size={14} /></button>
              </div>
              <div className="tp-seg-icons">
                <button className={`tp-seg-icons__btn${vAlign === 'top' ? ' active' : ''}`} title="Top" onClick={() => setVAlign('top')}><AlignStartVertical size={14} /></button>
                <button className={`tp-seg-icons__btn${vAlign === 'middle' ? ' active' : ''}`} title="Middle" onClick={() => setVAlign('middle')}><AlignCenterVertical size={14} /></button>
                <button className={`tp-seg-icons__btn${vAlign === 'bottom' ? ' active' : ''}`} title="Bottom" onClick={() => setVAlign('bottom')}><AlignEndVertical size={14} /></button>
              </div>
            </div>
          </div>

          <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '4px 0 2px', textAlign: 'center' }}>
            {isEditing
              ? 'Adjust settings, then click OK to apply'
              : textType === 'along-path'
                ? 'Click a sketch curve (line, arc, circle, spline) to flow text along it'
                : 'Click on the sketch to place text'}
          </p>

        </div>
      </div>

      {/* Footer */}
      <div className="tp-actions" style={{ justifyContent: 'space-between' }}>
        <button className="tp-icon-btn" title="Parametric text info" onClick={() => setShowFxInfo(!showFxInfo)}>
          <Info size={13} />
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="tp-btn tp-btn-ok"
            disabled={!isEditing}
            onClick={isEditing ? commitEdit : undefined}
            title={isEditing ? 'Apply changes' : 'Click on the sketch to place text'}
          >OK</button>
          <button className="tp-btn tp-btn-cancel" onClick={cancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
