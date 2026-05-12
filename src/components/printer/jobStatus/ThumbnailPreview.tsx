import { useState, useEffect } from 'react';
import { Image, Loader2 } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import '../DuetJobStatus.css';

export function ThumbnailPreview() {
  const service = usePrinterStore((s) => s.service);
  const model = usePrinterStore((s) => s.model);
  const job = model.job;

  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fileName = job?.file?.fileName ?? '';
  const thumbnails = job?.file?.thumbnails;

  useEffect(() => {
    setThumbnailSrc(null); // eslint-disable-line react-hooks/set-state-in-effect -- reset on job change
    if (!service || !fileName || !thumbnails || thumbnails.length === 0) return;

    // Pick the largest thumbnail by area
    const largest = [...thumbnails].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0];

    let cancelled = false;
    setLoading(true);

    service
      .getThumbnail(fileName, largest.offset)
      .then((dataUrl) => {
        if (!cancelled && dataUrl) setThumbnailSrc(dataUrl);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [service, fileName, thumbnails]);

  if (!job?.file) return null;

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Image size={14} /> Print Preview
      </div>
      <div className="duet-job__thumbnail">
        {loading ? (
          <div className="duet-job__thumbnail-state duet-job__thumbnail-state--loading">
            <Loader2 size={16} className="spin" />
            Loading thumbnail...
          </div>
        ) : thumbnailSrc ? (
          <img
            src={thumbnailSrc}
            alt="Print thumbnail"
            className="duet-job__thumbnail-img"
          />
        ) : (
          <div className="duet-job__thumbnail-state">
            <Image size={32} strokeWidth={1} />
            <span>No thumbnail</span>
          </div>
        )}
      </div>
    </div>
  );
}
