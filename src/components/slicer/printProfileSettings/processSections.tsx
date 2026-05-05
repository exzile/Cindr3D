import type { PrintSettingsSectionProps } from './shared';
import { AdvancedDivider, Tier } from './shared';
import { SlicerSection } from '../SlicerSection';
import { Check, Density, Num, SectionDivider, Sel } from '../workspace/settings/controls/SettingsFieldControls';
import { getSettingHelp } from '../../../utils/settingsHelpContent';

export function InfillSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('infill')) return null;

  return (
    <SlicerSection title="Infill" color="#fb923c" defaultOpen={true}>
      <div style={{ position: 'relative' }}>
        <Density value={print.infillDensity} onChange={(v) => upd({ infillDensity: v })} />
      </div>
      <Sel label="Pattern" value={print.infillPattern} onChange={(v) => upd({ infillPattern: v })} options={[{ value: 'grid', label: 'Grid' }, { value: 'lines', label: 'Lines' }, { value: 'triangles', label: 'Triangles' }, { value: 'cubic', label: 'Cubic' }, { value: 'gyroid', label: 'Gyroid' }, { value: 'honeycomb', label: 'Honeycomb' }, { value: 'lightning', label: 'Lightning' }, { value: 'organic', label: 'Organic' }, { value: 'concentric', label: 'Concentric' }, { value: 'cross', label: 'Cross' }, { value: 'cross3d', label: 'Cross 3D' }, { value: 'quarter_cubic', label: 'Quarter Cubic' }, { value: 'octet', label: 'Octet' }, { value: 'tri_hexagon', label: 'Tri-Hexagon' }, { value: 'zigzag', label: 'Zigzag' }, { value: 'tetrahedral', label: 'Tetrahedral' }, { value: 'cubicsubdiv', label: 'Cubic Subdivision' }]} helpBrief={getSettingHelp('infillPattern')?.brief} onShowHelp={() => showHelp('infillPattern', 'Infill Pattern')} />
      <Tier min="advanced">
        <Num label="Infill Line Width" unit="mm" value={print.infillLineWidth} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ infillLineWidth: v })} helpBrief={getSettingHelp('lineWidth')?.brief} onShowHelp={() => showHelp('lineWidth', 'Infill Line Width')} />
        <Check label="Randomize Infill Start" value={print.randomInfillStart ?? false} onChange={(v) => upd({ randomInfillStart: v })} helpBrief={getSettingHelp('randomInfillStart')?.brief} onShowHelp={() => showHelp('randomInfillStart', 'Randomize Infill Start')} />
        <Num label="Minimum Infill Area" unit="mmÂ²" value={print.minInfillArea ?? 0} step={0.5} min={0} max={100} onChange={(v) => upd({ minInfillArea: v })} helpBrief={getSettingHelp('minInfillArea')?.brief} onShowHelp={() => showHelp('minInfillArea', 'Minimum Infill Area')} />
        <Num label="Gradual Infill Steps" value={print.gradualInfillSteps ?? 0} min={0} max={5} onChange={(v) => upd({ gradualInfillSteps: v })} helpBrief={getSettingHelp('gradualInfillSteps')?.brief} onShowHelp={() => showHelp('gradualInfillSteps', 'Gradual Infill Steps')} />
        <Num label="Extra Infill Wall Count" value={print.infillWallCount ?? 0} min={0} max={5} onChange={(v) => upd({ infillWallCount: v })} helpBrief={getSettingHelp('infillWallCount')?.brief} onShowHelp={() => showHelp('infillWallCount', 'Extra Infill Wall Count')} />
      </Tier>
      <Tier min="expert">
        <Num label="Infill Overlap" unit="%" value={print.infillOverlap} min={0} max={50} onChange={(v) => upd({ infillOverlap: v })} helpBrief={getSettingHelp('infillOverlap')?.brief} onShowHelp={() => showHelp('infillOverlap', 'Infill Overlap')} />
        {print.infillPattern === 'lightning' && <Num label="Lightning Overhang Angle" unit="Â°" value={print.lightningInfillOverhangAngle ?? 40} min={10} max={89} onChange={(v) => upd({ lightningInfillOverhangAngle: v })} />}
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
        <Num label="Infill Overhang Angle" unit="Â°" value={print.infillOverhangAngle ?? 0} min={0} max={89} onChange={(v) => upd({ infillOverhangAngle: v })} />
        <Num label="Gradual Infill Step Height" unit="mm" value={print.gradualInfillStepHeight ?? 1.5} step={0.1} min={0.1} max={20} onChange={(v) => upd({ gradualInfillStepHeight: v })} />
        <Num label="Infill X Offset" unit="mm" value={print.infillXOffset ?? 0} step={0.1} min={-100} max={100} onChange={(v) => upd({ infillXOffset: v })} />
        <Num label="Infill Y Offset" unit="mm" value={print.infillYOffset ?? 0} step={0.1} min={-100} max={100} onChange={(v) => upd({ infillYOffset: v })} />
        <SectionDivider label="Lightning Infill" />
        <Num label="Lightning Prune Angle" unit="Â°" value={print.lightningPruneAngle ?? 40} min={0} max={89} onChange={(v) => upd({ lightningPruneAngle: v })} />
        <Num label="Lightning Straightening Angle" unit="Â°" value={print.lightningStraighteningAngle ?? 40} min={0} max={89} onChange={(v) => upd({ lightningStraighteningAngle: v })} />
        <SectionDivider label="Cubic Subdivision" />
        <Num label="Cubic Subdivision Shell" unit="mm" value={print.cubicSubdivisionShell ?? 0} step={0.5} min={0} max={20} onChange={(v) => upd({ cubicSubdivisionShell: v })} />
      </Tier>
    </SlicerSection>
  );
}

export function SpeedSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('speed')) return null;

  return (
    <SlicerSection title="Speed" color="#f43f5e" defaultOpen={false}>
      <Num label="Print Speed" unit="mm/s" value={print.printSpeed} min={1} max={1000} onChange={(v) => upd({ printSpeed: v })} helpBrief={getSettingHelp('printSpeed')?.brief} onShowHelp={() => showHelp('printSpeed', 'Print Speed')} />
      <Tier min="advanced">
        <Num label="Travel Speed" unit="mm/s" value={print.travelSpeed} min={1} max={1000} onChange={(v) => upd({ travelSpeed: v })} helpBrief={getSettingHelp('travelSpeed')?.brief} onShowHelp={() => showHelp('travelSpeed', 'Travel Speed')} />
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
    </SlicerSection>
  );
}

export function TravelSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('travel')) return null;

  return (
    <SlicerSection title="Travel" color="#22d3ee" defaultOpen={false}>
      <Tier min="advanced">
        <Sel label="Combing Mode" value={print.combingMode} onChange={(v) => upd({ combingMode: v })} options={[{ value: 'all', label: 'All â€” avoid everything' }, { value: 'noskin', label: 'No Skin â€” avoid skin only' }, { value: 'infill', label: 'Infill Only' }, { value: 'off', label: 'Off â€” shortest path' }]} helpBrief={getSettingHelp('combingMode')?.brief} onShowHelp={() => showHelp('combingMode', 'Combing Mode')} />
        <Check label="Avoid Crossing Perimeters" value={print.avoidCrossingPerimeters} onChange={(v) => upd({ avoidCrossingPerimeters: v })} helpBrief={getSettingHelp('avoidCrossingPerimeters')?.brief} onShowHelp={() => showHelp('avoidCrossingPerimeters', 'Avoid Crossing Perimeters')} />
        <Num label="Min Travel Before Retract" unit="mm" value={print.retractionMinTravel ?? 1.5} step={0.1} min={0} max={20} onChange={(v) => upd({ retractionMinTravel: v })} helpBrief={getSettingHelp('retractionMinTravel')?.brief} onShowHelp={() => showHelp('retractionMinTravel', 'Min Travel Before Retract')} />
        <Check label="Retract at Layer Change" value={print.retractAtLayerChange ?? true} onChange={(v) => upd({ retractAtLayerChange: v })} helpBrief={getSettingHelp('retractAtLayerChange')?.brief} onShowHelp={() => showHelp('retractAtLayerChange', 'Retract at Layer Change')} />
        <Check label="Retract Before Outer Wall" value={print.travelRetractBeforeOuterWall ?? false} onChange={(v) => upd({ travelRetractBeforeOuterWall: v })} helpBrief={getSettingHelp('retractAtLayerChange')?.brief} onShowHelp={() => showHelp('retractAtLayerChange', 'Retract Before Outer Wall')} />
        <Check label="Combing Avoids Supports" value={print.combingAvoidsSupports ?? false} onChange={(v) => upd({ combingAvoidsSupports: v })} helpBrief={getSettingHelp('avoidSupports')?.brief} onShowHelp={() => showHelp('avoidSupports', 'Combing Avoids Supports')} />
      </Tier>
      <Tier min="expert">
        <SectionDivider label="Retraction Limits" />
        <Num label="Max Retraction Count" value={print.maxRetractionCount ?? 90} min={1} max={300} onChange={(v) => upd({ maxRetractionCount: v })} />
        <Num label="Extra Prime Amount" unit="mmÂ³" value={print.retractionExtraPrimeAmount ?? 0} step={0.01} min={0} max={1} onChange={(v) => upd({ retractionExtraPrimeAmount: v })} />
        <SectionDivider label="Layer Start Position" />
        <Num label="Layer Start X" unit="mm" value={print.layerStartX ?? 0} step={1} min={-500} max={500} onChange={(v) => upd({ layerStartX: v })} />
        <Num label="Layer Start Y" unit="mm" value={print.layerStartY ?? 0} step={1} min={-500} max={500} onChange={(v) => upd({ layerStartY: v })} />
        <Check label="Layer Start at Z Seam" value={print.layerStartAtSeam ?? false} onChange={(v) => upd({ layerStartAtSeam: v })} />
        <Num label="Min Extrusion Distance Window" unit="mm" value={print.minimumExtrusionDistanceWindow ?? 0} step={0.5} min={0} max={50} onChange={(v) => upd({ minimumExtrusionDistanceWindow: v })} />
      </Tier>
      <Tier min="advanced">
        <AdvancedDivider label="Advanced Â· Avoidance" />
        <Check label="Avoid Printed Parts When Traveling" value={print.avoidPrintedParts ?? true} onChange={(v) => upd({ avoidPrintedParts: v })} helpBrief={getSettingHelp('avoidPrintedParts')?.brief} onShowHelp={() => showHelp('avoidPrintedParts', 'Avoid Printed Parts')} />
        <Check label="Avoid Supports When Traveling" value={print.avoidSupports ?? false} onChange={(v) => upd({ avoidSupports: v })} helpBrief={getSettingHelp('avoidSupports')?.brief} onShowHelp={() => showHelp('avoidSupports', 'Avoid Supports')} />
        <Num label="Max Comb Distance w/o Retract" unit="mm" value={print.maxCombDistanceNoRetract ?? 0} step={1} min={0} max={1000} onChange={(v) => upd({ maxCombDistanceNoRetract: v })} helpBrief={getSettingHelp('maxCombDistanceNoRetract')?.brief} onShowHelp={() => showHelp('maxCombDistanceNoRetract', 'Max Comb Distance')} />
        <Num label="Travel Avoid Distance" unit="mm" value={print.travelAvoidDistance ?? 0.625} step={0.05} min={0} max={10} onChange={(v) => upd({ travelAvoidDistance: v })} helpBrief={getSettingHelp('travelAvoidDistance')?.brief} onShowHelp={() => showHelp('travelAvoidDistance', 'Travel Avoid Distance')} />
        <Num label="Inside Travel Avoid Distance" unit="mm" value={print.insideTravelAvoidDistance ?? 0.4} step={0.05} min={0} max={10} onChange={(v) => upd({ insideTravelAvoidDistance: v })} helpBrief={getSettingHelp('insideTravelAvoidDistance')?.brief} onShowHelp={() => showHelp('insideTravelAvoidDistance', 'Inside Travel Avoid Distance')} />
        <AdvancedDivider label="Advanced Â· Z-Hop" />
        <Check label="Z-Hop When Retracted" value={print.zHopWhenRetracted ?? false} onChange={(v) => upd({ zHopWhenRetracted: v })} helpBrief={getSettingHelp('zHopWhenRetracted')?.brief} onShowHelp={() => showHelp('zHopWhenRetracted', 'Z-Hop When Retracted')} />
        {(print.zHopWhenRetracted ?? false) && (
          <>
            <Num label="Z-Hop Height" unit="mm" value={print.zHopHeight ?? 0.4} step={0.05} min={0.05} max={5} onChange={(v) => upd({ zHopHeight: v })} helpBrief={getSettingHelp('zHopHeight')?.brief} onShowHelp={() => showHelp('zHopHeight', 'Z-Hop Height')} />
            <Num label="Z-Hop Speed" unit="mm/s" value={print.zHopSpeed ?? 10} step={1} min={1} max={100} onChange={(v) => upd({ zHopSpeed: v })} helpBrief={getSettingHelp('zHopSpeed')?.brief} onShowHelp={() => showHelp('zHopSpeed', 'Z-Hop Speed')} />
            <Check label="Z-Hop Only Over Printed Parts" value={print.zHopOnlyOverPrinted ?? false} onChange={(v) => upd({ zHopOnlyOverPrinted: v })} helpBrief={getSettingHelp('avoidPrintedParts')?.brief} onShowHelp={() => showHelp('avoidPrintedParts', 'Z-Hop Only Over Printed Parts')} />
          </>
        )}
        <AdvancedDivider label="Advanced Â· Prime / Wipe" />
        <Num label="Retraction Extra Prime Amount" unit="mmÂ³" value={print.retractionExtraPrimeAmount ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ retractionExtraPrimeAmount: v })} />
        <Num label="Wipe Retraction Distance" unit="mm" value={print.wipeRetractionDistance ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ wipeRetractionDistance: v })} />
        <Num label="Wipe Retraction Extra Prime" unit="mmÂ³" value={print.wipeRetractionExtraPrime ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ wipeRetractionExtraPrime: v })} />
      </Tier>
    </SlicerSection>
  );
}

export function CoolingSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('cooling')) return null;

  return (
    <SlicerSection title="Cooling" color="#60a5fa" defaultOpen={false}>
      <Num label="Min Layer Time" unit="s" value={print.minLayerTime} min={0} max={120} onChange={(v) => upd({ minLayerTime: v })} helpBrief={getSettingHelp('minLayerTime')?.brief} onShowHelp={() => showHelp('minLayerTime', 'Min Layer Time')} />
      <Tier min="advanced">
        <Num label="Full Fan Speed at Layer" value={print.fanFullLayer ?? 4} min={1} max={50} onChange={(v) => upd({ fanFullLayer: v })} helpBrief={getSettingHelp('fanFullLayer')?.brief} onShowHelp={() => showHelp('fanFullLayer', 'Full Fan Speed at Layer')} />
        <Num label="Min Print Speed" unit="mm/s" value={print.minPrintSpeed ?? 10} min={1} max={100} onChange={(v) => upd({ minPrintSpeed: v })} helpBrief={getSettingHelp('minPrintSpeed')?.brief} onShowHelp={() => showHelp('minPrintSpeed', 'Min Print Speed')} />
        <Check label="Lift Head on Min Layer Time" value={print.liftHeadEnabled ?? false} onChange={(v) => upd({ liftHeadEnabled: v })} helpBrief={getSettingHelp('liftHeadEnabled')?.brief} onShowHelp={() => showHelp('liftHeadEnabled', 'Lift Head on Min Layer Time')} />
        <Check label="Bridge Fan" value={print.enableBridgeFan} onChange={(v) => upd({ enableBridgeFan: v })} helpBrief={getSettingHelp('enableBridgeFan')?.brief} onShowHelp={() => showHelp('enableBridgeFan', 'Bridge Fan')} />
        {print.enableBridgeFan && <Num label="Bridge Fan Speed" unit="%" value={print.bridgeFanSpeed} min={0} max={100} onChange={(v) => upd({ bridgeFanSpeed: v })} helpBrief={getSettingHelp('bridgeFanSpeed')?.brief} onShowHelp={() => showHelp('bridgeFanSpeed', 'Bridge Fan Speed')} />}
        <SectionDivider label="Fan Ramp-up" />
        <Num label="Regular Fan Speed at Layer" value={print.regularFanSpeedLayer ?? 1} min={0} max={100} onChange={(v) => upd({ regularFanSpeedLayer: v })} helpBrief={getSettingHelp('regularFanSpeedLayer')?.brief} onShowHelp={() => showHelp('regularFanSpeedLayer', 'Regular Fan Speed at Layer')} />
        <Num label="Regular Fan Speed at Height" unit="mm" value={print.regularFanSpeedAtHeight ?? 0} step={0.5} min={0} max={500} onChange={(v) => upd({ regularFanSpeedAtHeight: v })} helpBrief={getSettingHelp('regularFanSpeedAtHeight')?.brief} onShowHelp={() => showHelp('regularFanSpeedAtHeight', 'Regular Fan Speed at Height')} />
        <Num label="Fan Kickstart Time" unit="ms" value={print.fanKickstartTime ?? 100} step={10} min={0} max={5000} onChange={(v) => upd({ fanKickstartTime: v })} helpBrief={getSettingHelp('fanKickstartTime')?.brief} onShowHelp={() => showHelp('fanKickstartTime', 'Fan Kickstart Time')} />
        <Num label="Small Layer Printing Temp" unit="Â°C" value={print.smallLayerPrintingTemperature ?? 0} step={1} min={0} max={400} onChange={(v) => upd({ smallLayerPrintingTemperature: v })} />
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
    </SlicerSection>
  );
}
