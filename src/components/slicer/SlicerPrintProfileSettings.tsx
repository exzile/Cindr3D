import type { PrintProfile } from '../../types/slicer';
import { Num, Check, Sel, Density, SectionDivider } from './workspace/settings/controls/SettingsFieldControls';
import { SlicerSection } from './SlicerSection';

export function SlicerPrintProfileSettings({
  print,
  upd,
}: {
  print: PrintProfile;
  upd: (updates: Record<string, unknown>) => void;
}) {
  return (
    <>
      <SlicerSection title="Quality" defaultOpen={true}>
        <Num label="Layer Height" unit="mm" value={print.layerHeight} step={0.05} min={0.01} max={1.0} onChange={(v) => upd({ layerHeight: v })} />
        <Num label="First Layer Height" unit="mm" value={print.firstLayerHeight} step={0.05} min={0.05} max={1.0} onChange={(v) => upd({ firstLayerHeight: v })} />
        <SectionDivider label="Line Widths" />
        <Num label="Line Width" unit="mm" value={print.lineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ lineWidth: v })} />
        <Num label="Outer Wall Line Width" unit="mm" value={print.outerWallLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ outerWallLineWidth: v })} />
        <Num label="Top/Bottom Line Width" unit="mm" value={print.topBottomLineWidth ?? 0.4} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ topBottomLineWidth: v })} />
        <Num label="Initial Layer Width Factor" unit="%" value={print.initialLayerLineWidthFactor ?? 120} step={5} min={50} max={200} onChange={(v) => upd({ initialLayerLineWidthFactor: v })} />
        <SectionDivider label="Adaptive Layers" />
        <Check label="Enable Adaptive Layers" value={(print as unknown as Record<string, unknown>).adaptiveLayersEnabled as boolean ?? false} onChange={(v) => upd({ adaptiveLayersEnabled: v })} />
        {((print as unknown as Record<string, unknown>).adaptiveLayersEnabled as boolean ?? false) && (<>
          <Num label="Max Variation" unit="mm" value={(print as unknown as Record<string, unknown>).adaptiveLayersMaxVariation as number ?? 0.1} step={0.01} min={0.01} max={0.5} onChange={(v) => upd({ adaptiveLayersMaxVariation: v })} />
          <Num label="Variation Step" unit="mm" value={(print as unknown as Record<string, unknown>).adaptiveLayersVariationStep as number ?? 0.05} step={0.01} min={0.01} max={0.2} onChange={(v) => upd({ adaptiveLayersVariationStep: v })} />
        </>)}
      </SlicerSection>

      <SlicerSection title="Walls" defaultOpen={false}>
        <Num label="Wall Count" value={print.wallCount} min={1} max={20} onChange={(v) => upd({ wallCount: v })} />
        <Num label="Wall Line Width" unit="mm" value={print.wallLineWidth} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ wallLineWidth: v })} />
        <Check label="Outer Wall First" value={print.outerWallFirst ?? false} onChange={(v) => upd({ outerWallFirst: v })} />
        <Check label="Alternate Extra Wall" value={print.alternateExtraWall ?? false} onChange={(v) => upd({ alternateExtraWall: v })} />
        <Sel label="Z Seam Alignment" value={print.zSeamAlignment}
          onChange={(v) => upd({ zSeamAlignment: v })}
          options={[
            { value: 'sharpest_corner', label: 'Sharpest Corner' },
            { value: 'aligned', label: 'Aligned' },
            { value: 'shortest', label: 'Shortest' },
            { value: 'random', label: 'Random' },
          ]} />
        <Check label="Thin Wall Detection" value={print.thinWallDetection} onChange={(v) => upd({ thinWallDetection: v })} />
        <SectionDivider label="Advanced" />
        <Num label="Min Wall Line Width" unit="mm" value={(print as unknown as Record<string, unknown>).minWallLineWidth as number ?? 0.2} step={0.01} min={0.05} max={1} onChange={(v) => upd({ minWallLineWidth: v })} />
        <Num label="Wall Transition Length" unit="mm" value={(print as unknown as Record<string, unknown>).wallTransitionLength as number ?? 1.0} step={0.1} min={0.1} max={10} onChange={(v) => upd({ wallTransitionLength: v })} />
        <Num label="Outer Wall Wipe Distance" unit="mm" value={(print as unknown as Record<string, unknown>).outerWallWipeDistance as number ?? 0} step={0.1} min={0} max={5} onChange={(v) => upd({ outerWallWipeDistance: v })} />
      </SlicerSection>

      <SlicerSection title="Top / Bottom" defaultOpen={false}>
        <Num label="Top Layers" value={print.topLayers} min={0} max={50} onChange={(v) => upd({ topLayers: v })} />
        <Num label="Bottom Layers" value={print.bottomLayers} min={0} max={50} onChange={(v) => upd({ bottomLayers: v })} />
        <Sel label="Pattern" value={print.topBottomPattern}
          onChange={(v) => upd({ topBottomPattern: v })}
          options={[
            { value: 'lines', label: 'Lines' },
            { value: 'concentric', label: 'Concentric' },
            { value: 'zigzag', label: 'Zigzag' },
          ]} />
        <Num label="Top Surface Speed" unit="mm/s" value={print.topSpeed} min={1} max={500} onChange={(v) => upd({ topSpeed: v })} />
        <SectionDivider label="Ironing" />
        <Check label="Enable Ironing" value={print.ironingEnabled} onChange={(v) => upd({ ironingEnabled: v })} />
        {print.ironingEnabled && (<>
          <Num label="Ironing Speed" unit="mm/s" value={print.ironingSpeed} min={1} max={100} onChange={(v) => upd({ ironingSpeed: v })} />
          <Num label="Ironing Flow" unit="%" value={print.ironingFlow} step={0.5} min={0} max={30} onChange={(v) => upd({ ironingFlow: v })} />
          <Num label="Ironing Spacing" unit="mm" value={print.ironingSpacing} step={0.01} min={0.01} max={1.0} onChange={(v) => upd({ ironingSpacing: v })} />
        </>)}
      </SlicerSection>

      <SlicerSection title="Infill" defaultOpen={true}>
        <Density value={print.infillDensity} onChange={(v) => upd({ infillDensity: v })} />
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
          ]} />
        <Num label="Infill Line Width" unit="mm" value={print.infillLineWidth} step={0.01} min={0.1} max={2.0} onChange={(v) => upd({ infillLineWidth: v })} />
        <Num label="Infill Overlap" unit="%" value={print.infillOverlap} min={0} max={50} onChange={(v) => upd({ infillOverlap: v })} />
      </SlicerSection>

      <SlicerSection title="Speed" defaultOpen={false}>
        <Num label="Print Speed" unit="mm/s" value={print.printSpeed} min={1} max={1000} onChange={(v) => upd({ printSpeed: v })} />
        <Num label="Travel Speed" unit="mm/s" value={print.travelSpeed} min={1} max={1000} onChange={(v) => upd({ travelSpeed: v })} />
        <Num label="First Layer Speed" unit="mm/s" value={print.firstLayerSpeed} min={1} max={200} onChange={(v) => upd({ firstLayerSpeed: v })} />
        <SectionDivider label="Per-Feature" />
        <Num label="Outer Wall Speed" unit="mm/s" value={print.outerWallSpeed} min={1} max={500} onChange={(v) => upd({ outerWallSpeed: v })} />
        <Num label="Inner Wall Speed" unit="mm/s" value={print.wallSpeed} min={1} max={500} onChange={(v) => upd({ wallSpeed: v })} />
        <Num label="Infill Speed" unit="mm/s" value={print.infillSpeed} min={1} max={500} onChange={(v) => upd({ infillSpeed: v })} />
        <Num label="Support Speed" unit="mm/s" value={print.supportSpeed ?? 40} min={1} max={500} onChange={(v) => upd({ supportSpeed: v })} />
        <Num label="Small Area Speed" unit="mm/s" value={print.smallAreaSpeed ?? 20} min={1} max={200} onChange={(v) => upd({ smallAreaSpeed: v })} />
      </SlicerSection>

      <SlicerSection title="Travel" defaultOpen={false}>
        <Sel label="Combing Mode" value={print.combingMode}
          onChange={(v) => upd({ combingMode: v })}
          options={[
            { value: 'all', label: 'All — avoid everything' },
            { value: 'noskin', label: 'No Skin — avoid skin only' },
            { value: 'infill', label: 'Infill Only' },
            { value: 'off', label: 'Off — shortest path' },
          ]} />
        <Check label="Avoid Crossing Perimeters" value={print.avoidCrossingPerimeters} onChange={(v) => upd({ avoidCrossingPerimeters: v })} />
        <Num label="Min Travel Before Retract" unit="mm" value={print.retractionMinTravel ?? 1.5} step={0.1} min={0} max={20} onChange={(v) => upd({ retractionMinTravel: v })} />
        <Check label="Retract at Layer Change" value={(print as unknown as Record<string, unknown>).retractAtLayerChange as boolean ?? true} onChange={(v) => upd({ retractAtLayerChange: v })} />
        <Check label="Retract Before Outer Wall" value={(print as unknown as Record<string, unknown>).travelRetractBeforeOuterWall as boolean ?? false} onChange={(v) => upd({ travelRetractBeforeOuterWall: v })} />
        <Check label="Combing Avoids Supports" value={(print as unknown as Record<string, unknown>).combingAvoidsSupports as boolean ?? false} onChange={(v) => upd({ combingAvoidsSupports: v })} />
        <SectionDivider label="Retraction Limits" />
        <Num label="Max Retraction Count" value={(print as unknown as Record<string, unknown>).maxRetractionCount as number ?? 90} min={1} max={300} onChange={(v) => upd({ maxRetractionCount: v })} />
        <Num label="Extra Prime Amount" unit="mm³" value={(print as unknown as Record<string, unknown>).retractionExtraPrimeAmount as number ?? 0} step={0.01} min={0} max={1} onChange={(v) => upd({ retractionExtraPrimeAmount: v })} />
      </SlicerSection>

      <SlicerSection title="Cooling" defaultOpen={false}>
        <Num label="Min Layer Time" unit="s" value={print.minLayerTime} min={0} max={120} onChange={(v) => upd({ minLayerTime: v })} />
        <Num label="Full Fan Speed at Layer" value={print.fanFullLayer ?? 4} min={1} max={50} onChange={(v) => upd({ fanFullLayer: v })} />
        <Num label="Min Print Speed" unit="mm/s" value={print.minPrintSpeed ?? 10} min={1} max={100} onChange={(v) => upd({ minPrintSpeed: v })} />
        <Check label="Lift Head on Min Layer Time" value={print.liftHeadEnabled ?? false} onChange={(v) => upd({ liftHeadEnabled: v })} />
        <Check label="Bridge Fan" value={print.enableBridgeFan} onChange={(v) => upd({ enableBridgeFan: v })} />
        {print.enableBridgeFan && (
          <Num label="Bridge Fan Speed" unit="%" value={print.bridgeFanSpeed} min={0} max={100} onChange={(v) => upd({ bridgeFanSpeed: v })} />
        )}
        <SectionDivider label="Fan Ramp-up" />
        <Num label="Regular Fan Speed at Layer" value={(print as unknown as Record<string, unknown>).regularFanSpeedLayer as number ?? 1} min={0} max={100} onChange={(v) => upd({ regularFanSpeedLayer: v })} />
        <Num label="Fan Kickstart Time" unit="ms" value={(print as unknown as Record<string, unknown>).fanKickstartTime as number ?? 100} step={10} min={0} max={5000} onChange={(v) => upd({ fanKickstartTime: v })} />
      </SlicerSection>

      <SlicerSection title="Support" defaultOpen={print.supportEnabled}>
        <Check label="Enable Support" value={print.supportEnabled} onChange={(v) => upd({ supportEnabled: v })} />
        {print.supportEnabled && (<>
          <Sel label="Support Structure" value={print.supportType}
            onChange={(v) => upd({ supportType: v })}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'tree', label: 'Tree' },
              { value: 'organic', label: 'Organic' },
            ]} />
          <Num label="Overhang Angle" unit="°" value={print.supportAngle} min={0} max={89} onChange={(v) => upd({ supportAngle: v })} />
          <Density value={print.supportDensity} onChange={(v) => upd({ supportDensity: v })} />
          <Sel label="Support Pattern" value={print.supportPattern}
            onChange={(v) => upd({ supportPattern: v })}
            options={[
              { value: 'lines', label: 'Lines' },
              { value: 'grid', label: 'Grid' },
              { value: 'zigzag', label: 'Zigzag' },
            ]} />
          <SectionDivider label="Distances" />
          <Num label="Z Distance" unit="mm" value={print.supportZDistance} step={0.05} min={0} max={5} onChange={(v) => upd({ supportZDistance: v })} />
          <Num label="XY Distance" unit="mm" value={print.supportXYDistance} step={0.05} min={0} max={5} onChange={(v) => upd({ supportXYDistance: v })} />
          <SectionDivider label="Interface" />
          <Check label="Support Interface Layers" value={print.supportInterface} onChange={(v) => upd({ supportInterface: v })} />
          {print.supportInterface && (
            <Num label="Interface Layer Count" value={print.supportInterfaceLayers} min={1} max={10} onChange={(v) => upd({ supportInterfaceLayers: v })} />
          )}
          {(print.supportType === 'tree' || print.supportType === 'organic') && (<>
            <SectionDivider label="Tree Support" />
            <Num label="Branch Angle" unit="°" value={print.supportTreeAngle ?? 60} min={10} max={85} onChange={(v) => upd({ supportTreeAngle: v })} />
            <Num label="Branch Diameter" unit="mm" value={print.supportTreeBranchDiameter ?? 5} step={0.5} min={1} max={20} onChange={(v) => upd({ supportTreeBranchDiameter: v })} />
          </>)}
          <SectionDivider label="Placement" />
          <Check label="Build Plate Only" value={(print as unknown as Record<string, unknown>).supportBuildplateOnly as boolean ?? false} onChange={(v) => upd({ supportBuildplateOnly: v })} />
          <Num label="Support Wall Count" value={(print as unknown as Record<string, unknown>).supportWallCount as number ?? 0} min={0} max={5} onChange={(v) => upd({ supportWallCount: v })} />
          <Num label="Bottom Support Distance" unit="mm" value={(print as unknown as Record<string, unknown>).supportBottomDistance as number ?? 0.2} step={0.05} min={0} max={5} onChange={(v) => upd({ supportBottomDistance: v })} />
          <SectionDivider label="Roof / Floor" />
          <Check label="Support Roof" value={(print as unknown as Record<string, unknown>).supportRoofEnable as boolean ?? false} onChange={(v) => upd({ supportRoofEnable: v })} />
          <Check label="Support Floor" value={(print as unknown as Record<string, unknown>).supportFloorEnable as boolean ?? false} onChange={(v) => upd({ supportFloorEnable: v })} />
          {(((print as unknown as Record<string, unknown>).supportRoofEnable as boolean ?? false) || ((print as unknown as Record<string, unknown>).supportFloorEnable as boolean ?? false)) && (<>
            <Sel label="Interface Pattern" value={(print as unknown as Record<string, unknown>).supportInterfacePattern as 'lines' | 'grid' | 'concentric' | 'zigzag' ?? 'lines'}
              onChange={(v) => upd({ supportInterfacePattern: v })}
              options={[
                { value: 'lines', label: 'Lines' },
                { value: 'grid', label: 'Grid' },
                { value: 'concentric', label: 'Concentric' },
                { value: 'zigzag', label: 'Zigzag' },
              ]} />
            <Num label="Interface Density" unit="%" value={(print as unknown as Record<string, unknown>).supportInterfaceDensity as number ?? 100} min={0} max={100} onChange={(v) => upd({ supportInterfaceDensity: v })} />
          </>)}
        </>)}
      </SlicerSection>

      <SlicerSection title="Build Plate Adhesion" defaultOpen={false}>
        <Sel label="Type" value={print.adhesionType}
          onChange={(v) => upd({ adhesionType: v })}
          options={[
            { value: 'none', label: 'None' },
            { value: 'skirt', label: 'Skirt' },
            { value: 'brim', label: 'Brim' },
            { value: 'raft', label: 'Raft' },
          ]} />
        {print.adhesionType === 'skirt' && (<>
          <Num label="Skirt Lines" value={print.skirtLines} min={1} max={20} onChange={(v) => upd({ skirtLines: v })} />
          <Num label="Skirt Distance" unit="mm" value={print.skirtDistance} step={0.5} min={0} max={20} onChange={(v) => upd({ skirtDistance: v })} />
        </>)}
        {print.adhesionType === 'brim' && (<>
          <Num label="Brim Width" unit="mm" value={print.brimWidth} step={0.5} min={0} max={50} onChange={(v) => upd({ brimWidth: v })} />
          <Num label="Brim Gap" unit="mm" value={print.brimGap ?? 0} step={0.1} min={0} max={5} onChange={(v) => upd({ brimGap: v })} />
          <Sel label="Brim Location" value={print.brimLocation ?? 'outside'}
            onChange={(v) => upd({ brimLocation: v })}
            options={[
              { value: 'outside', label: 'Outside' },
              { value: 'inside', label: 'Inside' },
              { value: 'everywhere', label: 'Everywhere' },
            ]} />
        </>)}
        {print.adhesionType === 'raft' && (<>
          <Num label="Raft Layers" value={print.raftLayers} min={1} max={10} onChange={(v) => upd({ raftLayers: v })} />
          <Num label="Raft Margin" unit="mm" value={print.raftMargin ?? 5} step={0.5} min={0} max={30} onChange={(v) => upd({ raftMargin: v })} />
          <SectionDivider label="Raft Layers (Advanced)" />
          <Num label="Base Thickness" unit="mm" value={(print as unknown as Record<string, unknown>).raftBaseThickness as number ?? 0.3} step={0.05} min={0.1} max={2} onChange={(v) => upd({ raftBaseThickness: v })} />
          <Num label="Base Line Width" unit="mm" value={(print as unknown as Record<string, unknown>).raftBaseLineWidth as number ?? 0.8} step={0.05} min={0.1} max={3} onChange={(v) => upd({ raftBaseLineWidth: v })} />
          <Num label="Base Speed" unit="mm/s" value={(print as unknown as Record<string, unknown>).raftBaseSpeed as number ?? 20} min={1} max={200} onChange={(v) => upd({ raftBaseSpeed: v })} />
          <Num label="Interface Thickness" unit="mm" value={(print as unknown as Record<string, unknown>).raftInterfaceThickness as number ?? 0.27} step={0.05} min={0.1} max={2} onChange={(v) => upd({ raftInterfaceThickness: v })} />
          <Num label="Surface Air Gap" unit="mm" value={(print as unknown as Record<string, unknown>).raftAirGap as number ?? 0.3} step={0.05} min={0} max={2} onChange={(v) => upd({ raftAirGap: v })} />
        </>)}
        {print.adhesionType === 'skirt' && (
          <Num label="Skirt Height (layers)" value={(print as unknown as Record<string, unknown>).skirtHeight as number ?? 1} min={1} max={10} onChange={(v) => upd({ skirtHeight: v })} />
        )}
      </SlicerSection>

      <SlicerSection title="Special Modes" defaultOpen={false}>
        <Check label="Vase Mode (Spiralize Contour)" value={print.spiralizeContour ?? false} onChange={(v) => upd({ spiralizeContour: v })} />
        <Sel label="Surface Mode" value={(print as unknown as Record<string, unknown>).surfaceMode as 'normal' | 'surface' | 'both' ?? 'normal'}
          onChange={(v) => upd({ surfaceMode: v })}
          options={[
            { value: 'normal', label: 'Normal — solid model' },
            { value: 'surface', label: 'Surface — shell only' },
            { value: 'both', label: 'Both — normal + surface' },
          ]} />
        <Sel label="Print Sequence" value={print.printSequence ?? 'all_at_once'}
          onChange={(v) => upd({ printSequence: v })}
          options={[
            { value: 'all_at_once', label: 'All at Once' },
            { value: 'one_at_a_time', label: 'One at a Time' },
          ]} />
        <SectionDivider label="Mold" />
        <Check label="Enable Mold Mode" value={(print as unknown as Record<string, unknown>).moldEnabled as boolean ?? false} onChange={(v) => upd({ moldEnabled: v })} />
        {((print as unknown as Record<string, unknown>).moldEnabled as boolean ?? false) && (<>
          <Num label="Mold Draft Angle" unit="°" value={(print as unknown as Record<string, unknown>).moldAngle as number ?? 40} min={0} max={89} onChange={(v) => upd({ moldAngle: v })} />
          <Num label="Mold Roof Height" unit="mm" value={(print as unknown as Record<string, unknown>).moldRoofHeight as number ?? 0.5} step={0.1} min={0} max={10} onChange={(v) => upd({ moldRoofHeight: v })} />
        </>)}
      </SlicerSection>

      <SlicerSection title="Experimental" defaultOpen={false}>
        <Check label="Draft Shield" value={print.draftShieldEnabled ?? false} onChange={(v) => upd({ draftShieldEnabled: v })} />
        {print.draftShieldEnabled && (
          <Num label="Draft Shield Distance" unit="mm" value={print.draftShieldDistance ?? 10} step={1} min={1} max={50} onChange={(v) => upd({ draftShieldDistance: v })} />
        )}
        <Check label="Coasting" value={print.coastingEnabled ?? false} onChange={(v) => upd({ coastingEnabled: v })} />
        {print.coastingEnabled && (
          <Num label="Coasting Volume" unit="mm³" value={print.coastingVolume ?? 0.064} step={0.001} min={0} max={1} onChange={(v) => upd({ coastingVolume: v })} />
        )}
        <SectionDivider label="Fuzzy Skin" />
        <Check label="Enable Fuzzy Skin" value={(print as unknown as Record<string, unknown>).fuzzySkinsEnabled as boolean ?? false} onChange={(v) => upd({ fuzzySkinsEnabled: v })} />
        {((print as unknown as Record<string, unknown>).fuzzySkinsEnabled as boolean ?? false) && (<>
          <Num label="Fuzzy Thickness" unit="mm" value={(print as unknown as Record<string, unknown>).fuzzySkinThickness as number ?? 0.3} step={0.05} min={0.01} max={2} onChange={(v) => upd({ fuzzySkinThickness: v })} />
          <Num label="Fuzzy Point Distance" unit="mm" value={(print as unknown as Record<string, unknown>).fuzzySkinPointDist as number ?? 0.8} step={0.05} min={0.1} max={5} onChange={(v) => upd({ fuzzySkinPointDist: v })} />
        </>)}
        <SectionDivider label="Overhang" />
        <Check label="Make Overhang Printable" value={(print as unknown as Record<string, unknown>).makeOverhangPrintable as boolean ?? false} onChange={(v) => upd({ makeOverhangPrintable: v })} />
        {((print as unknown as Record<string, unknown>).makeOverhangPrintable as boolean ?? false) && (
          <Num label="Max Overhang Angle" unit="°" value={(print as unknown as Record<string, unknown>).makeOverhangPrintableMaxAngle as number ?? 50} min={0} max={89} onChange={(v) => upd({ makeOverhangPrintableMaxAngle: v })} />
        )}
        <SectionDivider label="Slicing" />
        <Sel label="Slicing Tolerance" value={(print as unknown as Record<string, unknown>).slicingTolerance as 'middle' | 'inclusive' | 'exclusive' ?? 'middle'}
          onChange={(v) => upd({ slicingTolerance: v })}
          options={[
            { value: 'middle', label: 'Middle — balanced' },
            { value: 'inclusive', label: 'Inclusive — thicker' },
            { value: 'exclusive', label: 'Exclusive — thinner' },
          ]} />
        <Num label="Min Polygon Circumference" unit="mm" value={(print as unknown as Record<string, unknown>).minimumPolygonCircumference as number ?? 1.0} step={0.1} min={0.1} max={10} onChange={(v) => upd({ minimumPolygonCircumference: v })} />
        <Num label="Small Hole Max Size" unit="mm" value={(print as unknown as Record<string, unknown>).smallHoleMaxSize as number ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ smallHoleMaxSize: v })} />
      </SlicerSection>

      <SlicerSection title="Acceleration & Jerk" defaultOpen={false}>
        <Check label="Enable Acceleration Control" value={(print as unknown as Record<string, unknown>).accelerationEnabled as boolean ?? false} onChange={(v) => upd({ accelerationEnabled: v })} />
        {((print as unknown as Record<string, unknown>).accelerationEnabled as boolean ?? false) && (<>
          <SectionDivider label="Acceleration (mm/s²)" />
          <Num label="Print" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationPrint as number ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationPrint: v })} />
          <Num label="Travel" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationTravel as number ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationTravel: v })} />
          <Num label="Outer Wall" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationWall as number ?? 1000} min={100} max={20000} onChange={(v) => upd({ accelerationWall: v })} />
          <Num label="Infill" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationInfill as number ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationInfill: v })} />
          <Num label="Top/Bottom" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationTopBottom as number ?? 1000} min={100} max={20000} onChange={(v) => upd({ accelerationTopBottom: v })} />
          <Num label="Support" unit="mm/s²" value={(print as unknown as Record<string, unknown>).accelerationSupport as number ?? 2000} min={100} max={20000} onChange={(v) => upd({ accelerationSupport: v })} />
        </>)}
        <Check label="Enable Jerk Control" value={(print as unknown as Record<string, unknown>).jerkEnabled as boolean ?? false} onChange={(v) => upd({ jerkEnabled: v })} />
        {((print as unknown as Record<string, unknown>).jerkEnabled as boolean ?? false) && (<>
          <SectionDivider label="Jerk (mm/s)" />
          <Num label="Print Jerk" unit="mm/s" value={(print as unknown as Record<string, unknown>).jerkPrint as number ?? 10} min={1} max={30} onChange={(v) => upd({ jerkPrint: v })} />
          <Num label="Travel Jerk" unit="mm/s" value={(print as unknown as Record<string, unknown>).jerkTravel as number ?? 10} min={1} max={30} onChange={(v) => upd({ jerkTravel: v })} />
          <Num label="Wall Jerk" unit="mm/s" value={(print as unknown as Record<string, unknown>).jerkWall as number ?? 8} min={1} max={30} onChange={(v) => upd({ jerkWall: v })} />
          <Num label="Infill Jerk" unit="mm/s" value={(print as unknown as Record<string, unknown>).jerkInfill as number ?? 10} min={1} max={30} onChange={(v) => upd({ jerkInfill: v })} />
          <Num label="Top/Bottom Jerk" unit="mm/s" value={(print as unknown as Record<string, unknown>).jerkTopBottom as number ?? 8} min={1} max={30} onChange={(v) => upd({ jerkTopBottom: v })} />
        </>)}
      </SlicerSection>

      <SlicerSection title="Mesh Fixes" defaultOpen={false}>
        <Check label="Union Overlapping Volumes" value={(print as unknown as Record<string, unknown>).unionOverlappingVolumes as boolean ?? true} onChange={(v) => upd({ unionOverlappingVolumes: v })} />
        <Check label="Remove All Holes" value={(print as unknown as Record<string, unknown>).removeAllHoles as boolean ?? false} onChange={(v) => upd({ removeAllHoles: v })} />
        <Check label="Extensive Stitching" value={(print as unknown as Record<string, unknown>).extensiveStitching as boolean ?? false} onChange={(v) => upd({ extensiveStitching: v })} />
        <Check label="Keep Disconnected Faces" value={(print as unknown as Record<string, unknown>).keepDisconnectedFaces as boolean ?? false} onChange={(v) => upd({ keepDisconnectedFaces: v })} />
        <SectionDivider label="Precision" />
        <Num label="Maximum Resolution" unit="mm" value={(print as unknown as Record<string, unknown>).maxResolution as number ?? 0.5} step={0.01} min={0.01} max={2} onChange={(v) => upd({ maxResolution: v })} />
        <Num label="Maximum Deviation" unit="mm" value={(print as unknown as Record<string, unknown>).maxDeviation as number ?? 0.025} step={0.005} min={0.001} max={1} onChange={(v) => upd({ maxDeviation: v })} />
        <Num label="Max Travel Resolution" unit="mm" value={(print as unknown as Record<string, unknown>).maxTravelResolution as number ?? 0.8} step={0.1} min={0.1} max={5} onChange={(v) => upd({ maxTravelResolution: v })} />
      </SlicerSection>
    </>
  );
}
