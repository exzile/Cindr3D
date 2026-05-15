import { useEffect, useState } from 'react';
import { getCalibrationPhotoObjectUrl } from '../../../../services/calibration/calibrationPhotoStore';

interface CalibrationResultThumbnailProps {
  photoId: string;
  alt: string;
  onClick?: () => void;
}

/**
 * Async-loaded thumbnail for a single calibration photo. Resolves the photo
 * blob from IDB on mount, creates a short-lived object URL, and revokes it
 * on unmount. Falls back to a small placeholder while loading or on failure.
 */
export function CalibrationResultThumbnail({ photoId, alt, onClick }: CalibrationResultThumbnailProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    void (async () => {
      try {
        const next = await getCalibrationPhotoObjectUrl(photoId);
        if (cancelled) {
          if (next) URL.revokeObjectURL(next);
          return;
        }
        if (next) {
          createdUrl = next;
          setUrl(next);
        } else {
          setFailed(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [photoId]);

  if (failed) {
    return <span className="calib-results__thumb calib-results__thumb--missing" aria-label="Photo unavailable">×</span>;
  }
  if (!url) {
    return <span className="calib-results__thumb calib-results__thumb--loading" aria-hidden="true" />;
  }
  return (
    <button
      type="button"
      className="calib-results__thumb"
      onClick={onClick}
      aria-label={alt}
    >
      <img src={url} alt={alt} />
    </button>
  );
}
