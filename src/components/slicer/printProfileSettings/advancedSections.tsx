import type { PrintSettingsSectionProps } from './shared';
import { Tier } from './shared';
import { SlicerSection } from '../SlicerSection';
import { Check, Num, SectionDivider, Sel } from '../workspace/settings/controls/SettingsFieldControls';
import { getSettingHelp } from '../../../utils/settingsHelpContent';

export function AccelerationSection({ print, upd, isVisible, showHelp, machineSourcedFields, checkFirmware }: PrintSettingsSectionProps) {
  if (!isVisible('acceleration')) return null;

  return (
    <SlicerSection title="Acceleration & Jerk" color="#fb7185" defaultOpen={false}>
      <Tier level="expert">
        <Check label="Enable Travel Acceleration" value={print.travelAccelerationEnabled ?? false} onChange={(v) => upd({ travelAccelerationEnabled: v })} firmwareUnsupported={checkFirmware('travelAccelerationEnabled')} />
        <Check label="Enable Travel Jerk" value={print.travelJerkEnabled ?? false} onChange={(v) => upd({ travelJerkEnabled: v })} firmwareUnsupported={checkFirmware('travelJerkEnabled')} />
      </Tier>
      <Check label="Enable Acceleration Control" value={print.accelerationEnabled ?? false} onChange={(v) => upd({ accelerationEnabled: v })} machineSourced={machineSourcedFields.has('accelerationEnabled')} helpBrief={getSettingHelp('accelerationEnabled')?.brief} onShowHelp={() => showHelp('accelerationEnabled', 'Enable Acceleration Control')} />
      {(print.accelerationEnabled ?? false) && (
        <>
          <SectionDivider label="Acceleration (mm/sÂ²)" />
          <Num label="Print" unit="mm/sÂ²" value={print.accelerationPrint ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationPrint: v })} machineSourced={machineSourcedFields.has('accelerationPrint')} helpBrief={getSettingHelp('accelerationPrint')?.brief} onShowHelp={() => showHelp('accelerationPrint', 'Print Acceleration')} />
          <Num label="Travel" unit="mm/sÂ²" value={print.accelerationTravel ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationTravel: v })} machineSourced={machineSourcedFields.has('accelerationTravel')} firmwareUnsupported={checkFirmware('accelerationTravel')} helpBrief={getSettingHelp('accelerationTravel')?.brief} onShowHelp={() => showHelp('accelerationTravel', 'Travel Acceleration')} />
          <Num label="Outer Wall" unit="mm/sÂ²" value={print.accelerationWall ?? 1000} min={100} max={20000} onChange={(v) => upd({ accelerationWall: v })} machineSourced={machineSourcedFields.has('accelerationWall')} helpBrief={getSettingHelp('accelerationWall')?.brief} onShowHelp={() => showHelp('accelerationWall', 'Wall Acceleration')} />
          <Tier level="expert">
            <Num label="Outer Wall (separate)" unit="mm/sÂ²" value={print.accelerationOuterWall ?? (print.accelerationWall ?? 1000)} min={100} max={20000} onChange={(v) => upd({ accelerationOuterWall: v })} />
            <Num label="Inner Wall" unit="mm/sÂ²" value={print.accelerationInnerWall ?? (print.accelerationWall ?? 1000)} min={100} max={20000} onChange={(v) => upd({ accelerationInnerWall: v })} />
            <Num label="Skirt/Brim" unit="mm/sÂ²" value={print.accelerationSkirtBrim ?? (print.accelerationPrint ?? 3000)} min={100} max={20000} onChange={(v) => upd({ accelerationSkirtBrim: v })} />
            <Num label="Initial Layer" unit="mm/sÂ²" value={print.accelerationInitialLayer ?? (print.accelerationPrint ?? 3000)} min={100} max={20000} onChange={(v) => upd({ accelerationInitialLayer: v })} />
          </Tier>
          <Num label="Infill" unit="mm/sÂ²" value={print.accelerationInfill ?? 3000} min={100} max={20000} onChange={(v) => upd({ accelerationInfill: v })} machineSourced={machineSourcedFields.has('accelerationInfill')} helpBrief={getSettingHelp('accelerationInfill')?.brief} onShowHelp={() => showHelp('accelerationInfill', 'Infill Acceleration')} />
          <Num label="Top/Bottom" unit="mm/sÂ²" value={print.accelerationTopBottom ?? 1000} min={100} max={20000} onChange={(v) => upd({ accelerationTopBottom: v })} machineSourced={machineSourcedFields.has('accelerationTopBottom')} helpBrief={getSettingHelp('accelerationTopBottom')?.brief} onShowHelp={() => showHelp('accelerationTopBottom', 'Top/Bottom Acceleration')} />
          <Num label="Support" unit="mm/sÂ²" value={print.accelerationSupport ?? 2000} min={100} max={20000} onChange={(v) => upd({ accelerationSupport: v })} machineSourced={machineSourcedFields.has('accelerationSupport')} helpBrief={getSettingHelp('accelerationSupport')?.brief} onShowHelp={() => showHelp('accelerationSupport', 'Support Acceleration')} />
        </>
      )}
      <Check label="Enable Jerk Control" value={print.jerkEnabled ?? false} onChange={(v) => upd({ jerkEnabled: v })} machineSourced={machineSourcedFields.has('jerkEnabled')} helpBrief={getSettingHelp('jerkEnabled')?.brief} onShowHelp={() => showHelp('jerkEnabled', 'Enable Jerk Control')} />
      {(print.jerkEnabled ?? false) && (
        <>
          <SectionDivider label="Jerk (mm/s)" />
          <Num label="Print Jerk" unit="mm/s" value={print.jerkPrint ?? 10} min={1} max={30} onChange={(v) => upd({ jerkPrint: v })} machineSourced={machineSourcedFields.has('jerkPrint')} helpBrief={getSettingHelp('jerkPrint')?.brief} onShowHelp={() => showHelp('jerkPrint', 'Print Jerk')} />
          <Num label="Travel Jerk" unit="mm/s" value={print.jerkTravel ?? 10} min={1} max={30} onChange={(v) => upd({ jerkTravel: v })} machineSourced={machineSourcedFields.has('jerkTravel')} firmwareUnsupported={checkFirmware('jerkTravel')} helpBrief={getSettingHelp('jerkTravel')?.brief} onShowHelp={() => showHelp('jerkTravel', 'Travel Jerk')} />
          <Num label="Wall Jerk" unit="mm/s" value={print.jerkWall ?? 8} min={1} max={30} onChange={(v) => upd({ jerkWall: v })} machineSourced={machineSourcedFields.has('jerkWall')} helpBrief={getSettingHelp('jerkWall')?.brief} onShowHelp={() => showHelp('jerkWall', 'Wall Jerk')} />
          <Tier level="expert">
            <Num label="Outer Wall Jerk" unit="mm/s" value={print.jerkOuterWall ?? (print.jerkWall ?? 8)} min={1} max={30} onChange={(v) => upd({ jerkOuterWall: v })} />
            <Num label="Inner Wall Jerk" unit="mm/s" value={print.jerkInnerWall ?? (print.jerkWall ?? 8)} min={1} max={30} onChange={(v) => upd({ jerkInnerWall: v })} />
            <Num label="Support Jerk" unit="mm/s" value={print.jerkSupport ?? (print.jerkPrint ?? 10)} min={1} max={30} onChange={(v) => upd({ jerkSupport: v })} />
            <Num label="Skirt/Brim Jerk" unit="mm/s" value={print.jerkSkirtBrim ?? (print.jerkPrint ?? 10)} min={1} max={30} onChange={(v) => upd({ jerkSkirtBrim: v })} />
            <Num label="Initial Layer Jerk" unit="mm/s" value={print.jerkInitialLayer ?? (print.jerkPrint ?? 10)} min={1} max={30} onChange={(v) => upd({ jerkInitialLayer: v })} />
          </Tier>
          <Num label="Infill Jerk" unit="mm/s" value={print.jerkInfill ?? 10} min={1} max={30} onChange={(v) => upd({ jerkInfill: v })} machineSourced={machineSourcedFields.has('jerkInfill')} helpBrief={getSettingHelp('jerkInfill')?.brief} onShowHelp={() => showHelp('jerkInfill', 'Infill Jerk')} />
          <Num label="Top/Bottom Jerk" unit="mm/s" value={print.jerkTopBottom ?? 8} min={1} max={30} onChange={(v) => upd({ jerkTopBottom: v })} machineSourced={machineSourcedFields.has('jerkTopBottom')} helpBrief={getSettingHelp('jerkTopBottom')?.brief} onShowHelp={() => showHelp('jerkTopBottom', 'Top/Bottom Jerk')} />
        </>
      )}
    </SlicerSection>
  );
}

export function MeshFixesSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('meshFixes')) return null;
  return (
    <SlicerSection title="Mesh Fixes" color="#34d399" defaultOpen={false}>
      <Check label="Union Overlapping Volumes" value={print.unionOverlappingVolumes ?? true} onChange={(v) => upd({ unionOverlappingVolumes: v })} helpBrief={getSettingHelp('unionOverlappingVolumes')?.brief} onShowHelp={() => showHelp('unionOverlappingVolumes', 'Union Overlapping Volumes')} />
      <Check label="Remove All Holes" value={print.removeAllHoles ?? false} onChange={(v) => upd({ removeAllHoles: v })} helpBrief={getSettingHelp('removeAllHoles')?.brief} onShowHelp={() => showHelp('removeAllHoles', 'Remove All Holes')} />
      <Check label="Extensive Stitching" value={print.extensiveStitching ?? false} onChange={(v) => upd({ extensiveStitching: v })} helpBrief={getSettingHelp('extensiveStitching')?.brief} onShowHelp={() => showHelp('extensiveStitching', 'Extensive Stitching')} />
      <Check label="Keep Disconnected Faces" value={print.keepDisconnectedFaces ?? false} onChange={(v) => upd({ keepDisconnectedFaces: v })} />
      <SectionDivider label="Precision" />
      <Num label="Maximum Resolution" unit="mm" value={print.maxResolution ?? 0.5} step={0.01} min={0.01} max={2} onChange={(v) => upd({ maxResolution: v })} helpBrief={getSettingHelp('maxResolution')?.brief} onShowHelp={() => showHelp('maxResolution', 'Maximum Resolution')} />
      <Num label="Maximum Deviation" unit="mm" value={print.maxDeviation ?? 0.025} step={0.005} min={0.001} max={1} onChange={(v) => upd({ maxDeviation: v })} helpBrief={getSettingHelp('maxDeviation')?.brief} onShowHelp={() => showHelp('maxDeviation', 'Maximum Deviation')} />
      <Num label="Max Travel Resolution" unit="mm" value={print.maxTravelResolution ?? 0.8} step={0.1} min={0.1} max={5} onChange={(v) => upd({ maxTravelResolution: v })} helpBrief={getSettingHelp('maxTravelResolution')?.brief} onShowHelp={() => showHelp('maxTravelResolution', 'Max Travel Resolution')} />
    </SlicerSection>
  );
}

export function CompensationSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('compensation')) return null;
  return (
    <SlicerSection title="Dimensional Compensation" color="#c084fc" defaultOpen={false}>
      <Num label="Horizontal Expansion" unit="mm" value={print.horizontalExpansion ?? 0} step={0.01} min={-1} max={1} onChange={(v) => upd({ horizontalExpansion: v })} helpBrief={getSettingHelp('horizontalExpansion')?.brief} onShowHelp={() => showHelp('horizontalExpansion', 'Horizontal Expansion')} />
      <Num label="Initial Layer Horizontal Expansion" unit="mm" value={print.initialLayerHorizontalExpansion ?? 0} step={0.01} min={-1} max={1} onChange={(v) => upd({ initialLayerHorizontalExpansion: v })} helpBrief={getSettingHelp('initialLayerHorizontalExpansion')?.brief} onShowHelp={() => showHelp('initialLayerHorizontalExpansion', 'Initial Layer Horizontal Expansion')} />
      <Num label="Hole Horizontal Expansion" unit="mm" value={print.holeHorizontalExpansion ?? 0} step={0.01} min={-1} max={1} onChange={(v) => upd({ holeHorizontalExpansion: v })} helpBrief={getSettingHelp('holeHorizontalExpansion')?.brief} onShowHelp={() => showHelp('holeHorizontalExpansion', 'Hole Horizontal Expansion')} />
      <Num label="Elephant Foot Compensation" unit="mm" value={print.elephantFootCompensation ?? 0} step={0.01} min={0} max={1} onChange={(v) => upd({ elephantFootCompensation: v })} helpBrief={getSettingHelp('elephantFootCompensation')?.brief} onShowHelp={() => showHelp('elephantFootCompensation', 'Elephant Foot Compensation')} />
    </SlicerSection>
  );
}

export function FlowSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('flow')) return null;
  return (
    <SlicerSection title="Flow" color="#f472b6" defaultOpen={false}>
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
        <Num label="Max Volumetric Flow Rate" unit="mmÂ³/s" value={print.maxFlowRate ?? 0} step={0.5} min={0} max={50} onChange={(v) => upd({ maxFlowRate: v })} />
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
    </SlicerSection>
  );
}

export function BridgingSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('bridging')) return null;
  return (
    <SlicerSection title="Bridging" color="#38bdf8" defaultOpen={false}>
      <Check label="Enable Advanced Bridge Settings" value={print.enableBridgeSettings ?? false} onChange={(v) => upd({ enableBridgeSettings: v })} helpBrief={getSettingHelp('enableBridgeSettings')?.brief} onShowHelp={() => showHelp('enableBridgeSettings', 'Enable Advanced Bridge Settings')} />
      {(print.enableBridgeSettings ?? false) && (
        <>
          <Num label="Bridge Wall Speed" unit="mm/s" value={print.bridgeWallSpeed ?? 30} min={1} max={200} onChange={(v) => upd({ bridgeWallSpeed: v })} helpBrief={getSettingHelp('bridgeWallSpeed')?.brief} onShowHelp={() => showHelp('bridgeWallSpeed', 'Bridge Wall Speed')} />
          <Num label="Bridge Skin Speed" unit="mm/s" value={print.bridgeSkinSpeed ?? 30} min={1} max={200} onChange={(v) => upd({ bridgeSkinSpeed: v })} helpBrief={getSettingHelp('bridgeSkinSpeed')?.brief} onShowHelp={() => showHelp('bridgeSkinSpeed', 'Bridge Skin Speed')} />
          <Num label="Bridge Skin Flow" unit="%" value={print.bridgeSkinFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ bridgeSkinFlow: v })} helpBrief={getSettingHelp('bridgeSkinFlow')?.brief} onShowHelp={() => showHelp('bridgeSkinFlow', 'Bridge Skin Flow')} />
          <Num label="Bridge Angle (0 = auto)" unit="Â°" value={print.bridgeAngle ?? 0} min={0} max={359} onChange={(v) => upd({ bridgeAngle: v })} helpBrief={getSettingHelp('bridgeAngle')?.brief} onShowHelp={() => showHelp('bridgeAngle', 'Bridge Angle')} />
          <Num label="Bridge Min Wall Line Width" unit="mm" value={print.bridgeMinWallLineWidth ?? 0.2} step={0.01} min={0.05} max={2} onChange={(v) => upd({ bridgeMinWallLineWidth: v })} />
          <Num label="Bridge Sparse Infill Max Density" unit="%" value={print.bridgeSparseInfillMaxDensity ?? 0} step={1} min={0} max={100} onChange={(v) => upd({ bridgeSparseInfillMaxDensity: v })} />
          <Num label="Bridge Skin Density" unit="%" value={print.bridgeSkinDensity ?? 100} step={1} min={0} max={100} onChange={(v) => upd({ bridgeSkinDensity: v })} />
          <Check label="Interlace Bridge Lines" value={print.interlaceBridgeLines ?? false} onChange={(v) => upd({ interlaceBridgeLines: v })} />
          <Check label="Bridge Has Multiple Layers" value={print.bridgeHasMultipleLayers ?? false} onChange={(v) => upd({ bridgeHasMultipleLayers: v })} />
          <SectionDivider label="Multi-Layer Bridge" />
          <Check label="Apply to Layers Above First Bridge" value={print.bridgeEnableMoreLayers ?? false} onChange={(v) => upd({ bridgeEnableMoreLayers: v })} />
          {(print.bridgeEnableMoreLayers ?? false) && (
            <>
              <Num label="Fan Speed (Layer 2)" unit="%" value={print.bridgeFanSpeed2 ?? 50} step={1} min={0} max={100} onChange={(v) => upd({ bridgeFanSpeed2: v })} />
              <Num label="Fan Speed (Layer 3)" unit="%" value={print.bridgeFanSpeed3 ?? 25} step={1} min={0} max={100} onChange={(v) => upd({ bridgeFanSpeed3: v })} />
            </>
          )}
        </>
      )}
    </SlicerSection>
  );
}

export function SmallFeaturesSection({ print, upd, isVisible }: PrintSettingsSectionProps) {
  if (!isVisible('smallFeatures')) return null;
  return (
    <SlicerSection title="Small Features" color="#fbbf24" defaultOpen={false}>
      <Num label="Small Feature Max Length" unit="mm" value={print.smallFeatureMaxLength ?? 0} step={0.1} min={0} max={20} onChange={(v) => upd({ smallFeatureMaxLength: v })} />
      <Num label="Small Feature Speed" unit="%" value={print.smallFeatureSpeedFactor ?? 50} step={5} min={10} max={100} onChange={(v) => upd({ smallFeatureSpeedFactor: v })} />
      <Num label="Small Feature Speed (Initial Layer)" unit="%" value={print.smallFeatureInitialLayerSpeedFactor ?? 50} step={5} min={10} max={100} onChange={(v) => upd({ smallFeatureInitialLayerSpeedFactor: v })} />
      <Num label="Small Hole Max Size" unit="mm" value={print.smallHoleMaxSize ?? 0} step={0.1} min={0} max={20} onChange={(v) => upd({ smallHoleMaxSize: v })} />
    </SlicerSection>
  );
}

export function PrimeTowerSection({ print, upd, isVisible }: PrintSettingsSectionProps) {
  if (!isVisible('primeTower')) return null;
  return (
    <SlicerSection title="Prime Tower" color="#a3e635" defaultOpen={false}>
      <Check label="Enable Prime Tower" value={print.primeTowerEnable ?? false} onChange={(v) => upd({ primeTowerEnable: v })} />
      {(print.primeTowerEnable ?? false) && (
        <>
          <Num label="Tower Size" unit="mm" value={print.primeTowerSize ?? 20} step={1} min={5} max={60} onChange={(v) => upd({ primeTowerSize: v })} />
          <Num label="Position X" unit="mm" value={print.primeTowerPositionX ?? 200} step={1} min={0} max={500} onChange={(v) => upd({ primeTowerPositionX: v })} />
          <Num label="Position Y" unit="mm" value={print.primeTowerPositionY ?? 200} step={1} min={0} max={500} onChange={(v) => upd({ primeTowerPositionY: v })} />
          <Num label="Min Volume per Change" unit="mmÂ³" value={print.primeTowerMinVolume ?? 6} step={0.5} min={0} max={50} onChange={(v) => upd({ primeTowerMinVolume: v })} />
          <Check label="Wipe on Tower" value={print.primeTowerWipeEnable ?? true} onChange={(v) => upd({ primeTowerWipeEnable: v })} />
        </>
      )}
    </SlicerSection>
  );
}

export function ModifierMeshesSection({ print, isVisible }: PrintSettingsSectionProps) {
  if (!isVisible('modifierMeshes')) return null;
  const modifierMeshRole = (print as typeof print & { _modifierMeshRole?: string })._modifierMeshRole ?? 'normal';

  return (
    <SlicerSection title="Modifier Meshes" color="#f59e0b" defaultOpen={false}>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted, #999)', margin: '4px 0 8px' }}>
        Modifier meshes are assigned per-object in the 3D viewport. Select an object, then choose a role below to apply local overrides to slicing behaviour inside that volume.
      </p>
      <Sel
        label="Role"
        value={modifierMeshRole}
        options={[
          { value: 'normal', label: 'Normal (no modifier)' },
          { value: 'infill_mesh', label: 'Infill Mesh' },
          { value: 'cutting_mesh', label: 'Cutting Mesh' },
          { value: 'support_mesh', label: 'Support Mesh' },
          { value: 'anti_overhang_mesh', label: 'Anti-Overhang Mesh' },
        ]}
        onChange={() => {}}
      />
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #999)', margin: '4px 0 0' }}>
        Per-mesh settings (infill density, pattern, etc.) are configured in the object properties panel.
      </p>
    </SlicerSection>
  );
}
