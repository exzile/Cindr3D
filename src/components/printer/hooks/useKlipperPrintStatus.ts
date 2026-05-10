/**
 * Poll the connected Klipper printer's print_stats / display_status via
 * Moonraker and return the latest snapshot. Returns null when the printer
 * is not Klipper, not connected, or no status has been fetched yet.
 *
 * Stops polling automatically when the printer disconnects, the board
 * type changes, or the consumer unmounts.
 */
import { useEffect, useState } from 'react';
import { usePrinterStore } from '../../../store/printerStore';
import { MoonrakerService, type MoonrakerPrintStatus } from '../../../services/MoonrakerService';

export function useKlipperPrintStatus(intervalMs = 3000): MoonrakerPrintStatus | null {
  const boardType = usePrinterStore((s) => s.config.boardType);
  const hostname = usePrinterStore((s) => s.config.hostname);
  const connected = usePrinterStore((s) => s.connected);

  const [status, setStatus] = useState<MoonrakerPrintStatus | null>(null);

  useEffect(() => {
    if (boardType !== 'klipper' || !connected || !hostname) {
      let disposed = false;
      queueMicrotask(() => {
        if (!disposed) setStatus(null);
      });
      return () => { disposed = true; };
    }

    const svc = new MoonrakerService(hostname);
    let cancelled = false;
    const tick = async () => {
      const s = await svc.getPrintStatus();
      if (!cancelled) setStatus(s);
    };
    void tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [boardType, connected, hostname, intervalMs]);

  return status;
}
