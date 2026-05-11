import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

type PrimitiveKind = 'box' | 'cylinder' | 'sphere' | 'torus' | 'coil';

export function PrimitivesDialog({ kind, onClose }: { kind: PrimitiveKind; onClose: () => void }) {
  const [boxW, setBoxW] = useState(20);
  const [boxH, setBoxH] = useState(20);
  const [boxD, setBoxD] = useState(20);
  const [cylRadius, setCylRadius] = useState(10);
  const [cylHeight, setCylHeight] = useState(20);
  const [cylRadiusTop, setCylRadiusTop] = useState(10);
  const [sphRadius, setSphRadius] = useState(10);
  const [torRadius, setTorRadius] = useState(15);
  const [torTube, setTorTube] = useState(3);
  const [coilOuterRadius, setCoilOuterRadius] = useState(15);
  const [coilWireRadius, setCoilWireRadius] = useState(2);
  const [coilPitch, setCoilPitch] = useState(10);
  const [coilTurns, setCoilTurns] = useState(5);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [z, setZ] = useState(0);

  const addPrimitive = useCADStore((s) => s.addPrimitive);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const params: Record<string, number> = kind === 'box'
      ? { width: boxW, height: boxH, depth: boxD }
      : kind === 'cylinder'
        ? { radius: cylRadius, radiusTop: cylRadiusTop, height: cylHeight }
        : kind === 'sphere'
          ? { radius: sphRadius }
          : kind === 'coil'
            ? { outerRadius: coilOuterRadius, wireRadius: coilWireRadius, pitch: coilPitch, turns: coilTurns }
            : { radius: torRadius, tubeRadius: torTube };
    addPrimitive(kind, { ...params, x, y, z });
    setStatusMessage(`Created ${kind}`);
    onClose();
  };

  const titles: Record<PrimitiveKind, string> = {
    box: 'Box',
    cylinder: 'Cylinder',
    sphere: 'Sphere',
    torus: 'Torus',
    coil: 'Coil',
  };

  return (
    <DialogShell title={titles[kind]} onClose={onClose} size="sm" onConfirm={handleApply}>
      {kind === 'box' && (
        <div className="settings-grid">
          <div className="form-group">
            <label>Width (mm)</label>
            <input type="number" value={boxW} onChange={(e) => setBoxW(Math.max(0.1, parseFloat(e.target.value) || 20))} step={1} min={0.1} />
          </div>
          <div className="form-group">
            <label>Height (mm)</label>
            <input type="number" value={boxH} onChange={(e) => setBoxH(Math.max(0.1, parseFloat(e.target.value) || 20))} step={1} min={0.1} />
          </div>
          <div className="form-group">
            <label>Depth (mm)</label>
            <input type="number" value={boxD} onChange={(e) => setBoxD(Math.max(0.1, parseFloat(e.target.value) || 20))} step={1} min={0.1} />
          </div>
        </div>
      )}
      {kind === 'cylinder' && (
        <div className="settings-grid">
          <div className="form-group">
            <label>Radius Bottom (mm)</label>
            <input type="number" value={cylRadius} onChange={(e) => setCylRadius(Math.max(0.1, parseFloat(e.target.value) || 10))} step={0.5} min={0.1} />
          </div>
          <div className="form-group">
            <label>Radius Top (mm)</label>
            <input type="number" value={cylRadiusTop} onChange={(e) => setCylRadiusTop(Math.max(0, parseFloat(e.target.value) || 10))} step={0.5} min={0} />
          </div>
          <div className="form-group">
            <label>Height (mm)</label>
            <input type="number" value={cylHeight} onChange={(e) => setCylHeight(Math.max(0.1, parseFloat(e.target.value) || 20))} step={1} min={0.1} />
          </div>
        </div>
      )}
      {kind === 'sphere' && (
        <div className="form-group">
          <label>Radius (mm)</label>
          <input type="number" value={sphRadius} onChange={(e) => setSphRadius(Math.max(0.1, parseFloat(e.target.value) || 10))} step={0.5} min={0.1} />
        </div>
      )}
      {kind === 'torus' && (
        <div className="settings-grid">
          <div className="form-group">
            <label>Major Radius (mm)</label>
            <input type="number" value={torRadius} onChange={(e) => setTorRadius(Math.max(0.1, parseFloat(e.target.value) || 15))} step={0.5} min={0.1} />
          </div>
          <div className="form-group">
            <label>Tube Radius (mm)</label>
            <input type="number" value={torTube} onChange={(e) => setTorTube(Math.max(0.1, Math.min(torRadius - 0.01, parseFloat(e.target.value) || 3)))} step={0.5} min={0.1} />
          </div>
        </div>
      )}
      {kind === 'coil' && (
        <div className="settings-grid">
          <div className="form-group">
            <label>Outer Radius (mm)</label>
            <input type="number" value={coilOuterRadius} onChange={(e) => setCoilOuterRadius(Math.max(0.1, parseFloat(e.target.value) || 15))} step={0.5} min={0.1} />
          </div>
          <div className="form-group">
            <label>Wire Radius (mm)</label>
            <input type="number" value={coilWireRadius} onChange={(e) => setCoilWireRadius(Math.max(0.1, Math.min(coilOuterRadius - 0.01, parseFloat(e.target.value) || 2)))} step={0.1} min={0.1} />
          </div>
          <div className="form-group">
            <label>Pitch (mm/turn)</label>
            <input type="number" value={coilPitch} onChange={(e) => setCoilPitch(Math.max(0.1, parseFloat(e.target.value) || 10))} step={0.5} min={0.1} />
          </div>
          <div className="form-group">
            <label>Turns</label>
            <input type="number" value={coilTurns} onChange={(e) => setCoilTurns(Math.max(0.25, parseFloat(e.target.value) || 5))} step={0.25} min={0.25} />
          </div>
        </div>
      )}
      <div className="settings-grid">
        <div className="form-group">
          <label>X Position (mm)</label>
          <input type="number" value={x} onChange={(e) => setX(parseFloat(e.target.value) || 0)} step={1} />
        </div>
        <div className="form-group">
          <label>Y Position (mm)</label>
          <input type="number" value={y} onChange={(e) => setY(parseFloat(e.target.value) || 0)} step={1} />
        </div>
        <div className="form-group">
          <label>Z Position (mm)</label>
          <input type="number" value={z} onChange={(e) => setZ(parseFloat(e.target.value) || 0)} step={1} />
        </div>
      </div>
    </DialogShell>
  );
}
