import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLatestPanelDue, panelDueBinAssets, panelDueVariantLabel, parseM575, proxiedGithubUrl, sortPanelDueAssets, type GitHubAsset, type GitHubRelease, type PanelDueConfig } from './helpers';
import { errorMessage } from '../../../utils/errorHandling';
import { usePrinterStore } from '../../../store/printerStore';
import type { PanelDueFlashed, PanelDueUpdateState } from '../../../types/panel-due.types';

const PANELDUE_MARKER_PATH = '0:/sys/paneldue-flashed.json';

export function usePanelDue({
  connected,
  tab,
}: {
  connected: boolean;
  tab: string;
}) {
  const [showPanelDueNotes, setShowPanelDueNotes] = useState(false);
  const [panelDueInfo, setPanelDueInfo] = useState<{
    loading: boolean;
    loaded: boolean;
    configs: PanelDueConfig[];
    error?: string;
  }>({ loading: false, loaded: false, configs: [] });
  const [panelDueCheck, setPanelDueCheck] = useState<{
    loading: boolean;
    release?: GitHubRelease;
    error?: string;
    checkedAt?: number;
  }>({ loading: false });
  const panelDueCheckRef = useRef(panelDueCheck);
  useEffect(() => {
    panelDueCheckRef.current = panelDueCheck;
  }, [panelDueCheck]);

  const panelDueLogRef = useRef<HTMLPreElement | null>(null);
  const [panelDueUpdate, setPanelDueUpdate] = useState<PanelDueUpdateState>({ step: 'idle', progress: 0 });
  const [panelDueAsset, setPanelDueAsset] = useState<GitHubAsset | null>(null);
  const [panelDueFlashed, setPanelDueFlashed] = useState<{ loaded: boolean; data?: PanelDueFlashed }>({ loaded: false });

  const loadPanelDueInfo = useCallback(async () => {
    const service = usePrinterStore.getState().service;
    if (!service) {
      setPanelDueInfo({ loading: false, loaded: true, configs: [], error: 'Not connected.' });
      setPanelDueFlashed({ loaded: true });
      return;
    }

    setPanelDueInfo((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const blob = await service.downloadFile('0:/sys/config.g');
      const text = await blob.text();
      setPanelDueInfo({ loading: false, loaded: true, configs: parseM575(text) });
    } catch (err) {
      setPanelDueInfo({
        loading: false,
        loaded: true,
        configs: [],
        error: `Couldn't read 0:/sys/config.g â€” ${errorMessage(err, 'Unknown error')}`,
      });
    }

    try {
      const markerBlob = await service.downloadFile(PANELDUE_MARKER_PATH);
      const parsed = JSON.parse(await markerBlob.text()) as Partial<PanelDueFlashed>;
      if (parsed && typeof parsed.tag === 'string' && typeof parsed.assetName === 'string') {
        setPanelDueFlashed({
          loaded: true,
          data: {
            tag: parsed.tag,
            assetName: parsed.assetName,
            variant: parsed.variant ?? '',
            flashedAt: parsed.flashedAt ?? '',
          },
        });
      } else {
        setPanelDueFlashed({ loaded: true });
      }
    } catch {
      setPanelDueFlashed({ loaded: true });
    }
  }, []);

  const handleCheckPanelDueUpdate = useCallback(async () => {
    setPanelDueCheck({ loading: true });
    try {
      const release = await fetchLatestPanelDue();
      setPanelDueCheck({ loading: false, release, checkedAt: Date.now() });
      const bins = sortPanelDueAssets(panelDueBinAssets(release.assets));
      if (bins.length > 0) setPanelDueAsset(bins[0]);
    } catch (err) {
      setPanelDueCheck({ loading: false, error: errorMessage(err, 'Unknown error'), checkedAt: Date.now() });
    }
  }, []);

  const handlePanelDueInstall = useCallback(async (asset: GitHubAsset) => {
    const ok = confirm(`Flash ${asset.name} to the connected PanelDue? The Duet will stream the firmware to the display over UART â€” this takes about a minute. Don't power off during install.`);
    if (!ok) return;

    setPanelDueUpdate({ step: 'downloading', progress: 0, assetName: asset.name });
    let binFile: Blob;
    try {
      const res = await fetch(proxiedGithubUrl(asset.browser_download_url), { mode: 'cors' });
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
      const total = Number(res.headers.get('content-length') || asset.size || 0);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Streaming not supported in this browser.');
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          if (total > 0) {
            setPanelDueUpdate((s) => ({ ...s, progress: Math.round((received / total) * 100) }));
          }
        }
      }
      binFile = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
    } catch (err) {
      setPanelDueUpdate({ step: 'error', progress: 0, assetName: asset.name, error: `Download failed: ${errorMessage(err, 'Unknown error')}` });
      return;
    }

    const canonicalName = 'PanelDueFirmware.bin';
    const canonicalFile = new File([binFile], canonicalName, { type: 'application/octet-stream' });
    setPanelDueUpdate({ step: 'uploading', progress: 0, assetName: canonicalName });
    try {
      const service = usePrinterStore.getState().service;
      if (!service) throw new Error('Not connected to a printer.');
      await service.uploadFile(`0:/firmware/${canonicalName}`, canonicalFile, (progress) => {
        setPanelDueUpdate((s) => ({ ...s, progress }));
      });
    } catch (err) {
      setPanelDueUpdate({ step: 'error', progress: 0, assetName: canonicalName, error: `Upload failed: ${errorMessage(err, 'Unknown error')}` });
      return;
    }

    setPanelDueUpdate({ step: 'installing', progress: 100, assetName: canonicalName, messages: [] });
    const successRe = /(?:success(?:ful)?|completed?\b|flashed\b|update\s+ok)/i;
    const errorRe = /(?:failed\b|failure\b|error[:\s]|unable to|cannot\s+(?:open|read|write|flash)|aborted)/i;
    const collected: string[] = [];
    const pushLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      collected.push(trimmed);
      setPanelDueUpdate((s) => ({ ...s, messages: [...collected] }));
    };

    let outcome: 'success' | 'error' | 'timeout' = 'timeout';
    let errorMessage = '';

    try {
      const service = usePrinterStore.getState().service;
      if (!service) throw new Error('Not connected to a printer.');
      const firstReply = await service.sendGCode('M997 S4');
      if (firstReply) pushLine(firstReply);
      const firstClass = errorRe.test(firstReply) ? 'error' : successRe.test(firstReply) ? 'success' : null;
      if (firstClass) {
        outcome = firstClass;
      } else {
        const started = Date.now();
        while (Date.now() - started < 150_000) {
          await new Promise((r) => setTimeout(r, 1500));
          const line = await service.pollReply();
          if (!line) continue;
          pushLine(line);
          if (errorRe.test(line)) {
            outcome = 'error';
            errorMessage = line.trim();
            break;
          }
          if (successRe.test(line)) {
            outcome = 'success';
            break;
          }
        }
      }
    } catch (err) {
      setPanelDueUpdate({
        step: 'error',
        progress: 100,
        assetName: canonicalName,
        error: `Install command (M997 S4) failed: ${errorMessage(err, 'Unknown error')}`,
        messages: collected,
      });
      return;
    }

    if (outcome === 'error') {
      setPanelDueUpdate({
        step: 'error',
        progress: 100,
        assetName: canonicalName,
        error: errorMessage || 'PanelDue reported a flash failure â€” see messages below.',
        messages: collected,
      });
      return;
    }

    setPanelDueUpdate({
      step: 'done',
      progress: 100,
      assetName: canonicalName,
      messages: collected,
      timedOut: outcome === 'timeout',
    });

    if (outcome === 'success') {
      const release = panelDueCheckRef.current.release;
      const marker: PanelDueFlashed = {
        tag: release?.tag_name?.replace(/^v/i, '') ?? '',
        assetName: asset.name,
        variant: panelDueVariantLabel(asset.name),
        flashedAt: new Date().toISOString(),
      };
      try {
        const service = usePrinterStore.getState().service;
        if (!service) return;
        const markerFile = new File([JSON.stringify(marker, null, 2)], 'paneldue-flashed.json', { type: 'application/json' });
        await service.uploadFile(PANELDUE_MARKER_PATH, markerFile);
        setPanelDueFlashed({ loaded: true, data: marker });
      } catch {
        // Marker write is advisory only.
      }
    }
  }, []);

  useEffect(() => {
    if (tab !== 'paneldue' || !connected || panelDueInfo.loading) return;
    if (panelDueInfo.loaded && !panelDueInfo.error) return;
    loadPanelDueInfo();
  }, [connected, loadPanelDueInfo, panelDueInfo.error, panelDueInfo.loaded, panelDueInfo.loading, tab]);

  return {
    handleCheckPanelDueUpdate,
    handlePanelDueInstall,
    loadPanelDueInfo,
    panelDueAsset,
    panelDueCheck,
    panelDueFlashed,
    panelDueInfo,
    panelDueLogRef,
    panelDueUpdate,
    setPanelDueAsset,
    setPanelDueUpdate,
    setShowPanelDueNotes,
    showPanelDueNotes,
  };
}
