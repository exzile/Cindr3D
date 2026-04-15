import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { useComponentStore } from '../../store/componentStore';
import type { Feature, BooleanOperation, FeatureType } from '../../types/cad';
import * as THREE from 'three';

// ===== Shell Dialog (D83) =====
export function ShellDialog({ onClose }: { onClose: () => void }) {
  const [thickness, setThickness] = useState(2);
  const [direction, setDirection] = useState<'inside' | 'outside' | 'both'>('inside');
  const [tangentChain, setTangentChain] = useState(true);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Shell (${thickness}mm ${direction})`,
      type: 'shell',
      params: { thickness, direction, tangentChain, removeFaces: '' },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created ${direction} shell with ${thickness}mm thickness`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Shell</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'inside' | 'outside' | 'both')}>
              <option value="inside">Inside</option>
              <option value="outside">Outside</option>
              <option value="both">Both Sides</option>
            </select>
          </div>
          <div className="form-group">
            <label>Thickness (mm)</label>
            <input type="number" value={thickness} onChange={(e) => setThickness(parseFloat(e.target.value) || 2)} step={0.5} min={0.1} />
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={tangentChain} onChange={(e) => setTangentChain(e.target.checked)} />
            Tangent Chain face selection
          </label>
          <p className="dialog-hint">Select faces to remove in the viewport, or leave empty to shell all faces.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Linear Pattern Dialog (D98) =====
export function LinearPatternDialog({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState(3);
  const [spacing, setSpacing] = useState(20);
  const [distribution, setDistribution] = useState<'spacing' | 'extent'>('spacing');
  const [directionX, setDirectionX] = useState(1);
  const [directionY, setDirectionY] = useState(0);
  const [directionZ, setDirectionZ] = useState(0);
  const [useSecond, setUseSecond] = useState(false);
  const [count2, setCount2] = useState(2);
  const [spacing2, setSpacing2] = useState(20);
  const [distribution2, setDistribution2] = useState<'spacing' | 'extent'>('spacing');

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  // When distribution is 'extent', spacing is the total span; per-instance = span/(count-1).
  const effectiveSpacing = distribution === 'extent' ? spacing / Math.max(1, count - 1) : spacing;
  const effectiveSpacing2 = distribution2 === 'extent' ? spacing2 / Math.max(1, count2 - 1) : spacing2;

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Linear Pattern (${count}${useSecond ? `×${count2}` : ''})`,
      type: 'linear-pattern',
      params: {
        count,
        spacing: effectiveSpacing,
        distribution,
        directionX, directionY, directionZ,
        useSecondDirection: useSecond,
        count2: useSecond ? count2 : 1,
        spacing2: useSecond ? effectiveSpacing2 : 0,
        distribution2: useSecond ? distribution2 : 'spacing',
      },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created linear pattern: ${count}${useSecond ? ` × ${count2}` : ''} instances`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>Linear Pattern</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="settings-grid">
            <div className="form-group">
              <label>Count</label>
              <input type="number" value={count} onChange={(e) => setCount(Math.max(2, parseInt(e.target.value) || 2))} min={2} max={100} />
            </div>
            <div className="form-group">
              <label>Distribution</label>
              <select value={distribution} onChange={(e) => setDistribution(e.target.value as 'spacing' | 'extent')}>
                <option value="spacing">Spacing</option>
                <option value="extent">Extent</option>
              </select>
            </div>
            <div className="form-group">
              <label>{distribution === 'extent' ? 'Total Extent (mm)' : 'Spacing (mm)'}</label>
              <input type="number" value={spacing} onChange={(e) => setSpacing(parseFloat(e.target.value) || 10)} step={1} />
            </div>
          </div>
          <div className="form-group">
            <label>Direction (X, Y, Z)</label>
            <div className="direction-inputs">
              <input type="number" value={directionX} onChange={(e) => setDirectionX(parseFloat(e.target.value) || 0)} step={0.1} />
              <input type="number" value={directionY} onChange={(e) => setDirectionY(parseFloat(e.target.value) || 0)} step={0.1} />
              <input type="number" value={directionZ} onChange={(e) => setDirectionZ(parseFloat(e.target.value) || 0)} step={0.1} />
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={useSecond} onChange={(e) => setUseSecond(e.target.checked)} />
            Second Direction
          </label>
          {useSecond && (
            <div className="settings-grid">
              <div className="form-group">
                <label>Count 2</label>
                <input type="number" value={count2} onChange={(e) => setCount2(Math.max(2, parseInt(e.target.value) || 2))} min={2} />
              </div>
              <div className="form-group">
                <label>Distribution 2</label>
                <select value={distribution2} onChange={(e) => setDistribution2(e.target.value as 'spacing' | 'extent')}>
                  <option value="spacing">Spacing</option>
                  <option value="extent">Extent</option>
                </select>
              </div>
              <div className="form-group">
                <label>{distribution2 === 'extent' ? 'Extent 2 (mm)' : 'Spacing 2 (mm)'}</label>
                <input type="number" value={spacing2} onChange={(e) => setSpacing2(parseFloat(e.target.value) || 10)} />
              </div>
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Circular Pattern Dialog (D99) =====
export function CircularPatternDialog({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState(6);
  const [totalAngle, setTotalAngle] = useState(360);
  const [symmetric, setSymmetric] = useState(false);
  const [axis, setAxis] = useState<'X' | 'Y' | 'Z'>('Y');
  const [computeType, setComputeType] = useState<'optimized' | 'identical' | 'adjust'>('optimized');

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Circular Pattern (${count}x)`,
      type: 'circular-pattern',
      params: { count, totalAngle, symmetric, axis, computeType },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created circular pattern: ${count} instances around ${axis}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Circular Pattern</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Axis</label>
            <select value={axis} onChange={(e) => setAxis(e.target.value as 'X' | 'Y' | 'Z')}>
              <option value="X">X Axis</option>
              <option value="Y">Y Axis</option>
              <option value="Z">Z Axis</option>
            </select>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Count</label>
              <input type="number" value={count} onChange={(e) => setCount(Math.max(2, parseInt(e.target.value) || 2))} min={2} max={100} />
            </div>
            <div className="form-group">
              <label>Total Angle (°)</label>
              <input type="number" value={totalAngle} onChange={(e) => setTotalAngle(parseFloat(e.target.value) || 360)} min={1} max={360} />
            </div>
          </div>
          <div className="form-group">
            <label>Compute Type</label>
            <select value={computeType} onChange={(e) => setComputeType(e.target.value as 'optimized' | 'identical' | 'adjust')}>
              <option value="optimized">Optimized</option>
              <option value="identical">Identical</option>
              <option value="adjust">Adjust</option>
            </select>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={symmetric} onChange={(e) => setSymmetric(e.target.checked)} />
            Symmetric
          </label>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Mirror Dialog =====
export function MirrorDialog({ onClose }: { onClose: () => void }) {
  const [mirrorPlane, setMirrorPlane] = useState('XY');

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Mirror (${mirrorPlane})`,
      type: 'mirror',
      params: { mirrorPlane },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created mirror on ${mirrorPlane} plane`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Mirror</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Mirror Plane</label>
            <select value={mirrorPlane} onChange={(e) => setMirrorPlane(e.target.value)}>
              <option value="XY">XY Plane</option>
              <option value="XZ">XZ Plane</option>
              <option value="YZ">YZ Plane</option>
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

// ===== Combine (Boolean) Dialog (D86) =====
export function CombineDialog({ onClose }: { onClose: () => void }) {
  const [operation, setOperation] = useState<BooleanOperation>('join');
  const [keepTools, setKeepTools] = useState(false);

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Combine (${operation})`,
      type: 'combine',
      params: { operation, keepTools },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created ${operation} operation${keepTools ? ' (keep tools)' : ''}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Combine Bodies</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as BooleanOperation)}>
              <option value="join">Join (Union)</option>
              <option value="cut">Cut (Subtract)</option>
              <option value="intersect">Intersect</option>
            </select>
          </div>
          <div className="boolean-preview">
            <div className="boolean-diagram">
              {operation === 'join' && <div className="bool-icon join">A + B</div>}
              {operation === 'cut' && <div className="bool-icon cut">A - B</div>}
              {operation === 'intersect' && <div className="bool-icon intersect">A &cap; B</div>}
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={keepTools} onChange={(e) => setKeepTools(e.target.checked)} />
            Keep Tools (preserve tool bodies)
          </label>
          <p className="dialog-hint">Select a target body and a tool body in the viewport.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Hole Dialog =====
// D91: Hole dialog (Fusion-accurate)
type HoleType = 'simple' | 'counterbore' | 'countersink' | 'counterbore-countersink';
type TapType = 'clearance' | 'tapped';
type DrillPoint = 'flat' | 'angled';
type HoleTermination = 'blind' | 'through-all' | 'to-next' | 'symmetric';

export function HoleDialog({ onClose }: { onClose: () => void }) {
  const [holeType, setHoleType] = useState<HoleType>('simple');
  const [tapType, setTapType] = useState<TapType>('clearance');
  const [drillPoint, setDrillPoint] = useState<DrillPoint>('angled');
  const [drillAngle, setDrillAngle] = useState(118);
  const [termination, setTermination] = useState<HoleTermination>('blind');
  const [diameter, setDiameter] = useState(5);
  const [depth, setDepth] = useState(10);
  // Counterbore params
  const [cbDiameter, setCbDiameter] = useState(10);
  const [cbDepth, setCbDepth] = useState(3);
  // Countersink params
  const [csAngle, setCsAngle] = useState(90);
  const [csDiameter, setCsDiameter] = useState(9);

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const through = termination === 'through-all' || termination === 'to-next';

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Hole (${diameter}mm Ø, ${holeType})`,
      type: 'hole',
      params: {
        holeType, tapType, drillPoint, drillAngle, termination,
        diameter, depth,
        cbDiameter, cbDepth,
        csAngle, csDiameter,
      },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created ${holeType} hole: ${diameter}mm ${tapType}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>Hole</h3>
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

// ===== Thread Dialog (D92) =====
type ThreadStandard = 'iso-metric' | 'ansi-unified' | 'npt';

export function ThreadDialog({ onClose }: { onClose: () => void }) {
  const [threadType, setThreadType] = useState<'cosmetic' | 'modeled'>('cosmetic');
  const [standard, setStandard] = useState<ThreadStandard>('iso-metric');
  const [designation, setDesignation] = useState('M6x1.0');
  const [threadClass, setThreadClass] = useState('6H');
  const [diameter, setDiameter] = useState(6);
  const [length, setLength] = useState(15);
  const [offset, setOffset] = useState(0);
  const [fullLength, setFullLength] = useState(false);
  const [direction, setDirection] = useState<'right-hand' | 'left-hand'>('right-hand');

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const ISO_DESIGNATIONS = ['M3x0.5', 'M4x0.7', 'M5x0.8', 'M6x1.0', 'M8x1.25', 'M10x1.5', 'M12x1.75', 'M16x2.0', 'M20x2.5', 'M24x3.0'];
  const ANSI_DESIGNATIONS = ['1/4-20', '5/16-18', '3/8-16', '7/16-14', '1/2-13', '5/8-11', '3/4-10', '7/8-9', '1-8'];
  const NPT_DESIGNATIONS = ['1/8 NPT', '1/4 NPT', '3/8 NPT', '1/2 NPT', '3/4 NPT', '1 NPT'];
  const designations = standard === 'iso-metric' ? ISO_DESIGNATIONS : standard === 'ansi-unified' ? ANSI_DESIGNATIONS : NPT_DESIGNATIONS;

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Thread (${designation}, ${direction === 'left-hand' ? 'LH' : 'RH'})`,
      type: 'thread',
      params: {
        threadType, standard, designation, threadClass,
        diameter, length, offset, fullLength,
        direction,
      },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created ${threadType} thread: ${designation}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Thread</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="settings-grid">
            <div className="form-group">
              <label>Type</label>
              <select value={threadType} onChange={(e) => setThreadType(e.target.value as 'cosmetic' | 'modeled')}>
                <option value="cosmetic">Cosmetic</option>
                <option value="modeled">Modeled</option>
              </select>
            </div>
            <div className="form-group">
              <label>Direction</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'right-hand' | 'left-hand')}>
                <option value="right-hand">Right Hand</option>
                <option value="left-hand">Left Hand</option>
              </select>
            </div>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Standard</label>
              <select value={standard} onChange={(e) => { setStandard(e.target.value as ThreadStandard); setDesignation(''); }}>
                <option value="iso-metric">ISO Metric</option>
                <option value="ansi-unified">ANSI Unified</option>
                <option value="npt">NPT</option>
              </select>
            </div>
            <div className="form-group">
              <label>Designation</label>
              <select value={designation} onChange={(e) => setDesignation(e.target.value)}>
                {designations.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Class</label>
              <input type="text" value={threadClass} onChange={(e) => setThreadClass(e.target.value)} placeholder="e.g. 6H" />
            </div>
            <div className="form-group">
              <label>Diameter (mm)</label>
              <input type="number" value={diameter} onChange={(e) => setDiameter(Math.max(0.1, parseFloat(e.target.value) || 6))} step={0.5} min={0.1} />
            </div>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Length (mm)</label>
              <input type="number" value={length} onChange={(e) => setLength(Math.max(0.1, parseFloat(e.target.value) || 15))} disabled={fullLength} step={0.5} min={0.1} />
            </div>
            <div className="form-group">
              <label>Offset (mm)</label>
              <input type="number" value={offset} onChange={(e) => setOffset(parseFloat(e.target.value) || 0)} step={0.5} />
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={fullLength} onChange={(e) => setFullLength(e.target.checked)} />
            Full Length
          </label>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Construction Plane Dialog =====
export function ConstructionPlaneDialog({ onClose, initialMethod }: { onClose: () => void; initialMethod?: string }) {
  const [method, setMethod] = useState(initialMethod ?? 'offset');
  const [distance, setDistance] = useState(10);
  const [referencePlane, setReferencePlane] = useState('XY');
  const [angle, setAngle] = useState(45);

  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const addConstruction = useComponentStore((s) => s.addConstruction);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    let normal = new THREE.Vector3(0, 0, 1);
    let origin = new THREE.Vector3(0, 0, 0);
    let name = 'Plane';

    if (method === 'offset') {
      switch (referencePlane) {
        case 'XY': normal.set(0, 0, 1); origin.set(0, 0, distance); break;
        case 'XZ': normal.set(0, 1, 0); origin.set(0, distance, 0); break;
        case 'YZ': normal.set(1, 0, 0); origin.set(distance, 0, 0); break;
      }
      name = `Offset Plane (${referencePlane} + ${distance}mm)`;
    } else if (method === 'angle') {
      const rad = (angle * Math.PI) / 180;
      switch (referencePlane) {
        case 'XY': normal.set(0, Math.sin(rad), Math.cos(rad)); break;
        case 'XZ': normal.set(Math.sin(rad), Math.cos(rad), 0); break;
        case 'YZ': normal.set(Math.cos(rad), 0, Math.sin(rad)); break;
      }
      name = `Angled Plane (${angle}deg from ${referencePlane})`;
    } else if (method === 'midplane') {
      origin.set(0, 0, distance / 2);
      name = 'Midplane';
    }

    addConstruction({
      name,
      type: 'plane',
      componentId: activeComponentId,
      visible: true,
      planeNormal: normal,
      planeOrigin: origin,
      planeSize: 50,
      definition: method === 'offset'
        ? { method: 'offset-plane', referencePlane, distance }
        : method === 'angle'
        ? { method: 'angle-plane', referencePlane, angle, axis: 'x' }
        : { method: 'midplane', plane1: 'XY', plane2: 'XY' },
    });

    setStatusMessage(`Created construction plane: ${name}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>Construction Plane</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="offset">Offset Plane</option>
              <option value="angle">Plane at Angle</option>
              <option value="midplane">Midplane</option>
            </select>
          </div>
          <div className="form-group">
            <label>Reference Plane</label>
            <select value={referencePlane} onChange={(e) => setReferencePlane(e.target.value)}>
              <option value="XY">XY Plane</option>
              <option value="XZ">XZ Plane</option>
              <option value="YZ">YZ Plane</option>
            </select>
          </div>
          {method === 'offset' && (
            <div className="form-group">
              <label>Offset Distance (mm)</label>
              <input type="number" value={distance} onChange={(e) => setDistance(parseFloat(e.target.value) || 0)} step={1} />
            </div>
          )}
          {method === 'angle' && (
            <div className="form-group">
              <label>Angle (degrees)</label>
              <input type="number" value={angle} onChange={(e) => setAngle(parseFloat(e.target.value) || 0)} min={-180} max={180} step={5} />
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Draft Dialog (D84) =====
export function DraftDialog({ onClose }: { onClose: () => void }) {
  const [draftType, setDraftType] = useState<'fixed-plane' | 'parting-line'>('fixed-plane');
  const [angle, setAngle] = useState(3);
  const [mode, setMode] = useState<'one-side' | 'two-side' | 'symmetric'>('one-side');
  const [pullAxis, setPullAxis] = useState<'X' | 'Y' | 'Z'>('Y');
  const [flipPull, setFlipPull] = useState(false);

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Draft (${angle}°)`,
      type: 'draft',
      params: { draftType, angle, mode, pullAxis, flipPull },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Draft applied: ${angle}° (${mode})`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Draft</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Type</label>
            <select value={draftType} onChange={(e) => setDraftType(e.target.value as 'fixed-plane' | 'parting-line')}>
              <option value="fixed-plane">Fixed Plane</option>
              <option value="parting-line">Parting Line</option>
            </select>
          </div>
          <div className="form-group">
            <label>Pull Direction</label>
            <div className="direction-inputs" style={{ alignItems: 'center', gap: 8 }}>
              <select value={pullAxis} onChange={(e) => setPullAxis(e.target.value as 'X' | 'Y' | 'Z')}
                style={{ flex: 1 }}>
                <option value="X">+X Axis</option>
                <option value="Y">+Y Axis</option>
                <option value="Z">+Z Axis</option>
              </select>
              <label className="checkbox-label" style={{ margin: 0 }}>
                <input type="checkbox" checked={flipPull} onChange={(e) => setFlipPull(e.target.checked)} />
                Flip
              </label>
            </div>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Draft Angle (°)</label>
              <input type="number" value={angle}
                onChange={(e) => setAngle(Math.max(0.1, Math.min(89, parseFloat(e.target.value) || 3)))}
                step={0.5} min={0.1} max={89} />
            </div>
            <div className="form-group">
              <label>Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as 'one-side' | 'two-side' | 'symmetric')}>
                <option value="one-side">One Side</option>
                <option value="two-side">Two Sides</option>
                <option value="symmetric">Symmetric</option>
              </select>
            </div>
          </div>
          <p className="dialog-hint">Select the face(s) to draft in the viewport.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Scale (Solid) Dialog (D85) =====
export function ScaleDialog({ onClose }: { onClose: () => void }) {
  const [scaleType, setScaleType] = useState<'uniform' | 'non-uniform'>('uniform');
  const [factor, setFactor] = useState(1);
  const [factorX, setFactorX] = useState(1);
  const [factorY, setFactorY] = useState(1);
  const [factorZ, setFactorZ] = useState(1);
  const [refPoint, setRefPoint] = useState<'centroid' | 'origin'>('centroid');

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const params: Record<string, string | number | boolean | number[]> = scaleType === 'uniform'
      ? { scaleType, factor, refPoint }
      : { scaleType, factorX, factorY, factorZ, refPoint };
    const label = scaleType === 'uniform'
      ? `${factor}×`
      : `${factorX}×${factorY}×${factorZ}`;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Scale (${label})`,
      type: 'scale',
      params,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Solid scaled ${label}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Scale</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Scale Type</label>
            <select value={scaleType} onChange={(e) => setScaleType(e.target.value as 'uniform' | 'non-uniform')}>
              <option value="uniform">Uniform</option>
              <option value="non-uniform">Non-Uniform</option>
            </select>
          </div>
          {scaleType === 'uniform' ? (
            <div className="form-group">
              <label>Scale Factor</label>
              <input type="number" value={factor}
                onChange={(e) => setFactor(Math.max(0.001, parseFloat(e.target.value) || 1))}
                step={0.1} min={0.001} />
            </div>
          ) : (
            <div className="settings-grid">
              <div className="form-group">
                <label>X Factor</label>
                <input type="number" value={factorX}
                  onChange={(e) => setFactorX(Math.max(0.001, parseFloat(e.target.value) || 1))}
                  step={0.1} min={0.001} />
              </div>
              <div className="form-group">
                <label>Y Factor</label>
                <input type="number" value={factorY}
                  onChange={(e) => setFactorY(Math.max(0.001, parseFloat(e.target.value) || 1))}
                  step={0.1} min={0.001} />
              </div>
              <div className="form-group">
                <label>Z Factor</label>
                <input type="number" value={factorZ}
                  onChange={(e) => setFactorZ(Math.max(0.001, parseFloat(e.target.value) || 1))}
                  step={0.1} min={0.001} />
              </div>
            </div>
          )}
          <div className="form-group">
            <label>Reference Point</label>
            <select value={refPoint} onChange={(e) => setRefPoint(e.target.value as 'centroid' | 'origin')}>
              <option value="centroid">Body Centroid</option>
              <option value="origin">World Origin</option>
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

// ===== Primitives Dialog (D80) =====
type PrimitiveKind = 'box' | 'cylinder' | 'sphere' | 'torus';

export function PrimitivesDialog({ kind, onClose }: { kind: PrimitiveKind; onClose: () => void }) {
  // Box params
  const [boxW, setBoxW] = useState(20);
  const [boxH, setBoxH] = useState(20);
  const [boxD, setBoxD] = useState(20);
  // Cylinder params
  const [cylRadius, setCylRadius] = useState(10);
  const [cylHeight, setCylHeight] = useState(20);
  const [cylRadiusTop, setCylRadiusTop] = useState(10);
  // Sphere params
  const [sphRadius, setSphRadius] = useState(10);
  // Torus params
  const [torRadius, setTorRadius] = useState(15);
  const [torTube, setTorTube] = useState(3);

  const addPrimitive = useCADStore((s) => s.addPrimitive);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const params: Record<string, number> = kind === 'box'
      ? { width: boxW, height: boxH, depth: boxD }
      : kind === 'cylinder'
        ? { radius: cylRadius, radiusTop: cylRadiusTop, height: cylHeight }
        : kind === 'sphere'
          ? { radius: sphRadius }
          : { radius: torRadius, tubeRadius: torTube };
    addPrimitive(kind, params);
    setStatusMessage(`Created ${kind}`);
    onClose();
  };

  const titles: Record<PrimitiveKind, string> = {
    box: 'Box',
    cylinder: 'Cylinder',
    sphere: 'Sphere',
    torus: 'Torus',
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{titles[kind]}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
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
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Web Dialog (D74) =====
export function WebDialog({ onClose }: { onClose: () => void }) {
  const [thickness, setThickness] = useState(2);
  const [height, setHeight] = useState(10);
  const [direction, setDirection] = useState<'normal' | 'flip' | 'symmetric'>('normal');
  const [operation, setOperation] = useState<'join' | 'new-body'>('join');

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Web (${thickness}mm thick)`,
      type: 'rib' as FeatureType,
      params: { thickness, height, direction, operation, webStyle: 'perpendicular' },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created web: ${thickness}mm thick`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Web</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="settings-grid">
            <div className="form-group">
              <label>Thickness (mm)</label>
              <input type="number" value={thickness} onChange={(e) => setThickness(Math.max(0.01, parseFloat(e.target.value) || 2))} step={0.5} min={0.01} />
            </div>
            <div className="form-group">
              <label>Height (mm)</label>
              <input type="number" value={height} onChange={(e) => setHeight(Math.max(0.1, parseFloat(e.target.value) || 10))} step={1} min={0.1} />
            </div>
          </div>
          <div className="form-group">
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="normal">Normal</option>
              <option value="flip">Flip</option>
              <option value="symmetric">Symmetric</option>
            </select>
          </div>
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as typeof operation)}>
              <option value="join">Join</option>
              <option value="new-body">New Body</option>
            </select>
          </div>
          <p className="dialog-hint">Select an open-profile sketch perpendicular to the base plane.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Emboss Dialog (D75) =====
export function EmbossDialog({ onClose }: { onClose: () => void }) {
  const sketches = useCADStore((s) => s.sketches);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [profileId, setProfileId] = useState('');
  const [depth, setDepth] = useState(1);
  const [direction, setDirection] = useState<'raise' | 'recess'>('raise');
  const [angle, setAngle] = useState(2);

  const handleApply = () => {
    const sketch = sketches.find((s) => s.id === profileId);
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Emboss (${direction}, ${depth}mm)`,
      type: 'rib' as FeatureType,
      params: { profileId, profileName: sketch?.name ?? '', depth, direction, angle, embossStyle: 'emboss' },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created ${direction} emboss: ${depth}mm`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Emboss</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Profile Sketch</label>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="" disabled>Select a sketch</option>
              {sketches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Direction</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'raise' | 'recess')}>
                <option value="raise">Raise</option>
                <option value="recess">Recess</option>
              </select>
            </div>
            <div className="form-group">
              <label>Depth (mm)</label>
              <input type="number" value={depth} onChange={(e) => setDepth(Math.max(0.01, parseFloat(e.target.value) || 1))} step={0.1} min={0.01} />
            </div>
          </div>
          <div className="form-group">
            <label>Draft Angle (deg)</label>
            <input type="number" value={angle} onChange={(e) => setAngle(parseFloat(e.target.value) || 0)} min={0} max={30} step={0.5} />
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!profileId} onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Rest Dialog (D76) =====
export function RestDialog({ onClose }: { onClose: () => void }) {
  const sketches = useCADStore((s) => s.sketches);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [profileId, setProfileId] = useState('');
  const [depth, setDepth] = useState(0);
  const [operation, setOperation] = useState<'join' | 'cut'>('join');

  const handleApply = () => {
    const sketch = sketches.find((s) => s.id === profileId);
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Rest (${sketch?.name ?? 'profile'})`,
      type: 'rib' as FeatureType,
      params: { profileId, profileName: sketch?.name ?? '', depth, operation, restStyle: 'rest' },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created rest feature from ${sketch?.name ?? 'profile'}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Rest</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Profile Sketch</label>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="" disabled>Select a sketch</option>
              {sketches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Depth (mm, 0 = flush)</label>
            <input type="number" value={depth} onChange={(e) => setDepth(parseFloat(e.target.value) || 0)} step={0.1} min={0} />
          </div>
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as 'join' | 'cut')}>
              <option value="join">Join</option>
              <option value="cut">Cut</option>
            </select>
          </div>
          <p className="dialog-hint">Creates a flat seating area on the solid body using the sketch profile boundary.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!profileId} onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Thicken Dialog (D77) =====
export function ThickenDialog({ onClose }: { onClose: () => void }) {
  const [thickness, setThickness] = useState(2);
  const [direction, setDirection] = useState<'inside' | 'outside' | 'symmetric'>('inside');
  const [operation, setOperation] = useState<'new-body' | 'join' | 'cut'>('new-body');

  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Thicken (${thickness}mm, ${direction})`,
      type: 'thicken',
      params: { thickness, direction, operation },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created thicken: ${thickness}mm ${direction}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Thicken</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Thickness (mm)</label>
            <input type="number" value={thickness} onChange={(e) => setThickness(Math.max(0.01, parseFloat(e.target.value) || 2))} step={0.5} min={0.01} />
          </div>
          <div className="form-group">
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'inside' | 'outside' | 'symmetric')}>
              <option value="inside">Inside</option>
              <option value="outside">Outside</option>
              <option value="symmetric">Symmetric</option>
            </select>
          </div>
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as 'new-body' | 'join' | 'cut')}>
              <option value="new-body">New Body</option>
              <option value="join">Join</option>
              <option value="cut">Cut</option>
            </select>
          </div>
          <p className="dialog-hint">Select a face or surface body in the viewport to thicken.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Pattern on Path Dialog (D100) =====
export function PatternOnPathDialog({ onClose }: { onClose: () => void }) {
  const sketches = useCADStore((s) => s.sketches);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [pathSketchId, setPathSketchId] = useState<string>('');
  const [count, setCount] = useState(4);
  const [alignment, setAlignment] = useState<'tangent' | 'fixed'>('tangent');
  const [distance, setDistance] = useState(100);
  const [distanceType, setDistanceType] = useState<'percent' | 'spacing'>('percent');

  const handleApply = () => {
    const sketch = sketches.find((s) => s.id === pathSketchId);
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Pattern on Path (${count}×)`,
      type: 'pattern-on-path',
      params: {
        pathSketchId,
        pathSketchName: sketch?.name ?? '',
        count,
        alignment,
        distance,
        distanceType,
      },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created pattern on path: ${count} instances`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Pattern on Path</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Path Sketch</label>
            <select value={pathSketchId} onChange={(e) => setPathSketchId(e.target.value)}>
              <option value="" disabled>Select a sketch</option>
              {sketches.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Count</label>
            <input type="number" value={count} min={2} step={1}
              onChange={(e) => setCount(Math.max(2, parseInt(e.target.value) || 2))} />
          </div>
          <div className="form-group">
            <label>Orientation</label>
            <select value={alignment} onChange={(e) => setAlignment(e.target.value as 'tangent' | 'fixed')}>
              <option value="tangent">Tangent to Path</option>
              <option value="fixed">Fixed (Parallel)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Distance Type</label>
            <select value={distanceType} onChange={(e) => setDistanceType(e.target.value as 'percent' | 'spacing')}>
              <option value="percent">% of Path Length</option>
              <option value="spacing">Equal Spacing</option>
            </select>
          </div>
          {distanceType === 'percent' && (
            <div className="form-group">
              <label>Path Coverage (%)</label>
              <input type="number" value={distance} min={1} max={100} step={5}
                onChange={(e) => setDistance(Math.max(1, Math.min(100, parseFloat(e.target.value) || 100)))} />
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!pathSketchId} onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Create Base Feature Dialog (D79) =====
export function BaseFeatureDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('Base Feature 1');
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name,
      type: 'import',
      params: { baseFeature: true, description: '' },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created Base Feature: ${name}. Geometry inside is not parametrically tracked.`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Create Base Feature</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <p className="dialog-hint">
            A Base Feature is a non-parametric container. Geometry modeled inside it will not trigger timeline recompute and can be freely edited without constraint. Use it to import or model bodies that shouldn't participate in the parametric history.
          </p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Rename Sketch Dialog =====
export function RenameSketchDialog({ sketchId, onClose }: { sketchId: string | null; onClose: () => void }) {
  const sketches = useCADStore((s) => s.sketches);
  const renameSketch = useCADStore((s) => s.renameSketch);
  const sketch = sketches.find((s) => s.id === sketchId);
  const [name, setName] = useState(sketch?.name ?? '');

  useEffect(() => {
    setName(sketch?.name ?? '');
  }, [sketch]);

  const handleApply = () => {
    if (!sketchId || !name.trim()) return;
    renameSketch(sketchId, name.trim());
    onClose();
  };

  if (!sketch) return null;

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Rename Sketch</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }} autoFocus />
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Redefine Sketch Plane Dialog (D60) =====
export function RedefineSketchPlaneDialog({ onClose }: { onClose: () => void }) {
  const sketches = useCADStore((s) => s.sketches);
  const redefineSketchPlane = useCADStore((s) => s.redefineSketchPlane);

  const [sketchId, setSketchId] = useState(sketches[0]?.id ?? '');
  const [plane, setPlane] = useState<'XY' | 'XZ' | 'YZ' | 'custom'>('XY');
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [offsetZ, setOffsetZ] = useState(0);

  const handleApply = () => {
    let normal = new THREE.Vector3(0, 0, 1);
    let origin = new THREE.Vector3(offsetX, offsetY, offsetZ);
    if (plane === 'XY') { normal.set(0, 0, 1); }
    else if (plane === 'XZ') { normal.set(0, 1, 0); }
    else if (plane === 'YZ') { normal.set(1, 0, 0); }
    // For 'custom' the user would need to type the normal — simplify for now
    redefineSketchPlane(sketchId, plane as any, normal, origin);
    onClose();
  };

  if (sketches.length === 0) {
    return (
      <div className="dialog-overlay">
        <div className="dialog dialog-sm">
          <div className="dialog-header">
            <h3>Redefine Sketch Plane</h3>
            <button className="dialog-close" onClick={onClose}><X size={16} /></button>
          </div>
          <div className="dialog-body">
            <p className="dialog-hint">No sketches available to redefine.</p>
          </div>
          <div className="dialog-footer">
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Redefine Sketch Plane</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Sketch</label>
            <select value={sketchId} onChange={(e) => setSketchId(e.target.value)}>
              {sketches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>New Plane</label>
            <select value={plane} onChange={(e) => setPlane(e.target.value as typeof plane)}>
              <option value="XY">XY Plane</option>
              <option value="XZ">XZ Plane</option>
              <option value="YZ">YZ Plane</option>
            </select>
          </div>
          <div className="form-group">
            <label>Origin Offset</label>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>X (mm)</label>
              <input type="number" value={offsetX} onChange={(e) => setOffsetX(parseFloat(e.target.value) || 0)} step={1} />
            </div>
            <div className="form-group">
              <label>Y (mm)</label>
              <input type="number" value={offsetY} onChange={(e) => setOffsetY(parseFloat(e.target.value) || 0)} step={1} />
            </div>
            <div className="form-group">
              <label>Z (mm)</label>
              <input type="number" value={offsetZ} onChange={(e) => setOffsetZ(parseFloat(e.target.value) || 0)} step={1} />
            </div>
          </div>
          <p className="dialog-hint">Redefines the reference plane for the selected sketch. All geometry remains unchanged; only the coordinate system is updated.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!sketchId} onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ===== Joint Dialog =====
export function JointDialog({ onClose }: { onClose: () => void }) {
  const [jointType, setJointType] = useState('rigid');
  const [name, setName] = useState('Joint 1');
  const [rotMin, setRotMin] = useState(-180);
  const [rotMax, setRotMax] = useState(180);
  const [transMin, setTransMin] = useState(0);
  const [transMax, setTransMax] = useState(50);

  const addJoint = useComponentStore((s) => s.addJoint);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    addJoint({
      name,
      type: jointType as any,
      componentId1: activeComponentId,
      componentId2: activeComponentId, // placeholder
      origin: new THREE.Vector3(0, 0, 0),
      axis: new THREE.Vector3(0, 1, 0),
      rotationLimits: ['revolute', 'cylindrical'].includes(jointType)
        ? { min: rotMin, max: rotMax } : undefined,
      translationLimits: ['slider', 'cylindrical', 'pin-slot'].includes(jointType)
        ? { min: transMin, max: transMax } : undefined,
      rotationValue: 0,
      translationValue: 0,
      locked: false,
    });

    setStatusMessage(`Created ${jointType} joint: ${name}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>Joint</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Joint Type</label>
            <select value={jointType} onChange={(e) => setJointType(e.target.value)}>
              <option value="rigid">Rigid</option>
              <option value="revolute">Revolute (Rotation)</option>
              <option value="slider">Slider (Translation)</option>
              <option value="cylindrical">Cylindrical</option>
              <option value="pin-slot">Pin-Slot</option>
              <option value="planar">Planar</option>
              <option value="ball">Ball</option>
            </select>
          </div>
          {['revolute', 'cylindrical'].includes(jointType) && (
            <div className="settings-grid">
              <div className="form-group">
                <label>Rotation Min (deg)</label>
                <input type="number" value={rotMin} onChange={(e) => setRotMin(parseFloat(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Rotation Max (deg)</label>
                <input type="number" value={rotMax} onChange={(e) => setRotMax(parseFloat(e.target.value))} />
              </div>
            </div>
          )}
          {['slider', 'cylindrical', 'pin-slot'].includes(jointType) && (
            <div className="settings-grid">
              <div className="form-group">
                <label>Translation Min (mm)</label>
                <input type="number" value={transMin} onChange={(e) => setTransMin(parseFloat(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Translation Max (mm)</label>
                <input type="number" value={transMax} onChange={(e) => setTransMax(parseFloat(e.target.value))} />
              </div>
            </div>
          )}
          <p className="dialog-hint">Select two components to connect with this joint.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}
