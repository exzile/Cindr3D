/**
 * useCsvFileList — owns fetching the list of .csv files in 0:/sys and
 * re-fetching when the printer reconnects.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DuetService } from '../../../../services/DuetService';

export interface UseCsvFileListDeps {
  service: DuetService | null;
  connected: boolean;
}

export interface UseCsvFileListApi {
  csvFiles: string[];
  loadingCsvList: boolean;
  refreshCsvList: () => Promise<void>;
}

export function useCsvFileList({ service, connected }: UseCsvFileListDeps): UseCsvFileListApi {
  const [csvFiles, setCsvFiles] = useState<string[]>([]);
  const [loadingCsvList, setLoadingCsvList] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const refreshCsvList = useCallback(async () => {
    if (!service) return;
    setLoadingCsvList(true);
    try {
      const entries = await service.listFiles('0:/sys');
      if (mountedRef.current) {
        setCsvFiles(
          entries
            .filter((e) => e.type === 'f' && e.name.toLowerCase().endsWith('.csv'))
            .map((e) => e.name)
            .sort(),
        );
      }
    } catch {
      if (mountedRef.current) setCsvFiles([]);
    } finally {
      if (mountedRef.current) setLoadingCsvList(false);
    }
  }, [service]);

  useEffect(() => { if (connected) void refreshCsvList(); }, [connected, refreshCsvList]);

  return { csvFiles, loadingCsvList, refreshCsvList };
}
