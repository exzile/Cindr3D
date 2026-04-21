import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { PrintProfile } from '../../types/slicer';
import { Num, Check, Sel, Density, SectionDivider } from './workspace/settings/controls/SettingsFieldControls';
import { SlicerSection } from './SlicerSection';
import { useSlicerVisibilityStore, type DetailLevel } from '../../store/slicerVisibilityStore';
import { getUnsupportedReason } from '../../utils/firmwareCompatibility';
import { getSettingHelp, type SettingHelp } from '../../utils/settingsHelpContent';
import { SettingsHelpModal } from './workspace/settings/SettingsHelpModal';
import { useSlicerStore } from '../../store/slicerStore';

// Renders children only when the current detail level meets the minimum.
// basic = always shown; advanced = default; expert = power-user only.
// Accepts either `min` or `level` as a convenience alias.
function Tier({ min, level, children }: { min?: DetailLevel; level?: DetailLevel; children: React.ReactNode }) {
  const required: DetailLevel = min ?? level ?? 'basic';
  const meets = useSlicerVisibilityStore((s) => s.meetsLevel(required));
  if (!meets) return null;
  return <>{children}</>;
}

// Divider stamped with an Advanced / Expert badge so users can see at a
// glance that what follows is a deeper-level knob inside a merged section.
function AdvancedDivider({ label = 'Advanced' }: { label?: string }) {
  return <SectionDivider label={label} icon={<Sparkles size={10} />} />;
}

export function SlicerPrintProfileSettings({
  print,
  upd,
}: {
  print: PrintProfile;
  upd: (updates: Record<string, unknown>) => void;
}) {
  const isVisible = useSlicerVisibilityStore((s) => s.isVisible);
  useSlicerVisibilityStore((s) => s.visible); // re-render on toggle
  const ms = new Set(print.machineSourcedFields ?? []);
  const printer = useSlicerStore((s) => s.getActivePrinterProfile());

  // Help modal state
  const [helpModal, setHelpModal] = useState<{ title: string; help: SettingHelp } | null>(null);

  // Helper to check if a setting is compatible with the current printer firmware
  const checkFirmware = (settingKey: string): string | null => {
    return getUnsupportedReason(settingKey, printer);
  };

  // Helper to show help for a setting
  const showHelp = (settingKey: string, label: string) => {
    const help = getSettingHelp(settingKey);
    if (help) {
      setHelpModal({ title: label, help });
    }
  };

  return (
    <>
      {isVisible('quality') && <SlicerSection title="Quality" color="#4a9eff" defaultOpen={true}>
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
          <Num label="Top/Bottom Line Width" unit="mm" value={print.topBottomLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ topBottomLineWidth: v })} helpBrief={getSettingHelp('topBottomLineWidth')?.brief} onShowHelp={() => showHelp('topBottomLineWidth', 'Top/Bottom Line Width')} />
          <Num label="Skirt/Brim Line Width" unit="mm" value={print.skirtBrimLineWidth ?? print.wallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ skirtBrimLineWidth: v })} helpBrief={getSettingHelp('skirtBrimLineWidth')?.brief} onShowHelp={() => showHelp('skirtBrimLineWidth', 'Skirt/Brim Line Width')} />
          <Num label="Support Line Width" unit="mm" value={print.supportLineWidth ?? print.wallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ supportLineWidth: v })} helpBrief={getSettingHelp('supportLineWidth')?.brief} onShowHelp={() => showHelp('supportLineWidth', 'Support Line Width')} />
          <Tier level="advanced"><Num label="Support Interface Line Width" unit="mm" value={print.supportInterfaceLineWidth ?? print.supportLineWidth ?? print.wallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ supportInterfaceLineWidth: v })} helpBrief={getSettingHelp('supportInterfaceLineWidth')?.brief} onShowHelp={() => showHelp('supportInterfaceLineWidth', 'Support Interface Line Width')} /></Tier>
          <Tier level="expert"><Num label="Support Roof Line Width" unit="mm" value={print.supportRoofLineWidth ?? print.supportInterfaceLineWidth ?? print.wallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ supportRoofLineWidth: v })} helpBrief={getSettingHelp('supportInterfaceLineWidth')?.brief} onShowHelp={() => showHelp('supportInterfaceLineWidth', 'Support Roof Line Width')} /></Tier>
          <Tier level="expert"><Num label="Support Floor Line Width" unit="mm" value={print.supportFloorLineWidth ?? print.supportInterfaceLineWidth ?? print.wallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ supportFloorLineWidth: v })} helpBrief={getSettingHelp('supportInterfaceLineWidth')?.brief} onShowHelp={() => showHelp('supportInterfaceLineWidth', 'Support Floor Line Width')} /></Tier>
          <Num label="Initial Layer Width Factor" unit="%" value={print.initialLayerLineWidthFactor ?? 120} step={5} min={50} max={200} onChange={(v) => upd({ initialLayerLineWidthFactor: v })} helpBrief={getSettingHelp('initialLayerLineWidthFactor')?.brief} onShowHelp={() => showHelp('initialLayerLineWidthFactor', 'Initial Layer Width Factor')} />
          <SectionDivider label="Adaptive Layers" />
          <Check label="Enable Adaptive Layers" value={print.adaptiveLayersEnabled ?? false} onChange={(v) => upd({ adaptiveLayersEnabled: v })} helpBrief={getSettingHelp('adaptiveLayersEnabled')?.brief} onShowHelp={() => showHelp('adaptiveLayersEnabled', 'Enable Adaptive Layers')} />
          {(print.adaptiveLayersEnabled ?? false) && (<>
            <Num label="Max Variation" unit="mm" value={print.adaptiveLayersMaxVariation ?? 0.1} step={0.01} min={0.01} max={0.5} onChange={(v) => upd({ adaptiveLayersMaxVariation: v })} helpBrief={getSettingHelp('adaptiveLayersMaxVariation')?.brief} onShowHelp={() => showHelp('adaptiveLayersMaxVariation', 'Max Layer Variation')} />
            <Num label="Variation Step" unit="mm" value={print.adaptiveLayersVariationStep ?? 0.05} step={0.01} min={0.01} max={0.2} onChange={(v) => upd({ adaptiveLayersVariationStep: v })} helpBrief={getSettingHelp('adaptiveLayersVariationStep')?.brief} onShowHelp={() => showHelp('adaptiveLayersVariationStep', 'Variation Step')} />
            <Num label="Topography Size" unit="mm" value={print.adaptiveLayersTopographySize ?? 0.4} step={0.01} min={0.01} max={2} onChange={(v) => upd({ adaptiveLayersTopographySize: v })} />
          </>)}
        </Tier>
      </SlicerSection>}

      {isVisible('walls') && <SlicerSection title="Walls" color="#a78bfa" defaultOpen={false}>
        <Num
          label="Wall Count"
          value={print.wallCount}
          min={1}
          max={20}
          onChange={(v) => upd({ wallCount: v })}
          helpBrief={getSettingHelp('wallCount')?.brief}
          onShowHelp={() => showHelp('wallCount', 'Wall Count')}
        />
        <Tier min="advanced">
          <Num label="Wall Line Width" unit="mm" value={print.wallLineWidth} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ wallLineWidth: v })} helpBrief={getSettingHelp('lineWidth')?.brief} onShowHelp={() => showHelp('lineWidth', 'Wall Line Width')} />
          <Check label="Outer Wall First" value={print.outerWallFirst ?? false} onChange={(v) => upd({ outerWallFirst: v })} helpBrief={getSettingHelp('outerWallFirst')?.brief} onShowHelp={() => showHelp('outerWallFirst', 'Outer Wall First')} />
          <Check label="Alternate Extra Wall" value={print.alternateExtraWall ?? false} onChange={(v) => upd({ alternateExtraWall: v })} helpBrief={getSettingHelp('alternateExtraWall')?.brief} onShowHelp={() => showHelp('alternateExtraWall', 'Alternate Extra Wall')} />
          <Sel label="Z Seam Alignment" value={print.zSeamAlignment}
            onChange={(v) => upd({ zSeamAlignment: v })}
            options={[
              { value: 'sharpest_corner', label: 'Sharpest Corner' },
              { value: 'aligned', label: 'Aligned' },
              { value: 'shortest', label: 'Shortest' },
              { value: 'random', label: 'Random' },
            ]}
            helpBrief={getSettingHelp('zSeamAlignment')?.brief}
            onShowHelp={() => showHelp('zSeamAlignment', 'Z Seam Alignment')} />
          <Check label="Thin Wall Detection" value={print.thinWallDetection} onChange={(v) => upd({ thinWallDetection: v })} helpBrief={getSettingHelp('thinWallDetection')?.brief} onShowHelp={() => showHelp('thinWallDetection', 'Thin Wall Detection')} />
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
          {(print.printThinWalls ?? false) && (<>
            <Num label="Min Feature Size" unit="mm" value={print.minFeatureSize ?? 0.1} step={0.01} min={0.01} max={1} onChange={(v) => upd({ minFeatureSize: v })} helpBrief={getSettingHelp('minFeatureSize')?.brief} onShowHelp={() => showHelp('minFeatureSize', 'Min Feature Size')} />
            <Num label="Min Thin Wall Line Width" unit="mm" value={print.minThinWallLineWidth ?? 0.1} step={0.01} min={0.01} max={1} onChange={(v) => upd({ minThinWallLineWidth: v })} helpBrief={getSettingHelp('minThinWallLineWidth')?.brief} onShowHelp={() => showHelp('minThinWallLineWidth', 'Min Thin Wall Line Width')} />
          </>)}
        </Tier>
        <Tier min="advanced">
          <AdvancedDivider />
          <Num label="Wall Line Count (alias)" value={print.wallLineCount ?? print.wallCount ?? 2} min={1} max={20} onChange={(v) => upd({ wallLineCount: v, wallCount: v })} helpBrief={getSettingHelp('wallLineCount')?.brief} onShowHelp={() => showHelp('wallLineCount', 'Wall Line Count')} />
          <Num label="Inner Wall Line Width" unit="mm" value={print.innerWallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ innerWallLineWidth: v })} helpBrief={getSettingHelp('innerWallLineWidth')?.brief} onShowHelp={() => showHelp('innerWallLineWidth', 'Inner Wall Line Width')} />
          <Check label="Group Outer Walls" value={print.groupOuterWalls ?? false} onChange={(v) => upd({ groupOuterWalls: v })} helpBrief={getSettingHelp('groupOuterWalls')?.brief} onShowHelp={() => showHelp('groupOuterWalls', 'Group Outer Walls')} />
          <Check label="Alternate Wall Directions" value={print.alternateWallDirections ?? false} onChange={(v) => upd({ alternateWallDirections: v })} helpBrief={getSettingHelp('alternateWallDirections')?.brief} onShowHelp={() => showHelp('alternateWallDirections', 'Alternate Wall Directions')} />
          <Check label="Optimize Wall Printing Order" value={print.optimizeWallOrder ?? false} onChange={(v) => upd({ optimizeWallOrder: v })} helpBrief={getSettingHelp('optimizeWallOrder')?.brief} onShowHelp={() => showHelp('optimizeWallOrder', 'Optimize Wall Printing Order')} />
          <Num label="Min Odd Wall Line Width" unit="mm" value={print.minOddWallLineWidth ?? 0.2} step={0.01} min={0.05} max={1} onChange={(v) => upd({ minOddWallLineWidth: v })} helpBrief={getSettingHelp('minOddWallLineWidth')?.brief} onShowHelp={() => showHelp('minOddWallLineWidth', 'Min Odd Wall Line Width')} />
          <SectionDivider label="Overhanging Walls" />
          <Num label="Overhanging Wall Angle" unit="°" value={print.overhangingWallAngle ?? 45} min={0} max={89} onChange={(v) => upd({ overhangingWallAngle: v })} helpBrief={getSettingHelp('overhangingWallAngle')?.brief} onShowHelp={() => showHelp('overhangingWallAngle', 'Overhanging Wall Angle')} />
          <Num label="Overhanging Wall Speed" unit="%" value={print.overhangingWallSpeed ?? 100} step={5} min={10} max={100} onChange={(v) => upd({ overhangingWallSpeed: v })} helpBrief={getSettingHelp('overhangingWallSpeed')?.brief} onShowHelp={() => showHelp('overhangingWallSpeed', 'Overhanging Wall Speed')} />
          <SectionDivider label="Z Seam" />
          <Sel label="Z Seam Position" value={print.zSeamPosition ?? 'sharpest_corner'}
            onChange={(v) => upd({ zSeamPosition: v })}
            options={[
              { value: 'shortest',         label: 'Shortest' },
              { value: 'sharpest_corner',  label: 'Sharpest Corner' },
              { value: 'random',           label: 'Random' },
              { value: 'user_specified',   label: 'User Specified (X/Y)' },
              { value: 'back',             label: 'Back' },
            ]}
            helpBrief={getSettingHelp('zSeamAlignment')?.brief} onShowHelp={() => showHelp('zSeamAlignment', 'Z Seam Position')} />
          <Check label="Z Seam Relative" value={print.zSeamRelative ?? false} onChange={(v) => upd({ zSeamRelative: v })} helpBrief={getSettingHelp('zSeamRelative')?.brief} onShowHelp={() => showHelp('zSeamRelative', 'Z Seam Relative')} />
          <Check label="Snap Z Seam to Vertex" value={print.zSeamOnVertex ?? false} onChange={(v) => upd({ zSeamOnVertex: v })} helpBrief={getSettingHelp('zSeamOnVertex')?.brief} onShowHelp={() => showHelp('zSeamOnVertex', 'Snap Z Seam to Vertex')} />
          <Num label="Z Seam X" unit="mm" value={print.zSeamX ?? 0} step={0.1} min={-1000} max={1000} onChange={(v) => upd({ zSeamX: v })} helpBrief={getSettingHelp('zSeamAlignment')?.brief} onShowHelp={() => showHelp('zSeamAlignment', 'Z Seam X Position')} />
          <Num label="Z Seam Y" unit="mm" value={print.zSeamY ?? 0} step={0.1} min={-1000} max={1000} onChange={(v) => upd({ zSeamY: v })} helpBrief={getSettingHelp('zSeamAlignment')?.brief} onShowHelp={() => showHelp('zSeamAlignment', 'Z Seam Y Position')} />
          <Sel label="Seam Corner Preference" value={print.seamCornerPreference ?? 'none'}
            onChange={(v) => upd({ seamCornerPreference: v })}
            options={[
              { value: 'none',           label: 'None' },
              { value: 'hide_seam',      label: 'Hide Seam' },
              { value: 'expose_seam',    label: 'Expose Seam' },
              { value: 'hide_or_expose', label: 'Hide or Expose' },
              { value: 'smart_hide',     label: 'Smart Hide' },
            ]}
            helpBrief={getSettingHelp('seamCornerPreference')?.brief} onShowHelp={() => showHelp('seamCornerPreference', 'Seam Corner Preference')} />
        </Tier>
      </SlicerSection>}

      {isVisible('topBottom') && <SlicerSection title="Top / Bottom" color="#2dd4bf" defaultOpen={false}>
        <Num label="Top Layers" value={print.topLayers} min={0} max={50} onChange={(v) => upd({ topLayers: v })} helpBrief={getSettingHelp('topLayers')?.brief} onShowHelp={() => showHelp('topLayers', 'Top Layers')} />
        <Num label="Bottom Layers" value={print.bottomLayers} min={0} max={50} onChange={(v) => upd({ bottomLayers: v })} helpBrief={getSettingHelp('bottomLayers')?.brief} onShowHelp={() => showHelp('bottomLayers', 'Bottom Layers')} />
        <Tier min="advanced">
          <Num label="Initial Bottom Layers" value={print.initialBottomLayers ?? print.bottomLayers} min={0} max={50} onChange={(v) => upd({ initialBottomLayers: v })} helpBrief={getSettingHelp('initialBottomLayers')?.brief} onShowHelp={() => showHelp('initialBottomLayers', 'Initial Bottom Layers')} />
          <Num label="Top Surface Skin Layers" value={print.topSurfaceSkinLayers ?? 0} min={0} max={20} onChange={(v) => upd({ topSurfaceSkinLayers: v })} helpBrief={getSettingHelp('topSurfaceSkinLayers')?.brief} onShowHelp={() => showHelp('topSurfaceSkinLayers', 'Top Surface Skin Layers')} />
          <Num label="Bottom Surface Skin Layers" value={print.bottomSurfaceSkinLayers ?? 0} min={0} max={20} onChange={(v) => upd({ bottomSurfaceSkinLayers: v })} helpBrief={getSettingHelp('bottomSurfaceSkinLayers')?.brief} onShowHelp={() => showHelp('bottomSurfaceSkinLayers', 'Bottom Surface Skin Layers')} />
          <Sel label="Pattern" value={print.topBottomPattern}
            onChange={(v) => upd({ topBottomPattern: v })}
            options={[
              { value: 'lines', label: 'Lines' },
              { value: 'concentric', label: 'Concentric' },
              { value: 'zigzag', label: 'Zigzag' },
            ]}
            helpBrief={getSettingHelp('topBottomPattern')?.brief}
            onShowHelp={() => showHelp('topBottomPattern', 'Top/Bottom Pattern')} />
          <Num label="Top Surface Speed" unit="mm/s" value={print.topSpeed} min={1} max={500} onChange={(v) => upd({ topSpeed: v })} helpBrief={getSettingHelp('topSpeed')?.brief} onShowHelp={() => showHelp('topSpeed', 'Top Surface Speed')} />
          <SectionDivider label="Ironing" />
          <Check label="Enable Ironing" value={print.ironingEnabled} onChange={(v) => upd({ ironingEnabled: v })} helpBrief={getSettingHelp('ironingEnabled')?.brief} onShowHelp={() => showHelp('ironingEnabled', 'Enable Ironing')} />
          {print.ironingEnabled && (<>
            <Sel label="Ironing Pattern" value={print.ironingPattern ?? 'lines'} onChange={(v) => upd({ ironingPattern: v })}
              options={[
                { value: 'lines', label: 'Lines' },
                { value: 'concentric', label: 'Concentric' },
                { value: 'zigzag', label: 'Zigzag' },
              ]}
              helpBrief={getSettingHelp('ironingPattern')?.brief} onShowHelp={() => showHelp('ironingPattern', 'Ironing Pattern')} />
            <Num label="Ironing Inset" unit="mm" value={print.ironingInset ?? 0.35} step={0.05} min={0} max={5} onChange={(v) => upd({ ironingInset: v })} helpBrief={getSettingHelp('ironingInset')?.brief} onShowHelp={() => showHelp('ironingInset', 'Ironing Inset')} />
            <Num label="Ironing Speed" unit="mm/s" value={print.ironingSpeed} min={1} max={100} onChange={(v) => upd({ ironingSpeed: v })} helpBrief={getSettingHelp('ironingSpeed')?.brief} onShowHelp={() => showHelp('ironingSpeed', 'Ironing Speed')} />
            <Num label="Ironing Flow" unit="%" value={print.ironingFlow} step={0.5} min={0} max={30} onChange={(v) => upd({ ironingFlow: v })} helpBrief={getSettingHelp('ironingFlow')?.brief} onShowHelp={() => showHelp('ironingFlow', 'Ironing Flow')} />
            <Num label="Ironing Spacing" unit="mm" value={print.ironingSpacing} step={0.01} min={0.01} max={1.0} onChange={(v) => upd({ ironingSpacing: v })} helpBrief={getSettingHelp('ironingSpacing')?.brief} onShowHelp={() => showHelp('ironingSpacing', 'Ironing Spacing')} />
            <Tier level="expert"><Check label="Monotonic Ironing Order" value={print.monotonicIroningOrder ?? false} onChange={(v) => upd({ monotonicIroningOrder: v })} /></Tier>
          </>)}
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
          <Num label="Skin Overlap" unit="%" value={print.skinOverlapPercent ?? 10} step={1} min={0} max={100} onChange={(v) => upd({ skinOverlapPercent: v })} helpBrief={getSettingHelp('skinOverlapPercent')?.brief} onShowHelp={() => showHelp('skinOverlapPercent', 'Skin Overlap')} />
          <Num label="Top Skin Expand Distance" unit="mm" value={print.topSkinExpandDistance ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ topSkinExpandDistance: v })} helpBrief={getSettingHelp('topSkinExpandDistance')?.brief} onShowHelp={() => showHelp('topSkinExpandDistance', 'Top Skin Expand Distance')} />
          <Num label="Bottom Skin Expand Distance" unit="mm" value={print.bottomSkinExpandDistance ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ bottomSkinExpandDistance: v })} helpBrief={getSettingHelp('bottomSkinExpandDistance')?.brief} onShowHelp={() => showHelp('bottomSkinExpandDistance', 'Bottom Skin Expand Distance')} />
          <Num label="Skin Removal Width" unit="mm" value={print.skinRemovalWidth ?? 0} step={0.05} min={0} max={5} onChange={(v) => upd({ skinRemovalWidth: v })} />
          <Num label="Extra Skin Wall Count" value={print.extraSkinWallCount ?? 0} min={0} max={10} onChange={(v) => upd({ extraSkinWallCount: v })} />
          <Check label="No Skin in Z Gaps" value={print.noSkinInZGaps ?? false} onChange={(v) => upd({ noSkinInZGaps: v })} />
          <Sel label="Bottom Pattern (Initial Layer)" value={print.bottomPatternInitialLayer ?? 'lines'}
            onChange={(v) => upd({ bottomPatternInitialLayer: v })}
            options={[
              { value: 'lines',      label: 'Lines' },
              { value: 'concentric', label: 'Concentric' },
              { value: 'zigzag',     label: 'Zigzag' },
              { value: 'monotonic',  label: 'Monotonic' },
            ]} />
          <Check label="Iron Only Highest Layer" value={print.ironOnlyHighestLayer ?? false} onChange={(v) => upd({ ironOnlyHighestLayer: v })} />
          <SectionDivider label="Top Surface Skin" />
          <Num label="Top Surface Skin Line Width" unit="mm" value={print.topSurfaceSkinLineWidth ?? 0.4} step={0.01} min={0.1} max={2} onChange={(v) => upd({ topSurfaceSkinLineWidth: v })} />
          <Sel label="Top Surface Skin Pattern" value={print.topSurfaceSkinPattern ?? 'lines'}
            onChange={(v) => upd({ topSurfaceSkinPattern: v })}
            options={[
              { value: 'lines',       label: 'Lines' },
              { value: 'concentric',  label: 'Concentric' },
              { value: 'zigzag',      label: 'Zigzag' },
            ]} />
          <Num label="Top Surface Skin Expansion" unit="mm" value={print.topSurfaceSkinExpansion ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ topSurfaceSkinExpansion: v })} />
          <Num label="Top Surface Skin Flow" unit="%" value={print.topSurfaceSkinFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ topSurfaceSkinFlow: v })} />
        </Tier>
      </SlicerSection>}

      {isVisible('infill') && <SlicerSection title="Infill" color="#fb923c" defaultOpen={true}>
        {/* Density component doesn't support help yet, but infill is a key setting */}
        <div style={{ position: 'relative' }}>
          <Density value={print.infillDensity} onChange={(v) => upd({ infillDensity: v })} />
        </div>
        <Sel label="Pattern" value={print.infillPattern}
          onChange={(v) => upd({ infillPattern: v })}
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'lines', label: 'Lines' },
            { value: 'triangles', label: 'Triangles' },
            { value: 'cubic', label: 'Cubic' },
            { value: 'gyroid', label: 'Gyroid' },
            { value: 'honeycomb', label: 'Honeycomb' },
            { value: 'lightning', label: 'Lightning' },
            { value: 'concentric', label: 'Concentric' },
            { value: 'cross', label: 'Cross' },
            { value: 'cross3d', label: 'Cross 3D' },
            { value: 'quarter_cubic', label: 'Quarter Cubic' },
            { value: 'octet', label: 'Octet' },
            { value: 'tri_hexagon', label: 'Tri-Hexagon' },
            { value: 'zigzag', label: 'Zigzag' },
            { value: 'tetrahedral', label: 'Tetrahedral' },
            { value: 'cubicsubdiv', label: 'Cubic Subdivision' },
          ]}
          helpBrief={getSettingHelp('infillPattern')?.brief}
          onShowHelp={() => showHelp('infillPattern', 'Infill Pattern')} />
        <Tier min="advanced">
          <Num label="Infill Line Width" unit="mm" value={print.infillLineWidth} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ infillLineWidth: v })} helpBrief={getSettingHelp('lineWidth')?.brief} onShowHelp={() => showHelp('lineWidth', 'Infill Line Width')} />
          <Check label="Randomize Infill Start" value={print.randomInfillStart ?? false} onChange={(v) => upd({ randomInfillStart: v })} helpBrief={getSettingHelp('randomInfillStart')?.brief} onShowHelp={() => showHelp('randomInfillStart', 'Randomize Infill Start')} />
          <Num label="Minimum Infill Area" unit="mm²" value={print.minInfillArea ?? 0} step={0.5} min={0} max={100} onChange={(v) => upd({ minInfillArea: v })} helpBrief={getSettingHelp('minInfillArea')?.brief} onShowHelp={() => showHelp('minInfillArea', 'Minimum Infill Area')} />
          <Num label="Gradual Infill Steps" value={print.gradualInfillSteps ?? 0} min={0} max={5} onChange={(v) => upd({ gradualInfillSteps: v })} helpBrief={getSettingHelp('gradualInfillSteps')?.brief} onShowHelp={() => showHelp('gradualInfillSteps', 'Gradual Infill Steps')} />
          <Num label="Extra Infill Wall Count" value={print.infillWallCount ?? 0} min={0} max={5} onChange={(v) => upd({ infillWallCount: v })} helpBrief={getSettingHelp('infillWallCount')?.brief} onShowHelp={() => showHelp('infillWallCount', 'Extra Infill Wall Count')} />
        </Tier>
        <Tier min="expert">
          <Num label="Infill Overlap" unit="%" value={print.infillOverlap} min={0} max={50} onChange={(v) => upd({ infillOverlap: v })} helpBrief={getSettingHelp('infillOverlap')?.brief} onShowHelp={() => showHelp('infillOverlap', 'Infill Overlap')} />
          {print.infillPattern === 'lightning' && (
            <Num label="Lightning Overhang Angle" unit="°" value={print.lightningInfillOverhangAngle ?? 40} min={10} max={89} onChange={(v) => upd({ lightningInfillOverhangAngle: v })} />
          )}
        </Tier>
        <Tier min="advanced">
          <AdvancedDivider />
          <Num label="Infill Line Distance (overrides density)" unit="mm" value={print.infillLineDistance ?? 0} step={0.05} min={0} max={20} onChange={(v) => upd({ infillLineDistance: v })} />
          <Num label="Infill Layer Thickness" unit="mm" value={print.infillLayerThickness ?? 0} step={0.05} min={0} max={2} onChange={(v) => upd({ infillLayerThickness: v })} />
          <Check label="Connect Infill Lines" value={print.connectInfillLines ?? false} onChange={(v) => upd({ connectInfillLines: v })} />
          <Check label="Connect Infill Polygons" value={print.connectInfillPolygons ?? true} onChange={(v) => upd({ connectInfillPolygons: v })} />
          <Num label="Infill Wipe Distance" unit="mm" value={print.infillWipeDistance ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ infillWipeDistance: v })} />
          <Num label="Infill Start Move Inwards" unit="mm" value={print.infillStartMoveInwardsLength ?? 0} step={0.1} min={0} max={5} onChange={(v) => upd({ infillStartMoveInwardsLength: v })} />
          <Num label="Infill End Move Inwards" unit="mm" value={print.infillEndMoveInwardsLength ?? 0} step={0.1} min={0} max={5} onChange={(v) => upd({ infillEndMoveInwardsLength: v })} />
          <Num label="Infill Overhang Angle" unit="°" value={print.infillOverhangAngle ?? 0} min={0} max={89} onChange={(v) => upd({ infillOverhangAngle: v })} />
          <Num label="Gradual Infill Step Height" unit="mm" value={print.gradualInfillStepHeight ?? 1.5} step={0.1} min={0.1} max={20} onChange={(v) => upd({ gradualInfillStepHeight: v })} />
          <Num label="Infill X Offset" unit="mm" value={print.infillXOffset ?? 0} step={0.1} min={-100} max={100} onChange={(v) => upd({ infillXOffset: v })} />
          <Num label="Infill Y Offset" unit="mm" value={print.infillYOffset ?? 0} step={0.1} min={-100} max={100} onChange={(v) => upd({ infillYOffset: v })} />
          <SectionDivider label="Lightning Infill" />
          <Num label="Lightning Prune Angle" unit="°" value={print.lightningPruneAngle ?? 40} min={0} max={89} onChange={(v) => upd({ lightningPruneAngle: v })} />
          <Num label="Lightning Straightening Angle" unit="°" value={print.lightningStraighteningAngle ?? 40} min={0} max={89} onChange={(v) => upd({ lightningStraighteningAngle: v })} />
          <SectionDivider label="Cubic Subdivision" />
          <Num label="Cubic Subdivision Shell" unit="mm" value={print.cubicSubdivisionShell ?? 0} step={0.5} min={0} max={20} onChange={(v) => upd({ cubicSubdivisionShell: v })} />
        </Tier>
      </SlicerSection>}

      {isVisible('speed') && <SlicerSection title="Speed" color="#f43f5e" defaultOpen={false}>
        <Num
          label="Print Speed"
          unit="mm/s"
          value={print.printSpeed}
          min={1}
          max={1000}
          onChange={(v) => upd({ printSpeed: v })}
          helpBrief={getSettingHelp('printSpeed')?.brief}
          onShowHelp={() => showHelp('printSpeed', 'Print Speed')}
        />
        <Tier min="advanced">
          <Num
            label="Travel Speed"
            unit="mm/s"
            value={print.travelSpeed}
            min={1}
            max={1000}
            onChange={(v) => upd({ travelSpeed: v })}
            helpBrief={getSettingHelp('travelSpeed')?.brief}
            onShowHelp={() => showHelp('travelSpeed', 'Travel Speed')}
          />
          <Num label="First Layer Speed" unit="mm/s" value={print.firstLayerSpeed} min={1} max={200} onChange={(v) => upd({ firstLayerSpeed: v })} helpBrief={getSettingHelp('firstLayerSpeed')?.brief} onShowHelp={() => showHelp('firstLayerSpeed', 'First Layer Speed')} />
          <SectionDivider label="Per-Feature" />
          <Num label="Outer Wall Speed" unit="mm/s" value={print.outerWallSpeed} min={1} max={500} onChange={(v) => upd({ outerWallSpeed: v })} helpBrief={getSettingHelp('outerWallSpeed')?.brief} onShowHelp={() => showHelp('outerWallSpeed', 'Outer Wall Speed')} />
          <Num label="Inner Wall Speed" unit="mm/s" value={print.wallSpeed} min={1} max={500} onChange={(v) => upd({ wallSpeed: v })} helpBrief={getSettingHelp('wallSpeed')?.brief} onShowHelp={() => showHelp('wallSpeed', 'Inner Wall Speed')} />
          <Num label="Top Surface Speed" unit="mm/s" value={print.topSpeed} min={1} max={500} onChange={(v) => upd({ topSpeed: v })} helpBrief={getSettingHelp('topSpeed')?.brief} onShowHelp={() => showHelp('topSpeed', 'Top Surface Speed')} />
          <Num label="Bottom Surface Speed" unit="mm/s" value={print.bottomSpeed ?? print.topSpeed} min={1} max={500} onChange={(v) => upd({ bottomSpeed: v })} helpBrief={getSettingHelp('bottomSpeed')?.brief} onShowHelp={() => showHelp('bottomSpeed', 'Bottom Surface Speed')} />
          <Num label="Infill Speed" unit="mm/s" value={print.infillSpeed} min={1} max={500} onChange={(v) => upd({ infillSpeed: v })} helpBrief={getSettingHelp('infillSpeed')?.brief} onShowHelp={() => showHelp('infillSpeed', 'Infill Speed')} />
          <Num label="Support Speed" unit="mm/s" value={print.supportSpeed ?? 40} min={1} max={500} onChange={(v) => upd({ supportSpeed: v })} helpBrief={getSettingHelp('supportSpeed')?.brief} onShowHelp={() => showHelp('supportSpeed', 'Support Speed')} />
          <Num label="Support Infill Speed" unit="mm/s" value={print.supportInfillSpeed ?? (print.supportSpeed ?? 40)} min={1} max={500} onChange={(v) => upd({ supportInfillSpeed: v })} helpBrief={getSettingHelp('supportSpeed')?.brief} onShowHelp={() => showHelp('supportSpeed', 'Support Infill Speed')} />
          <Tier level="expert">
            <Num label="Support Interface Speed" unit="mm/s" value={print.supportInterfaceSpeed ?? (print.supportSpeed ?? 40)} min={1} max={500} onChange={(v) => upd({ supportInterfaceSpeed: v })} helpBrief={getSettingHelp('supportSpeed')?.brief} onShowHelp={() => showHelp('supportSpeed', 'Support Interface Speed')} />
            <Num label="Support Roof Speed" unit="mm/s" value={print.supportRoofSpeed ?? (print.supportInterfaceSpeed ?? print.supportSpeed ?? 40)} min={1} max={500} onChange={(v) => upd({ supportRoofSpeed: v })} helpBrief={getSettingHelp('supportSpeed')?.brief} onShowHelp={() => showHelp('supportSpeed', 'Support Roof Speed')} />
            <Num label="Support Floor Speed" unit="mm/s" value={print.supportFloorSpeed ?? (print.supportInterfaceSpeed ?? print.supportSpeed ?? 40)} min={1} max={500} onChange={(v) => upd({ supportFloorSpeed: v })} helpBrief={getSettingHelp('supportSpeed')?.brief} onShowHelp={() => showHelp('supportSpeed', 'Support Floor Speed')} />
          </Tier>
          <Num label="Number of Slower Layers" value={print.numberOfSlowerLayers ?? 0} min={0} max={30} onChange={(v) => upd({ numberOfSlowerLayers: v })} helpBrief={getSettingHelp('numberOfSlowerLayers')?.brief} onShowHelp={() => showHelp('numberOfSlowerLayers', 'Number of Slower Layers')} />
          <Num label="Initial Layer Travel Speed" unit="mm/s" value={print.initialLayerTravelSpeed ?? print.travelSpeed} min={1} max={500} onChange={(v) => upd({ initialLayerTravelSpeed: v })} helpBrief={getSettingHelp('initialLayerTravelSpeed')?.brief} onShowHelp={() => showHelp('initialLayerTravelSpeed', 'Initial Layer Travel Speed')} />
        </Tier>
        <Tier min="expert">
          <Num label="Small Area Speed" unit="mm/s" value={print.smallAreaSpeed ?? 20} min={1} max={200} onChange={(v) => upd({ smallAreaSpeed: v })} />
        </Tier>
      </SlicerSection>}

      {isVisible('travel') && <SlicerSection title="Travel" color="#22d3ee" defaultOpen={false}>
        <Tier min="advanced">
          <Sel label="Combing Mode" value={print.combingMode}
            onChange={(v) => upd({ combingMode: v })}
            options={[
              { value: 'all', label: 'All — avoid everything' },
              { value: 'noskin', label: 'No Skin — avoid skin only' },
              { value: 'infill', label: 'Infill Only' },
              { value: 'off', label: 'Off — shortest path' },
            ]}
            helpBrief={getSettingHelp('combingMode')?.brief}
            onShowHelp={() => showHelp('combingMode', 'Combing Mode')} />
          <Check label="Avoid Crossing Perimeters" value={print.avoidCrossingPerimeters} onChange={(v) => upd({ avoidCrossingPerimeters: v })} helpBrief={getSettingHelp('avoidCrossingPerimeters')?.brief} onShowHelp={() => showHelp('avoidCrossingPerimeters', 'Avoid Crossing Perimeters')} />
          <Num label="Min Travel Before Retract" unit="mm" value={print.retractionMinTravel ?? 1.5} step={0.1} min={0} max={20} onChange={(v) => upd({ retractionMinTravel: v })} helpBrief={getSettingHelp('retractionMinTravel')?.brief} onShowHelp={() => showHelp('retractionMinTravel', 'Min Travel Before Retract')} />
          <Check label="Retract at Layer Change" value={print.retractAtLayerChange ?? true} onChange={(v) => upd({ retractAtLayerChange: v })} helpBrief={getSettingHelp('retractAtLayerChange')?.brief} onShowHelp={() => showHelp('retractAtLayerChange', 'Retract at Layer Change')} />
          <Check label="Retract Before Outer Wall" value={print.travelRetractBeforeOuterWall ?? false} onChange={(v) => upd({ travelRetractBeforeOuterWall: v })} helpBrief={getSettingHelp('retractAtLayerChange')?.brief} onShowHelp={() => showHelp('retractAtLayerChange', 'Retract Before Outer Wall')} />
          <Check label="Combing Avoids Supports" value={print.combingAvoidsSupports ?? false} onChange={(v) => upd({ combingAvoidsSupports: v })} helpBrief={getSettingHelp('avoidSupports')?.brief} onShowHelp={() => showHelp('avoidSupports', 'Combing Avoids Supports')} />
        </Tier>
        <Tier min="expert">
          <SectionDivider label="Retraction Limits" />
          <Num label="Max Retraction Count" value={print.maxRetractionCount ?? 90} min={1} max={300} onChange={(v) => upd({ maxRetractionCount: v })} />
          <Num label="Extra Prime Amount" unit="mm³" value={print.retractionExtraPrimeAmount ?? 0} step={0.01} min={0} max={1} onChange={(v) => upd({ retractionExtraPrimeAmount: v })} />
          <SectionDivider label="Layer Start Position" />
          <Num label="Layer Start X" unit="mm" value={print.layerStartX ?? 0} step={1} min={-500} max={500} onChange={(v) => upd({ layerStartX: v })} />
          <Num label="Layer Start Y" unit="mm" value={print.layerStartY ?? 0} step={1} min={-500} max={500} onChange={(v) => upd({ layerStartY: v })} />
          <Check label="Layer Start at Z Seam" value={print.layerStartAtSeam ?? false} onChange={(v) => upd({ layerStartAtSeam: v })} />
          <Num label="Min Extrusion Distance Window" unit="mm" value={print.minimumExtrusionDistanceWindow ?? 0} step={0.5} min={0} max={50} onChange={(v) => upd({ minimumExtrusionDistanceWindow: v })} />
        </Tier>
        <Tier min="advanced">
          <AdvancedDivider label="Advanced · Avoidance" />
          <Check label="Avoid Printed Parts When Traveling" value={print.avoidPrintedParts ?? false} onChange={(v) => upd({ avoidPrintedParts: v })} helpBrief={getSettingHelp('avoidPrintedParts')?.brief} onShowHelp={() => showHelp('avoidPrintedParts', 'Avoid Printed Parts')} />
          <Check label="Avoid Supports When Traveling" value={print.avoidSupports ?? false} onChange={(v) => upd({ avoidSupports: v })} helpBrief={getSettingHelp('avoidSupports')?.brief} onShowHelp={() => showHelp('avoidSupports', 'Avoid Supports')} />
          <Num label="Max Comb Distance w/o Retract" unit="mm" value={print.maxCombDistanceNoRetract ?? 0} step={1} min={0} max={1000} onChange={(v) => upd({ maxCombDistanceNoRetract: v })} helpBrief={getSettingHelp('maxCombDistanceNoRetract')?.brief} onShowHelp={() => showHelp('maxCombDistanceNoRetract', 'Max Comb Distance')} />
          <Num label="Travel Avoid Distance" unit="mm" value={print.travelAvoidDistance ?? 0.625} step={0.05} min={0} max={10} onChange={(v) => upd({ travelAvoidDistance: v })} helpBrief={getSettingHelp('travelAvoidDistance')?.brief} onShowHelp={() => showHelp('travelAvoidDistance', 'Travel Avoid Distance')} />
          <Num label="Inside Travel Avoid Distance" unit="mm" value={print.insideTravelAvoidDistance ?? 0.4} step={0.05} min={0} max={10} onChange={(v) => upd({ insideTravelAvoidDistance: v })} helpBrief={getSettingHelp('insideTravelAvoidDistance')?.brief} onShowHelp={() => showHelp('insideTravelAvoidDistance', 'Inside Travel Avoid Distance')} />
          <AdvancedDivider label="Advanced · Z-Hop" />
          <Check label="Z-Hop When Retracted" value={print.zHopWhenRetracted ?? false} onChange={(v) => upd({ zHopWhenRetracted: v })} helpBrief={getSettingHelp('zHopWhenRetracted')?.brief} onShowHelp={() => showHelp('zHopWhenRetracted', 'Z-Hop When Retracted')} />
          {(print.zHopWhenRetracted ?? false) && (<>
            <Num label="Z-Hop Height" unit="mm" value={print.zHopHeight ?? 0.4} step={0.05} min={0.05} max={5} onChange={(v) => upd({ zHopHeight: v })} helpBrief={getSettingHelp('zHopHeight')?.brief} onShowHelp={() => showHelp('zHopHeight', 'Z-Hop Height')} />
            <Num label="Z-Hop Speed" unit="mm/s" value={print.zHopSpeed ?? 10} step={1} min={1} max={100} onChange={(v) => upd({ zHopSpeed: v })} helpBrief={getSettingHelp('zHopSpeed')?.brief} onShowHelp={() => showHelp('zHopSpeed', 'Z-Hop Speed')} />
            <Check label="Z-Hop Only Over Printed Parts" value={print.zHopOnlyOverPrinted ?? false} onChange={(v) => upd({ zHopOnlyOverPrinted: v })} helpBrief={getSettingHelp('avoidPrintedParts')?.brief} onShowHelp={() => showHelp('avoidPrintedParts', 'Z-Hop Only Over Printed Parts')} />
          </>)}
          <AdvancedDivider label="Advanced · Prime / Wipe" />
          <Num label="Retraction Extra Prime Amount" unit="mm³" value={print.retractionExtraPrimeAmount ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ retractionExtraPrimeAmount: v })} />
          <Num label="Wipe Retraction Distance" unit="mm" value={print.wipeRetractionDistance ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ wipeRetractionDistance: v })} />
          <Num label="Wipe Retraction Extra Prime" unit="mm³" value={print.wipeRetractionExtraPrime ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ wipeRetractionExtraPrime: v })} />
        </Tier>
      </SlicerSection>}

      {isVisible('cooling') && <SlicerSection title="Cooling" color="#60a5fa" defaultOpen={false}>
        <Num label="Min Layer Time" unit="s" value={print.minLayerTime} min={0} max={120} onChange={(v) => upd({ minLayerTime: v })} helpBrief={getSettingHelp('minLayerTime')?.brief} onShowHelp={() => showHelp('minLayerTime', 'Min Layer Time')} />
        <Tier min="advanced">
          <Num label="Full Fan Speed at Layer" value={print.fanFullLayer ?? 4} min={1} max={50} onChange={(v) => upd({ fanFullLayer: v })} helpBrief={getSettingHelp('fanFullLayer')?.brief} onShowHelp={() => showHelp('fanFullLayer', 'Full Fan Speed at Layer')} />
          <Num label="Min Print Speed" unit="mm/s" value={print.minPrintSpeed ?? 10} min={1} max={100} onChange={(v) => upd({ minPrintSpeed: v })} helpBrief={getSettingHelp('minPrintSpeed')?.brief} onShowHelp={() => showHelp('minPrintSpeed', 'Min Print Speed')} />
          <Check label="Lift Head on Min Layer Time" value={print.liftHeadEnabled ?? false} onChange={(v) => upd({ liftHeadEnabled: v })} helpBrief={getSettingHelp('liftHeadEnabled')?.brief} onShowHelp={() => showHelp('liftHeadEnabled', 'Lift Head on Min Layer Time')} />
          <Check label="Bridge Fan" value={print.enableBridgeFan} onChange={(v) => upd({ enableBridgeFan: v })} helpBrief={getSettingHelp('enableBridgeFan')?.brief} onShowHelp={() => showHelp('enableBridgeFan', 'Bridge Fan')} />
          {print.enableBridgeFan && (
            <Num
              label="Bridge Fan Speed"
              unit="%"
              value={print.bridgeFanSpeed}
              min={0}
              max={100}
              onChange={(v) => upd({ bridgeFanSpeed: v })}
              helpBrief={getSettingHelp('bridgeFanSpeed')?.brief}
              onShowHelp={() => showHelp('bridgeFanSpeed', 'Bridge Fan Speed')}
            />
          )}
          <SectionDivider label="Fan Ramp-up" />
          <Num label="Regular Fan Speed at Layer" value={print.regularFanSpeedLayer ?? 1} min={0} max={100} onChange={(v) => upd({ regularFanSpeedLayer: v })} helpBrief={getSettingHelp('regularFanSpeedLayer')?.brief} onShowHelp={() => showHelp('regularFanSpeedLayer', 'Regular Fan Speed at Layer')} />
          <Num label="Regular Fan Speed at Height" unit="mm" value={print.regularFanSpeedAtHeight ?? 0} step={0.5} min={0} max={500} onChange={(v) => upd({ regularFanSpeedAtHeight: v })} helpBrief={getSettingHelp('regularFanSpeedAtHeight')?.brief} onShowHelp={() => showHelp('regularFanSpeedAtHeight', 'Regular Fan Speed at Height')} />
          <Num label="Fan Kickstart Time" unit="ms" value={print.fanKickstartTime ?? 100} step={10} min={0} max={5000} onChange={(v) => upd({ fanKickstartTime: v })} helpBrief={getSettingHelp('fanKickstartTime')?.brief} onShowHelp={() => showHelp('fanKickstartTime', 'Fan Kickstart Time')} />
          <Num label="Small Layer Printing Temp" unit="°C" value={print.smallLayerPrintingTemperature ?? 0} step={1} min={0} max={400} onChange={(v) => upd({ smallLayerPrintingTemperature: v })} />
          <AdvancedDivider />
          <Num label="Initial Fan Speed" unit="%" value={print.initialFanSpeed ?? 0} step={1} min={0} max={100} onChange={(v) => upd({ initialFanSpeed: v })} helpBrief={getSettingHelp('initialFanSpeed')?.brief} onShowHelp={() => showHelp('initialFanSpeed', 'Initial Fan Speed')} />
          <Num label="Maximum Fan Speed" unit="%" value={print.maximumFanSpeed ?? 100} step={1} min={0} max={100} onChange={(v) => upd({ maximumFanSpeed: v })} helpBrief={getSettingHelp('maximumFanSpeed')?.brief} onShowHelp={() => showHelp('maximumFanSpeed', 'Maximum Fan Speed')} />
          <Num label="Regular/Max Fan Threshold" unit="s" value={print.regularMaxFanThreshold ?? 10} step={0.5} min={0} max={60} onChange={(v) => upd({ regularMaxFanThreshold: v })} />
          <Num label="Minimum Speed" unit="mm/s" value={print.minimumSpeed ?? 10} step={1} min={1} max={100} onChange={(v) => upd({ minimumSpeed: v })} />
          <Num label="Build Volume Fan Speed" unit="%" value={print.buildVolumeFanSpeed ?? 0} step={1} min={0} max={100} onChange={(v) => upd({ buildVolumeFanSpeed: v })} helpBrief={getSettingHelp('buildVolumeFanSpeed')?.brief} onShowHelp={() => showHelp('buildVolumeFanSpeed', 'Build Volume Fan Speed')} />
          <Tier min="expert">
            <Num label="Build Volume Fan Speed at Height" unit="mm" value={print.buildVolumeFanSpeedAtHeight ?? 0} step={0.5} min={0} max={500} onChange={(v) => upd({ buildVolumeFanSpeedAtHeight: v })} />
            <Num label="Initial Layers Build Volume Fan Speed" unit="%" value={print.initialLayersBuildVolumeFanSpeed ?? 0} step={1} min={0} max={100} onChange={(v) => upd({ initialLayersBuildVolumeFanSpeed: v })} />
          </Tier>
        </Tier>
      </SlicerSection>}

      {isVisible('support') && <SlicerSection title="Support" color="#facc15" defaultOpen={print.supportEnabled}>
        <Check label="Enable Support" value={print.supportEnabled} onChange={(v) => upd({ supportEnabled: v })} helpBrief={getSettingHelp('supportEnabled')?.brief} onShowHelp={() => showHelp('supportEnabled', 'Enable Support')} />
        {print.supportEnabled && (<>
          <Num
            label="Overhang Angle"
            unit="°"
            value={print.supportAngle}
            min={0}
            max={89}
            onChange={(v) => upd({ supportAngle: v })}
            helpBrief={getSettingHelp('supportAngle')?.brief}
            onShowHelp={() => showHelp('supportAngle', 'Support Angle')}
          />
          <Tier min="advanced">
            <Sel label="Support Structure" value={print.supportType}
              onChange={(v) => upd({ supportType: v })}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'tree', label: 'Tree' },
                { value: 'organic', label: 'Organic' },
              ]}
              helpBrief={getSettingHelp('supportType')?.brief}
              onShowHelp={() => showHelp('supportType', 'Support Structure')} />
            <Density value={print.supportDensity} onChange={(v) => upd({ supportDensity: v })} />
            {/* Support Density help */}
            <Sel label="Support Pattern" value={print.supportPattern}
              onChange={(v) => upd({ supportPattern: v })}
              options={[
                { value: 'lines', label: 'Lines' },
                { value: 'grid', label: 'Grid' },
                { value: 'zigzag', label: 'Zigzag' },
              ]}
              helpBrief={getSettingHelp('supportPattern')?.brief}
              onShowHelp={() => showHelp('supportPattern', 'Support Pattern')} />
            <SectionDivider label="Distances" />
            <Num label="Z Distance" unit="mm" value={print.supportZDistance} step={0.05} min={0} max={5} onChange={(v) => upd({ supportZDistance: v })} helpBrief={getSettingHelp('supportZDistance')?.brief} onShowHelp={() => showHelp('supportZDistance', 'Support Z Distance')} />
            <Tier level="expert"><Num label="Top Distance" unit="mm" value={print.supportTopDistance ?? print.supportZDistance} step={0.05} min={0} max={5} onChange={(v) => upd({ supportTopDistance: v })} /></Tier>
            <Num label="XY Distance" unit="mm" value={print.supportXYDistance} step={0.05} min={0} max={5} onChange={(v) => upd({ supportXYDistance: v })} helpBrief={getSettingHelp('supportXYDistance')?.brief} onShowHelp={() => showHelp('supportXYDistance', 'Support XY Distance')} />
            <SectionDivider label="Interface" />
            <Check label="Support Interface Layers" value={print.supportInterface} onChange={(v) => upd({ supportInterface: v })} helpBrief={getSettingHelp('supportInterface')?.brief} onShowHelp={() => showHelp('supportInterface', 'Support Interface')} />
            {print.supportInterface && (
              <Num label="Interface Layer Count" value={print.supportInterfaceLayers} min={1} max={10} onChange={(v) => upd({ supportInterfaceLayers: v })} />
            )}
          </Tier>
          <Tier min="expert">
            {(print.supportType === 'tree' || print.supportType === 'organic') && (<>
              <SectionDivider label="Tree Support" />
              <Num label="Branch Angle" unit="°" value={print.supportTreeAngle ?? 60} min={10} max={85} onChange={(v) => upd({ supportTreeAngle: v })} helpBrief={getSettingHelp('supportTreeAngle')?.brief} onShowHelp={() => showHelp('supportTreeAngle', 'Tree Branch Angle')} />
              <Num label="Branch Diameter" unit="mm" value={print.supportTreeBranchDiameter ?? 5} step={0.5} min={1} max={20} onChange={(v) => upd({ supportTreeBranchDiameter: v })} helpBrief={getSettingHelp('supportTreeBranchDiameter')?.brief} onShowHelp={() => showHelp('supportTreeBranchDiameter', 'Tree Branch Diameter')} />
              <Num label="Tip Diameter" unit="mm" value={print.supportTreeTipDiameter ?? 0.8} step={0.1} min={0.1} max={5} onChange={(v) => upd({ supportTreeTipDiameter: v })} />
              <Num label="Max Branch Diameter" unit="mm" value={print.supportTreeMaxBranchDiameter ?? 25} step={0.5} min={1} max={100} onChange={(v) => upd({ supportTreeMaxBranchDiameter: v })} />
              <Num label="Branch Diameter Angle" unit="°" value={print.supportTreeBranchDiameterAngle ?? 0} min={0} max={45} onChange={(v) => upd({ supportTreeBranchDiameterAngle: v })} />
              <Num label="Min Height" unit="mm" value={print.supportTreeMinHeight ?? 0} step={0.5} min={0} max={50} onChange={(v) => upd({ supportTreeMinHeight: v })} />
              <Check label="Build Plate Roots Only" value={print.supportTreeBuildplateOnly ?? false} onChange={(v) => upd({ supportTreeBuildplateOnly: v })} />
            </>)}
            <SectionDivider label="Placement" />
            <Check label="Build Plate Only" value={print.supportBuildplateOnly ?? false} onChange={(v) => upd({ supportBuildplateOnly: v })} helpBrief={getSettingHelp('supportBuildplateOnly')?.brief} onShowHelp={() => showHelp('supportBuildplateOnly', 'Build Plate Only')} />
            <Num label="Support Wall Count" value={print.supportWallCount ?? 0} min={0} max={5} onChange={(v) => upd({ supportWallCount: v })} />
            <Num label="Bottom Support Distance" unit="mm" value={print.supportBottomDistance ?? 0.2} step={0.05} min={0} max={5} onChange={(v) => upd({ supportBottomDistance: v })} />
            <Num label="Min Support XY Distance" unit="mm" value={print.minSupportXYDistance ?? 0} step={0.05} min={0} max={5} onChange={(v) => upd({ minSupportXYDistance: v })} />
            <Num label="Support Wall Count" value={print.supportWallLineCount ?? 0} min={0} max={5} onChange={(v) => upd({ supportWallLineCount: v })} />
            <Num label="Initial Layer Support Line Distance" unit="mm" value={print.initialLayerSupportLineDistance ?? 0} step={0.1} min={0} max={20} onChange={(v) => upd({ initialLayerSupportLineDistance: v })} />
            <Num label="Fan Speed Override" unit="%" value={print.supportFanSpeedOverride ?? 0} step={1} min={0} max={100} onChange={(v) => upd({ supportFanSpeedOverride: v })} />
            <SectionDivider label="Gradual Support" />
            <Num label="Gradual Support Steps" value={print.gradualSupportSteps ?? 0} min={0} max={10} onChange={(v) => upd({ gradualSupportSteps: v })} />
            {(print.gradualSupportSteps ?? 0) > 0 && (
              <Num label="Gradual Step Height" unit="mm" value={print.gradualSupportStepHeight ?? 1.0} step={0.1} min={0.1} max={10} onChange={(v) => upd({ gradualSupportStepHeight: v })} />
            )}
            <SectionDivider label="Roof / Floor" />
            <Check label="Support Roof" value={print.supportRoofEnable ?? false} onChange={(v) => upd({ supportRoofEnable: v })} />
            <Check label="Support Floor" value={print.supportFloorEnable ?? false} onChange={(v) => upd({ supportFloorEnable: v })} />
            {((print.supportRoofEnable ?? false) || (print.supportFloorEnable ?? false)) && (<>
              <Sel label="Interface Pattern" value={print.supportInterfacePattern ?? 'lines'}
                onChange={(v) => upd({ supportInterfacePattern: v })}
                options={[
                  { value: 'lines', label: 'Lines' },
                  { value: 'grid', label: 'Grid' },
                  { value: 'concentric', label: 'Concentric' },
                  { value: 'zigzag', label: 'Zigzag' },
                ]} />
              <Num label="Interface Density" unit="%" value={print.supportInterfaceDensity ?? 100} min={0} max={100} onChange={(v) => upd({ supportInterfaceDensity: v })} />
              <Num label="Roof Density" unit="%" value={print.supportRoofDensity ?? (print.supportInterfaceDensity ?? 100)} min={0} max={100} onChange={(v) => upd({ supportRoofDensity: v })} />
              <Num label="Floor Density" unit="%" value={print.supportFloorDensity ?? (print.supportInterfaceDensity ?? 100)} min={0} max={100} onChange={(v) => upd({ supportFloorDensity: v })} />
              <Num label="Roof Thickness" unit="mm" value={print.supportRoofThickness ?? 1.0} step={0.1} min={0} max={10} onChange={(v) => upd({ supportRoofThickness: v })} />
              <Num label="Floor Thickness" unit="mm" value={print.supportFloorThickness ?? 1.0} step={0.1} min={0} max={10} onChange={(v) => upd({ supportFloorThickness: v })} />
              <Sel label="Roof Pattern" value={print.supportRoofPattern ?? 'lines'}
                onChange={(v) => upd({ supportRoofPattern: v })}
                options={[
                  { value: 'lines',       label: 'Lines' },
                  { value: 'grid',        label: 'Grid' },
                  { value: 'concentric',  label: 'Concentric' },
                  { value: 'zigzag',      label: 'Zigzag' },
                ]} />
              <Sel label="Floor Pattern" value={print.supportFloorPattern ?? 'lines'}
                onChange={(v) => upd({ supportFloorPattern: v })}
                options={[
                  { value: 'lines',       label: 'Lines' },
                  { value: 'grid',        label: 'Grid' },
                  { value: 'concentric',  label: 'Concentric' },
                  { value: 'zigzag',      label: 'Zigzag' },
                ]} />
            </>)}
            <SectionDivider label="Towers" />
            <Check label="Use Towers" value={print.useTowers ?? false} onChange={(v) => upd({ useTowers: v })} />
            {(print.useTowers ?? false) && (<>
              <Num label="Tower Diameter" unit="mm" value={print.towerDiameter ?? 3.0} step={0.5} min={1} max={20} onChange={(v) => upd({ towerDiameter: v })} />
              <Num label="Tower Roof Angle" unit="°" value={print.towerRoofAngle ?? 65} min={0} max={89} onChange={(v) => upd({ towerRoofAngle: v })} />
            </>)}
          </Tier>
          <Tier min="advanced">
            <AdvancedDivider />
            <Num label="Support Horizontal Expansion" unit="mm" value={print.supportHorizontalExpansion ?? 0} step={0.1} min={-5} max={5} onChange={(v) => upd({ supportHorizontalExpansion: v })} helpBrief={getSettingHelp('supportHorizontalExpansion')?.brief} onShowHelp={() => showHelp('supportHorizontalExpansion', 'Support Horizontal Expansion')} />
            <Num label="Support Line Distance" unit="mm" value={print.supportLineDistance ?? 0} step={0.1} min={0} max={20} onChange={(v) => upd({ supportLineDistance: v })} />
            <Num label="Support Join Distance" unit="mm" value={print.supportJoinDistance ?? 2} step={0.1} min={0} max={20} onChange={(v) => upd({ supportJoinDistance: v })} helpBrief={getSettingHelp('supportJoinDistance')?.brief} onShowHelp={() => showHelp('supportJoinDistance', 'Support Join Distance')} />
            <Num label="Minimum Support Area" unit="mm²" value={print.minimumSupportArea ?? 0} step={0.5} min={0} max={100} onChange={(v) => upd({ minimumSupportArea: v })} helpBrief={getSettingHelp('minimumSupportArea')?.brief} onShowHelp={() => showHelp('minimumSupportArea', 'Minimum Support Area')} />
            <Num label="Support Infill Layer Thickness" unit="mm" value={print.supportInfillLayerThickness ?? 0} step={0.05} min={0} max={2} onChange={(v) => upd({ supportInfillLayerThickness: v })} />
            <SectionDivider label="Connect / Chain" />
            <Check label="Connect Support Lines" value={print.connectSupportLines ?? false} onChange={(v) => upd({ connectSupportLines: v })} />
            <Check label="Connect Support ZigZags" value={print.connectSupportZigZags ?? false} onChange={(v) => upd({ connectSupportZigZags: v })} />
            <SectionDivider label="Conical Support" />
            <Check label="Enable Conical Support" value={print.enableConicalSupport ?? false} onChange={(v) => upd({ enableConicalSupport: v })} />
            {(print.enableConicalSupport ?? false) && (
              <Num label="Conical Support Angle" unit="°" value={print.conicalSupportAngle ?? 30} min={0} max={60} onChange={(v) => upd({ conicalSupportAngle: v })} />
            )}
            <SectionDivider label="Support Brim" />
            <Check label="Enable Support Brim" value={print.enableSupportBrim ?? false} onChange={(v) => upd({ enableSupportBrim: v })} />
            {(print.enableSupportBrim ?? false) && (<>
              <Num label="Support Brim Line Count" value={print.supportBrimLineCount ?? 5} min={0} max={50} onChange={(v) => upd({ supportBrimLineCount: v })} />
              <Num label="Support Brim Width" unit="mm" value={print.supportBrimWidth ?? 3} step={0.1} min={0} max={50} onChange={(v) => upd({ supportBrimWidth: v })} />
            </>)}
            <SectionDivider label="Stair Step Base" />
            <Num label="Stair Step Height" unit="mm" value={print.supportStairStepHeight ?? 0.3} step={0.05} min={0} max={10} onChange={(v) => upd({ supportStairStepHeight: v })} />
            <Num label="Stair Step Minimum Slope" unit="°" value={print.supportStairStepMinSlope ?? 10} min={0} max={89} onChange={(v) => upd({ supportStairStepMinSlope: v })} />
            <Num label="Stair Step Max Width" unit="mm" value={print.supportStairStepMaxWidth ?? 5} step={0.1} min={0} max={50} onChange={(v) => upd({ supportStairStepMaxWidth: v })} />
            <SectionDivider label="Distance Priority" />
            <Sel label="Support Distance Priority" value={print.supportDistancePriority ?? 'xy_overrides_z'}
              onChange={(v) => upd({ supportDistancePriority: v })}
              options={[
                { value: 'xy_overrides_z', label: 'XY overrides Z' },
                { value: 'z_overrides_xy', label: 'Z overrides XY' },
              ]} />
            <SectionDivider label="Break Up Chunks" />
            <Check label="Break Up Support in Chunks" value={print.breakUpSupportInChunks ?? false} onChange={(v) => upd({ breakUpSupportInChunks: v })} />
            {(print.breakUpSupportInChunks ?? false) && (<>
              <Num label="Chunk Size" unit="mm" value={print.breakUpSupportChunkSize ?? 20} step={1} min={1} max={100} onChange={(v) => upd({ breakUpSupportChunkSize: v })} />
              <Num label="Chunk Line Count" value={print.breakUpSupportChunkLineCount ?? 5} min={1} max={50} onChange={(v) => upd({ breakUpSupportChunkLineCount: v })} />
            </>)}
            <SectionDivider label="Conical Min Width" />
            <Num label="Conical Support Min Width" unit="mm" value={print.conicalSupportMinWidth ?? 5} step={0.5} min={0} max={50} onChange={(v) => upd({ conicalSupportMinWidth: v })} />
          </Tier>
        </>)}
      </SlicerSection>}

      {isVisible('adhesion') && <SlicerSection title="Build Plate Adhesion" color="#4ade80" defaultOpen={false}>
        <Sel label="Type" value={print.adhesionType}
          onChange={(v) => upd({ adhesionType: v })}
          options={[
            { value: 'none', label: 'None' },
            { value: 'skirt', label: 'Skirt' },
            { value: 'brim', label: 'Brim' },
            { value: 'raft', label: 'Raft' },
          ]}
          helpBrief={getSettingHelp('adhesionType')?.brief}
          onShowHelp={() => showHelp('adhesionType', 'Adhesion Type')} />
        <Tier min="expert">
          <SectionDivider label="Prime Blob" />
          <Check label="Enable Prime Blob" value={print.primeBlobEnable ?? false} onChange={(v) => upd({ primeBlobEnable: v })} />
          {(print.primeBlobEnable ?? false) && (
            <Num label="Prime Blob Size" unit="mm³" value={print.primeBlobSize ?? 0.5} step={0.1} min={0.1} max={10} onChange={(v) => upd({ primeBlobSize: v })} />
          )}
        </Tier>
        <Tier min="advanced">
          {print.adhesionType === 'skirt' && (<>
            <Num label="Skirt Lines" value={print.skirtLines} min={1} max={20} onChange={(v) => upd({ skirtLines: v })} helpBrief={getSettingHelp('skirtLines')?.brief} onShowHelp={() => showHelp('skirtLines', 'Skirt Lines')} />
            <Num label="Skirt Distance" unit="mm" value={print.skirtDistance} step={0.5} min={0} max={20} onChange={(v) => upd({ skirtDistance: v })} helpBrief={getSettingHelp('skirtDistance')?.brief} onShowHelp={() => showHelp('skirtDistance', 'Skirt Distance')} />
            <Num label="Skirt Height (layers)" value={print.skirtHeight ?? 1} min={1} max={10} onChange={(v) => upd({ skirtHeight: v })} />
            <Num label="Skirt Minimum Length" unit="mm" value={print.skirtBrimMinLength ?? 0} step={10} min={0} max={5000} onChange={(v) => upd({ skirtBrimMinLength: v })} />
          </>)}
          {print.adhesionType === 'brim' && (<>
            <Num label="Brim Width" unit="mm" value={print.brimWidth} step={0.5} min={0} max={50} onChange={(v) => upd({ brimWidth: v })} helpBrief={getSettingHelp('brimWidth')?.brief} onShowHelp={() => showHelp('brimWidth', 'Brim Width')} />
            <Num label="Brim Gap" unit="mm" value={print.brimGap ?? 0} step={0.1} min={0} max={5} onChange={(v) => upd({ brimGap: v })} />
            <Sel label="Brim Location" value={print.brimLocation ?? 'outside'}
              onChange={(v) => upd({ brimLocation: v })}
              options={[
                { value: 'outside', label: 'Outside' },
                { value: 'inside', label: 'Inside' },
                { value: 'everywhere', label: 'Everywhere' },
              ]} />
            <Num label="Brim Avoid Margin" unit="mm" value={print.brimAvoidMargin ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ brimAvoidMargin: v })} />
            <Check label="Smart Brim" value={print.smartBrim ?? false} onChange={(v) => upd({ smartBrim: v })} />
          </>)}
          {print.adhesionType === 'raft' && (<>
            <Num label="Raft Layers" value={print.raftLayers} min={1} max={10} onChange={(v) => upd({ raftLayers: v })} helpBrief={getSettingHelp('raftLayers')?.brief} onShowHelp={() => showHelp('raftLayers', 'Raft Layers')} />
            <Num label="Raft Margin" unit="mm" value={print.raftMargin ?? 5} step={0.5} min={0} max={30} onChange={(v) => upd({ raftMargin: v })} helpBrief={getSettingHelp('raftMargin')?.brief} onShowHelp={() => showHelp('raftMargin', 'Raft Margin')} />
          </>)}
        </Tier>
        <Tier min="expert">
          <SectionDivider label="First Layer" />
          <Num label="Initial Layer Z Overlap" unit="mm" value={print.initialLayerZOverlap ?? 0} step={0.01} min={0} max={0.5} onChange={(v) => upd({ initialLayerZOverlap: v })} />
          {print.adhesionType === 'raft' && (<>
            <SectionDivider label="Raft Layers (Advanced)" />
            <Num label="Base Thickness" unit="mm" value={print.raftBaseThickness ?? 0.3} step={0.05} min={0.1} max={2} onChange={(v) => upd({ raftBaseThickness: v })} />
            <Num label="Base Line Width" unit="mm" value={print.raftBaseLineWidth ?? 0.8} step={0.05} min={0.1} max={3} onChange={(v) => upd({ raftBaseLineWidth: v })} />
            <Num label="Base Speed" unit="mm/s" value={print.raftBaseSpeed ?? 20} min={1} max={200} onChange={(v) => upd({ raftBaseSpeed: v })} />
            <Num label="Interface Thickness" unit="mm" value={print.raftInterfaceThickness ?? 0.27} step={0.05} min={0.1} max={2} onChange={(v) => upd({ raftInterfaceThickness: v })} />
            <Num label="Surface Air Gap" unit="mm" value={print.raftAirGap ?? 0.3} step={0.05} min={0} max={2} onChange={(v) => upd({ raftAirGap: v })} />
          </>)}
        </Tier>
        {print.adhesionType === 'raft' && (
          <Tier min="advanced">
            <AdvancedDivider label="Advanced · Raft" />
            <Num label="Raft Wall Count" value={print.raftWallCount ?? 0} min={0} max={10} onChange={(v) => upd({ raftWallCount: v })} />
            <Num label="Raft Smoothing" unit="mm" value={print.raftSmoothing ?? 5} step={0.5} min={0} max={50} onChange={(v) => upd({ raftSmoothing: v })} />
            <Num label="Raft Extra Margin" unit="mm" value={print.raftExtraMargin ?? 15} step={0.5} min={0} max={50} onChange={(v) => upd({ raftExtraMargin: v })} />
            <SectionDivider label="Middle Layers" />
            <Num label="Middle Layer Count" value={print.raftMiddleLayers ?? 2} min={0} max={20} onChange={(v) => upd({ raftMiddleLayers: v })} />
            <Num label="Middle Layer Thickness" unit="mm" value={print.raftMiddleThickness ?? 0.15} step={0.01} min={0.05} max={2} onChange={(v) => upd({ raftMiddleThickness: v })} />
            <Num label="Middle Layer Line Width" unit="mm" value={print.raftMiddleLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ raftMiddleLineWidth: v })} />
            <SectionDivider label="Top Layers" />
            <Num label="Top Layer Count" value={print.raftTopLayers ?? 2} min={0} max={20} onChange={(v) => upd({ raftTopLayers: v })} />
            <Num label="Top Layer Thickness" unit="mm" value={print.raftTopThickness ?? 0.1} step={0.01} min={0.05} max={1} onChange={(v) => upd({ raftTopThickness: v })} />
            <Num label="Top Line Width" unit="mm" value={print.raftTopLineWidth ?? 0.4} step={0.01} min={0.1} max={2} onChange={(v) => upd({ raftTopLineWidth: v })} />
            <Num label="Top Line Spacing" unit="mm" value={print.raftTopLineSpacing ?? 0.4} step={0.05} min={0.1} max={5} onChange={(v) => upd({ raftTopLineSpacing: v })} />
            <Num label="Top Surface Z Offset" unit="mm" value={print.raftTopSurfaceZOffset ?? 0} step={0.01} min={-1} max={1} onChange={(v) => upd({ raftTopSurfaceZOffset: v })} />
            <SectionDivider label="Base" />
            <Num label="Base Line Spacing" unit="mm" value={print.raftBaseLineSpacing ?? 1.6} step={0.1} min={0.1} max={10} onChange={(v) => upd({ raftBaseLineSpacing: v })} />
            <Num label="Base Infill Overlap" unit="%" value={print.raftBaseInfillOverlap ?? 0} step={1} min={0} max={100} onChange={(v) => upd({ raftBaseInfillOverlap: v })} />
            <SectionDivider label="Middle" />
            <Num label="Middle Line Spacing" unit="mm" value={print.raftMiddleLineSpacing ?? 0.8} step={0.05} min={0.1} max={5} onChange={(v) => upd({ raftMiddleLineSpacing: v })} />
            <Num label="Interface Z Offset" unit="mm" value={print.raftInterfaceZOffset ?? 0} step={0.01} min={-1} max={1} onChange={(v) => upd({ raftInterfaceZOffset: v })} />
            <SectionDivider label="Print Settings" />
            <Num label="Raft Print Acceleration" unit="mm/s²" value={print.raftPrintAcceleration ?? 0} step={100} min={0} max={10000} onChange={(v) => upd({ raftPrintAcceleration: v })} />
            <Num label="Raft Print Jerk" unit="mm/s" value={print.raftPrintJerk ?? 0} step={0.5} min={0} max={30} onChange={(v) => upd({ raftPrintJerk: v })} />
            <Num label="Raft Fan Speed" unit="%" value={print.raftFanSpeed ?? 0} step={1} min={0} max={100} onChange={(v) => upd({ raftFanSpeed: v })} />
            <Num label="Raft Flow" unit="%" value={print.raftFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ raftFlow: v })} />
            <Check label="Monotonic Raft Top Surface" value={print.monotonicRaftTopSurface ?? false} onChange={(v) => upd({ monotonicRaftTopSurface: v })} />
            <Check label="Remove Raft Inside Corners" value={print.removeRaftInsideCorners ?? false} onChange={(v) => upd({ removeRaftInsideCorners: v })} />
          </Tier>
        )}
      </SlicerSection>}

      {isVisible('specialModes') && <SlicerSection title="Special Modes" color="#e879f9" defaultOpen={false}>
        <Check label="Relative Extrusion (M83)" value={print.relativeExtrusion ?? false} onChange={(v) => upd({ relativeExtrusion: v })} helpBrief={getSettingHelp('relativeExtrusion')?.brief} onShowHelp={() => showHelp('relativeExtrusion', 'Relative Extrusion')} />
        <Check label="Vase Mode (Spiralize Contour)" value={print.spiralizeContour ?? false} onChange={(v) => upd({ spiralizeContour: v })} helpBrief={getSettingHelp('spiralizeContour')?.brief} onShowHelp={() => showHelp('spiralizeContour', 'Vase Mode')} />
        {(print.spiralizeContour ?? false) && (
          <Tier level="expert"><Check label="Smooth Spiralized Contours" value={print.smoothSpiralizedContours ?? false} onChange={(v) => upd({ smoothSpiralizedContours: v })} /></Tier>
        )}
        <Sel label="Surface Mode" value={print.surfaceMode ?? 'normal'}
          onChange={(v) => upd({ surfaceMode: v })}
          options={[
            { value: 'normal', label: 'Normal — solid model' },
            { value: 'surface', label: 'Surface — shell only' },
            { value: 'both', label: 'Both — normal + surface' },
          ]}
          helpBrief={getSettingHelp('surfaceMode')?.brief}
          onShowHelp={() => showHelp('surfaceMode', 'Surface Mode')} />
        <Sel label="Print Sequence" value={print.printSequence ?? 'all_at_once'}
          onChange={(v) => upd({ printSequence: v })}
          options={[
            { value: 'all_at_once', label: 'All at Once' },
            { value: 'one_at_a_time', label: 'One at a Time' },
          ]}
          helpBrief={getSettingHelp('printSequence')?.brief}
          onShowHelp={() => showHelp('printSequence', 'Print Sequence')} />
        <SectionDivider label="Mold" />
        <Check label="Enable Mold Mode" value={print.moldEnabled ?? false} onChange={(v) => upd({ moldEnabled: v })} helpBrief={getSettingHelp('moldEnabled')?.brief} onShowHelp={() => showHelp('moldEnabled', 'Enable Mold Mode')} />
        {(print.moldEnabled ?? false) && (<>
          <Num label="Mold Draft Angle" unit="°" value={print.moldAngle ?? 40} min={0} max={89} onChange={(v) => upd({ moldAngle: v })} />
          <Num label="Mold Roof Height" unit="mm" value={print.moldRoofHeight ?? 0.5} step={0.1} min={0} max={10} onChange={(v) => upd({ moldRoofHeight: v })} />
          <Num label="Min Mold Width" unit="mm" value={print.minMoldWidth ?? 5} step={0.5} min={0} max={50} onChange={(v) => upd({ minMoldWidth: v })} />
        </>)}
      </SlicerSection>}

      {isVisible('experimental') && <SlicerSection title="Experimental" color="#94a3b8" defaultOpen={false}>
        <Check label="Draft Shield" value={print.draftShieldEnabled ?? false} onChange={(v) => upd({ draftShieldEnabled: v })} helpBrief={getSettingHelp('draftShieldEnabled')?.brief} onShowHelp={() => showHelp('draftShieldEnabled', 'Draft Shield')} />
        {print.draftShieldEnabled && (<>
          <Num label="Draft Shield Distance" unit="mm" value={print.draftShieldDistance ?? 10} step={1} min={1} max={50} onChange={(v) => upd({ draftShieldDistance: v })} />
          <Sel label="Shield Limitation" value={print.draftShieldLimitation ?? 'full'}
            onChange={(v) => upd({ draftShieldLimitation: v })}
            options={[
              { value: 'full',    label: 'Full — all layers' },
              { value: 'limited', label: 'Limited — up to height' },
            ]} />
          {print.draftShieldLimitation === 'limited' && (
            <Num label="Shield Height" unit="mm" value={print.draftShieldHeight ?? 10} step={1} min={1} max={1000} onChange={(v) => upd({ draftShieldHeight: v })} />
          )}
        </>)}
        <Check label="Coasting" value={print.coastingEnabled ?? false} onChange={(v) => upd({ coastingEnabled: v })} helpBrief={getSettingHelp('coastingEnabled')?.brief} onShowHelp={() => showHelp('coastingEnabled', 'Coasting')} />
        {print.coastingEnabled && (<>
          <Num label="Coasting Volume" unit="mm³" value={print.coastingVolume ?? 0.064} step={0.001} min={0} max={1} onChange={(v) => upd({ coastingVolume: v })} />
          <Num label="Min Volume Before Coasting" unit="mm³" value={print.minVolumeBeforeCoasting ?? 0} step={0.01} min={0} max={10} onChange={(v) => upd({ minVolumeBeforeCoasting: v })} />
        </>)}
        <SectionDivider label="Fuzzy Skin" />
        <Check label="Enable Fuzzy Skin" value={print.fuzzySkinsEnabled ?? false} onChange={(v) => upd({ fuzzySkinsEnabled: v })} helpBrief={getSettingHelp('fuzzySkinsEnabled')?.brief} onShowHelp={() => showHelp('fuzzySkinsEnabled', 'Enable Fuzzy Skin')} />
        {(print.fuzzySkinsEnabled ?? false) && (<>
          <Num label="Fuzzy Thickness" unit="mm" value={print.fuzzySkinThickness ?? 0.3} step={0.05} min={0.01} max={2} onChange={(v) => upd({ fuzzySkinThickness: v })} />
          <Num label="Fuzzy Point Distance" unit="mm" value={print.fuzzySkinPointDist ?? 0.8} step={0.05} min={0.1} max={5} onChange={(v) => upd({ fuzzySkinPointDist: v })} />
          <Tier level="expert"><Check label="Outside Only" value={print.fuzzySkinOutsideOnly ?? false} onChange={(v) => upd({ fuzzySkinOutsideOnly: v })} /></Tier>
        </>)}
        <SectionDivider label="Overhang" />
        <Check label="Make Overhang Printable" value={print.makeOverhangPrintable ?? false} onChange={(v) => upd({ makeOverhangPrintable: v })} helpBrief={getSettingHelp('makeOverhangPrintable')?.brief} onShowHelp={() => showHelp('makeOverhangPrintable', 'Make Overhang Printable')} />
        {(print.makeOverhangPrintable ?? false) && (
          <Num label="Max Overhang Angle" unit="°" value={print.makeOverhangPrintableMaxAngle ?? 50} min={0} max={89} onChange={(v) => upd({ makeOverhangPrintableMaxAngle: v })} />
        )}
        <SectionDivider label="Slicing" />
        <Sel label="Slicing Tolerance" value={print.slicingTolerance ?? 'middle'}
          onChange={(v) => upd({ slicingTolerance: v })}
          options={[
            { value: 'middle', label: 'Middle — balanced' },
            { value: 'inclusive', label: 'Inclusive — thicker' },
            { value: 'exclusive', label: 'Exclusive — thinner' },
          ]}
          helpBrief={getSettingHelp('slicingTolerance')?.brief}
          onShowHelp={() => showHelp('slicingTolerance', 'Slicing Tolerance')} />
        <Num label="Min Polygon Circumference" unit="mm" value={print.minimumPolygonCircumference ?? 1.0} step={0.1} min={0.1} max={10} onChange={(v) => upd({ minimumPolygonCircumference: v })} />
        <Num label="Small Hole Max Size" unit="mm" value={print.smallHoleMaxSize ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ smallHoleMaxSize: v })} />
        <Tier min="advanced">
          <AdvancedDivider label="Advanced · Fluid Motion" />
          <Check label="Enable Fluid Motion" value={print.fluidMotionEnable ?? false} onChange={(v) => upd({ fluidMotionEnable: v })} helpBrief={getSettingHelp('fluidMotionEnable')?.brief} onShowHelp={() => showHelp('fluidMotionEnable', 'Enable Fluid Motion')} />
          {(print.fluidMotionEnable ?? false) && (<>
            <Num label="Fluid Motion Angle" unit="°" value={print.fluidMotionAngle ?? 15} min={0} max={89} onChange={(v) => upd({ fluidMotionAngle: v })} />
            <Num label="Fluid Motion Small Distance" unit="mm" value={print.fluidMotionSmallDistance ?? 0.01} step={0.005} min={0.001} max={1} onChange={(v) => upd({ fluidMotionSmallDistance: v })} />
          </>)}
          <AdvancedDivider label="Advanced · Flow Compensation" />
          <Num label="Flow Rate Compensation Factor" value={print.flowRateCompensationFactor ?? 1.0} step={0.01} min={0.1} max={3.0} onChange={(v) => upd({ flowRateCompensationFactor: v })} />
          <AdvancedDivider label="Advanced · Coasting" />
          <Num label="Coasting Speed" unit="%" value={print.coastingSpeed ?? 90} step={1} min={10} max={100} onChange={(v) => upd({ coastingSpeed: v })} />
          <AdvancedDivider label="Advanced · Scarf Seam" />
          <Num label="Scarf Seam Length" unit="mm" value={print.scarfSeamLength ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ scarfSeamLength: v })} helpBrief={getSettingHelp('scarfSeamLength')?.brief} onShowHelp={() => showHelp('scarfSeamLength', 'Scarf Seam Length')} />
          <Num label="Scarf Seam Step Length" unit="mm" value={print.scarfSeamStepLength ?? 0.5} step={0.05} min={0.05} max={5} onChange={(v) => upd({ scarfSeamStepLength: v })} />
          <Num label="Scarf Seam Start Height" unit="mm" value={print.scarfSeamStartHeight ?? 0} step={0.05} min={0} max={10} onChange={(v) => upd({ scarfSeamStartHeight: v })} />
          <Num label="Scarf Seam Start Speed Ratio" value={print.scarfSeamStartSpeedRatio ?? 1.0} step={0.05} min={0.1} max={1.0} onChange={(v) => upd({ scarfSeamStartSpeedRatio: v })} />
          <AdvancedDivider label="Advanced · Ooze Shield" />
          <Check label="Enable Ooze Shield" value={print.enableOozeShield ?? false} onChange={(v) => upd({ enableOozeShield: v })} helpBrief={getSettingHelp('enableOozeShield')?.brief} onShowHelp={() => showHelp('enableOozeShield', 'Enable Ooze Shield')} />
          {(print.enableOozeShield ?? false) && (<>
            <Num label="Ooze Shield Angle" unit="°" value={print.oozeShieldAngle ?? 60} min={0} max={89} onChange={(v) => upd({ oozeShieldAngle: v })} />
            <Num label="Ooze Shield Distance" unit="mm" value={print.oozeShieldDistance ?? 2} step={0.1} min={0} max={20} onChange={(v) => upd({ oozeShieldDistance: v })} />
          </>)}
          <AdvancedDivider label="Advanced · Cooling Extras" />
          <Num label="Min Layer Time With Overhang" unit="s" value={print.minLayerTimeWithOverhang ?? 0} step={0.5} min={0} max={30} onChange={(v) => upd({ minLayerTimeWithOverhang: v })} />
          <AdvancedDivider label="Advanced · Travel Extras" />
          <Check label="Keep Retracting During Travel" value={print.keepRetractingDuringTravel ?? false} onChange={(v) => upd({ keepRetractingDuringTravel: v })} />
          <Check label="Prime During Travel" value={print.primeDuringTravel ?? false} onChange={(v) => upd({ primeDuringTravel: v })} />
          <Check label="Infill Travel Optimization" value={print.infillTravelOptimization ?? false} onChange={(v) => upd({ infillTravelOptimization: v })} />
        </Tier>
      </SlicerSection>}

      {isVisible('acceleration') && <SlicerSection title="Acceleration & Jerk" color="#fb7185" defaultOpen={false}>
        <Tier level="expert">
          <Check label="Enable Travel Acceleration" value={print.travelAccelerationEnabled ?? false} onChange={(v) => upd({ travelAccelerationEnabled: v })} firmwareUnsupported={checkFirmware('travelAccelerationEnabled')} />
          <Check label="Enable Travel Jerk" value={print.travelJerkEnabled ?? false} onChange={(v) => upd({ travelJerkEnabled: v })} firmwareUnsupported={checkFirmware('travelJerkEnabled')} />
        </Tier>
        <Check label="Enable Acceleration Control" value={print.accelerationEnabled ?? false} onChange={(v) => upd({ accelerationEnabled: v })} machineSourced={ms.has('accelerationEnabled')} helpBrief={getSettingHelp('accelerationEnabled')?.brief} onShowHelp={() => showHelp('accelerationEnabled', 'Enable Acceleration Control')} />
        {(print.accelerationEnabled ?? false) && (<>
          <SectionDivider label="Acceleration (mm/s²)" />
          <Num label="Print" unit="mm/s²" value={print.accelerationPrint ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationPrint: v })} machineSourced={ms.has('accelerationPrint')} helpBrief={getSettingHelp('accelerationPrint')?.brief} onShowHelp={() => showHelp('accelerationPrint', 'Print Acceleration')} />
          <Num label="Travel" unit="mm/s²" value={print.accelerationTravel ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationTravel: v })} machineSourced={ms.has('accelerationTravel')} firmwareUnsupported={checkFirmware('accelerationTravel')} helpBrief={getSettingHelp('accelerationTravel')?.brief} onShowHelp={() => showHelp('accelerationTravel', 'Travel Acceleration')} />
          <Num label="Outer Wall" unit="mm/s²" value={print.accelerationWall ?? 1000} min={100} max={20000} onChange={(v) => upd({ accelerationWall: v })} machineSourced={ms.has('accelerationWall')} helpBrief={getSettingHelp('accelerationWall')?.brief} onShowHelp={() => showHelp('accelerationWall', 'Wall Acceleration')} />
          <Tier level="expert">
            <Num label="Outer Wall (separate)" unit="mm/s²" value={print.accelerationOuterWall ?? (print.accelerationWall ?? 1000)} min={100} max={20000} onChange={(v) => upd({ accelerationOuterWall: v })} />
            <Num label="Inner Wall" unit="mm/s²" value={print.accelerationInnerWall ?? (print.accelerationWall ?? 1000)} min={100} max={20000} onChange={(v) => upd({ accelerationInnerWall: v })} />
            <Num label="Skirt/Brim" unit="mm/s²" value={print.accelerationSkirtBrim ?? (print.accelerationPrint ?? 3000)} min={100} max={20000} onChange={(v) => upd({ accelerationSkirtBrim: v })} />
            <Num label="Initial Layer" unit="mm/s²" value={print.accelerationInitialLayer ?? (print.accelerationPrint ?? 3000)} min={100} max={20000} onChange={(v) => upd({ accelerationInitialLayer: v })} />
          </Tier>
          <Num label="Infill" unit="mm/s²" value={print.accelerationInfill ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationInfill: v })} machineSourced={ms.has('accelerationInfill')} helpBrief={getSettingHelp('accelerationInfill')?.brief} onShowHelp={() => showHelp('accelerationInfill', 'Infill Acceleration')} />
          <Num label="Top/Bottom" unit="mm/s²" value={print.accelerationTopBottom ?? 1000} min={100} max={20000} onChange={(v) => upd({ accelerationTopBottom: v })} machineSourced={ms.has('accelerationTopBottom')} helpBrief={getSettingHelp('accelerationTopBottom')?.brief} onShowHelp={() => showHelp('accelerationTopBottom', 'Top/Bottom Acceleration')} />
          <Num label="Support" unit="mm/s²" value={print.accelerationSupport ?? 2000} min={100} max={20000} onChange={(v) => upd({ accelerationSupport: v })} machineSourced={ms.has('accelerationSupport')} helpBrief={getSettingHelp('accelerationSupport')?.brief} onShowHelp={() => showHelp('accelerationSupport', 'Support Acceleration')} />
        </>)}
        <Check label="Enable Jerk Control" value={print.jerkEnabled ?? false} onChange={(v) => upd({ jerkEnabled: v })} machineSourced={ms.has('jerkEnabled')} helpBrief={getSettingHelp('jerkEnabled')?.brief} onShowHelp={() => showHelp('jerkEnabled', 'Enable Jerk Control')} />
        {(print.jerkEnabled ?? false) && (<>
          <SectionDivider label="Jerk (mm/s)" />
          <Num label="Print Jerk" unit="mm/s" value={print.jerkPrint ?? 10} min={1} max={30} onChange={(v) => upd({ jerkPrint: v })} machineSourced={ms.has('jerkPrint')} helpBrief={getSettingHelp('jerkPrint')?.brief} onShowHelp={() => showHelp('jerkPrint', 'Print Jerk')} />
          <Num label="Travel Jerk" unit="mm/s" value={print.jerkTravel ?? 10} min={1} max={30} onChange={(v) => upd({ jerkTravel: v })} machineSourced={ms.has('jerkTravel')} firmwareUnsupported={checkFirmware('jerkTravel')} helpBrief={getSettingHelp('jerkTravel')?.brief} onShowHelp={() => showHelp('jerkTravel', 'Travel Jerk')} />
          <Num label="Wall Jerk" unit="mm/s" value={print.jerkWall ?? 8} min={1} max={30} onChange={(v) => upd({ jerkWall: v })} machineSourced={ms.has('jerkWall')} helpBrief={getSettingHelp('jerkWall')?.brief} onShowHelp={() => showHelp('jerkWall', 'Wall Jerk')} />
          <Tier level="expert">
            <Num label="Outer Wall Jerk" unit="mm/s" value={print.jerkOuterWall ?? (print.jerkWall ?? 8)} min={1} max={30} onChange={(v) => upd({ jerkOuterWall: v })} />
            <Num label="Inner Wall Jerk" unit="mm/s" value={print.jerkInnerWall ?? (print.jerkWall ?? 8)} min={1} max={30} onChange={(v) => upd({ jerkInnerWall: v })} />
            <Num label="Support Jerk" unit="mm/s" value={print.jerkSupport ?? (print.jerkPrint ?? 10)} min={1} max={30} onChange={(v) => upd({ jerkSupport: v })} />
            <Num label="Skirt/Brim Jerk" unit="mm/s" value={print.jerkSkirtBrim ?? (print.jerkPrint ?? 10)} min={1} max={30} onChange={(v) => upd({ jerkSkirtBrim: v })} />
            <Num label="Initial Layer Jerk" unit="mm/s" value={print.jerkInitialLayer ?? (print.jerkPrint ?? 10)} min={1} max={30} onChange={(v) => upd({ jerkInitialLayer: v })} />
          </Tier>
          <Num label="Infill Jerk" unit="mm/s" value={print.jerkInfill ?? 10} min={1} max={30} onChange={(v) => upd({ jerkInfill: v })} machineSourced={ms.has('jerkInfill')} helpBrief={getSettingHelp('jerkInfill')?.brief} onShowHelp={() => showHelp('jerkInfill', 'Infill Jerk')} />
          <Num label="Top/Bottom Jerk" unit="mm/s" value={print.jerkTopBottom ?? 8} min={1} max={30} onChange={(v) => upd({ jerkTopBottom: v })} machineSourced={ms.has('jerkTopBottom')} helpBrief={getSettingHelp('jerkTopBottom')?.brief} onShowHelp={() => showHelp('jerkTopBottom', 'Top/Bottom Jerk')} />
        </>)}
      </SlicerSection>}

      {isVisible('meshFixes') && <SlicerSection title="Mesh Fixes" color="#34d399" defaultOpen={false}>
        <Check label="Union Overlapping Volumes" value={print.unionOverlappingVolumes ?? true} onChange={(v) => upd({ unionOverlappingVolumes: v })} helpBrief={getSettingHelp('unionOverlappingVolumes')?.brief} onShowHelp={() => showHelp('unionOverlappingVolumes', 'Union Overlapping Volumes')} />
        <Check label="Remove All Holes" value={print.removeAllHoles ?? false} onChange={(v) => upd({ removeAllHoles: v })} helpBrief={getSettingHelp('removeAllHoles')?.brief} onShowHelp={() => showHelp('removeAllHoles', 'Remove All Holes')} />
        <Check label="Extensive Stitching" value={print.extensiveStitching ?? false} onChange={(v) => upd({ extensiveStitching: v })} helpBrief={getSettingHelp('extensiveStitching')?.brief} onShowHelp={() => showHelp('extensiveStitching', 'Extensive Stitching')} />
        <Check label="Keep Disconnected Faces" value={print.keepDisconnectedFaces ?? false} onChange={(v) => upd({ keepDisconnectedFaces: v })} />
        <SectionDivider label="Precision" />
        <Num label="Maximum Resolution" unit="mm" value={print.maxResolution ?? 0.5} step={0.01} min={0.01} max={2} onChange={(v) => upd({ maxResolution: v })} helpBrief={getSettingHelp('maxResolution')?.brief} onShowHelp={() => showHelp('maxResolution', 'Maximum Resolution')} />
        <Num label="Maximum Deviation" unit="mm" value={print.maxDeviation ?? 0.025} step={0.005} min={0.001} max={1} onChange={(v) => upd({ maxDeviation: v })} helpBrief={getSettingHelp('maxDeviation')?.brief} onShowHelp={() => showHelp('maxDeviation', 'Maximum Deviation')} />
        <Num label="Max Travel Resolution" unit="mm" value={print.maxTravelResolution ?? 0.8} step={0.1} min={0.1} max={5} onChange={(v) => upd({ maxTravelResolution: v })} helpBrief={getSettingHelp('maxTravelResolution')?.brief} onShowHelp={() => showHelp('maxTravelResolution', 'Max Travel Resolution')} />
      </SlicerSection>}

      {/* ─── Dimensional Compensation (Cura: Shell) ─────────────────────── */}
      {isVisible('compensation') && <SlicerSection title="Dimensional Compensation" color="#c084fc" defaultOpen={false}>
        <Num label="Horizontal Expansion" unit="mm" value={print.horizontalExpansion ?? 0} step={0.01} min={-1} max={1} onChange={(v) => upd({ horizontalExpansion: v })} helpBrief={getSettingHelp('horizontalExpansion')?.brief} onShowHelp={() => showHelp('horizontalExpansion', 'Horizontal Expansion')} />
        <Num label="Initial Layer Horizontal Expansion" unit="mm" value={print.initialLayerHorizontalExpansion ?? 0} step={0.01} min={-1} max={1} onChange={(v) => upd({ initialLayerHorizontalExpansion: v })} helpBrief={getSettingHelp('initialLayerHorizontalExpansion')?.brief} onShowHelp={() => showHelp('initialLayerHorizontalExpansion', 'Initial Layer Horizontal Expansion')} />
        <Num label="Hole Horizontal Expansion" unit="mm" value={print.holeHorizontalExpansion ?? 0} step={0.01} min={-1} max={1} onChange={(v) => upd({ holeHorizontalExpansion: v })} helpBrief={getSettingHelp('holeHorizontalExpansion')?.brief} onShowHelp={() => showHelp('holeHorizontalExpansion', 'Hole Horizontal Expansion')} />
        <Num label="Elephant Foot Compensation" unit="mm" value={print.elephantFootCompensation ?? 0} step={0.01} min={0} max={1} onChange={(v) => upd({ elephantFootCompensation: v })} helpBrief={getSettingHelp('elephantFootCompensation')?.brief} onShowHelp={() => showHelp('elephantFootCompensation', 'Elephant Foot Compensation')} />
      </SlicerSection>}

      {/* ─── Per-feature Flow (Cura: Material) ──────────────────────────── */}
      {isVisible('flow') && <SlicerSection title="Flow" color="#f472b6" defaultOpen={false}>
        <Num label="Wall Flow" unit="%" value={print.wallFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ wallFlow: v })} helpBrief={getSettingHelp('wallFlow')?.brief} onShowHelp={() => showHelp('wallFlow', 'Wall Flow')} />
        <Num label="Outer Wall Flow" unit="%" value={print.outerWallFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ outerWallFlow: v })} helpBrief={getSettingHelp('outerWallFlow')?.brief} onShowHelp={() => showHelp('outerWallFlow', 'Outer Wall Flow')} />
        <Num label="Inner Wall Flow" unit="%" value={print.innerWallFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ innerWallFlow: v })} helpBrief={getSettingHelp('innerWallFlow')?.brief} onShowHelp={() => showHelp('innerWallFlow', 'Inner Wall Flow')} />
        <Num label="Top/Bottom Flow" unit="%" value={print.topBottomFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ topBottomFlow: v })} helpBrief={getSettingHelp('topBottomFlow')?.brief} onShowHelp={() => showHelp('topBottomFlow', 'Top/Bottom Flow')} />
        <Num label="Infill Flow" unit="%" value={print.infillFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ infillFlow: v })} helpBrief={getSettingHelp('infillFlow')?.brief} onShowHelp={() => showHelp('infillFlow', 'Infill Flow')} />
        <Num label="Support Flow" unit="%" value={print.supportFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ supportFlow: v })} helpBrief={getSettingHelp('supportFlow')?.brief} onShowHelp={() => showHelp('supportFlow', 'Support Flow')} />
        <Num label="Support Interface Flow" unit="%" value={print.supportInterfaceFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ supportInterfaceFlow: v })} helpBrief={getSettingHelp('supportInterfaceFlow')?.brief} onShowHelp={() => showHelp('supportInterfaceFlow', 'Support Interface Flow')} />
        <Num label="Skirt/Brim Flow" unit="%" value={print.skirtBrimFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ skirtBrimFlow: v })} helpBrief={getSettingHelp('skirtBrimFlow')?.brief} onShowHelp={() => showHelp('skirtBrimFlow', 'Skirt/Brim Flow')} />
        <Num label="Initial Layer Flow" unit="%" value={print.initialLayerFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ initialLayerFlow: v })} helpBrief={getSettingHelp('initialLayerFlow')?.brief} onShowHelp={() => showHelp('initialLayerFlow', 'Initial Layer Flow')} />
        <Tier level="expert">
          <Num label="Max Volumetric Flow Rate" unit="mm³/s" value={print.maxFlowRate ?? 0} step={0.5} min={0} max={50} onChange={(v) => upd({ maxFlowRate: v })} />
          <SectionDivider label="Initial Layer Per-Feature Flow" />
          <Num label="Initial Layer Outer Wall Flow" unit="%" value={print.initialLayerOuterWallFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ initialLayerOuterWallFlow: v })} />
          <Num label="Initial Layer Inner Wall Flow" unit="%" value={print.initialLayerInnerWallFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ initialLayerInnerWallFlow: v })} />
          <Num label="Initial Layer Bottom Flow" unit="%" value={print.initialLayerBottomFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ initialLayerBottomFlow: v })} />
          <SectionDivider label="Support Roof / Floor Flow" />
          <Num label="Support Roof Flow" unit="%" value={print.supportRoofFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ supportRoofFlow: v })} />
          <Num label="Support Floor Flow" unit="%" value={print.supportFloorFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ supportFloorFlow: v })} />
          <SectionDivider label="Flow Equalisation" />
          <Num label="Flow Equalization Ratio" value={print.flowEqualizationRatio ?? 0} step={0.05} min={0} max={1} onChange={(v) => upd({ flowEqualizationRatio: v })} />
        </Tier>
      </SlicerSection>}

      {/* ─── Advanced Bridging (Cura: Experimental) ─────────────────────── */}
      {isVisible('bridging') && <SlicerSection title="Bridging" color="#38bdf8" defaultOpen={false}>
        <Check label="Enable Advanced Bridge Settings" value={print.enableBridgeSettings ?? false} onChange={(v) => upd({ enableBridgeSettings: v })} helpBrief={getSettingHelp('enableBridgeSettings')?.brief} onShowHelp={() => showHelp('enableBridgeSettings', 'Enable Advanced Bridge Settings')} />
        {(print.enableBridgeSettings ?? false) && (<>
          <Num label="Bridge Wall Speed" unit="mm/s" value={print.bridgeWallSpeed ?? 30} min={1} max={200} onChange={(v) => upd({ bridgeWallSpeed: v })} helpBrief={getSettingHelp('bridgeWallSpeed')?.brief} onShowHelp={() => showHelp('bridgeWallSpeed', 'Bridge Wall Speed')} />
          <Num label="Bridge Skin Speed" unit="mm/s" value={print.bridgeSkinSpeed ?? 30} min={1} max={200} onChange={(v) => upd({ bridgeSkinSpeed: v })} helpBrief={getSettingHelp('bridgeSkinSpeed')?.brief} onShowHelp={() => showHelp('bridgeSkinSpeed', 'Bridge Skin Speed')} />
          <Num label="Bridge Skin Flow" unit="%" value={print.bridgeSkinFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ bridgeSkinFlow: v })} helpBrief={getSettingHelp('bridgeSkinFlow')?.brief} onShowHelp={() => showHelp('bridgeSkinFlow', 'Bridge Skin Flow')} />
          <Num label="Bridge Angle (0 = auto)" unit="°" value={print.bridgeAngle ?? 0} min={0} max={359} onChange={(v) => upd({ bridgeAngle: v })} helpBrief={getSettingHelp('bridgeAngle')?.brief} onShowHelp={() => showHelp('bridgeAngle', 'Bridge Angle')} />
          <Num label="Bridge Min Wall Line Width" unit="mm" value={print.bridgeMinWallLineWidth ?? 0.2} step={0.01} min={0.05} max={2} onChange={(v) => upd({ bridgeMinWallLineWidth: v })} />
          <Num label="Bridge Sparse Infill Max Density" unit="%" value={print.bridgeSparseInfillMaxDensity ?? 0} step={1} min={0} max={100} onChange={(v) => upd({ bridgeSparseInfillMaxDensity: v })} />
          <Num label="Bridge Skin Density" unit="%" value={print.bridgeSkinDensity ?? 100} step={1} min={0} max={100} onChange={(v) => upd({ bridgeSkinDensity: v })} />
          <Check label="Interlace Bridge Lines" value={print.interlaceBridgeLines ?? false} onChange={(v) => upd({ interlaceBridgeLines: v })} />
          <Check label="Bridge Has Multiple Layers" value={print.bridgeHasMultipleLayers ?? false} onChange={(v) => upd({ bridgeHasMultipleLayers: v })} />
          <SectionDivider label="Multi-Layer Bridge" />
          <Check label="Apply to Layers Above First Bridge" value={print.bridgeEnableMoreLayers ?? false} onChange={(v) => upd({ bridgeEnableMoreLayers: v })} />
          {(print.bridgeEnableMoreLayers ?? false) && (<>
            <Num label="Fan Speed (Layer 2)" unit="%" value={print.bridgeFanSpeed2 ?? 50} step={1} min={0} max={100} onChange={(v) => upd({ bridgeFanSpeed2: v })} />
            <Num label="Fan Speed (Layer 3)" unit="%" value={print.bridgeFanSpeed3 ?? 25} step={1} min={0} max={100} onChange={(v) => upd({ bridgeFanSpeed3: v })} />
          </>)}
        </>)}
      </SlicerSection>}

      {/* ─── Small Features ─────────────────────────────────────────────── */}
      {isVisible('smallFeatures') && <SlicerSection title="Small Features" color="#fbbf24" defaultOpen={false}>
        <Num label="Small Feature Max Length" unit="mm" value={print.smallFeatureMaxLength ?? 0} step={0.1} min={0} max={20} onChange={(v) => upd({ smallFeatureMaxLength: v })} />
        <Num label="Small Feature Speed" unit="%" value={print.smallFeatureSpeedFactor ?? 50} step={5} min={10} max={100} onChange={(v) => upd({ smallFeatureSpeedFactor: v })} />
        <Num label="Small Feature Speed (Initial Layer)" unit="%" value={print.smallFeatureInitialLayerSpeedFactor ?? 50} step={5} min={10} max={100} onChange={(v) => upd({ smallFeatureInitialLayerSpeedFactor: v })} />
        <Num label="Small Hole Max Size" unit="mm" value={print.smallHoleMaxSize ?? 0} step={0.1} min={0} max={20} onChange={(v) => upd({ smallHoleMaxSize: v })} />
      </SlicerSection>}

      {/* Cura-parity advanced fields are now merged into their parent
          sections (Walls, Top/Bottom, Infill, Travel, Cooling, Support,
          Adhesion, Experimental) and gated by Tier min="advanced" so they
          only appear at advanced/expert detail level. Each block is
          prefixed with an AdvancedDivider so users can tell them apart.
          Only sections that don't fit under an existing parent (Prime
          Tower, Modifier Meshes) remain standalone below. */}


      {/* ─── Prime Tower (Multi-Extruder) ───────────────────────────────── */}
      {isVisible('primeTower') && <SlicerSection title="Prime Tower" color="#a3e635" defaultOpen={false}>
        <Check label="Enable Prime Tower" value={print.primeTowerEnable ?? false} onChange={(v) => upd({ primeTowerEnable: v })} />
        {(print.primeTowerEnable ?? false) && (<>
          <Num label="Tower Size" unit="mm" value={print.primeTowerSize ?? 20} step={1} min={5} max={60} onChange={(v) => upd({ primeTowerSize: v })} />
          <Num label="Position X" unit="mm" value={print.primeTowerPositionX ?? 200} step={1} min={0} max={500} onChange={(v) => upd({ primeTowerPositionX: v })} />
          <Num label="Position Y" unit="mm" value={print.primeTowerPositionY ?? 200} step={1} min={0} max={500} onChange={(v) => upd({ primeTowerPositionY: v })} />
          <Num label="Min Volume per Change" unit="mm³" value={print.primeTowerMinVolume ?? 6} step={0.5} min={0} max={50} onChange={(v) => upd({ primeTowerMinVolume: v })} />
          <Check label="Wipe on Tower" value={print.primeTowerWipeEnable ?? true} onChange={(v) => upd({ primeTowerWipeEnable: v })} />
        </>)}
      </SlicerSection>}

      {/* ─── Modifier Meshes ────────────────────────────────────────────── */}
      {isVisible('modifierMeshes') && <SlicerSection title="Modifier Meshes" color="#f59e0b" defaultOpen={false}>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted, #999)', margin: '4px 0 8px' }}>
          Modifier meshes are assigned per-object in the 3D viewport. Select an object, then choose a role below to apply local overrides to slicing behaviour inside that volume.
        </p>
        <Sel
          label="Role"
          value={(print as any)._modifierMeshRole ?? 'normal'}
          options={[
            { value: 'normal',            label: 'Normal (no modifier)' },
            { value: 'infill_mesh',       label: 'Infill Mesh' },
            { value: 'cutting_mesh',      label: 'Cutting Mesh' },
            { value: 'support_mesh',      label: 'Support Mesh' },
            { value: 'anti_overhang_mesh',label: 'Anti-Overhang Mesh' },
          ]}
          onChange={() => {}}
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #999)', margin: '4px 0 0' }}>
          Per-mesh settings (infill density, pattern, etc.) are configured in the object properties panel.
        </p>
      </SlicerSection>}

      {/* Help Modal */}
      {helpModal && (
        <SettingsHelpModal
          title={helpModal.title}
          help={helpModal.help}
          onClose={() => setHelpModal(null)}
        />
      )}
    </>
  );
}
