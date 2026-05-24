import { useEffect, useState } from 'react';
import { File, Loader2 } from 'lucide-react';
import type { DuetService } from '../../../services/DuetService';
import { normalizeThumbDataUrl } from './qoiDecoder';

/**
 * Module-level concurrency cap for thumbnail fetches.
 * Keeps the printer's HTTP connection pool from being overwhelmed when
 * a large directory first renders.
 */
// Duet standalone boards parse the whole file for rr_fileinfo — keep to 1
// concurrent request so we don't saturate the board's single-threaded server.
const MAX_CONCURRENT = 1;
let inFlight = 0;
const waitQueue: Array<{ isCancelled: () => boolean; resolve: (acquired: boolean) => void }> = [];

function acquireSlot(isCancelled: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    if (isCancelled()) {
      resolve(false);
      return;
    }
    if (inFlight < MAX_CONCURRENT) {
      inFlight++;
      resolve(true);
    } else {
      waitQueue.push({ isCancelled, resolve });
    }
  });
}

function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1);
  while (waitQueue.length > 0) {
    const next = waitQueue.shift();
    if (!next) return;
    if (next.isCancelled()) {
      next.resolve(false);
      continue;
    }
    inFlight++;
    next.resolve(true);
    return;
  }
}

/* ── Component ────────────────────────────────────────────────────────────── */

type State = 'idle' | 'loading' | 'ready' | 'none';

export function GCodeThumbnail({
  path,
  service,
}: {
  /** Full printer path, e.g. "0:/gcodes/benchy.gcode" */
  path: string;
  service: DuetService | null;
}) {
  const [state, setState] = useState<State>('idle');
  const [src,   setSrc]   = useState<string | null>(null);

  useEffect(() => {
    if (!service) return;

    let cancelled = false;
    setState('loading');

    void (async () => {
      const acquired = await acquireSlot(() => cancelled);
      if (!acquired) return;
      let fileInfoTimeout: ReturnType<typeof setTimeout> | null = null;
      let thumbTimeout: ReturnType<typeof setTimeout> | null = null;
      try {
        if (cancelled) return;

        // rr_fileinfo on standalone Duet boards parses the whole file —
        // cap the wait so a slow/large file doesn't spin forever.
        const timeout = new Promise<never>((_, reject) => {
          fileInfoTimeout = setTimeout(() => reject(new Error('thumbnail timeout')), 30_000);
        });

        const info = await Promise.race([service.getFileInfo(path), timeout]);
        if (fileInfoTimeout) {
          clearTimeout(fileInfoTimeout);
          fileInfoTimeout = null;
        }
        if (cancelled) return;


        if (!info.thumbnails?.length) {
          setState('none');
          return;
        }

        // Pick the smallest thumbnail — fastest to fetch for row use.
        const thumb = [...info.thumbnails].sort(
          (a, b) => a.width * a.height - b.width * b.height,
        )[0];

        const dataUrl = await Promise.race([
          service.getThumbnail(path, thumb.offset),
          new Promise<null>((resolve) => {
            thumbTimeout = setTimeout(() => resolve(null), 30_000);
          }),
        ]);
        if (thumbTimeout) {
          clearTimeout(thumbTimeout);
          thumbTimeout = null;
        }
        if (cancelled) return;

        if (dataUrl) {
          // QOI thumbnails arrive labelled as image/png but contain raw QOI
          // bytes — decode to a real PNG data-URL the browser can display.
          const normalized = normalizeThumbDataUrl(dataUrl);
          if (normalized) {
            setSrc(normalized);
            setState('ready');
          } else {
            setState('none');
          }
        } else {
          setState('none');
        }
      } catch {
        if (!cancelled) setState('none');
      } finally {
        if (fileInfoTimeout) clearTimeout(fileInfoTimeout);
        if (thumbTimeout) clearTimeout(thumbTimeout);
        releaseSlot();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [service, path]);

  return (
    <div className="duet-file-mgr__thumb-cell">
      {state === 'ready' && src ? (
        <img
          src={src}
          alt=""
          className="duet-file-mgr__thumb-img"
          draggable={false}
        />
      ) : state === 'loading' ? (
        <Loader2 size={13} className="duet-file-mgr__thumb-spin" />
      ) : (
        <File size={15} className="duet-file-mgr__icon--file" />
      )}
    </div>
  );
}
