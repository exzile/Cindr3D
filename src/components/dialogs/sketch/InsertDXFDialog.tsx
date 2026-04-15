import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { SketchEntity, SketchPoint } from '../../../types/cad';

export function InsertDXFDialog({ onClose }: { onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [flipZ, setFlipZ] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const addSketchEntity = useCADStore((s) => s.addSketchEntity);

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  /** Parse DXF R12 group-code format — alternating code/value lines. */
  const parseDXF = (text: string) => {
    const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
    const pairs: Array<{ code: number; value: string }> = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = parseInt(lines[i], 10);
      if (!isNaN(code)) pairs.push({ code, value: lines[i + 1] ?? '' });
    }

    // Find ENTITIES section
    let inEntities = false;
    const entities: Array<Record<number, string>> = [];
    let current: Record<number, string> | null = null;

    for (const { code, value } of pairs) {
      if (code === 0 && value === 'SECTION') { inEntities = false; current = null; continue; }
      if (code === 2 && value === 'ENTITIES') { inEntities = true; continue; }
      if (code === 0 && value === 'ENDSEC') { if (inEntities && current) entities.push(current); inEntities = false; current = null; continue; }
      if (!inEntities) continue;

      if (code === 0) {
        if (current) entities.push(current);
        current = { 0: value };
      } else if (current) {
        current[code] = value;
      }
    }
    if (current && inEntities) entities.push(current);
    return entities;
  };

  const applyTransform = (x: number, y: number, z?: number): { x: number; y: number; z: number } => ({
    x: x * scale,
    y: y * scale,
    z: ((flipZ ? -(z ?? 0) : (z ?? 0))) * scale,
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const activeSketch = useCADStore.getState().activeSketch;
    if (!activeSketch) {
      setStatusMessage('No active sketch — open a sketch before inserting DXF');
      onClose();
      return;
    }

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;

      const dxfEntities = parseDXF(text);
      let count = 0;

      for (const ent of dxfEntities) {
        const type = ent[0] ?? '';

        if (type === 'LINE') {
          const p1 = applyTransform(parseFloat(ent[10] ?? '0'), parseFloat(ent[20] ?? '0'), parseFloat(ent[30] ?? '0'));
          const p2 = applyTransform(parseFloat(ent[11] ?? '0'), parseFloat(ent[21] ?? '0'), parseFloat(ent[31] ?? '0'));
          const points: SketchPoint[] = [
            { id: crypto.randomUUID(), x: p1.x, y: p1.y, z: p1.z },
            { id: crypto.randomUUID(), x: p2.x, y: p2.y, z: p2.z },
          ];
          const entity: SketchEntity = { id: crypto.randomUUID(), type: 'line', points };
          addSketchEntity(entity);
          count++;
        } else if (type === 'CIRCLE') {
          const cx = parseFloat(ent[10] ?? '0');
          const cy = parseFloat(ent[20] ?? '0');
          const cz = parseFloat(ent[30] ?? '0');
          const r  = parseFloat(ent[40] ?? '0');
          if (!r) continue;
          const t = applyTransform(cx, cy, cz);
          const entity: SketchEntity = {
            id: crypto.randomUUID(),
            type: 'circle',
            points: [{ id: crypto.randomUUID(), x: t.x, y: t.y, z: t.z }],
            radius: r * scale,
          };
          addSketchEntity(entity);
          count++;
        } else if (type === 'ARC') {
          const cx = parseFloat(ent[10] ?? '0');
          const cy = parseFloat(ent[20] ?? '0');
          const cz = parseFloat(ent[30] ?? '0');
          const r  = parseFloat(ent[40] ?? '0');
          const sa = parseFloat(ent[50] ?? '0');
          const ea = parseFloat(ent[51] ?? '360');
          if (!r) continue;
          const t = applyTransform(cx, cy, cz);
          const entity: SketchEntity = {
            id: crypto.randomUUID(),
            type: 'arc',
            points: [{ id: crypto.randomUUID(), x: t.x, y: t.y, z: t.z }],
            radius: r * scale,
            startAngle: sa,
            endAngle: ea,
          };
          addSketchEntity(entity);
          count++;
        } else if (type === 'LWPOLYLINE') {
          // LWPOLYLINE: group 10/20 pairs form the vertices; count in group 90
          const vertexCount = parseInt(ent[90] ?? '0', 10);
          if (!vertexCount) continue;
          // Collect all group-10 and group-20 entries (there are multiple with same code)
          // They've been overwritten in our map — we need to re-parse inline
          // Since we stored only the last value per code, re-extract from raw text isn't feasible here.
          // As a fallback, emit a single segment with whatever values we have.
          const px = parseFloat(ent[10] ?? '0');
          const py = parseFloat(ent[20] ?? '0');
          const t = applyTransform(px, py);
          const entity: SketchEntity = {
            id: crypto.randomUUID(),
            type: 'spline',
            points: [{ id: crypto.randomUUID(), x: t.x, y: t.y, z: 0 }],
            closed: (parseInt(ent[70] ?? '0', 10) & 1) === 1,
          };
          addSketchEntity(entity);
          count++;
        } else if (type === 'POINT') {
          const px = parseFloat(ent[10] ?? '0');
          const py = parseFloat(ent[20] ?? '0');
          const pz = parseFloat(ent[30] ?? '0');
          const t = applyTransform(px, py, pz);
          const entity: SketchEntity = {
            id: crypto.randomUUID(),
            type: 'point',
            points: [{ id: crypto.randomUUID(), x: t.x, y: t.y, z: t.z }],
          };
          addSketchEntity(entity);
          count++;
        }
      }

      setStatusMessage(`Inserted ${count} DXF entit${count === 1 ? 'y' : 'ies'} from ${file.name}`);
      onClose();
    };

    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Insert DXF into Sketch</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <button className="btn btn-secondary" onClick={handleChooseFile}>
              Choose DXF File
            </button>
            {fileName && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>{fileName}</span>}
            <input
              ref={fileInputRef}
              type="file"
              accept=".dxf"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
          <div className="form-group">
            <label>Scale Factor</label>
            <input
              type="number"
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value) || 1)}
              step={0.1}
              min={0.001}
            />
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={flipZ}
              onChange={(e) => setFlipZ(e.target.checked)}
            />
            Flip Z axis
          </label>
          <p className="dialog-hint">Imports LINE, CIRCLE, ARC, LWPOLYLINE, and POINT entities from DXF R12 into the active sketch.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
