/**
 * DeriveDialog — D195
 * Imports bodies/features/parameters from another Cindr3D JSON file
 * into the current design with a reference marker.
 */

import { useState, useRef } from 'react';
import { X, Check, FileCode, RefreshCw } from 'lucide-react';
import '../common/ToolPanel.css';
import { useCADStore } from '../../../store/cadStore';

interface SourceItem {
  id: string;
  name: string;
  kind: 'feature' | 'sketch';
  type: string;
}

export function DeriveDialog({ onClose }: { onClose: () => void }) {
  const deriveFromDesign = useCADStore((s) => s.deriveFromDesign);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [items, setItems] = useState<SourceItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const parsed: SourceItem[] = [];
        if (Array.isArray(data.features)) {
          for (const f of data.features) {
            if (f.id && f.name && f.type) {
              parsed.push({ id: f.id, name: f.name, kind: 'feature', type: f.type });
            }
          }
        }
        if (Array.isArray(data.sketches)) {
          for (const s of data.sketches) {
            if (s.id && s.name) {
              parsed.push({ id: s.id, name: s.name, kind: 'sketch', type: 'sketch' });
            }
          }
        }
        if (parsed.length === 0) setError('No importable items found in file.');
        setItems(parsed);
        setSelected(new Set(parsed.map((i) => i.id)));
      } catch {
        setError('Failed to parse file. Must be a Cindr3D .json export.');
        setItems([]);
      }
    };
    reader.readAsText(file);
  };

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = () => {
    const toImport = items.filter((i) => selected.has(i.id));
    if (toImport.length === 0) return;
    deriveFromDesign(toImport.map((i) => i.id), fileName);
    onClose();
  };

  return (
    <div className="tool-panel" style={{ width: 300, maxHeight: 520, display: 'flex', flexDirection: 'column' }}>
      <div className="tp-header">
        <div className="tp-header-icon"><FileCode size={12} /></div>
        <span className="tp-header-title">Derive</span>
        <button className="tp-close" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="tp-body" style={{ overflowY: 'auto', flex: 1 }}>
        <div className="tp-section">
          <div className="tp-section-title">Source File</div>
          <div className="tp-row">
            <button
              className="tp-btn tp-btn-cancel"
              style={{ flex: 1 }}
              onClick={() => fileRef.current?.click()}
            >
              <RefreshCw size={12} /> {fileName || 'Select .json file\u2026'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
          </div>
          {error && (
            <div style={{ fontSize: 10, color: '#f66', padding: '2px 0' }}>{error}</div>
          )}
        </div>
        {items.length > 0 && (
          <div className="tp-section">
            <div className="tp-section-title">Select Items to Import</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <button
                style={{ fontSize: 10, background: 'none', border: 'none', color: '#5588ff', cursor: 'pointer' }}
                onClick={() => setSelected(new Set(items.map((i) => i.id)))}
              >
                All
              </button>
              <button
                style={{ fontSize: 10, background: 'none', border: 'none', color: '#5588ff', cursor: 'pointer' }}
                onClick={() => setSelected(new Set())}
              >
                None
              </button>
            </div>
            {items.map((item) => (
              <label
                key={item.id}
                style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, margin: '1px 0', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleItem(item.id)}
                />
                <span>
                  <span style={{ color: item.kind === 'sketch' ? '#7eb8f7' : '#aaa', marginRight: 4, fontSize: 10 }}>
                    [{item.type}]
                  </span>
                  {item.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="tp-actions">
        <button className="tp-btn tp-btn-cancel" onClick={onClose}>
          <X size={13} /> Cancel
        </button>
        <button
          className="tp-btn tp-btn-ok"
          onClick={handleImport}
          disabled={selected.size === 0}
        >
          <Check size={13} /> Import ({selected.size})
        </button>
      </div>
    </div>
  );
}
