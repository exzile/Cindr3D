import type { ConsoleEntry } from '../types/duet';
import { MAX_CONSOLE_HISTORY } from '../constants/printerConsole';

const LOG_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+(.+)$/;
const LOG_FILE_PATTERN = /(?:^|[-_.])log(?:[-_.]|$)|^eventlog\.txt$/i;

export type ParsedPrinterLogLine = {
  entry: ConsoleEntry;
  hasTimestamp: boolean;
};

export function consoleEntryTypeFromPrinterMessage(type: unknown, content: string): ConsoleEntry['type'] {
  if (type === 0) return 'error';
  if (type === 2) return 'warning';

  const normalizedType = String(type ?? '').toLowerCase();
  if (normalizedType.includes('error')) return 'error';
  if (normalizedType.includes('warning')) return 'warning';

  if (content.startsWith('Error:') || /\berror\b/i.test(content)) return 'error';
  if (content.startsWith('Warning:') || /\bwarn(?:ing)?\b/i.test(content)) return 'warning';
  return 'response';
}

export function dateFromPrinterTimestamp(value: unknown, fallback = new Date()): Date {
  if (typeof value !== 'string') return fallback;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? fallback : timestamp;
}

export function normalizePrinterLogPath(path: string | null | undefined): string[] {
  const trimmed = path?.trim();
  if (!trimmed) return [];
  if (/^\d+:\//.test(trimmed)) return [trimmed];
  return [`0:/sys/${trimmed.replace(/^\/+/, '')}`];
}

export function isPrinterLogFile(filename: string): boolean {
  const normalized = filename.trim().toLowerCase();
  return normalized.endsWith('.log')
    || normalized.endsWith('.log.txt')
    || LOG_FILE_PATTERN.test(normalized);
}

export function parsePrinterLogLineDetails(line: string, fallback = new Date()): ParsedPrinterLogLine | null {
  const content = line.trim();
  if (!content) return null;

  const timestampMatch = content.match(LOG_TIMESTAMP_PATTERN);
  const message = timestampMatch ? timestampMatch[2].trim() : content;

  return {
    entry: {
      timestamp: dateFromPrinterTimestamp(timestampMatch?.[1], fallback),
      type: consoleEntryTypeFromPrinterMessage(undefined, message),
      content: message,
    },
    hasTimestamp: Boolean(timestampMatch),
  };
}

export function parsePrinterLogLine(line: string): ConsoleEntry | null {
  return parsePrinterLogLineDetails(line)?.entry ?? null;
}

export function mergeConsoleEntries(existing: ConsoleEntry[], importedEntries: ConsoleEntry[]): ConsoleEntry[] {
  const exactSeen = new Set(existing.map((entry) => `${entry.timestamp.getTime()}|${entry.type}|${entry.content}`));
  const liveSeen = new Set(existing.map((entry) => `${entry.type}|${entry.content}`));
  const uniqueImports = importedEntries.filter((entry) => {
    const exactKey = `${entry.timestamp.getTime()}|${entry.type}|${entry.content}`;
    const liveKey = `${entry.type}|${entry.content}`;
    if (exactSeen.has(exactKey) || liveSeen.has(liveKey)) return false;
    exactSeen.add(exactKey);
    liveSeen.add(liveKey);
    return true;
  });
  return [...existing, ...uniqueImports]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .slice(-MAX_CONSOLE_HISTORY);
}
