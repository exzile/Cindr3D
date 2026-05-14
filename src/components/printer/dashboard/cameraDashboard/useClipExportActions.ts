/**
 * useClipExportActions — every "save this off-device" action the dashboard
 * exposes:
 *
 *   • downloadClip(clip)          — single saved clip download
 *   • exportVisibleClips()        — every currently-filtered clip + manifest
 *   • generateJobReport(clips)    — printable summary for a job
 *   • generateContactSheet(clips) — snapshot grid PNG/PDF
 *   • exportClipBundle(clips)     — packaged folder for handoff
 *
 * The single-clip downloader is here too so consumers don't import from
 * two places when wiring an "export" UI; it's a thin pass-through but
 * keeps the call sites cohesive.
 */
import { useCallback } from 'react';
import {
  clipKind,
  type CameraClip,
} from './clipStore';
import {
  downloadClipBlob, downloadClipBundle, downloadClipManifest,
  downloadContactSheet, downloadJobReport,
} from './clipExport';

export interface UseClipExportActionsDeps {
  visibleClips: CameraClip[];
  timelineClips: CameraClip[];
  timelineJobName: string;
  printerId: string;
  printerName: string;
  setBusy: (busy: boolean) => void;
  setMessage: (msg: string) => void;
}

export function useClipExportActions(deps: UseClipExportActionsDeps) {
  const {
    visibleClips, timelineClips, timelineJobName,
    printerId, printerName,
    setBusy, setMessage,
  } = deps;

  const downloadClip = useCallback((clip: CameraClip) => {
    downloadClipBlob(clip);
  }, []);

  const exportVisibleClips = useCallback(() => {
    visibleClips.forEach(downloadClip);
    downloadClipManifest(visibleClips);
  }, [downloadClip, visibleClips]);

  const generateJobReport = useCallback((clipsToReport: CameraClip[]) => {
    const reportClips = clipsToReport.length ? clipsToReport : timelineClips;
    downloadJobReport(reportClips, printerName, timelineJobName);
    setMessage('Generated camera job report.');
  }, [printerName, setMessage, timelineClips, timelineJobName]);

  const generateContactSheet = useCallback(async (clipsToUse: CameraClip[]) => {
    const snapshots = clipsToUse.filter((clip) => clipKind(clip) === 'snapshot');
    if (snapshots.length === 0) {
      setMessage('Select one or more snapshots before generating a contact sheet.');
      return;
    }
    setBusy(true);
    try {
      await downloadContactSheet(snapshots, printerName);
      setMessage(`Generated contact sheet with ${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to generate contact sheet.');
    } finally {
      setBusy(false);
    }
  }, [printerName, setBusy, setMessage]);

  const exportClipBundle = useCallback(async (clipsToExport: CameraClip[]) => {
    if (clipsToExport.length === 0) return;
    setBusy(true);
    try {
      await downloadClipBundle(clipsToExport, printerId, printerName);
      setMessage(`Exported ${clipsToExport.length} camera item${clipsToExport.length === 1 ? '' : 's'} as a bundle.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to export camera bundle.');
    } finally {
      setBusy(false);
    }
  }, [printerId, printerName, setBusy, setMessage]);

  return { downloadClip, exportVisibleClips, generateJobReport, generateContactSheet, exportClipBundle };
}
