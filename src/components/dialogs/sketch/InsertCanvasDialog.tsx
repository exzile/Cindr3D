import { useRef, useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import type { Feature } from '../../../types/cad';

export function InsertCanvasDialog({ onClose }: { onClose: () => void }) {
  const [plane, setPlane] = useState<'XY' | 'XZ' | 'YZ'>('XY');
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [imgScale, setImgScale] = useState(1);
  const [opacity, setOpacity] = useState(0.5);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const addFeature = useCADStore((s) => s.addFeature);
  const addCanvasReference = useCADStore((s) => s.addCanvasReference);

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result as string;
      if (!dataUrl) return;

      const id = crypto.randomUUID();

      // Store in canvasReferences for easy lookup
      addCanvasReference({ id, dataUrl, plane, offsetX, offsetY, scale: imgScale, opacity });

      // Also add to feature timeline so it appears as a timeline entry
      const feature: Feature = {
        id,
        name: `Canvas: ${file.name}`,
        type: 'import',
        params: {
          isCanvasRef: true,
          plane,
          offsetX,
          offsetY,
          scale: imgScale,
          opacity,
          dataUrl,
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);

      setStatusMessage(`Inserted canvas reference: ${file.name}`);
      onClose();
    };

    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <DialogShell title="Insert Canvas (Reference Image)" onClose={onClose} size="sm" cancelLabel="Cancel">
      <div className="form-group">
        <button className="btn btn-secondary" onClick={handleChooseFile}>
          Choose Image File
        </button>
        {fileName && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>{fileName}</span>}
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>
      <div className="form-group">
        <label>Plane</label>
        <select value={plane} onChange={(e) => setPlane(e.target.value as 'XY' | 'XZ' | 'YZ')}>
          <option value="XY">XY (Top)</option>
          <option value="XZ">XZ (Front)</option>
          <option value="YZ">YZ (Side)</option>
        </select>
      </div>
      <div className="form-group">
        <label>Offset X</label>
        <input
          type="number"
          value={offsetX}
          onChange={(e) => setOffsetX(parseFloat(e.target.value) || 0)}
          step={1}
        />
      </div>
      <div className="form-group">
        <label>Offset Y</label>
        <input
          type="number"
          value={offsetY}
          onChange={(e) => setOffsetY(parseFloat(e.target.value) || 0)}
          step={1}
        />
      </div>
      <div className="form-group">
        <label>Scale</label>
        <input
          type="number"
          value={imgScale}
          onChange={(e) => setImgScale(parseFloat(e.target.value) || 1)}
          step={0.1}
          min={0.001}
        />
      </div>
      <div className="form-group">
        <label>Opacity (0–1)</label>
        <input
          type="number"
          value={opacity}
          onChange={(e) => setOpacity(Math.min(1, Math.max(0, parseFloat(e.target.value) || 0.5)))}
          step={0.05}
          min={0}
          max={1}
        />
      </div>
      <p className="dialog-hint">Adds a reference image to the viewport on the selected plane. The image appears in the feature timeline.</p>
    </DialogShell>
  );
}
