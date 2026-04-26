/* eslint-disable react-refresh/only-export-components */
import { ArrowUp, ArrowUpDown, ArrowDown } from 'lucide-react';
import type { DuetFileInfo } from '../../../types/duet';
import { formatDurationWords, formatFilamentLength } from '../../../utils/printerFormat';

export function formatDate(dateStr: string): string {
  if (!dateStr) return '--';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export const formatDuration = (seconds: number | undefined | null) => formatDurationWords(seconds, '--', true);
export const formatFilament = (mm: number) => formatFilamentLength(mm, '--');

export function isGCodeFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.gcode') || lower.endsWith('.g') || lower.endsWith('.nc');
}

export function isEditableFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.g') ||
    lower.endsWith('.gcode') ||
    lower.endsWith('.cfg') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.json') ||
    lower.endsWith('.nc')
  );
}

export interface FileTab {
  id: string;
  label: string;
  directory: string;
}

export const FILE_TABS: FileTab[] = [
  { id: 'gcodes', label: 'G-Code Files', directory: '0:/gcodes' },
  { id: 'sys', label: 'System', directory: '0:/sys' },
  { id: 'filaments', label: 'Filaments', directory: '0:/filaments' },
];

import type { SortField, SortDir } from '../../../types/file-manager.types';
export type { SortField, SortDir } from '../../../types/file-manager.types';

export function sortFiles(files: DuetFileInfo[], field: SortField, dir: SortDir): DuetFileInfo[] {
  const sorted = [...files];
  sorted.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'd' ? -1 : 1;

    let cmp = 0;
    switch (field) {
      case 'name':
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        break;
      case 'size':
        cmp = a.size - b.size;
        break;
      case 'date':
        cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
        break;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

export function SortIcon({ field, current, dir }: { field: SortField; current: SortField; dir: SortDir }) {
  if (field !== current) return <ArrowUpDown size={12} style={{ opacity: 0.3 }} />;
  return dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
}
