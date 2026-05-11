import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import type { Feature } from '../../../types/cad';

type Preset = 'Air' | 'Water' | 'PLA' | 'ABS' | 'Nylon' | 'Aluminum' | 'Steel' | 'Titanium' | 'Custom';

interface PresetData {
  density: number;
  youngModulus: number;
  yieldStrength: number;
}

const PRESET_TABLE: Record<Preset, PresetData> = {
  Air:      { density: 1.225,  youngModulus: 0,    yieldStrength: 0 },
  Water:    { density: 1000,   youngModulus: 0,    yieldStrength: 0 },
  PLA:      { density: 1240,   youngModulus: 3.5,  yieldStrength: 50 },
  ABS:      { density: 1050,   youngModulus: 2.3,  yieldStrength: 40 },
  Nylon:    { density: 1150,   youngModulus: 2.8,  yieldStrength: 55 },
  Aluminum: { density: 2700,   youngModulus: 69,   yieldStrength: 276 },
  Steel:    { density: 7850,   youngModulus: 200,  yieldStrength: 250 },
  Titanium: { density: 4510,   youngModulus: 116,  yieldStrength: 880 },
  Custom:   { density: 1000,   youngModulus: 1,    yieldStrength: 0 },
};

export function PhysicalMaterialDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const solidFeatures = features.filter((f) => f.type !== 'sketch' && f.type !== 'construction-plane' && f.type !== 'construction-axis');

  const [targetFeatureId, setTargetFeatureId] = useState(solidFeatures[0]?.id ?? '');
  const [preset, setPreset] = useState<Preset>('Aluminum');
  const [density, setDensity] = useState(PRESET_TABLE['Aluminum'].density);
  const [youngModulus, setYoungModulus] = useState(PRESET_TABLE['Aluminum'].youngModulus);
  const [yieldStrength, setYieldStrength] = useState(PRESET_TABLE['Aluminum'].yieldStrength);

  const handlePresetChange = (p: Preset) => {
    setPreset(p);
    if (p !== 'Custom') {
      const d = PRESET_TABLE[p];
      setDensity(d.density);
      setYoungModulus(d.youngModulus);
      setYieldStrength(d.yieldStrength);
    }
  };

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Material: ${preset}`,
      type: 'import',
      params: { isPhysicalMaterial: true, targetFeatureId, preset, density, youngModulus, yieldStrength },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Applied ${preset} material`);
    onClose();
  };

  return (
    <DialogShell title="Physical Material" onClose={onClose} size="sm" onConfirm={handleApply}>
      <div className="form-group">
        <label>Target Body</label>
        <select value={targetFeatureId} onChange={(e) => setTargetFeatureId(e.target.value)}>
          {solidFeatures.length === 0
            ? <option value="">— no bodies —</option>
            : solidFeatures.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)
          }
        </select>
      </div>
      <div className="form-group">
        <label>Material Preset</label>
        <select value={preset} onChange={(e) => handlePresetChange(e.target.value as Preset)}>
          {(Object.keys(PRESET_TABLE) as Preset[]).map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Density (kg/m³)</label>
        <input
          type="number"
          value={density}
          onChange={(e) => { setPreset('Custom'); setDensity(parseFloat(e.target.value) || 0); }}
          step={1}
          min={0}
        />
      </div>
      <div className="form-group">
        <label>Young's Modulus (GPa)</label>
        <input
          type="number"
          value={youngModulus}
          onChange={(e) => { setPreset('Custom'); setYoungModulus(parseFloat(e.target.value) || 0); }}
          step={0.1}
          min={0}
        />
      </div>
      <div className="form-group">
        <label>Yield Strength (MPa)</label>
        <input
          type="number"
          value={yieldStrength}
          onChange={(e) => { setPreset('Custom'); setYieldStrength(parseFloat(e.target.value) || 0); }}
          step={1}
          min={0}
        />
      </div>
    </DialogShell>
  );
}
