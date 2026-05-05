import type { PrintSettingsSectionProps } from './shared';
import { AdvancedDivider, Tier } from './shared';
import { SlicerSection } from '../SlicerSection';
import { Check, Density, Num, SectionDivider, Sel } from '../workspace/settings/controls/SettingsFieldControls';
import { getSettingHelp } from '../../../utils/settingsHelpContent';

export function SupportSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('support')) return null;

  return (
    <SlicerSection title="Support" color="#facc15" defaultOpen={print.supportEnabled}>
      <Check label="Enable Support" value={print.supportEnabled} onChange={(v) => upd({ supportEnabled: v })} helpBrief={getSettingHelp('supportEnabled')?.brief} onShowHelp={() => showHelp('supportEnabled', 'Enable Support')} />
      {print.supportEnabled && (
        <>
          <Num label="Overhang Angle" unit="Â°" value={print.supportAngle} min={0} max={89} onChange={(v) => upd({ supportAngle: v })} helpBrief={getSettingHelp('supportAngle')?.brief} onShowHelp={() => showHelp('supportAngle', 'Support Angle')} />
          <Tier min="advanced">
            <Sel label="Support Structure" value={print.supportType} onChange={(v) => upd({ supportType: v })} options={[{ value: 'normal', label: 'Normal' }, { value: 'tree', label: 'Tree' }, { value: 'organic', label: 'Organic' }]} helpBrief={getSettingHelp('supportType')?.brief} onShowHelp={() => showHelp('supportType', 'Support Structure')} />
            <Density value={print.supportDensity} onChange={(v) => upd({ supportDensity: v })} />
            <Sel label="Support Pattern" value={print.supportPattern} onChange={(v) => upd({ supportPattern: v })} options={[{ value: 'lines', label: 'Lines' }, { value: 'grid', label: 'Grid' }, { value: 'zigzag', label: 'Zigzag' }]} helpBrief={getSettingHelp('supportPattern')?.brief} onShowHelp={() => showHelp('supportPattern', 'Support Pattern')} />
            <SectionDivider label="Distances" />
            <Num label="Z Distance" unit="mm" value={print.supportZDistance} step={0.05} min={0} max={5} onChange={(v) => upd({ supportZDistance: v })} helpBrief={getSettingHelp('supportZDistance')?.brief} onShowHelp={() => showHelp('supportZDistance', 'Support Z Distance')} />
            <Tier level="expert"><Num label="Top Distance" unit="mm" value={print.supportTopDistance ?? print.supportZDistance} step={0.05} min={0} max={5} onChange={(v) => upd({ supportTopDistance: v })} /></Tier>
            <Num label="XY Distance" unit="mm" value={print.supportXYDistance} step={0.05} min={0} max={5} onChange={(v) => upd({ supportXYDistance: v })} helpBrief={getSettingHelp('supportXYDistance')?.brief} onShowHelp={() => showHelp('supportXYDistance', 'Support XY Distance')} />
            <SectionDivider label="Interface" />
            <Check label="Support Interface Layers" value={print.supportInterface} onChange={(v) => upd({ supportInterface: v })} helpBrief={getSettingHelp('supportInterface')?.brief} onShowHelp={() => showHelp('supportInterface', 'Support Interface')} />
            {print.supportInterface && <Num label="Interface Layer Count" value={print.supportInterfaceLayers} min={1} max={10} onChange={(v) => upd({ supportInterfaceLayers: v })} />}
          </Tier>
          <Tier min="expert">
            {(print.supportType === 'tree' || print.supportType === 'organic') && (
              <>
                <SectionDivider label="Tree Support" />
                <Num label="Branch Angle" unit="Â°" value={print.supportTreeAngle ?? 60} min={10} max={85} onChange={(v) => upd({ supportTreeAngle: v })} helpBrief={getSettingHelp('supportTreeAngle')?.brief} onShowHelp={() => showHelp('supportTreeAngle', 'Tree Branch Angle')} />
                <Num label="Branch Diameter" unit="mm" value={print.supportTreeBranchDiameter ?? 5} step={0.5} min={1} max={20} onChange={(v) => upd({ supportTreeBranchDiameter: v })} helpBrief={getSettingHelp('supportTreeBranchDiameter')?.brief} onShowHelp={() => showHelp('supportTreeBranchDiameter', 'Tree Branch Diameter')} />
                <Num label="Tip Diameter" unit="mm" value={print.supportTreeTipDiameter ?? 0.8} step={0.1} min={0.1} max={5} onChange={(v) => upd({ supportTreeTipDiameter: v })} />
                <Num label="Max Branch Diameter" unit="mm" value={print.supportTreeMaxBranchDiameter ?? 25} step={0.5} min={1} max={100} onChange={(v) => upd({ supportTreeMaxBranchDiameter: v })} />
                <Num label="Branch Diameter Angle" unit="Â°" value={print.supportTreeBranchDiameterAngle ?? 0} min={0} max={45} onChange={(v) => upd({ supportTreeBranchDiameterAngle: v })} />
                <Num label="Min Height" unit="mm" value={print.supportTreeMinHeight ?? 0} step={0.5} min={0} max={50} onChange={(v) => upd({ supportTreeMinHeight: v })} />
                <Check label="Build Plate Roots Only" value={print.supportTreeBuildplateOnly ?? false} onChange={(v) => upd({ supportTreeBuildplateOnly: v })} />
              </>
            )}
            <SectionDivider label="Placement" />
            <Check label="Build Plate Only" value={print.supportBuildplateOnly ?? false} onChange={(v) => upd({ supportBuildplateOnly: v })} helpBrief={getSettingHelp('supportBuildplateOnly')?.brief} onShowHelp={() => showHelp('supportBuildplateOnly', 'Build Plate Only')} />
            <Num label="Support Wall Count" value={print.supportWallCount ?? 0} min={0} max={5} onChange={(v) => upd({ supportWallCount: v })} />
            <Num label="Bottom Support Distance" unit="mm" value={print.supportBottomDistance ?? 0.2} step={0.05} min={0} max={5} onChange={(v) => upd({ supportBottomDistance: v })} />
            <Num label="Min Support XY Distance" unit="mm" value={print.minSupportXYDistance ?? 0} step={0.05} min={0} max={5} onChange={(v) => upd({ minSupportXYDistance: v })} />
            <Num label="Support Wall Count" value={print.supportWallLineCount ?? 0} min={0} max={5} onChange={(v) => upd({ supportWallLineCount: v })} />
            <Num label="Initial Layer Support Line Distance" unit="mm" value={print.initialLayerSupportLineDistance ?? 0} step={0.1} min={0} max={20} onChange={(v) => upd({ initialLayerSupportLineDistance: v })} />
            <Num label="Initial Layer Support Density Multiplier" unit="%" value={print.supportInfillDensityMultiplierInitialLayer ?? 100} step={5} min={0} max={500} onChange={(v) => upd({ supportInfillDensityMultiplierInitialLayer: v })} />
            <Num label="Fan Speed Override" unit="%" value={print.supportFanSpeedOverride ?? 0} step={1} min={0} max={100} onChange={(v) => upd({ supportFanSpeedOverride: v })} />
            <SectionDivider label="Gradual Support" />
            <Num label="Gradual Support Steps" value={print.gradualSupportSteps ?? 0} min={0} max={10} onChange={(v) => upd({ gradualSupportSteps: v })} />
            {(print.gradualSupportSteps ?? 0) > 0 && <Num label="Gradual Step Height" unit="mm" value={print.gradualSupportStepHeight ?? 1.0} step={0.1} min={0.1} max={10} onChange={(v) => upd({ gradualSupportStepHeight: v })} />}
            <SectionDivider label="Roof / Floor" />
            <Check label="Support Roof" value={print.supportRoofEnable ?? false} onChange={(v) => upd({ supportRoofEnable: v })} />
            <Check label="Support Floor" value={print.supportFloorEnable ?? false} onChange={(v) => upd({ supportFloorEnable: v })} />
            {((print.supportRoofEnable ?? false) || (print.supportFloorEnable ?? false)) && (
              <>
                <Sel label="Interface Pattern" value={print.supportInterfacePattern ?? 'lines'} onChange={(v) => upd({ supportInterfacePattern: v })} options={[{ value: 'lines', label: 'Lines' }, { value: 'grid', label: 'Grid' }, { value: 'concentric', label: 'Concentric' }, { value: 'zigzag', label: 'Zigzag' }]} />
                <Num label="Interface Density" unit="%" value={print.supportInterfaceDensity ?? 100} min={0} max={100} onChange={(v) => upd({ supportInterfaceDensity: v })} />
                <Num label="Roof Density" unit="%" value={print.supportRoofDensity ?? (print.supportInterfaceDensity ?? 100)} min={0} max={100} onChange={(v) => upd({ supportRoofDensity: v })} />
                <Num label="Floor Density" unit="%" value={print.supportFloorDensity ?? (print.supportInterfaceDensity ?? 100)} min={0} max={100} onChange={(v) => upd({ supportFloorDensity: v })} />
                <Num label="Roof Thickness" unit="mm" value={print.supportRoofThickness ?? 1.0} step={0.1} min={0} max={10} onChange={(v) => upd({ supportRoofThickness: v })} />
                <Num label="Floor Thickness" unit="mm" value={print.supportFloorThickness ?? 1.0} step={0.1} min={0} max={10} onChange={(v) => upd({ supportFloorThickness: v })} />
                <Sel label="Roof Pattern" value={print.supportRoofPattern ?? 'lines'} onChange={(v) => upd({ supportRoofPattern: v })} options={[{ value: 'lines', label: 'Lines' }, { value: 'grid', label: 'Grid' }, { value: 'concentric', label: 'Concentric' }, { value: 'zigzag', label: 'Zigzag' }]} />
                <Sel label="Floor Pattern" value={print.supportFloorPattern ?? 'lines'} onChange={(v) => upd({ supportFloorPattern: v })} options={[{ value: 'lines', label: 'Lines' }, { value: 'grid', label: 'Grid' }, { value: 'concentric', label: 'Concentric' }, { value: 'zigzag', label: 'Zigzag' }]} />
              </>
            )}
            <SectionDivider label="Towers" />
            <Check label="Use Towers" value={print.useTowers ?? false} onChange={(v) => upd({ useTowers: v })} />
            {(print.useTowers ?? false) && (
              <>
                <Num label="Tower Diameter" unit="mm" value={print.towerDiameter ?? 3.0} step={0.5} min={1} max={20} onChange={(v) => upd({ towerDiameter: v })} />
                <Num label="Tower Roof Angle" unit="Â°" value={print.towerRoofAngle ?? 65} min={0} max={89} onChange={(v) => upd({ towerRoofAngle: v })} />
              </>
            )}
          </Tier>
          <Tier min="advanced">
            <AdvancedDivider />
            <Num label="Support Horizontal Expansion" unit="mm" value={print.supportHorizontalExpansion ?? 0} step={0.1} min={-5} max={5} onChange={(v) => upd({ supportHorizontalExpansion: v })} helpBrief={getSettingHelp('supportHorizontalExpansion')?.brief} onShowHelp={() => showHelp('supportHorizontalExpansion', 'Support Horizontal Expansion')} />
            <Num label="Support Line Distance" unit="mm" value={print.supportLineDistance ?? 0} step={0.1} min={0} max={20} onChange={(v) => upd({ supportLineDistance: v })} />
            <Num label="Support Join Distance" unit="mm" value={print.supportJoinDistance ?? 2} step={0.1} min={0} max={20} onChange={(v) => upd({ supportJoinDistance: v })} helpBrief={getSettingHelp('supportJoinDistance')?.brief} onShowHelp={() => showHelp('supportJoinDistance', 'Support Join Distance')} />
            <Num label="Minimum Support Area" unit="mmÂ²" value={print.minimumSupportArea ?? 0} step={0.5} min={0} max={100} onChange={(v) => upd({ minimumSupportArea: v })} helpBrief={getSettingHelp('minimumSupportArea')?.brief} onShowHelp={() => showHelp('minimumSupportArea', 'Minimum Support Area')} />
            <Num label="Support Infill Layer Thickness" unit="mm" value={print.supportInfillLayerThickness ?? 0} step={0.05} min={0} max={2} onChange={(v) => upd({ supportInfillLayerThickness: v })} />
            <SectionDivider label="Connect / Chain" />
            <Check label="Connect Support Lines" value={print.connectSupportLines ?? false} onChange={(v) => upd({ connectSupportLines: v })} />
            <Check label="Connect Support ZigZags" value={print.connectSupportZigZags ?? false} onChange={(v) => upd({ connectSupportZigZags: v })} />
            <SectionDivider label="Conical Support" />
            <Check label="Enable Conical Support" value={print.enableConicalSupport ?? false} onChange={(v) => upd({ enableConicalSupport: v })} />
            {(print.enableConicalSupport ?? false) && <Num label="Conical Support Angle" unit="Â°" value={print.conicalSupportAngle ?? 30} min={0} max={60} onChange={(v) => upd({ conicalSupportAngle: v })} />}
            <SectionDivider label="Support Brim" />
            <Check label="Enable Support Brim" value={print.enableSupportBrim ?? false} onChange={(v) => upd({ enableSupportBrim: v })} />
            {(print.enableSupportBrim ?? false) && (
              <>
                <Num label="Support Brim Line Count" value={print.supportBrimLineCount ?? 5} min={0} max={50} onChange={(v) => upd({ supportBrimLineCount: v })} />
                <Num label="Support Brim Width" unit="mm" value={print.supportBrimWidth ?? 3} step={0.1} min={0} max={50} onChange={(v) => upd({ supportBrimWidth: v })} />
              </>
            )}
            <SectionDivider label="Stair Step Base" />
            <Num label="Stair Step Height" unit="mm" value={print.supportStairStepHeight ?? 0.3} step={0.05} min={0} max={10} onChange={(v) => upd({ supportStairStepHeight: v })} />
            <Num label="Stair Step Minimum Slope" unit="Â°" value={print.supportStairStepMinSlope ?? 10} min={0} max={89} onChange={(v) => upd({ supportStairStepMinSlope: v })} />
            <Num label="Stair Step Max Width" unit="mm" value={print.supportStairStepMaxWidth ?? 5} step={0.1} min={0} max={50} onChange={(v) => upd({ supportStairStepMaxWidth: v })} />
            <SectionDivider label="Distance Priority" />
            <Sel label="Support Distance Priority" value={print.supportDistancePriority ?? 'xy_overrides_z'} onChange={(v) => upd({ supportDistancePriority: v })} options={[{ value: 'xy_overrides_z', label: 'XY overrides Z' }, { value: 'z_overrides_xy', label: 'Z overrides XY' }]} />
            <SectionDivider label="Break Up Chunks" />
            <Check label="Break Up Support in Chunks" value={print.breakUpSupportInChunks ?? false} onChange={(v) => upd({ breakUpSupportInChunks: v })} />
            {(print.breakUpSupportInChunks ?? false) && (
              <>
                <Num label="Chunk Size" unit="mm" value={print.breakUpSupportChunkSize ?? 20} step={1} min={1} max={100} onChange={(v) => upd({ breakUpSupportChunkSize: v })} />
                <Num label="Chunk Line Count" value={print.breakUpSupportChunkLineCount ?? 5} min={1} max={50} onChange={(v) => upd({ breakUpSupportChunkLineCount: v })} />
              </>
            )}
            <SectionDivider label="Conical Min Width" />
            <Num label="Conical Support Min Width" unit="mm" value={print.conicalSupportMinWidth ?? 5} step={0.5} min={0} max={50} onChange={(v) => upd({ conicalSupportMinWidth: v })} />
          </Tier>
        </>
      )}
    </SlicerSection>
  );
}

export function AdhesionSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('adhesion')) return null;

  return (
    <SlicerSection title="Build Plate Adhesion" color="#4ade80" defaultOpen={false}>
      <Sel label="Type" value={print.adhesionType} onChange={(v) => upd({ adhesionType: v })} options={[{ value: 'none', label: 'None' }, { value: 'skirt', label: 'Skirt' }, { value: 'brim', label: 'Brim' }, { value: 'raft', label: 'Raft' }]} helpBrief={getSettingHelp('adhesionType')?.brief} onShowHelp={() => showHelp('adhesionType', 'Adhesion Type')} />
      <Tier min="expert">
        <SectionDivider label="Prime Blob" />
        <Check label="Enable Prime Blob" value={print.primeBlobEnable ?? false} onChange={(v) => upd({ primeBlobEnable: v })} />
        {(print.primeBlobEnable ?? false) && <Num label="Prime Blob Size" unit="mmÂ³" value={print.primeBlobSize ?? 0.5} step={0.1} min={0.1} max={10} onChange={(v) => upd({ primeBlobSize: v })} />}
      </Tier>
      <Tier min="advanced">
        {print.adhesionType === 'skirt' && (
          <>
            <Num label="Skirt Lines" value={print.skirtLines} min={1} max={20} onChange={(v) => upd({ skirtLines: v })} helpBrief={getSettingHelp('skirtLines')?.brief} onShowHelp={() => showHelp('skirtLines', 'Skirt Lines')} />
            <Num label="Skirt Distance" unit="mm" value={print.skirtDistance} step={0.5} min={0} max={20} onChange={(v) => upd({ skirtDistance: v })} helpBrief={getSettingHelp('skirtDistance')?.brief} onShowHelp={() => showHelp('skirtDistance', 'Skirt Distance')} />
            <Num label="Skirt Height (layers)" value={print.skirtHeight ?? 1} min={1} max={10} onChange={(v) => upd({ skirtHeight: v })} />
            <Num label="Skirt Minimum Length" unit="mm" value={print.skirtBrimMinLength ?? 0} step={10} min={0} max={5000} onChange={(v) => upd({ skirtBrimMinLength: v })} />
          </>
        )}
        {print.adhesionType === 'brim' && (
          <>
            <Num label="Brim Width" unit="mm" value={print.brimWidth} step={0.5} min={0} max={50} onChange={(v) => upd({ brimWidth: v })} helpBrief={getSettingHelp('brimWidth')?.brief} onShowHelp={() => showHelp('brimWidth', 'Brim Width')} />
            <Num label="Brim Gap" unit="mm" value={print.brimGap ?? 0} step={0.1} min={0} max={5} onChange={(v) => upd({ brimGap: v })} />
            <Sel label="Brim Location" value={print.brimLocation ?? 'outside'} onChange={(v) => upd({ brimLocation: v })} options={[{ value: 'outside', label: 'Outside' }, { value: 'inside', label: 'Inside' }, { value: 'everywhere', label: 'Everywhere' }]} />
            <Num label="Brim Avoid Margin" unit="mm" value={print.brimAvoidMargin ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ brimAvoidMargin: v })} />
            <Check label="Smart Brim" value={print.smartBrim ?? false} onChange={(v) => upd({ smartBrim: v })} />
          </>
        )}
        {print.adhesionType === 'raft' && (
          <>
            <Num label="Raft Layers" value={print.raftLayers} min={1} max={10} onChange={(v) => upd({ raftLayers: v })} helpBrief={getSettingHelp('raftLayers')?.brief} onShowHelp={() => showHelp('raftLayers', 'Raft Layers')} />
            <Num label="Raft Margin" unit="mm" value={print.raftMargin ?? 5} step={0.5} min={0} max={30} onChange={(v) => upd({ raftMargin: v })} helpBrief={getSettingHelp('raftMargin')?.brief} onShowHelp={() => showHelp('raftMargin', 'Raft Margin')} />
          </>
        )}
      </Tier>
      <Tier min="expert">
        <SectionDivider label="First Layer" />
        <Num label="Initial Layer Z Overlap" unit="mm" value={print.initialLayerZOverlap ?? 0} step={0.01} min={0} max={0.5} onChange={(v) => upd({ initialLayerZOverlap: v })} />
        {print.adhesionType === 'raft' && (
          <>
            <SectionDivider label="Raft Layers (Advanced)" />
            <Num label="Base Thickness" unit="mm" value={print.raftBaseThickness ?? 0.3} step={0.05} min={0.1} max={2} onChange={(v) => upd({ raftBaseThickness: v })} />
            <Num label="Base Line Width" unit="mm" value={print.raftBaseLineWidth ?? 0.8} step={0.05} min={0.1} max={3} onChange={(v) => upd({ raftBaseLineWidth: v })} />
            <Num label="Base Speed" unit="mm/s" value={print.raftBaseSpeed ?? 20} min={1} max={200} onChange={(v) => upd({ raftBaseSpeed: v })} />
            <Num label="Interface Thickness" unit="mm" value={print.raftInterfaceThickness ?? 0.27} step={0.05} min={0.1} max={2} onChange={(v) => upd({ raftInterfaceThickness: v })} />
            <Num label="Surface Air Gap" unit="mm" value={print.raftAirGap ?? 0.3} step={0.05} min={0} max={2} onChange={(v) => upd({ raftAirGap: v })} />
          </>
        )}
      </Tier>
      {print.adhesionType === 'raft' && (
        <Tier min="advanced">
          <AdvancedDivider label="Advanced Â· Raft" />
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
          <Num label="Raft Print Acceleration" unit="mm/sÂ²" value={print.raftPrintAcceleration ?? 0} step={100} min={0} max={10000} onChange={(v) => upd({ raftPrintAcceleration: v })} />
          <Num label="Raft Print Jerk" unit="mm/s" value={print.raftPrintJerk ?? 0} step={0.5} min={0} max={30} onChange={(v) => upd({ raftPrintJerk: v })} />
          <Num label="Raft Fan Speed" unit="%" value={print.raftFanSpeed ?? 0} step={1} min={0} max={100} onChange={(v) => upd({ raftFanSpeed: v })} />
          <Num label="Raft Flow" unit="%" value={print.raftFlow ?? 100} step={1} min={0} max={200} onChange={(v) => upd({ raftFlow: v })} />
          <Check label="Monotonic Raft Top Surface" value={print.monotonicRaftTopSurface ?? false} onChange={(v) => upd({ monotonicRaftTopSurface: v })} />
          <Check label="Remove Raft Inside Corners" value={print.removeRaftInsideCorners ?? false} onChange={(v) => upd({ removeRaftInsideCorners: v })} />
        </Tier>
      )}
    </SlicerSection>
  );
}

export function SpecialModesSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('specialModes')) return null;

  return (
    <SlicerSection title="Special Modes" color="#e879f9" defaultOpen={false}>
      <Check label="Relative Extrusion (M83)" value={print.relativeExtrusion ?? false} onChange={(v) => upd({ relativeExtrusion: v })} helpBrief={getSettingHelp('relativeExtrusion')?.brief} onShowHelp={() => showHelp('relativeExtrusion', 'Relative Extrusion')} />
      <Check label="Vase Mode (Spiralize Contour)" value={print.spiralizeContour ?? false} onChange={(v) => upd({ spiralizeContour: v })} helpBrief={getSettingHelp('spiralizeContour')?.brief} onShowHelp={() => showHelp('spiralizeContour', 'Vase Mode')} />
      {(print.spiralizeContour ?? false) && <Tier level="expert"><Check label="Smooth Spiralized Contours" value={print.smoothSpiralizedContours ?? false} onChange={(v) => upd({ smoothSpiralizedContours: v })} /></Tier>}
      <Sel label="Surface Mode" value={print.surfaceMode ?? 'normal'} onChange={(v) => upd({ surfaceMode: v })} options={[{ value: 'normal', label: 'Normal â€” solid model' }, { value: 'surface', label: 'Surface â€” shell only' }, { value: 'both', label: 'Both â€” normal + surface' }]} helpBrief={getSettingHelp('surfaceMode')?.brief} onShowHelp={() => showHelp('surfaceMode', 'Surface Mode')} />
      <Sel label="Print Sequence" value={print.printSequence ?? 'all_at_once'} onChange={(v) => upd({ printSequence: v })} options={[{ value: 'all_at_once', label: 'All at Once' }, { value: 'one_at_a_time', label: 'One at a Time' }]} helpBrief={getSettingHelp('printSequence')?.brief} onShowHelp={() => showHelp('printSequence', 'Print Sequence')} />
      <SectionDivider label="Mold" />
      <Check label="Enable Mold Mode" value={print.moldEnabled ?? false} onChange={(v) => upd({ moldEnabled: v })} helpBrief={getSettingHelp('moldEnabled')?.brief} onShowHelp={() => showHelp('moldEnabled', 'Enable Mold Mode')} />
      {(print.moldEnabled ?? false) && (
        <>
          <Num label="Mold Draft Angle" unit="Â°" value={print.moldAngle ?? 40} min={0} max={89} onChange={(v) => upd({ moldAngle: v })} />
          <Num label="Mold Roof Height" unit="mm" value={print.moldRoofHeight ?? 0.5} step={0.1} min={0} max={10} onChange={(v) => upd({ moldRoofHeight: v })} />
          <Num label="Min Mold Width" unit="mm" value={print.minMoldWidth ?? 5} step={0.5} min={0} max={50} onChange={(v) => upd({ minMoldWidth: v })} />
        </>
      )}
    </SlicerSection>
  );
}

export function ExperimentalSection({ print, upd, isVisible, showHelp }: PrintSettingsSectionProps) {
  if (!isVisible('experimental')) return null;

  return (
    <SlicerSection title="Experimental" color="#94a3b8" defaultOpen={false}>
      <Check label="Draft Shield" value={print.draftShieldEnabled ?? false} onChange={(v) => upd({ draftShieldEnabled: v })} helpBrief={getSettingHelp('draftShieldEnabled')?.brief} onShowHelp={() => showHelp('draftShieldEnabled', 'Draft Shield')} />
      {print.draftShieldEnabled && (
        <>
          <Num label="Draft Shield Distance" unit="mm" value={print.draftShieldDistance ?? 10} step={1} min={1} max={50} onChange={(v) => upd({ draftShieldDistance: v })} />
          <Sel label="Shield Limitation" value={print.draftShieldLimitation ?? 'full'} onChange={(v) => upd({ draftShieldLimitation: v })} options={[{ value: 'full', label: 'Full â€” all layers' }, { value: 'limited', label: 'Limited â€” up to height' }]} />
          {print.draftShieldLimitation === 'limited' && <Num label="Shield Height" unit="mm" value={print.draftShieldHeight ?? 10} step={1} min={1} max={1000} onChange={(v) => upd({ draftShieldHeight: v })} />}
        </>
      )}
      <Check label="Coasting" value={print.coastingEnabled ?? false} onChange={(v) => upd({ coastingEnabled: v })} helpBrief={getSettingHelp('coastingEnabled')?.brief} onShowHelp={() => showHelp('coastingEnabled', 'Coasting')} />
      {print.coastingEnabled && (
        <>
          <Num label="Coasting Volume" unit="mmÂ³" value={print.coastingVolume ?? 0.064} step={0.001} min={0} max={1} onChange={(v) => upd({ coastingVolume: v })} />
          <Num label="Min Volume Before Coasting" unit="mmÂ³" value={print.minVolumeBeforeCoasting ?? 0} step={0.01} min={0} max={10} onChange={(v) => upd({ minVolumeBeforeCoasting: v })} />
        </>
      )}
      <SectionDivider label="G-code Preview" />
      <Check label="Embed G-code Thumbnails" value={print.embedGCodeThumbnails ?? true} onChange={(v) => upd({ embedGCodeThumbnails: v })} />
      <SectionDivider label="Fuzzy Skin" />
      <Check label="Enable Fuzzy Skin" value={print.fuzzySkinsEnabled ?? false} onChange={(v) => upd({ fuzzySkinsEnabled: v })} helpBrief={getSettingHelp('fuzzySkinsEnabled')?.brief} onShowHelp={() => showHelp('fuzzySkinsEnabled', 'Enable Fuzzy Skin')} />
      {(print.fuzzySkinsEnabled ?? false) && (
        <>
          <Num label="Fuzzy Thickness" unit="mm" value={print.fuzzySkinThickness ?? 0.3} step={0.05} min={0.01} max={2} onChange={(v) => upd({ fuzzySkinThickness: v })} />
          <Num label="Fuzzy Point Distance" unit="mm" value={print.fuzzySkinPointDist ?? 0.8} step={0.05} min={0.1} max={5} onChange={(v) => upd({ fuzzySkinPointDist: v })} />
          <Tier level="expert"><Check label="Outside Only" value={print.fuzzySkinOutsideOnly ?? false} onChange={(v) => upd({ fuzzySkinOutsideOnly: v })} /></Tier>
        </>
      )}
      <SectionDivider label="Overhang" />
      <Check label="Make Overhang Printable" value={print.makeOverhangPrintable ?? false} onChange={(v) => upd({ makeOverhangPrintable: v })} helpBrief={getSettingHelp('makeOverhangPrintable')?.brief} onShowHelp={() => showHelp('makeOverhangPrintable', 'Make Overhang Printable')} />
      {(print.makeOverhangPrintable ?? false) && <Num label="Max Overhang Angle" unit="Â°" value={print.makeOverhangPrintableMaxAngle ?? 50} min={0} max={89} onChange={(v) => upd({ makeOverhangPrintableMaxAngle: v })} />}
      <SectionDivider label="Slicing" />
      <Sel label="Slicing Tolerance" value={print.slicingTolerance ?? 'middle'} onChange={(v) => upd({ slicingTolerance: v })} options={[{ value: 'middle', label: 'Middle â€” balanced' }, { value: 'inclusive', label: 'Inclusive â€” thicker' }, { value: 'exclusive', label: 'Exclusive â€” thinner' }]} helpBrief={getSettingHelp('slicingTolerance')?.brief} onShowHelp={() => showHelp('slicingTolerance', 'Slicing Tolerance')} />
      <Num label="Min Polygon Circumference" unit="mm" value={print.minimumPolygonCircumference ?? 1.0} step={0.1} min={0.1} max={10} onChange={(v) => upd({ minimumPolygonCircumference: v })} />
      <Num label="Small Hole Max Size" unit="mm" value={print.smallHoleMaxSize ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ smallHoleMaxSize: v })} />
      <Tier min="advanced">
        <AdvancedDivider label="Advanced Â· Fluid Motion" />
        <Check label="Enable Fluid Motion" value={print.fluidMotionEnable ?? false} onChange={(v) => upd({ fluidMotionEnable: v })} helpBrief={getSettingHelp('fluidMotionEnable')?.brief} onShowHelp={() => showHelp('fluidMotionEnable', 'Enable Fluid Motion')} />
        {(print.fluidMotionEnable ?? false) && (
          <>
            <Num label="Fluid Motion Angle" unit="Â°" value={print.fluidMotionAngle ?? 15} min={0} max={89} onChange={(v) => upd({ fluidMotionAngle: v })} />
            <Num label="Fluid Motion Small Distance" unit="mm" value={print.fluidMotionSmallDistance ?? 0.01} step={0.005} min={0.001} max={1} onChange={(v) => upd({ fluidMotionSmallDistance: v })} />
          </>
        )}
        <AdvancedDivider label="Advanced Â· Flow Compensation" />
        <Num label="Flow Rate Compensation Factor" value={print.flowRateCompensationFactor ?? 1.0} step={0.01} min={0.1} max={3.0} onChange={(v) => upd({ flowRateCompensationFactor: v })} />
        <AdvancedDivider label="Advanced Â· Coasting" />
        <Num label="Coasting Speed" unit="%" value={print.coastingSpeed ?? 90} step={1} min={10} max={100} onChange={(v) => upd({ coastingSpeed: v })} />
        <AdvancedDivider label="Advanced Â· Scarf Seam" />
        <Num label="Scarf Seam Length" unit="mm" value={print.scarfSeamLength ?? 0} step={0.1} min={0} max={10} onChange={(v) => upd({ scarfSeamLength: v })} helpBrief={getSettingHelp('scarfSeamLength')?.brief} onShowHelp={() => showHelp('scarfSeamLength', 'Scarf Seam Length')} />
        <Num label="Scarf Seam Step Length" unit="mm" value={print.scarfSeamStepLength ?? 0.5} step={0.05} min={0.05} max={5} onChange={(v) => upd({ scarfSeamStepLength: v })} />
        <Num label="Scarf Seam Start Height" unit="mm" value={print.scarfSeamStartHeight ?? 0} step={0.05} min={0} max={10} onChange={(v) => upd({ scarfSeamStartHeight: v })} />
        <Num label="Scarf Seam Start Speed Ratio" value={print.scarfSeamStartSpeedRatio ?? 1.0} step={0.05} min={0.1} max={1.0} onChange={(v) => upd({ scarfSeamStartSpeedRatio: v })} />
        <AdvancedDivider label="Advanced Â· Ooze Shield" />
        <Check label="Enable Ooze Shield" value={print.enableOozeShield ?? false} onChange={(v) => upd({ enableOozeShield: v })} helpBrief={getSettingHelp('enableOozeShield')?.brief} onShowHelp={() => showHelp('enableOozeShield', 'Enable Ooze Shield')} />
        {(print.enableOozeShield ?? false) && (
          <>
            <Num label="Ooze Shield Angle" unit="Â°" value={print.oozeShieldAngle ?? 60} min={0} max={89} onChange={(v) => upd({ oozeShieldAngle: v })} />
            <Num label="Ooze Shield Distance" unit="mm" value={print.oozeShieldDistance ?? 2} step={0.1} min={0} max={20} onChange={(v) => upd({ oozeShieldDistance: v })} />
          </>
        )}
        <AdvancedDivider label="Advanced Â· Cooling Extras" />
        <Num label="Min Layer Time With Overhang" unit="s" value={print.minLayerTimeWithOverhang ?? 0} step={0.5} min={0} max={30} onChange={(v) => upd({ minLayerTimeWithOverhang: v })} />
        <AdvancedDivider label="Advanced Â· Travel Extras" />
        <Check label="Keep Retracting During Travel" value={print.keepRetractingDuringTravel ?? false} onChange={(v) => upd({ keepRetractingDuringTravel: v })} />
        <Check label="Prime During Travel" value={print.primeDuringTravel ?? false} onChange={(v) => upd({ primeDuringTravel: v })} />
        <Check label="Infill Travel Optimization" value={print.infillTravelOptimization ?? false} onChange={(v) => upd({ infillTravelOptimization: v })} />
      </Tier>
    </SlicerSection>
  );
}
