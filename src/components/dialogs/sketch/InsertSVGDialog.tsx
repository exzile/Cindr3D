import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { SketchEntity, SketchPoint } from '../../../types/cad';

export function InsertSVGDialog({ onClose }: { onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [flipY, setFlipY] = useState(true);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const addSketchEntity = useCADStore((s) => s.addSketchEntity);

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  /** Sample a SVGGeometryElement into an array of {x,y} points */
  const samplePath = (el: SVGGeometryElement, numSamples: number): { x: number; y: number }[] => {
    const len = el.getTotalLength();
    const pts: { x: number; y: number }[] = [];
    const steps = Math.max(numSamples, Math.ceil(len / 2));
    for (let i = 0; i <= steps; i++) {
      const pt = el.getPointAtLength((i / steps) * len);
      pts.push({ x: pt.x, y: pt.y });
    }
    return pts;
  };

  const applyTransform = (x: number, y: number): { x: number; y: number } => ({
    x: x * scale,
    y: (flipY ? -y : y) * scale,
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const activeSketch = useCADStore.getState().activeSketch;
    if (!activeSketch) {
      setStatusMessage('No active sketch — open a sketch before inserting SVG');
      onClose();
      return;
    }

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const svgText = evt.target?.result as string;
      if (!svgText) return;

      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');

      let count = 0;

      // ── Process <path> elements ──────────────────────────────────────────
      doc.querySelectorAll('path').forEach((pathEl) => {
        const d = pathEl.getAttribute('d');
        if (!d) return;

        // Create a temporary SVG in the DOM to use SVGGeometryElement API
        const svgNs = 'http://www.w3.org/2000/svg';
        const tmpSvg = document.createElementNS(svgNs, 'svg') as SVGSVGElement;
        tmpSvg.setAttribute('style', 'position:absolute;visibility:hidden;pointer-events:none');
        document.body.appendChild(tmpSvg);
        const tmpPath = document.createElementNS(svgNs, 'path') as SVGPathElement;
        tmpPath.setAttribute('d', d);
        tmpSvg.appendChild(tmpPath);

        try {
          const rawPts = samplePath(tmpPath as SVGGeometryElement, 64);
          const points: SketchPoint[] = rawPts.map((p) => {
            const t = applyTransform(p.x, p.y);
            return { id: crypto.randomUUID(), x: t.x, y: t.y, z: 0 };
          });

          if (points.length >= 2) {
            const entity: SketchEntity = {
              id: crypto.randomUUID(),
              type: 'spline',
              points,
              closed: false,
            };
            addSketchEntity(entity);
            count++;
          }
        } finally {
          document.body.removeChild(tmpSvg);
        }
      });

      // ── Process <circle> elements ────────────────────────────────────────
      doc.querySelectorAll('circle').forEach((circleEl) => {
        const cx = parseFloat(circleEl.getAttribute('cx') ?? '0');
        const cy = parseFloat(circleEl.getAttribute('cy') ?? '0');
        const r  = parseFloat(circleEl.getAttribute('r')  ?? '0');
        if (!r) return;

        const t = applyTransform(cx, cy);
        const center: SketchPoint = { id: crypto.randomUUID(), x: t.x, y: t.y, z: 0 };

        const entity: SketchEntity = {
          id: crypto.randomUUID(),
          type: 'circle',
          points: [center],
          radius: r * scale,
        };
        addSketchEntity(entity);
        count++;
      });

      // ── Process <rect> elements ──────────────────────────────────────────
      doc.querySelectorAll('rect').forEach((rectEl) => {
        const rx = parseFloat(rectEl.getAttribute('x')      ?? '0');
        const ry = parseFloat(rectEl.getAttribute('y')      ?? '0');
        const rw = parseFloat(rectEl.getAttribute('width')  ?? '0');
        const rh = parseFloat(rectEl.getAttribute('height') ?? '0');
        if (!rw || !rh) return;

        // Four corners
        const corners = [
          applyTransform(rx,      ry),
          applyTransform(rx + rw, ry),
          applyTransform(rx + rw, ry + rh),
          applyTransform(rx,      ry + rh),
        ];
        const points: SketchPoint[] = corners.map((c) => ({
          id: crypto.randomUUID(), x: c.x, y: c.y, z: 0,
        }));

        const entity: SketchEntity = {
          id: crypto.randomUUID(),
          type: 'rectangle',
          points,
          closed: true,
        };
        addSketchEntity(entity);
        count++;
      });

      setStatusMessage(`Inserted ${count} SVG entit${count === 1 ? 'y' : 'ies'} from ${file.name}`);
      onClose();
    };

    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Insert SVG into Sketch</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <button className="btn btn-secondary" onClick={handleChooseFile}>
              Choose SVG File
            </button>
            {fileName && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>{fileName}</span>}
            <input
              ref={fileInputRef}
              type="file"
              accept=".svg"
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
            Flip Y (SVG is Y-down — recommended)
          </label>
          <p className="dialog-hint">Imports path, circle, and rect elements from the SVG into the active sketch.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
