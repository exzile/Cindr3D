import type { PrintProfile } from '../../../../../types/slicer';
import type { LayerProcessor } from '../../../../../types/slicer/profiles/print';
import { colors } from '../../../../../utils/theme';
import { fieldRow, inputStyle, labelStyle, SectionBody, selectStyle, TabBar } from './shared';
import { PostProcessorsTab } from './PostProcessorsTab';

export function PrintProfileEditor({
  activeTab,
  setActiveTab,
  print,
  updatePrintProfile,
}: {
  activeTab: number;
  setActiveTab: (tab: number) => void;
  print: PrintProfile;
  updatePrintProfile: (id: string, updates: Partial<PrintProfile>) => void;
}) {
  const tabs = ['Layers', 'Walls', 'Infill', 'Speed', 'Support', 'Adhesion', 'Advanced', 'Scripts'];

  return (
    <>
      <TabBar tabs={tabs} activeTab={activeTab} setActiveTab={setActiveTab} wrap />
      <SectionBody>
        {activeTab === 0 && (
          <>
            <div style={fieldRow}><div style={labelStyle}>Name</div><input style={inputStyle} value={print.name} onChange={(e) => updatePrintProfile(print.id, { name: e.target.value })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Layer Height (mm)</div><input type="number" style={inputStyle} value={print.layerHeight} step={0.05} onChange={(e) => updatePrintProfile(print.id, { layerHeight: parseFloat(e.target.value) || 0.2 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>First Layer Height (mm)</div><input type="number" style={inputStyle} value={print.firstLayerHeight} step={0.05} onChange={(e) => updatePrintProfile(print.id, { firstLayerHeight: parseFloat(e.target.value) || 0.3 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Top Layers</div><input type="number" style={inputStyle} value={print.topLayers} min={0} onChange={(e) => updatePrintProfile(print.id, { topLayers: parseInt(e.target.value) || 4 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Bottom Layers</div><input type="number" style={inputStyle} value={print.bottomLayers} min={0} onChange={(e) => updatePrintProfile(print.id, { bottomLayers: parseInt(e.target.value) || 4 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Top/Bottom Pattern</div><select style={selectStyle} value={print.topBottomPattern} onChange={(e) => updatePrintProfile(print.id, { topBottomPattern: e.target.value as PrintProfile['topBottomPattern'] })}><option value="lines">Lines</option><option value="concentric">Concentric</option><option value="zigzag">Zigzag</option></select></div>
          </>
        )}
        {activeTab === 1 && (
          <>
            <div style={fieldRow}><div style={labelStyle}>Wall Count</div><input type="number" style={inputStyle} value={print.wallCount} min={1} onChange={(e) => updatePrintProfile(print.id, { wallCount: parseInt(e.target.value) || 3 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Wall Generator</div><select style={selectStyle} value={print.wallGenerator ?? 'classic'} onChange={(e) => updatePrintProfile(print.id, { wallGenerator: e.target.value as PrintProfile['wallGenerator'] })}><option value="classic">Classic</option><option value="arachne">Arachne</option></select></div>
            {(print.wallGenerator ?? 'classic') === 'arachne' && <div style={fieldRow}><div style={labelStyle}>Arachne Backend</div><select style={selectStyle} value={print.arachneBackend ?? 'js'} onChange={(e) => updatePrintProfile(print.id, { arachneBackend: e.target.value as PrintProfile['arachneBackend'] })}><option value="js">JavaScript</option><option value="wasm">WASM</option></select></div>}
            <div style={fieldRow}><div style={labelStyle}>Wall Line Width (mm)</div><input type="number" style={inputStyle} value={print.wallLineWidth} step={0.01} onChange={(e) => updatePrintProfile(print.id, { wallLineWidth: parseFloat(e.target.value) || 0.45 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Wall Speed (mm/s)</div><input type="number" style={inputStyle} value={print.wallSpeed} onChange={(e) => updatePrintProfile(print.id, { wallSpeed: parseInt(e.target.value) || 45 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Outer Wall Speed (mm/s)</div><input type="number" style={inputStyle} value={print.outerWallSpeed} onChange={(e) => updatePrintProfile(print.id, { outerWallSpeed: parseInt(e.target.value) || 30 })} /></div>
          </>
        )}
        {activeTab === 2 && (
          <>
            <div style={fieldRow}>
              <div style={labelStyle}>Infill Density (%)</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="range" min={0} max={100} value={print.infillDensity} onChange={(e) => updatePrintProfile(print.id, { infillDensity: parseInt(e.target.value) })} style={{ flex: 1, accentColor: colors.accent }} />
                <input type="number" style={{ ...inputStyle, width: 50 }} value={print.infillDensity} min={0} max={100} onChange={(e) => updatePrintProfile(print.id, { infillDensity: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
            <div style={fieldRow}><div style={labelStyle}>Infill Pattern</div><select style={selectStyle} value={print.infillPattern} onChange={(e) => updatePrintProfile(print.id, { infillPattern: e.target.value as PrintProfile['infillPattern'] })}>{['grid', 'lines', 'triangles', 'cubic', 'gyroid', 'honeycomb', 'lightning', 'concentric'].map((pattern) => <option key={pattern} value={pattern}>{pattern.charAt(0).toUpperCase() + pattern.slice(1)}</option>)}</select></div>
            <div style={fieldRow}><div style={labelStyle}>Infill Speed (mm/s)</div><input type="number" style={inputStyle} value={print.infillSpeed} onChange={(e) => updatePrintProfile(print.id, { infillSpeed: parseInt(e.target.value) || 60 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Infill Line Width (mm)</div><input type="number" style={inputStyle} value={print.infillLineWidth} step={0.01} onChange={(e) => updatePrintProfile(print.id, { infillLineWidth: parseFloat(e.target.value) || 0.45 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Infill Overlap (%)</div><input type="number" style={inputStyle} value={print.infillOverlap} min={0} max={50} onChange={(e) => updatePrintProfile(print.id, { infillOverlap: parseInt(e.target.value) || 10 })} /></div>
          </>
        )}
        {activeTab === 3 && (
          <>
            <div style={fieldRow}><div style={labelStyle}>Print Speed (mm/s)</div><input type="number" style={inputStyle} value={print.printSpeed} onChange={(e) => updatePrintProfile(print.id, { printSpeed: parseInt(e.target.value) || 50 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Travel Speed (mm/s)</div><input type="number" style={inputStyle} value={print.travelSpeed} onChange={(e) => updatePrintProfile(print.id, { travelSpeed: parseInt(e.target.value) || 150 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>First Layer Speed (mm/s)</div><input type="number" style={inputStyle} value={print.firstLayerSpeed} onChange={(e) => updatePrintProfile(print.id, { firstLayerSpeed: parseInt(e.target.value) || 25 })} /></div>
            <div style={fieldRow}><div style={labelStyle}>Top Speed (mm/s)</div><input type="number" style={inputStyle} value={print.topSpeed} onChange={(e) => updatePrintProfile(print.id, { topSpeed: parseInt(e.target.value) || 40 })} /></div>
          </>
        )}
        {activeTab === 4 && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={print.supportEnabled} onChange={(e) => updatePrintProfile(print.id, { supportEnabled: e.target.checked })} style={{ accentColor: colors.accent }} />
              Enable Support
            </label>
            {print.supportEnabled && (
              <>
                <div style={fieldRow}><div style={labelStyle}>Support Type</div><select style={selectStyle} value={print.supportType} onChange={(e) => updatePrintProfile(print.id, { supportType: e.target.value as PrintProfile['supportType'] })}><option value="normal">Normal</option><option value="tree">Tree</option><option value="organic">Organic</option></select></div>
                <div style={fieldRow}><div style={labelStyle}>Overhang Angle (&deg;)</div><input type="number" style={inputStyle} value={print.supportAngle} min={0} max={90} onChange={(e) => updatePrintProfile(print.id, { supportAngle: parseInt(e.target.value) || 50 })} /></div>
                <div style={fieldRow}><div style={labelStyle}>Support Density (%)</div><input type="number" style={inputStyle} value={print.supportDensity} min={0} max={100} onChange={(e) => updatePrintProfile(print.id, { supportDensity: parseInt(e.target.value) || 15 })} /></div>
                <div style={fieldRow}><div style={labelStyle}>Support Pattern</div><select style={selectStyle} value={print.supportPattern} onChange={(e) => updatePrintProfile(print.id, { supportPattern: e.target.value as PrintProfile['supportPattern'] })}><option value="lines">Lines</option><option value="grid">Grid</option><option value="zigzag">Zigzag</option></select></div>
                <div style={fieldRow}><div style={labelStyle}>Support Z Distance (mm)</div><input type="number" style={inputStyle} value={print.supportZDistance} step={0.05} onChange={(e) => updatePrintProfile(print.id, { supportZDistance: parseFloat(e.target.value) || 0.2 })} /></div>
                <div style={fieldRow}><div style={labelStyle}>Support XY Distance (mm)</div><input type="number" style={inputStyle} value={print.supportXYDistance} step={0.1} onChange={(e) => updatePrintProfile(print.id, { supportXYDistance: parseFloat(e.target.value) || 0.7 })} /></div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={print.supportInterface} onChange={(e) => updatePrintProfile(print.id, { supportInterface: e.target.checked })} style={{ accentColor: colors.accent }} />
                  Dense Support Interface
                </label>
                {print.supportInterface && <div style={fieldRow}><div style={labelStyle}>Interface Layers</div><input type="number" style={inputStyle} value={print.supportInterfaceLayers} min={0} onChange={(e) => updatePrintProfile(print.id, { supportInterfaceLayers: parseInt(e.target.value) || 2 })} /></div>}
              </>
            )}
          </>
        )}
        {activeTab === 5 && (
          <>
            <div style={fieldRow}><div style={labelStyle}>Adhesion Type</div><select style={selectStyle} value={print.adhesionType} onChange={(e) => updatePrintProfile(print.id, { adhesionType: e.target.value as PrintProfile['adhesionType'] })}><option value="none">None</option><option value="skirt">Skirt</option><option value="brim">Brim</option><option value="raft">Raft</option></select></div>
            {(print.adhesionType === 'skirt' || print.adhesionType === 'none') && (<><div style={fieldRow}><div style={labelStyle}>Skirt Lines</div><input type="number" style={inputStyle} value={print.skirtLines} min={0} onChange={(e) => updatePrintProfile(print.id, { skirtLines: parseInt(e.target.value) || 3 })} /></div><div style={fieldRow}><div style={labelStyle}>Skirt Distance (mm)</div><input type="number" style={inputStyle} value={print.skirtDistance} onChange={(e) => updatePrintProfile(print.id, { skirtDistance: parseFloat(e.target.value) || 5 })} /></div></>)}
            {print.adhesionType === 'brim' && <div style={fieldRow}><div style={labelStyle}>Brim Width (mm)</div><input type="number" style={inputStyle} value={print.brimWidth} onChange={(e) => updatePrintProfile(print.id, { brimWidth: parseFloat(e.target.value) || 8 })} /></div>}
            {print.adhesionType === 'raft' && <div style={fieldRow}><div style={labelStyle}>Raft Layers</div><input type="number" style={inputStyle} value={print.raftLayers} min={1} onChange={(e) => updatePrintProfile(print.id, { raftLayers: parseInt(e.target.value) || 3 })} /></div>}
          </>
        )}
        {activeTab === 6 && (
          <>
            <div style={fieldRow}><div style={labelStyle}>Z Seam Alignment</div><select style={selectStyle} value={print.zSeamAlignment} onChange={(e) => updatePrintProfile(print.id, { zSeamAlignment: e.target.value as PrintProfile['zSeamAlignment'] })}><option value="random">Random</option><option value="aligned">Aligned</option><option value="sharpest_corner">Sharpest Corner</option><option value="shortest">Shortest</option></select></div>
            <div style={fieldRow}><div style={labelStyle}>Combing Mode</div><select style={selectStyle} value={print.combingMode} onChange={(e) => updatePrintProfile(print.id, { combingMode: e.target.value as PrintProfile['combingMode'] })}><option value="off">Off</option><option value="all">All</option><option value="noskin">No Skin</option><option value="infill">Infill Only</option></select></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}><input type="checkbox" checked={print.avoidCrossingPerimeters} onChange={(e) => updatePrintProfile(print.id, { avoidCrossingPerimeters: e.target.checked })} style={{ accentColor: colors.accent }} />Avoid Crossing Perimeters</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}><input type="checkbox" checked={print.thinWallDetection} onChange={(e) => updatePrintProfile(print.id, { thinWallDetection: e.target.checked })} style={{ accentColor: colors.accent }} />Thin Wall Detection</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}><input type="checkbox" checked={print.enableBridgeFan} onChange={(e) => updatePrintProfile(print.id, { enableBridgeFan: e.target.checked })} style={{ accentColor: colors.accent }} />Enable Bridge Fan</label>
            {print.enableBridgeFan && <div style={fieldRow}><div style={labelStyle}>Bridge Fan Speed (%)</div><input type="number" style={inputStyle} value={print.bridgeFanSpeed} min={0} max={100} onChange={(e) => updatePrintProfile(print.id, { bridgeFanSpeed: parseInt(e.target.value) || 100 })} /></div>}
            <div style={fieldRow}><div style={labelStyle}>Min Layer Time (s)</div><input type="number" style={inputStyle} value={print.minLayerTime} min={0} onChange={(e) => updatePrintProfile(print.id, { minLayerTime: parseInt(e.target.value) || 10 })} /></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}><input type="checkbox" checked={print.ironingEnabled} onChange={(e) => updatePrintProfile(print.id, { ironingEnabled: e.target.checked })} style={{ accentColor: colors.accent }} />Enable Ironing</label>
            {print.ironingEnabled && (<><div style={fieldRow}><div style={labelStyle}>Ironing Speed (mm/s)</div><input type="number" style={inputStyle} value={print.ironingSpeed} onChange={(e) => updatePrintProfile(print.id, { ironingSpeed: parseInt(e.target.value) || 15 })} /></div><div style={fieldRow}><div style={labelStyle}>Ironing Flow (%)</div><input type="number" style={inputStyle} value={print.ironingFlow} onChange={(e) => updatePrintProfile(print.id, { ironingFlow: parseInt(e.target.value) || 10 })} /></div><div style={fieldRow}><div style={labelStyle}>Ironing Spacing (mm)</div><input type="number" style={inputStyle} value={print.ironingSpacing} step={0.01} onChange={(e) => updatePrintProfile(print.id, { ironingSpacing: parseFloat(e.target.value) || 0.1 })} /></div></>)}
          </>
        )}
        {activeTab === 7 && (
          <PostProcessorsTab
            processors={print.layerProcessors ?? []}
            onChange={(updated: LayerProcessor[]) => updatePrintProfile(print.id, { layerProcessors: updated })}
          />
        )}
      </SectionBody>
    </>
  );
}
