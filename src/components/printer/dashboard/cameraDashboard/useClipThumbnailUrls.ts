/**
 * useClipThumbnailUrls — creates a Blob URL per clip thumbnail (or the
 * snapshot blob itself when no separate thumbnail exists) and revokes
 * them when the clip list changes or the panel unmounts.
 *
 * Returns the lookup map the gallery + recent-strip + library list
 * consume to render <img src>.
 */
import { useEffect, useState } from 'react';
import { clipKind, type CameraClip } from './clipStore';

export function useClipThumbnailUrls(clips: CameraClip[]) {
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const urls: Record<string, string> = {};
    clips.forEach((clip) => {
      const thumbnail = clip.thumbnailBlob ?? (clipKind(clip) === 'snapshot' ? clip.blob : undefined);
      if (thumbnail) {
        urls[clip.id] = URL.createObjectURL(thumbnail);
      }
    });
    setThumbUrls(urls);
    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [clips]);

  return thumbUrls;
}
