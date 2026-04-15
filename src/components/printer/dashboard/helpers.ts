import { useMemo } from 'react';
import { colors as COLORS } from '../../../utils/theme';
import { usePrinterStore } from '../../../store/printerStore';

export const HEATER_CHART_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

export interface HeaterRow {
  label: string;
  index: number;
  kind: 'bed' | 'chamber' | 'tool';
  toolIndex?: number;
  heaterIndexInTool?: number;
}

export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

export function statusColor(status: string): string {
  switch (status) {
    case 'idle': return COLORS.success;
    case 'processing': case 'simulating': return COLORS.accent;
    case 'paused': case 'pausing': case 'resuming': case 'changingTool': return COLORS.warning;
    case 'halted': case 'off': case 'cancelling': return COLORS.danger;
    case 'busy': return '#a855f7';
    default: return COLORS.textDim;
  }
}

export function heaterStateColor(state: string): string {
  switch (state) {
    case 'active': return COLORS.success;
    case 'standby': return COLORS.warning;
    case 'fault': return COLORS.danger;
    case 'tuning': return COLORS.accent;
    default: return COLORS.textDim;
  }
}

export function tempBarGradient(current: number, max = 300): string {
  const pct = Math.min(1, Math.max(0, current / max));
  if (pct < 0.5) {
    const t = pct / 0.5;
    const r = Math.round(59 + t * (245 - 59));
    const g = Math.round(130 + t * (158 - 130));
    const b = Math.round(246 + t * (11 - 246));
    return `rgb(${r},${g},${b})`;
  }
  const t = (pct - 0.5) / 0.5;
  const r = Math.round(245 + t * (239 - 245));
  const g = Math.round(158 + t * (68 - 158));
  const b = Math.round(11 + t * (68 - 11));
  return `rgb(${r},${g},${b})`;
}

export function tempColorIndicator(temp: number): string {
  if (temp < 50) return COLORS.success;
  if (temp < 70) return COLORS.warning;
  return COLORS.danger;
}

export function vinColorIndicator(voltage: number): string {
  if (voltage >= 22 && voltage <= 26) return COLORS.success;
  if (voltage >= 20 && voltage <= 28) return COLORS.warning;
  return COLORS.danger;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function toolStateColor(state: string): string {
  switch (state) {
    case 'active': return COLORS.success;
    case 'standby': return COLORS.warning;
    default: return COLORS.textDim;
  }
}

export function useHeaterRows(): HeaterRow[] {
  const model = usePrinterStore((s) => s.model);
  return useMemo(() => {
    const rows: HeaterRow[] = [];
    const bedHeaters = model.heat?.bedHeaters ?? [];
    bedHeaters.forEach((idx) => {
      if (idx >= 0) rows.push({ label: `Bed${bedHeaters.length > 1 ? ` ${idx}` : ''}`, index: idx, kind: 'bed' });
    });
    const chamberHeaters = model.heat?.chamberHeaters ?? [];
    chamberHeaters.forEach((idx) => {
      if (idx >= 0) rows.push({ label: `Chamber${chamberHeaters.length > 1 ? ` ${idx}` : ''}`, index: idx, kind: 'chamber' });
    });
    const tools = model.tools ?? [];
    tools.forEach((tool) => {
      tool.heaters.forEach((hIdx, hi) => {
        rows.push({
          label: tool.name || `Tool ${tool.number}${tool.heaters.length > 1 ? ` H${hi}` : ''}`,
          index: hIdx,
          kind: 'tool',
          toolIndex: tool.number,
          heaterIndexInTool: hi,
        });
      });
    });
    return rows;
  }, [model.heat, model.tools]);
}
