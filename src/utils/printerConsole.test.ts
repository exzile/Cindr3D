import { describe, expect, it } from 'vitest';
import type { ConsoleEntry } from '../types/duet';
import {
  consoleEntryTypeFromPrinterMessage,
  dateFromPrinterTimestamp,
  isPrinterLogFile,
  mergeConsoleEntries,
  normalizePrinterLogPath,
  parsePrinterLogLine,
  parsePrinterLogLineDetails,
} from './printerConsole';

describe('printerConsole utilities', () => {
  it('classifies DSF numeric message types', () => {
    expect(consoleEntryTypeFromPrinterMessage(0, 'heater fault')).toBe('error');
    expect(consoleEntryTypeFromPrinterMessage(2, 'heater approaching limit')).toBe('warning');
  });

  it('classifies string message types and content fallbacks', () => {
    expect(consoleEntryTypeFromPrinterMessage('Error', 'anything')).toBe('error');
    expect(consoleEntryTypeFromPrinterMessage('Warning', 'anything')).toBe('warning');
    expect(consoleEntryTypeFromPrinterMessage(undefined, 'Error: probe failed')).toBe('error');
    expect(consoleEntryTypeFromPrinterMessage(undefined, 'Warning: fan stalled')).toBe('warning');
    expect(consoleEntryTypeFromPrinterMessage(undefined, 'ok')).toBe('response');
  });

  it('falls back when printer timestamps are invalid', () => {
    const fallback = new Date('2026-05-10T12:00:00Z');
    expect(dateFromPrinterTimestamp('not-a-date', fallback)).toBe(fallback);
  });

  it('normalizes printer log paths', () => {
    expect(normalizePrinterLogPath('custom.log')).toEqual(['0:/sys/custom.log']);
    expect(normalizePrinterLogPath('/custom.log')).toEqual(['0:/sys/custom.log']);
    expect(normalizePrinterLogPath('1:/logs/custom.log')).toEqual(['1:/logs/custom.log']);
    expect(normalizePrinterLogPath(null)).toEqual([]);
  });

  it('detects common printer log files', () => {
    expect(isPrinterLogFile('eventlog.txt')).toBe(true);
    expect(isPrinterLogFile('rrf.log')).toBe(true);
    expect(isPrinterLogFile('console-log.txt')).toBe(true);
    expect(isPrinterLogFile('heightmap.csv')).toBe(false);
    expect(isPrinterLogFile('config.g')).toBe(false);
  });

  it('parses timestamped printer log lines', () => {
    const entry = parsePrinterLogLine('2026-05-10 12:34:56 Warning: fan stalled');
    expect(entry).toMatchObject({
      type: 'warning',
      content: 'Warning: fan stalled',
    });
    expect(entry?.timestamp.getFullYear()).toBe(2026);
  });

  it('reports whether imported printer log lines had real timestamps', () => {
    const fallback = new Date('2026-05-10T12:00:00Z');
    const timestamped = parsePrinterLogLineDetails('2026-05-10 12:34:56 Print started', fallback);
    const untimestamped = parsePrinterLogLineDetails('Print started', fallback);

    expect(timestamped?.hasTimestamp).toBe(true);
    expect(timestamped?.entry.timestamp).not.toBe(fallback);
    expect(untimestamped?.hasTimestamp).toBe(false);
    expect(untimestamped?.entry.timestamp).toBe(fallback);
  });

  it('merges imported logs without duplicating existing live messages', () => {
    const existing: ConsoleEntry[] = [
      { timestamp: new Date('2026-05-10T12:00:10Z'), type: 'warning', content: 'Warning: fan stalled' },
    ];
    const imported: ConsoleEntry[] = [
      { timestamp: new Date('2026-05-10T12:00:00Z'), type: 'warning', content: 'Warning: fan stalled' },
      { timestamp: new Date('2026-05-10T12:00:01Z'), type: 'response', content: 'Print started' },
    ];
    expect(mergeConsoleEntries(existing, imported)).toEqual([
      imported[1],
      existing[0],
    ]);
  });

  it('keeps only the most recent console entries after merging', () => {
    const baseTimestamp = Date.parse('2026-05-10T12:00:00Z');
    const existing: ConsoleEntry[] = Array.from({ length: 100 }, (_, index) => ({
      timestamp: new Date(baseTimestamp + index * 1000),
      type: 'response',
      content: `existing ${index}`,
    }));
    const imported: ConsoleEntry[] = [
      { timestamp: new Date('2026-05-10T14:00:00Z'), type: 'response', content: 'newest' },
    ];

    const merged = mergeConsoleEntries(existing, imported);

    expect(merged).toHaveLength(100);
    expect(merged.at(-1)?.content).toBe('newest');
    expect(merged[0].content).toBe('existing 1');
  });
});
