import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Camera, Images, RefreshCcw, Trash2 } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { DEFAULT_PREFS, getDuetPrefs, type DuetPrefs } from '../../../utils/duetPrefs';
import { cameraDisplayUrl, previewCameraStreamUrl } from '../../../utils/cameraStreamUrl';
import {
  captureLayerSnapshots,
  clearLayerGalleryFrames,
  exportLayerGalleryZip,
  listLayerGalleryFrames,
  shouldCaptureLayer,
  type LayerGalleryFrame,
} from '../../../services/camera/layerGallery';
import './LayerGalleryPanel.css';

function normalizedHost(hostname: string): string {
  const value = hostname.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value.replace(/\/$/, '');
  return `http://${value.replace(/\/$/, '')}`;
}

function useObjectUrls(frames: LayerGalleryFrame[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const nextUrls: Record<string, string> = {};
    for (const frame of frames) {
      nextUrls[frame.id] = URL.createObjectURL(frame.blob);
    }
    setUrls(nextUrls);
    return () => {
      for (const url of Object.values(nextUrls)) URL.revokeObjectURL(url);
    };
  }, [frames]);
  return urls;
}

export default function LayerGalleryPanel() {
  const config = usePrinterStore((s) => s.config);
  const service = usePrinterStore((s) => s.service);
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const model = usePrinterStore((s) => s.model);
  const activePrinter = printers.find((printer) => printer.id === activePrinterId);
  const prefs = useMemo<DuetPrefs>(() => ({
    ...DEFAULT_PREFS,
    ...getDuetPrefs(),
    ...(activePrinter?.prefs as Partial<DuetPrefs> | undefined),
  }), [activePrinter]);

  const [frames, setFrames] = useState<LayerGalleryFrame[]>([]);
  const [retentionCap, setRetentionCap] = useState(240);
  const [capturing, setCapturing] = useState(false);
  const [message, setMessage] = useState('');
  const previousLayerRef = useRef<number | undefined>(undefined);
  const urls = useObjectUrls(frames);

  const jobName = model.job?.file?.fileName || 'manual-gallery';
  const currentLayer = model.job?.layer;
  const status = model.state?.status;
  const printerName = activePrinter?.name ?? 'Printer';
  const fallbackUrl = useMemo(() => {
    const host = normalizedHost(config.hostname);
    return service?.getWebcamUrl() ?? (host ? `${host}/webcam/?action=stream` : '');
  }, [config.hostname, service]);

  const refreshFrames = useCallback(async () => {
    const loaded = await listLayerGalleryFrames(activePrinterId, jobName);
    setFrames(loaded);
  }, [activePrinterId, jobName]);

  const captureCurrentLayer = useCallback(async (layer = currentLayer) => {
    if (layer === undefined || !activePrinter) return;
    setCapturing(true);
    try {
      const captured = await captureLayerSnapshots({
        printerId: activePrinterId,
        printerName,
        jobName,
        layer,
        prefs,
        fallbackUrl,
        retentionCap,
      });
      setMessage(captured.length > 0 ? `Captured layer ${layer} from ${captured.length} camera${captured.length === 1 ? '' : 's'}.` : 'No enabled snapshot-capable camera responded.');
      await refreshFrames();
    } finally {
      setCapturing(false);
    }
  }, [activePrinter, activePrinterId, currentLayer, fallbackUrl, jobName, prefs, printerName, refreshFrames, retentionCap]);

  useEffect(() => {
    void refreshFrames();
  }, [refreshFrames]);

  useEffect(() => {
    const previous = previousLayerRef.current;
    previousLayerRef.current = currentLayer;
    if (!shouldCaptureLayer(previous, currentLayer, status)) return;
    void captureCurrentLayer(currentLayer);
  }, [captureCurrentLayer, currentLayer, status]);

  const clearCurrent = useCallback(async () => {
    await clearLayerGalleryFrames(activePrinterId, jobName);
    await refreshFrames();
    setMessage('Layer gallery cleared for this job.');
  }, [activePrinterId, jobName, refreshFrames]);

  const exportZip = useCallback(async () => {
    if (frames.length === 0) return;
    const blob = await exportLayerGalleryZip(frames);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${jobName.replace(/[^\w.-]+/g, '_')}-layer-gallery.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [frames, jobName]);

  const layers = useMemo(() => {
    const grouped = new Map<number, LayerGalleryFrame[]>();
    for (const frame of frames) {
      const group = grouped.get(frame.layer) ?? [];
      group.push(frame);
      grouped.set(frame.layer, group);
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
  }, [frames]);

  const previewUrl = useMemo(() => {
    const streamUrl = previewCameraStreamUrl(prefs, fallbackUrl);
    return streamUrl ? cameraDisplayUrl(streamUrl, prefs.webcamUsername, prefs.webcamPassword) : '';
  }, [fallbackUrl, prefs]);

  return (
    <section className="layer-gallery" aria-label="Layer-by-layer photo gallery">
      <div className="layer-gallery__toolbar">
        <div className="layer-gallery__title">
          <Images size={18} />
          <h2>Layer Gallery</h2>
          <span>{jobName}</span>
        </div>
        <div className="layer-gallery__actions">
          <label>
            Cap
            <input
              type="number"
              min={24}
              max={2000}
              value={retentionCap}
              onChange={(event) => setRetentionCap(Math.max(24, Number(event.target.value) || 240))}
            />
          </label>
          <button type="button" onClick={() => void refreshFrames()}><RefreshCcw size={13} /> Refresh</button>
          <button type="button" disabled={capturing || currentLayer === undefined} onClick={() => { void captureCurrentLayer(); }}>
            <Camera size={13} /> {capturing ? 'Capturing' : 'Capture'}
          </button>
          <button type="button" disabled={frames.length === 0} onClick={() => { void exportZip(); }}>
            <Archive size={13} /> Export ZIP
          </button>
          <button type="button" disabled={frames.length === 0} onClick={() => { void clearCurrent(); }}>
            <Trash2 size={13} /> Clear
          </button>
        </div>
      </div>

      {message && <div className="layer-gallery__message">{message}</div>}

      {frames.length === 0 ? (
        <div className="layer-gallery__empty">
          {previewUrl ? <img src={previewUrl} alt="Camera preview" /> : <Images size={28} />}
          <span>Layer snapshots will appear as the active print changes layers.</span>
        </div>
      ) : (
        <div className="layer-gallery__layers">
          {layers.map(([layer, layerFrames]) => (
            <article key={layer} className="layer-gallery__layer">
              <header>
                <strong>Layer {layer}</strong>
                <span>{layerFrames.length} frame{layerFrames.length === 1 ? '' : 's'}</span>
              </header>
              <div className="layer-gallery__frames">
                {layerFrames.map((frame) => (
                  <figure key={frame.id}>
                    <img src={urls[frame.id]} alt={`${frame.cameraLabel} layer ${frame.layer}`} />
                    <figcaption>
                      <strong>{frame.cameraLabel}</strong>
                      <span>{new Date(frame.createdAt).toLocaleTimeString()}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
