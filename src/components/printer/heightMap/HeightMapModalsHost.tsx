/**
 * Heightmap modal mounting host — renders whichever modal is currently
 * open. Keeps the host component's render tree focused on the topbar +
 * viewport + sidebar layout.
 *
 * NOTE: LevelBedResultsModal lives in DuetPrinterPanel.tsx (it's wired to
 * a store-level pending result so it survives tab navigation), not here.
 */

import { addToast } from '../../../store/toastStore';
import type { LevelBedOpts } from '../../../store/printerStore';
import { computeStats, type HeightMapStats } from './utils';
import type { ProbeOpts, SmartCalOpts, SmartCalResult } from './types';
import type { DuetHeightMap as HeightMapData, PrinterBoardType } from '../../../types/duet';
import { BedTiltSetupModal } from './modals/BedTiltSetupModal';
import { ProbeResultsModal } from './modals/ProbeResultsModal';
import { ProbeConfirmModal } from './modals/ProbeConfirmModal';
import { LevelBedModal } from './modals/LevelBedModal';
import { SmartCalModal } from './modals/SmartCalModal';
import { SmartCalResultModal } from './modals/SmartCalResultModal';
import { SaveAsModal } from './modals/SaveAsModal';

export type ProbeResult = { stats: HeightMapStats | null; passes: number };

export function HeightMapModalsHost(props: {
  // Visibility flags
  showSetupModal: boolean;
  showProbeModal: boolean;
  showProbeResultModal: boolean;
  showLevelModal: boolean;
  showSmartCalModal: boolean;
  showSmartCalResultModal: boolean;
  showSaveAsModal: boolean;

  // Setup modal
  bedTiltContent: string;
  bedTiltDerived: boolean;
  bedTiltNoG30: boolean;
  creatingTiltFile: boolean;
  onCreateBedTilt: (content: string) => void;
  closeSetup: () => void;

  // Probe result
  probeResult: ProbeResult | null;
  closeProbeResult: () => void;
  reopenProbe: () => void;
  enableCompensation: () => void;

  // Probe confirm
  m557Command: string;
  gridLabel: string;
  boardType: PrinterBoardType | undefined;
  heightMap: HeightMapData | null;
  closeProbe: () => void;
  runProbe: (opts: ProbeOpts) => void;

  // Level
  closeLevel: () => void;
  runLevel: (opts: LevelBedOpts) => void;

  // Smart Cal
  closeSmartCal: () => void;
  runSmartCal: (opts: SmartCalOpts) => void;
  smartCalResult: SmartCalResult | null;
  closeSmartCalResult: () => void;
  reopenSmartCal: () => void;

  // Save As
  closeSaveAs: () => void;
  onSaveAsConfirm: (name: string) => void;
}) {
  return (
    <>
      {props.showSetupModal && (
        <BedTiltSetupModal
          content={props.bedTiltContent}
          derived={props.bedTiltDerived}
          noG30Warning={props.bedTiltNoG30}
          creating={props.creatingTiltFile}
          onCreateFile={props.onCreateBedTilt}
          onClose={props.closeSetup}
        />
      )}
      {props.showProbeResultModal && props.probeResult && (
        <ProbeResultsModal
          stats={props.probeResult.stats}
          passes={props.probeResult.passes}
          onClose={props.closeProbeResult}
          onRunAgain={props.reopenProbe}
          onEnableCompensation={() => {
            props.enableCompensation();
            addToast('info', 'Mesh compensation enabled', 'G29 S1 applied — compensation is now active.');
          }}
        />
      )}
      {props.showProbeModal && (
        <ProbeConfirmModal
          onConfirm={props.runProbe}
          onCancel={props.closeProbe}
          m557Command={props.m557Command}
          gridLabel={props.gridLabel}
          boardType={props.boardType}
          lastMapMean={props.heightMap ? computeStats(props.heightMap).mean : null}
        />
      )}
      {props.showLevelModal && (
        <LevelBedModal onConfirm={props.runLevel} onCancel={props.closeLevel} />
      )}
      {props.showSmartCalModal && (
        <SmartCalModal onConfirm={props.runSmartCal} onCancel={props.closeSmartCal} />
      )}
      {props.showSmartCalResultModal && props.smartCalResult && (
        <SmartCalResultModal
          result={props.smartCalResult}
          onClose={props.closeSmartCalResult}
          onRunAgain={props.reopenSmartCal}
        />
      )}
      {props.showSaveAsModal && (
        <SaveAsModal onCancel={props.closeSaveAs} onConfirm={props.onSaveAsConfirm} />
      )}
    </>
  );
}
