import type { PrintSettingsSectionProps } from './shared';
import { AdvancedDivider, Tier } from './shared';
import { SlicerSection } from '../SlicerSection';
import { Check, Num, SectionDivider, Sel } from '../workspace/settings/controls/SettingsFieldControls';
import type { PrintProfile } from '../../../types/slicer';
import { getSettingHelp } from '../../../utils/settingsHelpContent';

export function QualitySection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('quality')) return null;

  return (
    <SlicerSection title="Quality" color="#4a9eff" defaultOpen={true}>
      <Num
        label="Layer Height"
        unit="mm"
        value={print.layerHeight}
        step={0.05}
        min={0.01}
        max={1.0}
        onChange={(v) => upd({ layerHeight: v })}
        helpBrief={getSettingHelp('layerHeight')?.brief}
        onShowHelp={() => showHelp('layerHeight', 'Layer Height')}
      />
      <Tier min="advanced">
        <Num label="First Layer Height" unit="mm" value={print.firstLayerHeight} step={0.05} min={0.05} max={1.0} onChange={(v) => upd({ firstLayerHeight: v })} helpBrief={getSettingHelp('firstLayerHeight')?.brief} onShowHelp={() => showHelp('firstLayerHeight', 'First Layer Height')} />
        <SectionDivider label="Line Widths" />
        <Num label="Line Width" unit="mm" value={print.lineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ lineWidth: v })} helpBrief={getSettingHelp('lineWidth')?.brief} onShowHelp={() => showHelp('lineWidth', 'Line Width')} />
        <Num label="Outer Wall Line Width" unit="mm" value={print.outerWallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ outerWallLineWidth: v })} helpBrief={getSettingHelp('outerWallLineWidth')?.brief} onShowHelp={() => showHelp('outerWallLineWidth', 'Outer Wall Line Width')} />
        <Num label="Inner Wall Line Width" unit="mm" value={print.innerWallLineWidth ?? 0.45} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ innerWallLineWidth: v })} helpBrief={getSettingHelp('innerWallLineWidth')?.brief} onShowHelp={() => showHelp('innerWallLineWidth', 'Inner Wall Line Width')} />
        <Num label="Top/Bottom Line Width" unit="mm" value={print.topBottomLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ topBottomLineWidth: v })} helpBrief={getSettingHelp('topBottomLineWidth')?.brief} onShowHelp={() => showHelp('topBottomLineWidth', 'Top/Bottom Line Width')} />
        <Num label="Skirt/Brim Line Width" unit="mm" value={print.skirtBrimLineWidth ?? print.wallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ skirtBrimLineWidth: v })} helpBrief={getSettingHelp('skirtBrimLineWidth')?.brief} onShowHelp={() => showHelp('skirtBrimLineWidth', 'Skirt/Brim Line Width')} />
        <Num label="Support Line Width" unit="mm" value={print.supportLineWidth ?? print.wallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ supportLineWidth: v })} helpBrief={getSettingHelp('supportLineWidth')?.brief} onShowHelp={() => showHelp('supportLineWidth', 'Support Line Width')} />
        <Tier level="advanced"><Num label="Support Interface Line Width" unit="mm" value={print.supportInterfaceLineWidth ?? print.supportLineWidth ?? print.wallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ supportInterfaceLineWidth: v })} helpBrief={getSettingHelp('supportInterfaceLineWidth')?.brief} onShowHelp={() => showHelp('supportInterfaceLineWidth', 'Support Interface Line Width')} /></Tier>
        <Tier level="expert"><Num label="Support Roof Line Width" unit="mm" value={print.supportRoofLineWidth ?? print.supportInterfaceLineWidth ?? print.wallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ supportRoofLineWidth: v })} helpBrief={getSettingHelp('supportInterfaceLineWidth')?.brief} onShowHelp={() => showHelp('supportInterfaceLineWidth', 'Support Roof Line Width')} /></Tier>
        <Tier level="expert"><Num label="Support Floor Line Width" unit="mm" value={print.supportFloorLineWidth ?? print.supportInterfaceLineWidth ?? print.wallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ supportFloorLineWidth: v })} helpBrief={getSettingHelp('supportInterfaceLineWidth')?.brief} onShowHelp={() => showHelp('supportInterfaceLineWidth', 'Support Floor Line Width')} /></Tier>
        <Num label="Initial Layer Width Factor" unit="%" value={print.initialLayerLineWidthFactor ?? 120} step={5} min={50} max={200} onChange={(v) => upd({ initialLayerLineWidthFactor: v })} helpBrief={getSettingHelp('initialLayerLineWidthFactor')?.brief} onShowHelp={() => showHelp('initialLayerLineWidthFactor', 'Initial Layer Width Factor')} />
        <AdvancedDivider label="Mesh Fixes" />
        <Num label="Slicing Closing Radius" unit="mm" value={print.slicingClosingRadius ?? 0.049} step={0.001} min={0} max={0.5} onChange={(v) => upd({ slicingClosingRadius: v })} helpBrief={getSettingHelp('slicingClosingRadius')?.brief} onShowHelp={() => showHelp('slicingClosingRadius', 'Slicing Closing Radius')} />
        <SectionDivider label="Adaptive Layers" />
        <Check label="Enable Adaptive Layers" value={print.adaptiveLayersEnabled ?? false} onChange={(v) => upd({ adaptiveLayersEnabled: v })} helpBrief={getSettingHelp('adaptiveLayersEnabled')?.brief} onShowHelp={() => showHelp('adaptiveLayersEnabled', 'Enable Adaptive Layers')} />
        {(print.adaptiveLayersEnabled ?? false) && (
          <>
            <Num label="Max Variation" unit="mm" value={print.adaptiveLayersMaxVariation ?? 0.1} step={0.01} min={0.01} max={0.5} onChange={(v) => upd({ adaptiveLayersMaxVariation: v })} helpBrief={getSettingHelp('adaptiveLayersMaxVariation')?.brief} onShowHelp={() => showHelp('adaptiveLayersMaxVariation', 'Max Layer Variation')} />
            <Num label="Variation Step" unit="mm" value={print.adaptiveLayersVariationStep ?? 0.05} step={0.01} min={0.01} max={0.2} onChange={(v) => upd({ adaptiveLayersVariationStep: v })} helpBrief={getSettingHelp('adaptiveLayersVariationStep')?.brief} onShowHelp={() => showHelp('adaptiveLayersVariationStep', 'Variation Step')} />
            <Num label="Minimum Layer Height" unit="mm" value={print.adaptiveLayersMinHeight ?? Math.max(0.04, (print.layerHeight ?? 0.2) - (print.adaptiveLayersMaxVariation ?? 0.1))} step={0.01} min={0.04} max={1} onChange={(v) => upd({ adaptiveLayersMinHeight: v })} helpBrief={getSettingHelp('adaptiveLayersMinHeight')?.brief} onShowHelp={() => showHelp('adaptiveLayersMinHeight', 'Minimum Layer Height')} />
            <Num label="Maximum Layer Height" unit="mm" value={print.adaptiveLayersMaxHeight ?? (print.layerHeight ?? 0.2) + (print.adaptiveLayersMaxVariation ?? 0.1)} step={0.01} min={0.05} max={1} onChange={(v) => upd({ adaptiveLayersMaxHeight: v })} helpBrief={getSettingHelp('adaptiveLayersMaxHeight')?.brief} onShowHelp={() => showHelp('adaptiveLayersMaxHeight', 'Maximum Layer Height')} />
            <Num label="Topography Size" unit="mm" value={print.adaptiveLayersTopographySize ?? 0.4} step={0.01} min={0.01} max={2} onChange={(v) => upd({ adaptiveLayersTopographySize: v })} />
          </>
        )}
      </Tier>
    </SlicerSection>
  );
}

export function WallsSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('walls')) return null;

  return (
    <SlicerSection title="Walls" color="#a78bfa" defaultOpen={false}>
      <Num label="Wall Count" value={print.wallCount} min={1} max={20} onChange={(v) => upd({ wallCount: v })} helpBrief={getSettingHelp('wallCount')?.brief} onShowHelp={() => showHelp('wallCount', 'Wall Count')} />
      <Tier min="advanced">
        <Num label="Wall Line Width" unit="mm" value={print.wallLineWidth} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ wallLineWidth: v })} helpBrief={getSettingHelp('lineWidth')?.brief} onShowHelp={() => showHelp('lineWidth', 'Wall Line Width')} />
        <Check label="Outer Wall First" value={print.outerWallFirst ?? false} onChange={(v) => upd({ outerWallFirst: v })} helpBrief={getSettingHelp('outerWallFirst')?.brief} onShowHelp={() => showHelp('outerWallFirst', 'Outer Wall First')} />
        <Check label="Alternate Extra Wall" value={print.alternateExtraWall ?? false} onChange={(v) => upd({ alternateExtraWall: v })} helpBrief={getSettingHelp('alternateExtraWall')?.brief} onShowHelp={() => showHelp('alternateExtraWall', 'Alternate Extra Wall')} />
        <Sel label="Z Seam Alignment" value={print.zSeamAlignment} onChange={(v) => upd({ zSeamAlignment: v })} options={[{ value: 'sharpest_corner', label: 'Sharpest Corner' }, { value: 'aligned', label: 'Aligned' }, { value: 'shortest', label: 'Shortest' }, { value: 'random', label: 'Random' }]} helpBrief={getSettingHelp('zSeamAlignment')?.brief} onShowHelp={() => showHelp('zSeamAlignment', 'Z Seam Alignment')} />
        <Check label="Thin Wall Detection" value={print.thinWallDetection} onChange={(v) => upd({ thinWallDetection: v })} helpBrief={getSettingHelp('thinWallDetection')?.brief} onShowHelp={() => showHelp('thinWallDetection', 'Thin Wall Detection')} />
        <Sel label="Wall Generator" value={print.wallGenerator ?? 'classic'} onChange={(v) => upd({ wallGenerator: v as 'classic' | 'arachne' })} options={[{ value: 'classic', label: 'Classic (fixed-width offset)' }, { value: 'arachne', label: 'Arachne (variable-width)' }]} helpBrief="Variable-width walls handle narrow regions cleanly. Classic is the legacy fixed-width offset." onShowHelp={() => showHelp('wallGenerator', 'Wall Generator')} />
        {(print.wallGenerator ?? 'classic') === 'arachne' && (
          <Sel label="Arachne Backend" value={print.arachneBackend ?? 'js'} onChange={(v) => upd({ arachneBackend: v as 'js' | 'wasm' })} options={[{ value: 'js', label: 'JavaScript' }, { value: 'wasm', label: 'WASM' }]} helpBrief="Selects the Arachne pipeline backend. WASM falls back until the adapter is available." onShowHelp={() => showHelp('arachneBackend', 'Arachne Backend')} />
        )}
      </Tier>
      <Tier min="expert">
        <SectionDivider label="Expert" />
        <Num label="Outer Wall Inset" unit="mm" value={print.outerWallInset ?? 0} step={0.01} min={0} max={2} onChange={(v) => upd({ outerWallInset: v })} helpBrief={getSettingHelp('outerWallInset')?.brief} onShowHelp={() => showHelp('outerWallInset', 'Outer Wall Inset')} />
        <Num label="Min Wall Line Width" unit="mm" value={print.minWallLineWidth ?? 0.2} step={0.01} min={0.05} max={1} onChange={(v) => upd({ minWallLineWidth: v })} helpBrief={getSettingHelp('minWallLineWidth')?.brief} onShowHelp={() => showHelp('minWallLineWidth', 'Min Wall Line Width')} />
        <Num label="Min Even Wall Line Width" unit="mm" value={print.minEvenWallLineWidth ?? 0.2} step={0.01} min={0.05} max={1} onChange={(v) => upd({ minEvenWallLineWidth: v })} helpBrief={getSettingHelp('minEvenWallLineWidth')?.brief} onShowHelp={() => showHelp('minEvenWallLineWidth', 'Min Even Wall Line Width')} />
        <Num label="Wall Distribution Count" value={print.wallDistributionCount ?? 1} min={1} max={20} onChange={(v) => upd({ wallDistributionCount: v })} helpBrief={getSettingHelp('wallDistributionCount')?.brief} onShowHelp={() => showHelp('wallDistributionCount', 'Wall Distribution Count')} />
        <Num label="Wall Transition Length" unit="mm" value={print.wallTransitionLength ?? 1.0} step={0.1} min={0.1} max={10} onChange={(v) => upd({ wallTransitionLength: v })} helpBrief={getSettingHelp('wallTransitionLength')?.brief} onShowHelp={() => showHelp('wallTransitionLength', 'Wall Transition Length')} />
        <Num label="Wall Transition Filter Distance" unit="mm" value={print.wallTransitionFilterDistance ?? 0.1} step={0.05} min={0} max={5} onChange={(v) => upd({ wallTransitionFilterDistance: v })} helpBrief={getSettingHelp('wallTransitionFilterDistance')?.brief} onShowHelp={() => showHelp('wallTransitionFilterDistance', 'Wall Transition Filter Distance')} />
        <Num label="Wall Transition Filter Margin" unit="mm" value={print.wallTransitionFilterMargin ?? 0.1} step={0.05} min={0} max={5} onChange={(v) => upd({ wallTransitionFilterMargin: v })} helpBrief={getSettingHelp('wallTransitionFilterMargin')?.brief} onShowHelp={() => showHelp('wallTransitionFilterMargin', 'Wall Transition Filter Margin')} />
        <Num label="Outer Wall Wipe Distance" unit="mm" value={print.outerWallWipeDistance ?? 0} step={0.1} min={0} max={5} onChange={(v) => upd({ outerWallWipeDistance: v })} helpBrief={getSettingHelp('outerWallWipeDistance')?.brief} onShowHelp={() => showHelp('outerWallWipeDistance', 'Outer Wall Wipe Distance')} />
        <Num label="Hole Expansion Max Diameter" unit="mm" value={print.holeHorizontalExpansionMaxDiameter ?? 0} step={0.5} min={0} max={50} onChange={(v) => upd({ holeHorizontalExpansionMaxDiameter: v })} helpBrief={getSettingHelp('holeHorizontalExpansionMaxDiameter')?.brief} onShowHelp={() => showHelp('holeHorizontalExpansionMaxDiameter', 'Hole Expansion Max Diameter')} />
        <Check label="Print Thin Walls" value={print.printThinWalls ?? false} onChange={(v) => upd({ printThinWalls: v })} helpBrief={getSettingHelp('printThinWalls')?.brief} onShowHelp={() => showHelp('printThinWalls', 'Print Thin Walls')} />
        {(print.printThinWalls ?? false) && (
          <>
            <Num label="Min Feature Size" unit="mm" value={print.minFeatureSize ?? 0.1} step={0.01} min={0.01} max={1} onChange={(v) => upd({ minFeatureSize: v })} helpBrief={getSettingHelp('minFeatureSize')?.brief} onShowHelp={() => showHelp('minFeatureSize', 'Min Feature Size')} />
            <Num label="Min Thin Wall Line Width" unit="mm" value={print.minThinWallLineWidth ?? 0.1} step={0.01} min={0.01} max={1} onChange={(v) => upd({ minThinWallLineWidth: v })} helpBrief={getSettingHelp('minThinWallLineWidth')?.brief} onShowHelp={() => showHelp('minThinWallLineWidth', 'Min Thin Wall Line Width')} />
          </>
        )}
      </Tier>
      <Tier min="advanced">
        <AdvancedDivider />
        <Num label="Wall Line Count (alias)" value={print.wallLineCount ?? print.wallCount ?? 2} min={1} max={20} onChange={(v) => upd({ wallLineCount: v, wallCount: v })} helpBrief={getSettingHelp('wallLineCount')?.brief} onShowHelp={() => showHelp('wallLineCount', 'Wall Line Count')} />
        <Check label="Group Outer Walls" value={print.groupOuterWalls ?? false} onChange={(v) => upd({ groupOuterWalls: v })} helpBrief={getSettingHelp('groupOuterWalls')?.brief} onShowHelp={() => showHelp('groupOuterWalls', 'Group Outer Walls')} />
        <Check label="Alternate Wall Directions" value={print.alternateWallDirections ?? false} onChange={(v) => upd({ alternateWallDirections: v })} helpBrief={getSettingHelp('alternateWallDirections')?.brief} onShowHelp={() => showHelp('alternateWallDirections', 'Alternate Wall Directions')} />
        <Check label="Optimize Wall Printing Order" value={print.optimizeWallOrder ?? false} onChange={(v) => upd({ optimizeWallOrder: v })} helpBrief={getSettingHelp('optimizeWallOrder')?.brief} onShowHelp={() => showHelp('optimizeWallOrder', 'Optimize Wall Printing Order')} />
        <Num label="Min Odd Wall Line Width" unit="mm" value={print.minOddWallLineWidth ?? 0.2} step={0.01} min={0.05} max={1} onChange={(v) => upd({ minOddWallLineWidth: v })} helpBrief={getSettingHelp('minOddWallLineWidth')?.brief} onShowHelp={() => showHelp('minOddWallLineWidth', 'Min Odd Wall Line Width')} />
        <SectionDivider label="Overhanging Walls" />
        <Num label="Overhanging Wall Angle" unit="Â°" value={print.overhangingWallAngle ?? 45} min={0} max={89} onChange={(v) => upd({ overhangingWallAngle: v })} helpBrief={getSettingHelp('overhangingWallAngle')?.brief} onShowHelp={() => showHelp('overhangingWallAngle', 'Overhanging Wall Angle')} />
        <Num label="Overhanging Wall Speed" unit="%" value={print.overhangingWallSpeed ?? 100} step={5} min={10} max={100} onChange={(v) => upd({ overhangingWallSpeed: v })} helpBrief={getSettingHelp('overhangingWallSpeed')?.brief} onShowHelp={() => showHelp('overhangingWallSpeed', 'Overhanging Wall Speed')} />
        <SectionDivider label="Z Seam" />
        <Sel label="Z Seam Position" value={print.zSeamPosition ?? 'sharpest_corner'} onChange={(v) => upd({ zSeamPosition: v })} options={[{ value: 'shortest', label: 'Shortest' }, { value: 'sharpest_corner', label: 'Sharpest Corner' }, { value: 'random', label: 'Random' }, { value: 'user_specified', label: 'User Specified (X/Y)' }, { value: 'painted', label: 'Painted' }, { value: 'back', label: 'Back' }]} helpBrief={getSettingHelp('zSeamAlignment')?.brief} onShowHelp={() => showHelp('zSeamAlignment', 'Z Seam Position')} />
        <Check label="Z Seam Relative" value={print.zSeamRelative ?? false} onChange={(v) => upd({ zSeamRelative: v })} helpBrief={getSettingHelp('zSeamRelative')?.brief} onShowHelp={() => showHelp('zSeamRelative', 'Z Seam Relative')} />
        <Check label="Snap Z Seam to Vertex" value={print.zSeamOnVertex ?? false} onChange={(v) => upd({ zSeamOnVertex: v })} helpBrief={getSettingHelp('zSeamOnVertex')?.brief} onShowHelp={() => showHelp('zSeamOnVertex', 'Snap Z Seam to Vertex')} />
        <Num label="Z Seam X" unit="mm" value={print.zSeamX ?? 0} step={0.1} min={-1000} max={1000} onChange={(v) => upd({ zSeamX: v })} helpBrief={getSettingHelp('zSeamAlignment')?.brief} onShowHelp={() => showHelp('zSeamAlignment', 'Z Seam X Position')} />
        <Num label="Z Seam Y" unit="mm" value={print.zSeamY ?? 0} step={0.1} min={-1000} max={1000} onChange={(v) => upd({ zSeamY: v })} helpBrief={getSettingHelp('zSeamAlignment')?.brief} onShowHelp={() => showHelp('zSeamAlignment', 'Z Seam Y Position')} />
        <Num label="Z Seam Radius" unit="mm" value={print.zSeamUserSpecifiedRadius ?? 0} step={0.1} min={0} max={50} onChange={(v) => upd({ zSeamUserSpecifiedRadius: v })} helpBrief="Tolerance around the user seam X/Y target" onShowHelp={() => showHelp('zSeamAlignment', 'Z Seam Radius')} />
        <Sel label="Seam Corner Preference" value={print.seamCornerPreference ?? 'none'} onChange={(v) => upd({ seamCornerPreference: v })} options={[{ value: 'none', label: 'None' }, { value: 'hide_seam', label: 'Hide Seam' }, { value: 'expose_seam', label: 'Expose Seam' }, { value: 'hide_or_expose', label: 'Hide or Expose' }, { value: 'smart_hide', label: 'Smart Hide' }]} helpBrief={getSettingHelp('seamCornerPreference')?.brief} onShowHelp={() => showHelp('seamCornerPreference', 'Seam Corner Preference')} />
      </Tier>
    </SlicerSection>
  );
}

export function TopBottomSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('topBottom')) return null;
  const extendedPrint = print as PrintProfile & {
    topPattern?: string;
    bottomPattern?: string;
  };

  return (
    <SlicerSection title="Top / Bottom" color="#2dd4bf" defaultOpen={false}>
      <Num label="Top Layers" value={print.topLayers} min={0} max={50} onChange={(v) => upd({ topLayers: v })} helpBrief={getSettingHelp('topLayers')?.brief} onShowHelp={() => showHelp('topLayers', 'Top Layers')} />
      <Num label="Bottom Layers" value={print.bottomLayers} min={0} max={50} onChange={(v) => upd({ bottomLayers: v })} helpBrief={getSettingHelp('bottomLayers')?.brief} onShowHelp={() => showHelp('bottomLayers', 'Bottom Layers')} />
      <Tier min="advanced">
        <Num label="Initial Bottom Layers" value={print.initialBottomLayers ?? print.bottomLayers} min={0} max={50} onChange={(v) => upd({ initialBottomLayers: v })} helpBrief={getSettingHelp('initialBottomLayers')?.brief} onShowHelp={() => showHelp('initialBottomLayers', 'Initial Bottom Layers')} />
        <Num label="Top Surface Skin Layers" value={print.topSurfaceSkinLayers ?? 0} min={0} max={20} onChange={(v) => upd({ topSurfaceSkinLayers: v })} helpBrief={getSettingHelp('topSurfaceSkinLayers')?.brief} onShowHelp={() => showHelp('topSurfaceSkinLayers', 'Top Surface Skin Layers')} />
        <Num label="Bottom Surface Skin Layers" value={print.bottomSurfaceSkinLayers ?? 0} min={0} max={20} onChange={(v) => upd({ bottomSurfaceSkinLayers: v })} helpBrief={getSettingHelp('bottomSurfaceSkinLayers')?.brief} onShowHelp={() => showHelp('bottomSurfaceSkinLayers', 'Bottom Surface Skin Layers')} />
        <Sel label="Pattern" value={print.topBottomPattern} onChange={(v) => upd({ topBottomPattern: v })} options={[{ value: 'lines', label: 'Lines' }, { value: 'concentric', label: 'Concentric' }, { value: 'zigzag', label: 'Zigzag' }]} helpBrief={getSettingHelp('topBottomPattern')?.brief} onShowHelp={() => showHelp('topBottomPattern', 'Top/Bottom Pattern')} />
        <Num label="Top Surface Speed" unit="mm/s" value={print.topSpeed} min={1} max={500} onChange={(v) => upd({ topSpeed: v })} helpBrief={getSettingHelp('topSpeed')?.brief} onShowHelp={() => showHelp('topSpeed', 'Top Surface Speed')} />
        <SectionDivider label="Ironing" />
        <Check label="Enable Ironing" value={print.ironingEnabled} onChange={(v) => upd({ ironingEnabled: v })} helpBrief={getSettingHelp('ironingEnabled')?.brief} onShowHelp={() => showHelp('ironingEnabled', 'Enable Ironing')} />
        {print.ironingEnabled && (
          <>
            <Sel label="Ironing Pattern" value={print.ironingPattern ?? 'lines'} onChange={(v) => upd({ ironingPattern: v })} options={[{ value: 'lines', label: 'Lines' }, { value: 'concentric', label: 'Concentric' }, { value: 'zigzag', label: 'Zigzag' }]} helpBrief={getSettingHelp('ironingPattern')?.brief} onShowHelp={() => showHelp('ironingPattern', 'Ironing Pattern')} />
            <Num label="Ironing Inset" unit="mm" value={print.ironingInset ?? 0.35} step={0.05} min={0} max={5} onChange={(v) => upd({ ironingInset: v })} helpBrief={getSettingHelp('ironingInset')?.brief} onShowHelp={() => showHelp('ironingInset', 'Ironing Inset')} />
            <Num label="Ironing Speed" unit="mm/s" value={print.ironingSpeed} min={1} max={100} onChange={(v) => upd({ ironingSpeed: v })} helpBrief={getSettingHelp('ironingSpeed')?.brief} onShowHelp={() => showHelp('ironingSpeed', 'Ironing Speed')} />
            <Num label="Ironing Flow" unit="%" value={print.ironingFlow} step={0.5} min={0} max={30} onChange={(v) => upd({ ironingFlow: v })} helpBrief={getSettingHelp('ironingFlow')?.brief} onShowHelp={() => showHelp('ironingFlow', 'Ironing Flow')} />
            <Num label="Ironing Spacing" unit="mm" value={print.ironingSpacing} step={0.01} min={0.01} max={1.0} onChange={(v) => upd({ ironingSpacing: v })} helpBrief={getSettingHelp('ironingSpacing')?.brief} onShowHelp={() => showHelp('ironingSpacing', 'Ironing Spacing')} />
            <Tier level="expert"><Check label="Monotonic Ironing Order" value={print.monotonicIroningOrder ?? false} onChange={(v) => upd({ monotonicIroningOrder: v })} /></Tier>
            <Tier level="expert"><Check label="Non-planar Ironing" value={print.nonPlanarIroningEnabled ?? false} onChange={(v) => upd({ nonPlanarIroningEnabled: v })} /></Tier>
            {(print.nonPlanarIroningEnabled ?? false) && (
              <Tier level="expert">
                <Num label="Non-planar Max Lift" unit="mm" value={print.nonPlanarIroningMaxOffset ?? 0.3} step={0.01} min={0.01} max={2} onChange={(v) => upd({ nonPlanarIroningMaxOffset: v })} />
                <Num label="Non-planar Sample Spacing" unit="mm" value={print.nonPlanarIroningSampleSpacing ?? 1} step={0.1} min={0.2} max={5} onChange={(v) => upd({ nonPlanarIroningSampleSpacing: v })} />
              </Tier>
            )}
          </>
        )}
        <Tier level="expert"><Check label="Connect Top/Bottom Polygons" value={print.connectTopBottomPolygons ?? false} onChange={(v) => upd({ connectTopBottomPolygons: v })} /></Tier>
        <Tier level="expert">
          <SectionDivider label="Skin Sizing" />
          <Num label="Top Skin Removal Width" unit="mm" value={print.topSkinRemovalWidth ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ topSkinRemovalWidth: v })} />
          <Num label="Bottom Skin Removal Width" unit="mm" value={print.bottomSkinRemovalWidth ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ bottomSkinRemovalWidth: v })} />
          <Num label="Small Top/Bottom Width" unit="mm" value={print.smallTopBottomWidth ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ smallTopBottomWidth: v })} />
        </Tier>
      </Tier>
      <Tier min="advanced">
        <AdvancedDivider />
        <Num label="Top Thickness" unit="mm" value={print.topThickness ?? 0.8} step={0.05} min={0} max={10} onChange={(v) => upd({ topThickness: v })} helpBrief={getSettingHelp('topThickness')?.brief} onShowHelp={() => showHelp('topThickness', 'Top Thickness')} />
        <Num label="Bottom Thickness" unit="mm" value={print.bottomThickness ?? 0.8} step={0.05} min={0} max={10} onChange={(v) => upd({ bottomThickness: v })} helpBrief={getSettingHelp('bottomThickness')?.brief} onShowHelp={() => showHelp('bottomThickness', 'Bottom Thickness')} />
        <Num label="Top/Bottom Line Width" unit="mm" value={print.topBottomLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ topBottomLineWidth: v })} helpBrief={getSettingHelp('topBottomLineWidth')?.brief} onShowHelp={() => showHelp('topBottomLineWidth', 'Top/Bottom Line Width')} />
        <Sel label="Top Pattern" value={extendedPrint.topPattern ?? print.topBottomPattern} onChange={(v) => upd({ topPattern: v })} options={[{ value: 'lines', label: 'Lines' }, { value: 'concentric', label: 'Concentric' }, { value: 'zigzag', label: 'Zigzag' }]} />
        <Sel label="Bottom Pattern" value={extendedPrint.bottomPattern ?? print.topBottomPattern} onChange={(v) => upd({ bottomPattern: v })} options={[{ value: 'lines', label: 'Lines' }, { value: 'concentric', label: 'Concentric' }, { value: 'zigzag', label: 'Zigzag' }]} />
        <Sel label="Initial Bottom Pattern" value={print.bottomPatternInitialLayer ?? extendedPrint.bottomPattern ?? print.topBottomPattern} onChange={(v) => upd({ bottomPatternInitialLayer: v })} options={[{ value: 'lines', label: 'Lines' }, { value: 'concentric', label: 'Concentric' }, { value: 'zigzag', label: 'Zigzag' }]} />
        <Num label="Top Surface Skin Expansion" unit="mm" value={print.topSurfaceSkinExpansion ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ topSurfaceSkinExpansion: v })} />
        <Num label="Top Surface Skin Flow" unit="%" value={print.topSurfaceSkinFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ topSurfaceSkinFlow: v })} />
      </Tier>
    </SlicerSection>
  );
}
