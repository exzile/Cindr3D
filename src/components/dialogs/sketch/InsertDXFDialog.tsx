import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { SketchEntity, SketchPoint, Sketch } from '../../../types/cad';

/** One (code, value) pair from the DXF file. */
interface DxfPair { code: number; value: string }

/** Simple parsed entity — we keep one lookup map for single-valued codes
 *  and an ordered `pairs` list so LWPOLYLINE can iterate repeated 10/20. */
interface DxfEntity {
  type: string;
  lookup: Record<number, string>;
  pairs: DxfPair[];
}

export function InsertDXFDialog({ onClose }: { onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [flipY, setFlipY] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const addSketchEntity = useCADStore((s) => s.addSketchEntity);

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  /**
   * Parse DXF R12 group-code format — alternating code/value lines.
   * Preserves the full ordered pair list on each entity so repeated group
   * codes (e.g. LWPOLYLINE 10/20 vertex pairs) survive parsing.
   */
  const parseDXF = (text: string): DxfEntity[] => {
    const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
    const pairs: DxfPair[] = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = parseInt(lines[i], 10);
      if (!isNaN(code)) pairs.push({ code, value: lines[i + 1] ?? '' });
    }

    const entities: DxfEntity[] = [];
    let inEntities = false;
    let current: DxfEntity | null = null;

    const flushCurrent = () => {
      if (current) { entities.push(current); current = null; }
    };

    for (let i = 0; i < pairs.length; i++) {
      const { code, value } = pairs[i];

      // SECTION bookkeeping
      if (code === 0 && value === 'SECTION') {
        flushCurrent();
        // Peek at the next pair (code 2) for the section name
        const next = pairs[i + 1];
        inEntities = next && next.code === 2 && next.value === 'ENTITIES';
        continue;
      }
      if (code === 0 && value === 'ENDSEC') {
        flushCurrent();
        inEntities = false;
        continue;
      }
      if (!inEntities) continue;

      // New entity starts with code 0
      if (code === 0) {
        flushCurrent();
        current = { type: value, lookup: {}, pairs: [] };
        continue;
      }
      if (current) {
        current.pairs.push({ code, value });
        // First occurrence wins for single-valued lookup
        if (!(code in current.lookup)) current.lookup[code] = value;
      }
    }
    flushCurrent();
    return entities;
  };

  /** Project a DXF (x, y) pair onto the active sketch plane in world space. */
  const makeSketchPointFactory = (sketch: Sketch) => {
    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
    const origin = sketch.planeOrigin;
    return (dxfX: number, dxfY: number): SketchPoint => {
      const u = dxfX * scale;
      const v = (flipY ? -dxfY : dxfY) * scale;
      return {
        id: crypto.randomUUID(),
        x: origin.x + u * t1.x + v * t2.x,
        y: origin.y + u * t1.y + v * t2.y,
        z: origin.z + u * t1.z + v * t2.z,
      };
    };
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const activeSketch = useCADStore.getState().activeSketch;
    if (!activeSketch) {
      setStatusMessage('No active sketch — open a sketch before inserting DXF');
      onClose();
      return;
    }

    const mkPoint = makeSketchPointFactory(activeSketch);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;

      const dxfEntities = parseDXF(text);
      let count = 0;

      for (const ent of dxfEntities) {
        if (ent.type === 'LINE') {
          const x1 = parseFloat(ent.lookup[10] ?? '0');
          const y1 = parseFloat(ent.lookup[20] ?? '0');
          const x2 = parseFloat(ent.lookup[11] ?? '0');
          const y2 = parseFloat(ent.lookup[21] ?? '0');
          const entity: SketchEntity = {
            id: crypto.randomUUID(),
            type: 'line',
            points: [mkPoint(x1, y1), mkPoint(x2, y2)],
          };
          addSketchEntity(entity);
          count++;
        } else if (ent.type === 'CIRCLE') {
          const cx = parseFloat(ent.lookup[10] ?? '0');
          const cy = parseFloat(ent.lookup[20] ?? '0');
          const r  = parseFloat(ent.lookup[40] ?? '0');
          if (!r) continue;
          const entity: SketchEntity = {
            id: crypto.randomUUID(),
            type: 'circle',
            points: [mkPoint(cx, cy)],
            radius: r * scale,
          };
          addSketchEntity(entity);
          count++;
        } else if (ent.type === 'ARC') {
          const cx = parseFloat(ent.lookup[10] ?? '0');
          const cy = parseFloat(ent.lookup[20] ?? '0');
          const r  = parseFloat(ent.lookup[40] ?? '0');
          const sa = parseFloat(ent.lookup[50] ?? '0');
          const ea = parseFloat(ent.lookup[51] ?? '360');
          if (!r) continue;
          const entity: SketchEntity = {
            id: crypto.randomUUID(),
            type: 'arc',
            points: [mkPoint(cx, cy)],
            radius: r * scale,
            startAngle: sa,
            endAngle: ea,
          };
          addSketchEntity(entity);
          count++;
        } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
          // Iterate the ordered pair list, picking up every (10, 20) pair in
          // order. Each pair is a polyline vertex. Repeated codes are
          // preserved by the new parser.
          const verts: SketchPoint[] = [];
          let pendingX: number | null = null;
          for (const { code, value } of ent.pairs) {
            if (code === 10) { pendingX = parseFloat(value); }
            else if (code === 20 && pendingX !== null) {
              verts.push(mkPoint(pendingX, parseFloat(value)));
              pendingX = null;
            }
          }
          if (verts.length >= 2) {
            const closed = (parseInt(ent.lookup[70] ?? '0', 10) & 1) === 1;
            const entity: SketchEntity = {
              id: crypto.randomUUID(),
              type: 'spline',
              points: verts,
              closed,
            };
            addSketchEntity(entity);
            count++;
          }
        } else if (ent.type === 'POINT') {
          const px = parseFloat(ent.lookup[10] ?? '0');
          const py = parseFloat(ent.lookup[20] ?? '0');
          const entity: SketchEntity = {
            id: crypto.randomUUID(),
            type: 'point',
            points: [mkPoint(px, py)],
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
              checked={flipY}
              onChange={(e) => setFlipY(e.target.checked)}
            />
            Flip Y axis
          </label>
          <p className="dialog-hint">Imports LINE, CIRCLE, ARC, LWPOLYLINE, and POINT entities from DXF R12 into the active sketch plane.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
