import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Download, Plus, Save, Trash2, X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import '../common/ToolPanel.css';

export function DesignConfigurationsDialog({ onClose }: { onClose: () => void }) {
  const designConfigurations = useCADStore((s) => s.designConfigurations);
  const activeDesignConfigurationId = useCADStore((s) => s.activeDesignConfigurationId);
  const features = useCADStore((s) => s.features);
  const createDesignConfiguration = useCADStore((s) => s.createDesignConfiguration);
  const switchDesignConfiguration = useCADStore((s) => s.switchDesignConfiguration);
  const renameDesignConfiguration = useCADStore((s) => s.renameDesignConfiguration);
  const removeDesignConfiguration = useCADStore((s) => s.removeDesignConfiguration);
  const captureDesignConfiguration = useCADStore((s) => s.captureDesignConfiguration);
  const toggleFeatureSuppressed = useCADStore((s) => s.toggleFeatureSuppressed);
  const exportDesignConfigurations = useCADStore((s) => s.exportDesignConfigurations);
  const activeConfiguration = designConfigurations.find((configuration) => configuration.id === activeDesignConfigurationId);
  const [newName, setNewName] = useState('');
  const [renameValue, setRenameValue] = useState(activeConfiguration?.name ?? '');
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
  } | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setRenameValue(activeConfiguration?.name ?? '');
    });
    return () => { disposed = true; };
  }, [activeConfiguration?.id, activeConfiguration?.name]);

  const handleCreate = () => {
    createDesignConfiguration(newName);
    setNewName('');
  };

  const handleSwitch = (id: string) => {
    switchDesignConfiguration(id);
    const next = designConfigurations.find((configuration) => configuration.id === id);
    setRenameValue(next?.name ?? '');
  };

  const handleRename = () => {
    if (!activeConfiguration) return;
    renameDesignConfiguration(activeConfiguration.id, renameValue);
  };

  const clampPanelPosition = useCallback((x: number, y: number, width: number, height: number) => {
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - width - margin);
    const maxY = Math.max(margin, window.innerHeight - height - margin);
    return {
      x: Math.min(Math.max(margin, x), maxX),
      y: Math.min(Math.max(margin, y), maxY),
    };
  }, []);

  const handleHeaderPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;

    event.preventDefault();
    const origin = clampPanelPosition(rect.left, rect.top, rect.width, rect.height);
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      width: rect.width,
      height: rect.height,
    };
    setPanelPosition(origin);
    setDragging(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      const next = clampPanelPosition(
        state.originX + moveEvent.clientX - state.startX,
        state.originY + moveEvent.clientY - state.startY,
        state.width,
        state.height,
      );
      setPanelPosition(next);
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      setDragging(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [clampPanelPosition]);

  const panelStyle: CSSProperties = panelPosition
    ? { width: 360, left: panelPosition.x, top: panelPosition.y, right: 'auto', transform: 'none' }
    : { width: 360 };

  return (
    <div className="tool-panel-overlay design-configurations-overlay">
      <div
        ref={panelRef}
        className={`tool-panel design-configurations-panel${dragging ? ' is-dragging' : ''}`}
        style={panelStyle}
      >
        <div className="tp-header" onPointerDown={handleHeaderPointerDown}>
          <div className="tp-header-icon"><Check size={12} /></div>
          <span className="tp-header-title">Design Configurations</span>
          <button className="tp-close" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} title="Close"><X size={14} /></button>
        </div>

        <div className="tp-body">
          <div className="tp-section">
            <div className="tp-section-title">Active Variant</div>
            <select className="tp-select" value={activeDesignConfigurationId} onChange={(event) => handleSwitch(event.target.value)}>
              {designConfigurations.map((configuration) => (
                <option key={configuration.id} value={configuration.id}>{configuration.name}</option>
              ))}
            </select>
          </div>

          <div className="tp-section">
            <div className="tp-section-title">Name</div>
            <div className="tp-row">
              <div className="tp-input-group">
                <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') handleRename(); }} />
              </div>
              <button className="tp-btn" onClick={handleRename}><Check size={13} /> Rename</button>
            </div>
          </div>

          <div className="tp-section">
            <div className="tp-section-title">Create</div>
            <div className="tp-row">
              <div className="tp-input-group">
                <input placeholder="M3 / short / production" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') handleCreate(); }} />
              </div>
              <button className="tp-btn" onClick={handleCreate}><Plus size={13} /> Add</button>
            </div>
          </div>

          <div className="tp-section">
            <div className="tp-section-title">Feature Suppression</div>
            {features.length === 0 ? (
              <p className="dialog-hint">No timeline features yet.</p>
            ) : features.map((feature) => (
              <label key={feature.id} className="tp-row" style={{ cursor: 'pointer' }}>
                <span className="tp-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{feature.name}</span>
                <input type="checkbox" checked={!feature.suppressed} onChange={() => toggleFeatureSuppressed(feature.id)} />
              </label>
            ))}
          </div>
        </div>

        <div className="tp-actions">
          <button className="tp-btn" onClick={() => captureDesignConfiguration()}>
            <Save size={13} /> Capture
          </button>
          <button className="tp-btn" onClick={exportDesignConfigurations}>
            <Download size={13} /> Export
          </button>
          <button
            className="tp-btn tp-btn-cancel"
            onClick={() => activeConfiguration && removeDesignConfiguration(activeConfiguration.id)}
            disabled={!activeConfiguration || activeConfiguration.id === 'default'}
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
