export interface PrintHistoryEntry {
  timestamp: string;
  file: string | null;
  kind: 'start' | 'finish' | 'cancel' | 'event';
  message: string;
  durationSec?: number;
}

export interface PrinterAlert {
  id: string;
  level: 'error' | 'warning';
  message: string;
  timestamp: number;
}
