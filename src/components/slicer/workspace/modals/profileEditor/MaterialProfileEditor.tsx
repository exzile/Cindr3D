import type { ReactNode } from 'react';
import type { MaterialProfile } from '../../../../../types/slicer';
import { colors } from '../../../../../utils/theme';
import { fieldRow, inputStyle, labelStyle, lockedInputProps, LOCK_TITLE, MachineLockBadge, SectionBody, selectStyle, TabBar } from './shared';

function renderFieldLabel(children: ReactNode, isLocked: boolean): ReactNode {
  return <div style={labelStyle}>{children}{isLocked && <MachineLockBadge />}</div>;
}

export function MaterialProfileEditor({
  activeTab,
  setActiveTab,
  material,
  updateMaterialProfile,
}: {
  activeTab: number;
  setActiveTab: (tab: number) => void;
  material: MaterialProfile;
  updateMaterialProfile: (id: string, updates: Partial<MaterialProfile>) => void;
}) {
  const tabs = ['General', 'Temperature', 'Retraction', 'Flow & Cost'];
  const machineFields = new Set(material.machineSourcedFields ?? []);
  const locked = (field: string) => machineFields.has(field);

  return (
    <>
      <TabBar tabs={tabs} activeTab={activeTab} setActiveTab={setActiveTab} wrap />
      <SectionBody>
        {activeTab === 0 && (
          <>
            <div style={fieldRow}>
              <div style={labelStyle}>Name</div>
              <input style={inputStyle} value={material.name} onChange={(e) => updateMaterialProfile(material.id, { name: e.target.value })} />
            </div>
            <div style={fieldRow}>
              <div style={labelStyle}>Material Type</div>
              <select style={selectStyle} value={material.type} onChange={(e) => updateMaterialProfile(material.id, { type: e.target.value as MaterialProfile['type'] })}>
                {['PLA', 'ABS', 'PETG', 'TPU', 'Nylon', 'ASA', 'PC', 'PVA', 'HIPS', 'Custom'].map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div style={fieldRow}>
              <div style={labelStyle}>Color</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" value={material.color} onChange={(e) => updateMaterialProfile(material.id, { color: e.target.value })}
                  style={{ width: 32, height: 32, border: 'none', cursor: 'pointer', background: 'transparent' }} />
                <input style={{ ...inputStyle, width: 90 }} value={material.color} onChange={(e) => updateMaterialProfile(material.id, { color: e.target.value })} />
              </div>
            </div>
          </>
        )}
        {activeTab === 1 && (
          <>
            <div style={fieldRow}><div style={labelStyle}>Nozzle Temp (&deg;C)</div><input type="number" style={inputStyle} value={material.nozzleTemp} onChange={(e) => updateMaterialProfile(material.id, { nozzleTemp: parseInt(e.target.value) || 200 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Nozzle Temp First Layer (&deg;C)</div><input type="number" style={inputStyle} value={material.nozzleTempFirstLayer} onChange={(e) => updateMaterialProfile(material.id, { nozzleTempFirstLayer: parseInt(e.target.value) || 200 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Bed Temp (&deg;C)</div><input type="number" style={inputStyle} value={material.bedTemp} onChange={(e) => updateMaterialProfile(material.id, { bedTemp: parseInt(e.target.value) || 60 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Bed Temp First Layer (&deg;C)</div><input type="number" style={inputStyle} value={material.bedTempFirstLayer} onChange={(e) => updateMaterialProfile(material.id, { bedTempFirstLayer: parseInt(e.target.value) || 60 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Chamber Temp (&deg;C)</div><input type="number" style={inputStyle} value={material.chamberTemp} onChange={(e) => updateMaterialProfile(material.id, { chamberTemp: parseInt(e.target.value) || 0 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Initial Printing Temp (&deg;C) - preheat while bed warms</div><input type="number" style={inputStyle} value={material.initialPrintingTemperature ?? material.nozzleTempFirstLayer} onChange={(e) => updateMaterialProfile(material.id, { initialPrintingTemperature: parseInt(e.target.value) || 0 })} /></div>
            <div style={fieldRow}>
              <div style={labelStyle}>Final Printing Temp (&deg;C) - cooldown at end (0 = off)</div>
              <input type="number" style={inputStyle} value={material.finalPrintingTemperature ?? 0}
                onChange={(e) => updateMaterialProfile(material.id, { finalPrintingTemperature: (parseInt(e.target.value) || 0) > 0 ? parseInt(e.target.value) || 0 : undefined })} />
            </div>
            <div style={fieldRow}><div style={labelStyle}>Fan Speed Min (%)</div><input type="number" style={inputStyle} value={material.fanSpeedMin} min={0} max={100} onChange={(e) => updateMaterialProfile(material.id, { fanSpeedMin: parseInt(e.target.value) || 0 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Fan Speed Max (%)</div><input type="number" style={inputStyle} value={material.fanSpeedMax} min={0} max={100} onChange={(e) => updateMaterialProfile(material.id, { fanSpeedMax: parseInt(e.target.value) || 100 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Disable Fan First N Layers</div><input type="number" style={inputStyle} value={material.fanDisableFirstLayers} min={0} onChange={(e) => updateMaterialProfile(material.id, { fanDisableFirstLayers: parseInt(e.target.value) || 0 })} /></div>
          </>
        )}
        {activeTab === 2 && (
          <>
            <div style={fieldRow}>{renderFieldLabel('Retraction Distance (mm)', locked('retractionDistance'))}<input type="number" style={inputStyle} value={material.retractionDistance} step={0.1} {...lockedInputProps(locked('retractionDistance'))} onChange={(e) => updateMaterialProfile(material.id, { retractionDistance: parseFloat(e.target.value) || 0.8 })} /></div>
            <div style={fieldRow}>{renderFieldLabel('Retraction Speed (mm/s) - fallback', locked('retractionSpeed'))}<input type="number" style={inputStyle} value={material.retractionSpeed} {...lockedInputProps(locked('retractionSpeed'))} onChange={(e) => updateMaterialProfile(material.id, { retractionSpeed: parseInt(e.target.value) || 45 })} /></div>
            <div style={fieldRow}>{renderFieldLabel('Retract Speed (mm/s)', locked('retractionRetractSpeed'))}<input type="number" style={inputStyle} value={material.retractionRetractSpeed ?? material.retractionSpeed} {...lockedInputProps(locked('retractionRetractSpeed'))} onChange={(e) => updateMaterialProfile(material.id, { retractionRetractSpeed: parseInt(e.target.value) || 45 })} /></div>
            <div style={fieldRow}>{renderFieldLabel('Prime Speed (mm/s)', locked('retractionPrimeSpeed'))}<input type="number" style={inputStyle} value={material.retractionPrimeSpeed ?? material.retractionSpeed} {...lockedInputProps(locked('retractionPrimeSpeed'))} onChange={(e) => updateMaterialProfile(material.id, { retractionPrimeSpeed: parseInt(e.target.value) || 45 })} /></div>
            <div style={fieldRow}>{renderFieldLabel('Retraction Z Hop (mm)', locked('retractionZHop'))}<input type="number" style={inputStyle} value={material.retractionZHop} step={0.05} {...lockedInputProps(locked('retractionZHop'))} onChange={(e) => updateMaterialProfile(material.id, { retractionZHop: parseFloat(e.target.value) || 0 })} /></div>
            <div style={{ borderTop: `1px solid ${colors.panelBorder}`, margin: '8px 0' }} />
            <div style={{ color: colors.textDim, fontSize: 11, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Linear / Pressure Advance{machineFields.has('linearAdvanceEnabled') && <MachineLockBadge title="Pressure advance value read from machine (M572) - edit on the Duet and resync." />}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: locked('linearAdvanceEnabled') ? 'not-allowed' : 'pointer', opacity: locked('linearAdvanceEnabled') ? 0.55 : 1 }} title={locked('linearAdvanceEnabled') ? LOCK_TITLE : undefined}>
              <input type="checkbox" checked={material.linearAdvanceEnabled ?? false} disabled={locked('linearAdvanceEnabled')}
                onChange={(e) => { if (!locked('linearAdvanceEnabled')) updateMaterialProfile(material.id, { linearAdvanceEnabled: e.target.checked }); }}
                style={{ accentColor: colors.accent }} />
              Enable Linear Advance (M900 / M572)
            </label>
            {(material.linearAdvanceEnabled ?? false) && (
              <div style={fieldRow}>
                {renderFieldLabel('K Factor', locked('linearAdvanceFactor'))}
                <input type="number" style={inputStyle} value={material.linearAdvanceFactor ?? 0} step={0.01} min={0} max={2} {...lockedInputProps(locked('linearAdvanceFactor'))}
                  onChange={(e) => updateMaterialProfile(material.id, { linearAdvanceFactor: parseFloat(e.target.value) || 0 })} />
              </div>
            )}
          </>
        )}
        {activeTab === 3 && (
          <>
            <div style={fieldRow}><div style={labelStyle}>Flow Rate (multiplier)</div><input type="number" style={inputStyle} value={material.flowRate} step={0.01} min={0.5} max={2.0} onChange={(e) => updateMaterialProfile(material.id, { flowRate: parseFloat(e.target.value) || 1.0 })} /></div>
            <div style={{ borderTop: `1px solid ${colors.panelBorder}`, margin: '8px 0' }} />
            <div style={{ color: colors.textDim, fontSize: 11, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Shrinkage Compensation</div>
            <div style={fieldRow}><div style={labelStyle}>XY Compensation (%)</div><input type="number" style={inputStyle} value={material.shrinkageCompensationXY ?? 0} step={0.05} min={-5} max={5} onChange={(e) => updateMaterialProfile(material.id, { shrinkageCompensationXY: parseFloat(e.target.value) || 0 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Z Compensation (%)</div><input type="number" style={inputStyle} value={material.shrinkageCompensationZ ?? 0} step={0.05} min={-5} max={5} onChange={(e) => updateMaterialProfile(material.id, { shrinkageCompensationZ: parseFloat(e.target.value) || 0 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Density (g/cm&sup3;)</div><input type="number" style={inputStyle} value={material.density} step={0.01} onChange={(e) => updateMaterialProfile(material.id, { density: parseFloat(e.target.value) || 1.24 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Cost per kg ($)</div><input type="number" style={inputStyle} value={material.costPerKg} step={1} onChange={(e) => updateMaterialProfile(material.id, { costPerKg: parseFloat(e.target.value) || 20 })} /></div>
          </>
        )}
      </SectionBody>
    </>
  );
}
