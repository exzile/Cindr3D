// Flange: extrudes a thin wall from a selected edge, bending at an angle
// Params: edge (which face edge), thickness, length, angle (degrees), kFactor
import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function FlangeDialog({ onClose }: { onClose: () => void }) {
  const commitFlange = useCADStore((s) => s.commitFlange);
  const closeFlangeDialog = useCADStore((s) => s.closeFlangeDialog);

  const [edgeStartX, setEdgeStartX] = useState(-10);
  const [edgeStartY, setEdgeStartY] = useState(0);
  const [edgeStartZ, setEdgeStartZ] = useState(0);
  const [edgeEndX, setEdgeEndX] = useState(10);
  const [edgeEndY, setEdgeEndY] = useState(0);
  const [edgeEndZ, setEdgeEndZ] = useState(0);
  const [faceNormalX, setFaceNormalX] = useState(0);
  const [faceNormalY, setFaceNormalY] = useState(1);
  const [faceNormalZ, setFaceNormalZ] = useState(0);
  const [thickness, setThickness] = useState(1);
  const [length, setLength] = useState(20);
  const [bendAngle, setBendAngle] = useState(90);

  const handleClose = () => { closeFlangeDialog(); onClose(); };

  const handleOK = () => {
    commitFlange({
      edgeStartX, edgeStartY, edgeStartZ,
      edgeEndX, edgeEndY, edgeEndZ,
      faceNormalX, faceNormalY, faceNormalZ,
      thickness, length, bendAngle,
    });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Sheet Metal Flange</h3>
          <button className="dialog-close" onClick={handleClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <p className="dialog-section-label">Edge Start</p>
          <div className="form-group form-group-row">
            <label>X</label>
            <input type="number" step={0.1} value={edgeStartX} onChange={(e) => setEdgeStartX(parseFloat(e.target.value) || 0)} />
            <label>Y</label>
            <input type="number" step={0.1} value={edgeStartY} onChange={(e) => setEdgeStartY(parseFloat(e.target.value) || 0)} />
            <label>Z</label>
            <input type="number" step={0.1} value={edgeStartZ} onChange={(e) => setEdgeStartZ(parseFloat(e.target.value) || 0)} />
          </div>
          <p className="dialog-section-label">Edge End</p>
          <div className="form-group form-group-row">
            <label>X</label>
            <input type="number" step={0.1} value={edgeEndX} onChange={(e) => setEdgeEndX(parseFloat(e.target.value) || 0)} />
            <label>Y</label>
            <input type="number" step={0.1} value={edgeEndY} onChange={(e) => setEdgeEndY(parseFloat(e.target.value) || 0)} />
            <label>Z</label>
            <input type="number" step={0.1} value={edgeEndZ} onChange={(e) => setEdgeEndZ(parseFloat(e.target.value) || 0)} />
          </div>
          <p className="dialog-section-label">Face Normal</p>
          <div className="form-group form-group-row">
            <label>X</label>
            <input type="number" step={0.1} value={faceNormalX} onChange={(e) => setFaceNormalX(parseFloat(e.target.value) || 0)} />
            <label>Y</label>
            <input type="number" step={0.1} value={faceNormalY} onChange={(e) => setFaceNormalY(parseFloat(e.target.value) || 0)} />
            <label>Z</label>
            <input type="number" step={0.1} value={faceNormalZ} onChange={(e) => setFaceNormalZ(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="form-group">
            <label>Thickness (mm)</label>
            <input type="number" min={0.1} max={50} step={0.1} value={thickness}
              onChange={(e) => setThickness(Math.max(0.1, parseFloat(e.target.value) || 1))} />
          </div>
          <div className="form-group">
            <label>Length (mm)</label>
            <input type="number" min={1} step={1} value={length}
              onChange={(e) => setLength(Math.max(1, parseFloat(e.target.value) || 20))} />
          </div>
          <div className="form-group">
            <label>Bend Angle (°)</label>
            <input type="number" min={0} max={180} step={1} value={bendAngle}
              onChange={(e) => setBendAngle(Math.min(180, Math.max(0, parseFloat(e.target.value) || 90)))} />
          </div>
          <p className="dialog-hint">Creates a thin wall extruded from the edge at the specified bend angle.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={handleClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}
