import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

type HoleType = 'simple' | 'counterbore' | 'countersink' | 'counterbore-countersink';
type TapType = 'clearance' | 'tapped';
type DrillPoint = 'flat' | 'angled';
type HoleTermination = 'blind' | 'through-all' | 'to-next' | 'symmetric';

export function HoleDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [holeType, setHoleType] = useState<HoleType>((p.holeType as HoleType) ?? 'simple');
  const [tapType, setTapType] = useState<TapType>((p.tapType as TapType) ?? 'clearance');
  const [drillPoint, setDrillPoint] = useState<DrillPoint>((p.drillPoint as DrillPoint) ?? 'angled');
  const [drillAngle, setDrillAngle] = useState(Number(p.drillAngle ?? 118));
  const [termination, setTermination] = useState<HoleTermination>((p.termination as HoleTermination) ?? 'blind');
  const [diameter, setDiameter] = useState(Number(p.diameter ?? 5));
  const [depth, setDepth] = useState(Number(p.depth ?? 10));
  const [cbDiameter, setCbDiameter] = useState(Number(p.cbDiameter ?? 10));
  const [cbDepth, setCbDepth] = useState(Number(p.cbDepth ?? 3));
  const [csAngle, setCsAngle] = useState(Number(p.csAngle ?? 90));
  const [csDiameter, setCsDiameter] = useState(Number(p.csDiameter ?? 9));

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const through = termination === 'through-all' || termination === 'to-next';

  const handleApply = () => {
    const params = {
      holeType, tapType, drillPoint, drillAngle, termination,
      diameter, depth,
      cbDiameter, cbDepth,
      csAngle, csDiameter,
    };
    if (editing) {
      updateFeatureParams(editing.id, params);
      setStatusMessage(`Updated ${holeType} hole: ${diameter}mm ${tapType}`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Hole (${diameter}mm Ø, ${holeType})`,
        type: 'hole',
        params,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created ${holeType} hole: ${diameter}mm ${tapType}`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Hole' : 'Hole'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="settings-grid">
            <div className="form-group">
              <label>Hole Type</label>
              <select value={holeType} onChange={(e) => setHoleType(e.target.value as HoleType)}>
                <option value="simple">Simple</option>
                <option value="counterbore">Counterbore</option>
                <option value="countersink">Countersink</option>
                <option value="counterbore-countersink">Counterbore + Countersink</option>
              </select>
            </div>
            <div className="form-group">
              <label>Tap</label>
              <select value={tapType} onChange={(e) => setTapType(e.target.value as TapType)}>
                <option value="clearance">Clearance</option>
                <option value="tapped">Tapped</option>
              </select>
            </div>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Diameter (mm)</label>
              <input type="number" value={diameter} onChange={(e) => setDiameter(Math.max(0.1, parseFloat(e.target.value) || 5))} step={0.5} min={0.1} />
            </div>
            <div className="form-group">
              <label>Depth (mm)</label>
              <input type="number" value={depth} onChange={(e) => setDepth(Math.max(0.1, parseFloat(e.target.value) || 10))} disabled={through} step={0.5} min={0.1} />
            </div>
          </div>
          {(holeType === 'counterbore' || holeType === 'counterbore-countersink') && (
            <div className="settings-grid">
              <div className="form-group">
                <label>CB Diameter (mm)</label>
                <input type="number" value={cbDiameter} onChange={(e) => setCbDiameter(Math.max(diameter, parseFloat(e.target.value) || 10))} step={0.5} min={0.1} />
              </div>
              <div className="form-group">
                <label>CB Depth (mm)</label>
                <input type="number" value={cbDepth} onChange={(e) => setCbDepth(Math.max(0.1, parseFloat(e.target.value) || 3))} step={0.5} min={0.1} />
              </div>
            </div>
          )}
          {(holeType === 'countersink' || holeType === 'counterbore-countersink') && (
            <div className="settings-grid">
              <div className="form-group">
                <label>CS Angle (deg)</label>
                <input type="number" value={csAngle} onChange={(e) => setCsAngle(parseFloat(e.target.value) || 90)} min={60} max={120} step={5} />
              </div>
              <div className="form-group">
                <label>CS Diameter (mm)</label>
                <input type="number" value={csDiameter} onChange={(e) => setCsDiameter(Math.max(diameter, parseFloat(e.target.value) || 9))} step={0.5} min={0.1} />
              </div>
            </div>
          )}
          <div className="settings-grid">
            <div className="form-group">
              <label>Drill Point</label>
              <select value={drillPoint} onChange={(e) => setDrillPoint(e.target.value as DrillPoint)}>
                <option value="flat">Flat</option>
                <option value="angled">Angled</option>
              </select>
            </div>
            {drillPoint === 'angled' && (
              <div className="form-group">
                <label>Point Angle (deg)</label>
                <input type="number" value={drillAngle} onChange={(e) => setDrillAngle(parseFloat(e.target.value) || 118)} min={60} max={150} step={1} />
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Termination</label>
            <select value={termination} onChange={(e) => setTermination(e.target.value as HoleTermination)}>
              <option value="blind">Blind (Distance)</option>
              <option value="through-all">Through All</option>
              <option value="to-next">To Next</option>
              <option value="symmetric">Symmetric</option>
            </select>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}
