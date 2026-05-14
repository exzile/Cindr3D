/**
 * Heightmap sidebar — composes the four sub-sections.
 *
 * The parent component owns all state; this composer just funnels it
 * through to the four focused section files (Actions / Stats / ProbeGrid
 * / Files). Keeping the composer skinny lets each section grow on its
 * own without bloating the host file.
 */

import type { HeightMapStats } from '../utils';
import type { DuetHeightMap as HeightMapData } from '../../../../types/duet';
import { ActionsSection } from './ActionsSection';
import { StatsSection } from './StatsSection';
import { ProbeGridSection } from './ProbeGridSection';
import { DisplayControlsSection } from './DisplayControlsSection';
import { FilesSection } from './FilesSection';

interface SafeBounds { xMin: number; xMax: number | null; yMin: number; yMax: number | null }

export function HeightMapSidebar(props: {
  open: boolean;

  // Actions
  connected: boolean;
  loading: boolean;
  probing: boolean;
  leveling: boolean;
  smartCalRunning: boolean;
  smartCalActive: boolean;
  gridLabel: string;
  spacingX: string;
  spacingY: string;
  loadError: string | null;
  heightMap: HeightMapData | null;
  isCompensationEnabled: boolean;
  onProbe: () => void;
  onLevel: () => void;
  onSmartCal: () => void;
  onLoad: () => void;
  onSaveAs: () => void;
  onDismissError: () => void;
  onCompensationToggle: () => void;

  // Stats
  stats: HeightMapStats;
  isDemo: boolean;
  quality: { label: string; color: string };

  // Probe grid
  probeFromConfig: boolean;
  configM557Line: string | null;
  probeGridUnlocked: boolean;
  setProbeGridUnlocked: (next: boolean | ((v: boolean) => boolean)) => void;
  probeGridLocked: boolean;
  probeXMin: number; probeXMax: number; probeYMin: number; probeYMax: number; probePoints: number;
  setProbeXMin: (n: number) => void;
  setProbeXMax: (n: number) => void;
  setProbeYMin: (n: number) => void;
  setProbeYMax: (n: number) => void;
  setProbePoints: (n: number) => void;
  safeBounds: SafeBounds | null;
  m557Command: string;
  probeMaxCount: number | undefined;
  probeTol: number | undefined;
  g31Offset: { x: number; y: number } | null;
  resetGrid: () => void;
  // Display controls
  mirrorX: boolean;
  setMirrorX: (next: boolean | ((v: boolean) => boolean)) => void;
  viewMode: '3d' | '2d';
  showProbePoints: boolean;
  setShowProbePoints: (next: boolean | ((v: boolean) => boolean)) => void;
  probePointScale: number;
  setProbePointScale: (n: number) => void;

  // Files + compare
  selectedCsv: string;
  setSelectedCsv: (path: string) => void;
  csvFiles: string[];
  loadingCsvList: boolean;
  refreshCsvList: () => Promise<void>;
  compareMode: boolean;
  compareCsv: string;
  loadingCompare: boolean;
  handleLoadCompare: (path: string) => Promise<void>;
  exitCompare: () => void;
}) {
  return (
    <aside className={`hm-sidebar${props.open ? ' is-open' : ''}`}>
      <ActionsSection
        connected={props.connected}
        loading={props.loading}
        probing={props.probing}
        leveling={props.leveling}
        smartCalRunning={props.smartCalRunning}
        smartCalActive={props.smartCalActive}
        gridLabel={props.gridLabel}
        spacingX={props.spacingX}
        spacingY={props.spacingY}
        loadError={props.loadError}
        heightMap={props.heightMap}
        isCompensationEnabled={props.isCompensationEnabled}
        onProbe={props.onProbe}
        onLevel={props.onLevel}
        onSmartCal={props.onSmartCal}
        onLoad={props.onLoad}
        onSaveAs={props.onSaveAs}
        onDismissError={props.onDismissError}
        onCompensationToggle={props.onCompensationToggle}
      />

      <StatsSection stats={props.stats} isDemo={props.isDemo} quality={props.quality} />

      <ProbeGridSection
        probeFromConfig={props.probeFromConfig}
        configM557Line={props.configM557Line}
        probeGridUnlocked={props.probeGridUnlocked}
        setProbeGridUnlocked={props.setProbeGridUnlocked}
        probeGridLocked={props.probeGridLocked}
        probeXMin={props.probeXMin}
        probeXMax={props.probeXMax}
        probeYMin={props.probeYMin}
        probeYMax={props.probeYMax}
        probePoints={props.probePoints}
        setProbeXMin={props.setProbeXMin}
        setProbeXMax={props.setProbeXMax}
        setProbeYMin={props.setProbeYMin}
        setProbeYMax={props.setProbeYMax}
        setProbePoints={props.setProbePoints}
        spacingX={props.spacingX}
        spacingY={props.spacingY}
        safeBounds={props.safeBounds}
        m557Command={props.m557Command}
        connected={props.connected}
        probeMaxCount={props.probeMaxCount}
        probeTol={props.probeTol}
        g31Offset={props.g31Offset}
        resetGrid={props.resetGrid}
      />

      <DisplayControlsSection
        mirrorX={props.mirrorX}
        setMirrorX={props.setMirrorX}
        viewMode={props.viewMode}
        showProbePoints={props.showProbePoints}
        setShowProbePoints={props.setShowProbePoints}
        probePointScale={props.probePointScale}
        setProbePointScale={props.setProbePointScale}
      />

      <FilesSection
        selectedCsv={props.selectedCsv}
        setSelectedCsv={props.setSelectedCsv}
        csvFiles={props.csvFiles}
        loadingCsvList={props.loadingCsvList}
        refreshCsvList={props.refreshCsvList}
        compareMode={props.compareMode}
        compareCsv={props.compareCsv}
        loadingCompare={props.loadingCompare}
        handleLoadCompare={props.handleLoadCompare}
        heightMap={props.heightMap}
        exitCompare={props.exitCompare}
      />
    </aside>
  );
}
