import { useState } from 'react';
import type { CSSProperties } from 'react';
import { X } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import type { PrinterProfile, MaterialProfile, PrintProfile } from '../../../../types/slicer';
import { colors, sharedStyles } from '../../../../utils/theme';

const btnAccent = sharedStyles.btnAccent;
const inputStyle = sharedStyles.input;
const selectStyle = sharedStyles.select;
const labelStyle = sharedStyles.label;

export function SlicerProfileEditorModal({
  type,
  onClose,
}: {
  type: 'printer' | 'material' | 'print';
  onClose: () => void;
}) {
  const getActivePrinterProfile = useSlicerStore((s) => s.getActivePrinterProfile);
  const getActiveMaterialProfile = useSlicerStore((s) => s.getActiveMaterialProfile);
  const getActivePrintProfile = useSlicerStore((s) => s.getActivePrintProfile);
  const updatePrinterProfile = useSlicerStore((s) => s.updatePrinterProfile);
  const updateMaterialProfile = useSlicerStore((s) => s.updateMaterialProfile);
  const updatePrintProfile = useSlicerStore((s) => s.updatePrintProfile);

  const printer = getActivePrinterProfile();
  const material = getActiveMaterialProfile();
  const print = getActivePrintProfile();

  const [activeTab, setActiveTab] = useState(0);

  const tabStyle = (active: boolean): CSSProperties => ({
    padding: '8px 16px',
    background: active ? colors.panelLight : 'transparent',
    color: active ? colors.text : colors.textDim,
    border: 'none',
    borderBottom: active ? `2px solid ${colors.accent}` : '2px solid transparent',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
  });

  const fieldRow: CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10,
  };

  const renderPrinterEditor = () => {
    if (!printer) return null;
    const tabs = ['General', 'Limits', 'G-code'];
    return (
      <>
        <div style={{ display: 'flex', borderBottom: `1px solid ${colors.panelBorder}` }}>
          {tabs.map((t, i) => <button key={t} style={tabStyle(activeTab === i)} onClick={() => setActiveTab(i)}>{t}</button>)}
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {activeTab === 0 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Name</div>
                <input style={inputStyle} value={printer.name} onChange={(e) => updatePrinterProfile(printer.id, { name: e.target.value })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Build Volume X (mm)</div>
                <input type="number" style={inputStyle} value={printer.buildVolume.x}
                  onChange={(e) => updatePrinterProfile(printer.id, { buildVolume: { ...printer.buildVolume, x: parseFloat(e.target.value) || 0 } })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Build Volume Y (mm)</div>
                <input type="number" style={inputStyle} value={printer.buildVolume.y}
                  onChange={(e) => updatePrinterProfile(printer.id, { buildVolume: { ...printer.buildVolume, y: parseFloat(e.target.value) || 0 } })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Build Volume Z (mm)</div>
                <input type="number" style={inputStyle} value={printer.buildVolume.z}
                  onChange={(e) => updatePrinterProfile(printer.id, { buildVolume: { ...printer.buildVolume, z: parseFloat(e.target.value) || 0 } })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Nozzle Diameter (mm)</div>
                <input type="number" style={inputStyle} value={printer.nozzleDiameter} step={0.1}
                  onChange={(e) => updatePrinterProfile(printer.id, { nozzleDiameter: parseFloat(e.target.value) || 0.4 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Nozzle Count</div>
                <input type="number" style={inputStyle} value={printer.nozzleCount} min={1}
                  onChange={(e) => updatePrinterProfile(printer.id, { nozzleCount: parseInt(e.target.value) || 1 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Filament Diameter (mm)</div>
                <select style={selectStyle} value={printer.filamentDiameter}
                  onChange={(e) => updatePrinterProfile(printer.id, { filamentDiameter: parseFloat(e.target.value) })}>
                  <option value={1.75}>1.75</option>
                  <option value={2.85}>2.85</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={printer.hasHeatedBed}
                  onChange={(e) => updatePrinterProfile(printer.id, { hasHeatedBed: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Heated Bed
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={printer.hasHeatedChamber}
                  onChange={(e) => updatePrinterProfile(printer.id, { hasHeatedChamber: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Heated Chamber
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={printer.originCenter}
                  onChange={(e) => updatePrinterProfile(printer.id, { originCenter: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Origin Center
              </label>
              <div style={fieldRow}>
                <div style={labelStyle}>G-code Flavor</div>
                <select style={selectStyle} value={printer.gcodeFlavorType}
                  onChange={(e) => updatePrinterProfile(printer.id, { gcodeFlavorType: e.target.value as PrinterProfile['gcodeFlavorType'] })}>
                  <option value="reprap">RepRap</option>
                  <option value="marlin">Marlin</option>
                  <option value="klipper">Klipper</option>
                  <option value="duet">Duet</option>
                </select>
              </div>
            </>
          )}
          {activeTab === 1 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Max Nozzle Temp (&deg;C)</div>
                <input type="number" style={inputStyle} value={printer.maxNozzleTemp}
                  onChange={(e) => updatePrinterProfile(printer.id, { maxNozzleTemp: parseInt(e.target.value) || 260 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Max Bed Temp (&deg;C)</div>
                <input type="number" style={inputStyle} value={printer.maxBedTemp}
                  onChange={(e) => updatePrinterProfile(printer.id, { maxBedTemp: parseInt(e.target.value) || 110 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Max Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={printer.maxSpeed}
                  onChange={(e) => updatePrinterProfile(printer.id, { maxSpeed: parseInt(e.target.value) || 200 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Max Acceleration (mm/s&sup2;)</div>
                <input type="number" style={inputStyle} value={printer.maxAcceleration}
                  onChange={(e) => updatePrinterProfile(printer.id, { maxAcceleration: parseInt(e.target.value) || 2000 })} />
              </div>
            </>
          )}
          {activeTab === 2 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Start G-code</div>
                <textarea
                  style={{ ...inputStyle, height: 180, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
                  value={printer.startGCode}
                  onChange={(e) => updatePrinterProfile(printer.id, { startGCode: e.target.value })}
                />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>End G-code</div>
                <textarea
                  style={{ ...inputStyle, height: 180, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
                  value={printer.endGCode}
                  onChange={(e) => updatePrinterProfile(printer.id, { endGCode: e.target.value })}
                />
              </div>
            </>
          )}
        </div>
      </>
    );
  };

  const renderMaterialEditor = () => {
    if (!material) return null;
    const tabs = ['General', 'Temperature', 'Retraction', 'Flow & Cost'];
    return (
      <>
        <div style={{ display: 'flex', borderBottom: `1px solid ${colors.panelBorder}`, flexWrap: 'wrap' }}>
          {tabs.map((t, i) => <button key={t} style={tabStyle(activeTab === i)} onClick={() => setActiveTab(i)}>{t}</button>)}
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {activeTab === 0 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Name</div>
                <input style={inputStyle} value={material.name} onChange={(e) => updateMaterialProfile(material.id, { name: e.target.value })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Material Type</div>
                <select style={selectStyle} value={material.type}
                  onChange={(e) => updateMaterialProfile(material.id, { type: e.target.value as MaterialProfile['type'] })}>
                  {['PLA','ABS','PETG','TPU','Nylon','ASA','PC','PVA','HIPS','Custom'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Color</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={material.color}
                    onChange={(e) => updateMaterialProfile(material.id, { color: e.target.value })}
                    style={{ width: 32, height: 32, border: 'none', cursor: 'pointer', background: 'transparent' }} />
                  <input style={{ ...inputStyle, width: 90 }} value={material.color}
                    onChange={(e) => updateMaterialProfile(material.id, { color: e.target.value })} />
                </div>
              </div>
            </>
          )}
          {activeTab === 1 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Nozzle Temp (&deg;C)</div>
                <input type="number" style={inputStyle} value={material.nozzleTemp}
                  onChange={(e) => updateMaterialProfile(material.id, { nozzleTemp: parseInt(e.target.value) || 200 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Nozzle Temp First Layer (&deg;C)</div>
                <input type="number" style={inputStyle} value={material.nozzleTempFirstLayer}
                  onChange={(e) => updateMaterialProfile(material.id, { nozzleTempFirstLayer: parseInt(e.target.value) || 200 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Bed Temp (&deg;C)</div>
                <input type="number" style={inputStyle} value={material.bedTemp}
                  onChange={(e) => updateMaterialProfile(material.id, { bedTemp: parseInt(e.target.value) || 60 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Bed Temp First Layer (&deg;C)</div>
                <input type="number" style={inputStyle} value={material.bedTempFirstLayer}
                  onChange={(e) => updateMaterialProfile(material.id, { bedTempFirstLayer: parseInt(e.target.value) || 60 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Chamber Temp (&deg;C)</div>
                <input type="number" style={inputStyle} value={material.chamberTemp}
                  onChange={(e) => updateMaterialProfile(material.id, { chamberTemp: parseInt(e.target.value) || 0 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Fan Speed Min (%)</div>
                <input type="number" style={inputStyle} value={material.fanSpeedMin} min={0} max={100}
                  onChange={(e) => updateMaterialProfile(material.id, { fanSpeedMin: parseInt(e.target.value) || 0 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Fan Speed Max (%)</div>
                <input type="number" style={inputStyle} value={material.fanSpeedMax} min={0} max={100}
                  onChange={(e) => updateMaterialProfile(material.id, { fanSpeedMax: parseInt(e.target.value) || 100 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Disable Fan First N Layers</div>
                <input type="number" style={inputStyle} value={material.fanDisableFirstLayers} min={0}
                  onChange={(e) => updateMaterialProfile(material.id, { fanDisableFirstLayers: parseInt(e.target.value) || 0 })} />
              </div>
            </>
          )}
          {activeTab === 2 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Retraction Distance (mm)</div>
                <input type="number" style={inputStyle} value={material.retractionDistance} step={0.1}
                  onChange={(e) => updateMaterialProfile(material.id, { retractionDistance: parseFloat(e.target.value) || 0.8 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Retraction Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={material.retractionSpeed}
                  onChange={(e) => updateMaterialProfile(material.id, { retractionSpeed: parseInt(e.target.value) || 45 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Retraction Z Hop (mm)</div>
                <input type="number" style={inputStyle} value={material.retractionZHop} step={0.05}
                  onChange={(e) => updateMaterialProfile(material.id, { retractionZHop: parseFloat(e.target.value) || 0 })} />
              </div>
            </>
          )}
          {activeTab === 3 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Flow Rate (multiplier)</div>
                <input type="number" style={inputStyle} value={material.flowRate} step={0.01} min={0.5} max={2.0}
                  onChange={(e) => updateMaterialProfile(material.id, { flowRate: parseFloat(e.target.value) || 1.0 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Density (g/cm&sup3;)</div>
                <input type="number" style={inputStyle} value={material.density} step={0.01}
                  onChange={(e) => updateMaterialProfile(material.id, { density: parseFloat(e.target.value) || 1.24 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Cost per kg ($)</div>
                <input type="number" style={inputStyle} value={material.costPerKg} step={1}
                  onChange={(e) => updateMaterialProfile(material.id, { costPerKg: parseFloat(e.target.value) || 20 })} />
              </div>
            </>
          )}
        </div>
      </>
    );
  };

  const renderPrintEditor = () => {
    if (!print) return null;
    const tabs = ['Layers', 'Walls', 'Infill', 'Speed', 'Support', 'Adhesion', 'Advanced'];
    return (
      <>
        <div style={{ display: 'flex', borderBottom: `1px solid ${colors.panelBorder}`, flexWrap: 'wrap' }}>
          {tabs.map((t, i) => <button key={t} style={tabStyle(activeTab === i)} onClick={() => setActiveTab(i)}>{t}</button>)}
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {activeTab === 0 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Name</div>
                <input style={inputStyle} value={print.name} onChange={(e) => updatePrintProfile(print.id, { name: e.target.value })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Layer Height (mm)</div>
                <input type="number" style={inputStyle} value={print.layerHeight} step={0.05}
                  onChange={(e) => updatePrintProfile(print.id, { layerHeight: parseFloat(e.target.value) || 0.2 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>First Layer Height (mm)</div>
                <input type="number" style={inputStyle} value={print.firstLayerHeight} step={0.05}
                  onChange={(e) => updatePrintProfile(print.id, { firstLayerHeight: parseFloat(e.target.value) || 0.3 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Top Layers</div>
                <input type="number" style={inputStyle} value={print.topLayers} min={0}
                  onChange={(e) => updatePrintProfile(print.id, { topLayers: parseInt(e.target.value) || 4 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Bottom Layers</div>
                <input type="number" style={inputStyle} value={print.bottomLayers} min={0}
                  onChange={(e) => updatePrintProfile(print.id, { bottomLayers: parseInt(e.target.value) || 4 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Top/Bottom Pattern</div>
                <select style={selectStyle} value={print.topBottomPattern}
                  onChange={(e) => updatePrintProfile(print.id, { topBottomPattern: e.target.value as PrintProfile['topBottomPattern'] })}>
                  <option value="lines">Lines</option>
                  <option value="concentric">Concentric</option>
                  <option value="zigzag">Zigzag</option>
                </select>
              </div>
            </>
          )}
          {activeTab === 1 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Wall Count</div>
                <input type="number" style={inputStyle} value={print.wallCount} min={1}
                  onChange={(e) => updatePrintProfile(print.id, { wallCount: parseInt(e.target.value) || 3 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Wall Line Width (mm)</div>
                <input type="number" style={inputStyle} value={print.wallLineWidth} step={0.01}
                  onChange={(e) => updatePrintProfile(print.id, { wallLineWidth: parseFloat(e.target.value) || 0.45 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Wall Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.wallSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { wallSpeed: parseInt(e.target.value) || 45 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Outer Wall Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.outerWallSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { outerWallSpeed: parseInt(e.target.value) || 30 })} />
              </div>
            </>
          )}
          {activeTab === 2 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Infill Density (%)</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="range" min={0} max={100} value={print.infillDensity}
                    onChange={(e) => updatePrintProfile(print.id, { infillDensity: parseInt(e.target.value) })}
                    style={{ flex: 1, accentColor: colors.accent }} />
                  <input type="number" style={{ ...inputStyle, width: 50 }} value={print.infillDensity} min={0} max={100}
                    onChange={(e) => updatePrintProfile(print.id, { infillDensity: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Infill Pattern</div>
                <select style={selectStyle} value={print.infillPattern}
                  onChange={(e) => updatePrintProfile(print.id, { infillPattern: e.target.value as PrintProfile['infillPattern'] })}>
                  {['grid','lines','triangles','cubic','gyroid','honeycomb','lightning','concentric'].map((p) => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Infill Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.infillSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { infillSpeed: parseInt(e.target.value) || 60 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Infill Line Width (mm)</div>
                <input type="number" style={inputStyle} value={print.infillLineWidth} step={0.01}
                  onChange={(e) => updatePrintProfile(print.id, { infillLineWidth: parseFloat(e.target.value) || 0.45 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Infill Overlap (%)</div>
                <input type="number" style={inputStyle} value={print.infillOverlap} min={0} max={50}
                  onChange={(e) => updatePrintProfile(print.id, { infillOverlap: parseInt(e.target.value) || 10 })} />
              </div>
            </>
          )}
          {activeTab === 3 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Print Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.printSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { printSpeed: parseInt(e.target.value) || 50 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Travel Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.travelSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { travelSpeed: parseInt(e.target.value) || 150 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>First Layer Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.firstLayerSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { firstLayerSpeed: parseInt(e.target.value) || 25 })} />
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Top Speed (mm/s)</div>
                <input type="number" style={inputStyle} value={print.topSpeed}
                  onChange={(e) => updatePrintProfile(print.id, { topSpeed: parseInt(e.target.value) || 40 })} />
              </div>
            </>
          )}
          {activeTab === 4 && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={print.supportEnabled}
                  onChange={(e) => updatePrintProfile(print.id, { supportEnabled: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Enable Support
              </label>
              {print.supportEnabled && (
                <>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Support Type</div>
                    <select style={selectStyle} value={print.supportType}
                      onChange={(e) => updatePrintProfile(print.id, { supportType: e.target.value as PrintProfile['supportType'] })}>
                      <option value="normal">Normal</option>
                      <option value="tree">Tree</option>
                      <option value="organic">Organic</option>
                    </select>
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Overhang Angle (&deg;)</div>
                    <input type="number" style={inputStyle} value={print.supportAngle} min={0} max={90}
                      onChange={(e) => updatePrintProfile(print.id, { supportAngle: parseInt(e.target.value) || 50 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Support Density (%)</div>
                    <input type="number" style={inputStyle} value={print.supportDensity} min={0} max={100}
                      onChange={(e) => updatePrintProfile(print.id, { supportDensity: parseInt(e.target.value) || 15 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Support Pattern</div>
                    <select style={selectStyle} value={print.supportPattern}
                      onChange={(e) => updatePrintProfile(print.id, { supportPattern: e.target.value as PrintProfile['supportPattern'] })}>
                      <option value="lines">Lines</option>
                      <option value="grid">Grid</option>
                      <option value="zigzag">Zigzag</option>
                    </select>
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Support Z Distance (mm)</div>
                    <input type="number" style={inputStyle} value={print.supportZDistance} step={0.05}
                      onChange={(e) => updatePrintProfile(print.id, { supportZDistance: parseFloat(e.target.value) || 0.2 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Support XY Distance (mm)</div>
                    <input type="number" style={inputStyle} value={print.supportXYDistance} step={0.1}
                      onChange={(e) => updatePrintProfile(print.id, { supportXYDistance: parseFloat(e.target.value) || 0.7 })} />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={print.supportInterface}
                      onChange={(e) => updatePrintProfile(print.id, { supportInterface: e.target.checked })}
                      style={{ accentColor: colors.accent }} />
                    Dense Support Interface
                  </label>
                  {print.supportInterface && (
                    <div style={fieldRow}>
                      <div style={labelStyle}>Interface Layers</div>
                      <input type="number" style={inputStyle} value={print.supportInterfaceLayers} min={0}
                        onChange={(e) => updatePrintProfile(print.id, { supportInterfaceLayers: parseInt(e.target.value) || 2 })} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {activeTab === 5 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Adhesion Type</div>
                <select style={selectStyle} value={print.adhesionType}
                  onChange={(e) => updatePrintProfile(print.id, { adhesionType: e.target.value as PrintProfile['adhesionType'] })}>
                  <option value="none">None</option>
                  <option value="skirt">Skirt</option>
                  <option value="brim">Brim</option>
                  <option value="raft">Raft</option>
                </select>
              </div>
              {(print.adhesionType === 'skirt' || print.adhesionType === 'none') && (
                <>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Skirt Lines</div>
                    <input type="number" style={inputStyle} value={print.skirtLines} min={0}
                      onChange={(e) => updatePrintProfile(print.id, { skirtLines: parseInt(e.target.value) || 3 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Skirt Distance (mm)</div>
                    <input type="number" style={inputStyle} value={print.skirtDistance}
                      onChange={(e) => updatePrintProfile(print.id, { skirtDistance: parseFloat(e.target.value) || 5 })} />
                  </div>
                </>
              )}
              {print.adhesionType === 'brim' && (
                <div style={fieldRow}>
                  <div style={labelStyle}>Brim Width (mm)</div>
                  <input type="number" style={inputStyle} value={print.brimWidth}
                    onChange={(e) => updatePrintProfile(print.id, { brimWidth: parseFloat(e.target.value) || 8 })} />
                </div>
              )}
              {print.adhesionType === 'raft' && (
                <div style={fieldRow}>
                  <div style={labelStyle}>Raft Layers</div>
                  <input type="number" style={inputStyle} value={print.raftLayers} min={1}
                    onChange={(e) => updatePrintProfile(print.id, { raftLayers: parseInt(e.target.value) || 3 })} />
                </div>
              )}
            </>
          )}
          {activeTab === 6 && (
            <>
              <div style={fieldRow}>
                <div style={labelStyle}>Z Seam Alignment</div>
                <select style={selectStyle} value={print.zSeamAlignment}
                  onChange={(e) => updatePrintProfile(print.id, { zSeamAlignment: e.target.value as PrintProfile['zSeamAlignment'] })}>
                  <option value="random">Random</option>
                  <option value="aligned">Aligned</option>
                  <option value="sharpest_corner">Sharpest Corner</option>
                  <option value="shortest">Shortest</option>
                </select>
              </div>
              <div style={fieldRow}>
                <div style={labelStyle}>Combing Mode</div>
                <select style={selectStyle} value={print.combingMode}
                  onChange={(e) => updatePrintProfile(print.id, { combingMode: e.target.value as PrintProfile['combingMode'] })}>
                  <option value="off">Off</option>
                  <option value="all">All</option>
                  <option value="noskin">No Skin</option>
                  <option value="infill">Infill Only</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={print.avoidCrossingPerimeters}
                  onChange={(e) => updatePrintProfile(print.id, { avoidCrossingPerimeters: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Avoid Crossing Perimeters
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={print.thinWallDetection}
                  onChange={(e) => updatePrintProfile(print.id, { thinWallDetection: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Thin Wall Detection
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={print.enableBridgeFan}
                  onChange={(e) => updatePrintProfile(print.id, { enableBridgeFan: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Enable Bridge Fan
              </label>
              {print.enableBridgeFan && (
                <div style={fieldRow}>
                  <div style={labelStyle}>Bridge Fan Speed (%)</div>
                  <input type="number" style={inputStyle} value={print.bridgeFanSpeed} min={0} max={100}
                    onChange={(e) => updatePrintProfile(print.id, { bridgeFanSpeed: parseInt(e.target.value) || 100 })} />
                </div>
              )}
              <div style={fieldRow}>
                <div style={labelStyle}>Min Layer Time (s)</div>
                <input type="number" style={inputStyle} value={print.minLayerTime} min={0}
                  onChange={(e) => updatePrintProfile(print.id, { minLayerTime: parseInt(e.target.value) || 10 })} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={print.ironingEnabled}
                  onChange={(e) => updatePrintProfile(print.id, { ironingEnabled: e.target.checked })}
                  style={{ accentColor: colors.accent }} />
                Enable Ironing
              </label>
              {print.ironingEnabled && (
                <>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Ironing Speed (mm/s)</div>
                    <input type="number" style={inputStyle} value={print.ironingSpeed}
                      onChange={(e) => updatePrintProfile(print.id, { ironingSpeed: parseInt(e.target.value) || 15 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Ironing Flow (%)</div>
                    <input type="number" style={inputStyle} value={print.ironingFlow}
                      onChange={(e) => updatePrintProfile(print.id, { ironingFlow: parseInt(e.target.value) || 10 })} />
                  </div>
                  <div style={fieldRow}>
                    <div style={labelStyle}>Ironing Spacing (mm)</div>
                    <input type="number" style={inputStyle} value={print.ironingSpacing} step={0.01}
                      onChange={(e) => updatePrintProfile(print.id, { ironingSpacing: parseFloat(e.target.value) || 0.1 })} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </>
    );
  };

  const titles = { printer: 'Printer Profile Editor', material: 'Material Profile Editor', print: 'Print Profile Editor' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
    }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.panel,
          border: `1px solid ${colors.panelBorder}`,
          borderRadius: 8,
          width: 560,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: `1px solid ${colors.panelBorder}`,
        }}>
          <span style={{ color: colors.text, fontSize: 14, fontWeight: 600 }}>{titles[type]}</span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        {type === 'printer' && renderPrinterEditor()}
        {type === 'material' && renderMaterialEditor()}
        {type === 'print' && renderPrintEditor()}

        <div style={{
          padding: '10px 16px', borderTop: `1px solid ${colors.panelBorder}`,
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button style={btnAccent} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
