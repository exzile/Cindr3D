import { useCallback, useEffect, useState } from 'react';
import { fetchLatestDwc, fetchLatestFirmware, proxiedGithubUrl, type GitHubAsset, type GitHubRelease } from './helpers';
import { errorMessage } from '../../../utils/errorHandling';
import { usePrinterStore } from '../../../store/printerStore';
import type { AutoUpdateState } from '../../../types/panel-due.types';

type FirmwareStatus = { type: 'success' | 'error'; message: string } | null;

export function useFirmwareUpdate({
  config,
  connected,
  firmwareUpdatePending,
  installFirmware,
  uploadFirmware,
}: {
  config: { hostname: string; password?: string; mode?: 'standalone' | 'sbc' };
  connected: boolean;
  firmwareUpdatePending: boolean;
  installFirmware: () => Promise<void>;
  uploadFirmware: (file: File) => Promise<void>;
}) {
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  const [firmwareStatus, setFirmwareStatus] = useState<FirmwareStatus>(null);
  const [iapFile, setIapFile] = useState<File | null>(null);
  const [iapStatus, setIapStatus] = useState<FirmwareStatus>(null);
  const [updateCheck, setUpdateCheck] = useState<{
    loading: boolean;
    release?: GitHubRelease;
    dwcRelease?: GitHubRelease;
    error?: string;
    checkedAt?: number;
  }>({ loading: false });
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState<AutoUpdateState>({ step: 'idle', progress: 0 });

  useEffect(() => {
    if (autoUpdate.step !== 'done') return;
    if (connected && !firmwareUpdatePending) {
      setAutoUpdate((s) => ({ ...s, step: 'reconnected' }));
      return;
    }

    const host = config.hostname.replace(/\/+$/, '').replace(/^https?:\/\//, '');
    if (!host) return;
    const base = import.meta.env.DEV ? `/duet-proxy/${host}` : `http://${host}`;
    const pingUrl = config.mode === 'sbc'
      ? `${base}/machine/status`
      : `${base}/rr_connect?password=${encodeURIComponent(config.password ?? '')}&time=${encodeURIComponent(new Date().toISOString())}`;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const maxWaitMs = 5 * 60 * 1000;

    const ping = async () => {
      if (cancelled || Date.now() - startedAt > maxWaitMs) return;

      const ac = new AbortController();
      const abortTimer = setTimeout(() => ac.abort(), 4000);
      let ok = false;
      try {
        const res = await fetch(pingUrl, { signal: ac.signal, cache: 'no-store' });
        ok = res.ok;
      } catch {
        ok = false;
      } finally {
        clearTimeout(abortTimer);
      }

      if (cancelled) return;
      if (ok) {
        if (!usePrinterStore.getState().connected) {
          try {
            await usePrinterStore.getState().connect();
          } catch {
            // Ignore reconnect failures here; the next poll will try again.
          }
        }
        if (!cancelled) setAutoUpdate((s) => ({ ...s, step: 'reconnected' }));
        return;
      }
      timer = setTimeout(ping, 3000);
    };

    timer = setTimeout(ping, 8000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [autoUpdate.step, config.hostname, config.mode, config.password, connected, firmwareUpdatePending]);

  const handleFirmwareSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.bin') && !lower.endsWith('.uf2')) {
      setFirmwareStatus({ type: 'error', message: 'Firmware must be a .bin or .uf2 file.' });
      return;
    }
    setFirmwareStatus(null);
    setFirmwareFile(file);
  }, []);

  const handleFirmwareUpload = useCallback(async () => {
    if (!firmwareFile) return;
    setFirmwareStatus(null);
    try {
      await uploadFirmware(firmwareFile);
      setFirmwareStatus({ type: 'success', message: `${firmwareFile.name} uploaded to 0:/firmware/` });
    } catch (err) {
      setFirmwareStatus({ type: 'error', message: errorMessage(err, 'Unknown error') });
    }
  }, [firmwareFile, uploadFirmware]);

  const handleIapSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.bin')) {
      setIapStatus({ type: 'error', message: 'IAP file must be a .bin file.' });
      return;
    }
    setIapStatus(null);
    setIapFile(file);
  }, []);

  const handleIapUpload = useCallback(async () => {
    if (!iapFile) return;
    setIapStatus(null);
    try {
      await uploadFirmware(iapFile);
      setIapStatus({ type: 'success', message: `${iapFile.name} uploaded to 0:/firmware/` });
    } catch (err) {
      setIapStatus({ type: 'error', message: errorMessage(err, 'Unknown error') });
    }
  }, [iapFile, uploadFirmware]);

  const handleFirmwareInstall = useCallback(async () => {
    const ok = confirm('Send M997 to start the firmware update? The board will reboot during install â€” do not power off until it comes back online.');
    if (!ok) return;
    await installFirmware();
  }, [installFirmware]);

  const handleCheckForUpdate = useCallback(async () => {
    setUpdateCheck({ loading: true });
    setShowReleaseNotes(false);
    try {
      const [release, dwcSettled] = await Promise.all([
        fetchLatestFirmware(),
        fetchLatestDwc().catch(() => undefined),
      ]);
      setUpdateCheck({ loading: false, release, dwcRelease: dwcSettled, checkedAt: Date.now() });
    } catch (err) {
      setUpdateCheck({ loading: false, error: errorMessage(err, 'Unknown error'), checkedAt: Date.now() });
    }
  }, []);

  const downloadAsset = useCallback(async (asset: GitHubAsset): Promise<File> => {
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
          setAutoUpdate((s) => ({ ...s, progress: Math.round((received / total) * 100) }));
        }
      }
    }
    return new File(chunks as BlobPart[], asset.name, { type: 'application/octet-stream' });
  }, []);

  const uploadDwcZip = useCallback(async (file: File): Promise<void> => {
    const service = usePrinterStore.getState().service;
    if (!service) throw new Error('Not connected to a printer.');
    await service.uploadFile(`0:/www/${file.name}`, file, (progress) => {
      usePrinterStore.getState().setUploadProgress(progress);
    });
  }, []);

  const buildDownloadError = useCallback((err: unknown): string => {
    const msg = errorMessage(err, 'Unknown error');
    const corsHint = import.meta.env.DEV
      ? 'The dev-server GitHub proxy may be misconfigured â€” check the Vite logs.'
      : 'GitHub release assets do not send CORS headers, so the browser cannot fetch them directly. Run the app via the Vite dev server (which proxies GitHub), or click the filename link below to download manually and use the Upload button.';
    return `Could not download from GitHub (${msg}). ${corsHint}`;
  }, []);

  const handleAutoUpdate = useCallback(async (fwAsset: GitHubAsset, dwcAsset?: GitHubAsset) => {
    const parts = [`â€¢ ${fwAsset.name}`, dwcAsset && `â€¢ ${dwcAsset.name}`].filter(Boolean).join('\n');
    const ok = confirm(`Download and install these updates? The board will reboot during install â€” do not power off until it comes back online.\n\n${parts}`);
    if (!ok) return;

    setAutoUpdate({ step: 'downloading', progress: 0, assetName: fwAsset.name });
    let fwFile: File;
    try {
      fwFile = await downloadAsset(fwAsset);
    } catch (err) {
      setAutoUpdate({ step: 'error', progress: 0, assetName: fwAsset.name, error: buildDownloadError(err) });
      return;
    }

    let dwcFile: File | null = null;
    if (dwcAsset) {
      setAutoUpdate({ step: 'downloading', progress: 0, assetName: dwcAsset.name });
      try {
        dwcFile = await downloadAsset(dwcAsset);
      } catch (err) {
        setAutoUpdate({ step: 'error', progress: 0, assetName: dwcAsset.name, error: buildDownloadError(err) });
        return;
      }
    }

    if (dwcFile) {
      setAutoUpdate({ step: 'uploading', progress: 0, assetName: dwcFile.name });
      try {
        await uploadDwcZip(dwcFile);
      } catch (err) {
        setAutoUpdate({ step: 'error', progress: 0, assetName: dwcFile.name, error: `DWC upload failed: ${errorMessage(err, 'Unknown error')}` });
        return;
      }
    }

    setAutoUpdate({ step: 'uploading', progress: 0, assetName: fwFile.name });
    try {
      await uploadFirmware(fwFile);
    } catch (err) {
      setAutoUpdate({ step: 'error', progress: 0, assetName: fwFile.name, error: `Firmware upload failed: ${errorMessage(err, 'Unknown error')}` });
      return;
    }

    setAutoUpdate({ step: 'installing', progress: 100, assetName: fwFile.name });
    try {
      await installFirmware();
      setAutoUpdate({ step: 'done', progress: 100, assetName: fwFile.name });
    } catch (err) {
      setAutoUpdate({ step: 'error', progress: 100, assetName: fwFile.name, error: `Install command (M997) failed: ${errorMessage(err, 'Unknown error')}` });
    }
  }, [buildDownloadError, downloadAsset, installFirmware, uploadDwcZip, uploadFirmware]);

  const handleUpdateDwcOnly = useCallback(async (dwcAsset: GitHubAsset) => {
    const ok = confirm(`Download ${dwcAsset.name} and install the updated DuetWebControl UI? No reboot is required.`);
    if (!ok) return;

    setAutoUpdate({ step: 'downloading', progress: 0, assetName: dwcAsset.name });
    let dwcFile: File;
    try {
      dwcFile = await downloadAsset(dwcAsset);
    } catch (err) {
      setAutoUpdate({ step: 'error', progress: 0, assetName: dwcAsset.name, error: buildDownloadError(err) });
      return;
    }

    setAutoUpdate({ step: 'uploading', progress: 0, assetName: dwcFile.name });
    try {
      await uploadDwcZip(dwcFile);
    } catch (err) {
      setAutoUpdate({ step: 'error', progress: 0, assetName: dwcFile.name, error: `DWC upload failed: ${errorMessage(err, 'Unknown error')}` });
      return;
    }

    setAutoUpdate({ step: 'reconnected', progress: 100, assetName: dwcFile.name });
  }, [buildDownloadError, downloadAsset, uploadDwcZip]);

  return {
    autoUpdate,
    firmwareFile,
    firmwareStatus,
    handleAutoUpdate,
    handleCheckForUpdate,
    handleFirmwareInstall,
    handleFirmwareSelect,
    handleFirmwareUpload,
    handleIapSelect,
    handleIapUpload,
    handleUpdateDwcOnly,
    iapFile,
    iapStatus,
    setAutoUpdate,
    setShowReleaseNotes,
    showReleaseNotes,
    updateCheck,
  };
}
