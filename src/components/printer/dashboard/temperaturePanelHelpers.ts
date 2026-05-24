import {
  HEATER_CHART_COLORS,
  type HeaterRow,
} from "./helpers";

export function heaterRowKey(row: HeaterRow): string {
  return `${row.kind}-${row.index}-${row.toolIndex ?? "machine"}-${row.heaterIndexInTool ?? 0}`;
}

export function heaterRowColor(row: HeaterRow): string {
  if (row.kind === "bed") return "#ef4444";
  if (row.kind === "chamber") return "#a855f7";
  if (row.kind === "heater") return "#22c55e";
  return HEATER_CHART_COLORS[(row.index + 1) % HEATER_CHART_COLORS.length];
}
