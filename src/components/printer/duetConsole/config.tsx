import type { ReactNode } from 'react';
import { AlertTriangle, Cpu, Crosshair, Home, Info, RotateCcw, Settings } from 'lucide-react';

export const QUICK_COMMANDS: {
  label: string;
  gcode: string;
  icon: ReactNode;
  variant?: 'danger';
}[] = [
  { label: 'M112 Emergency Stop', gcode: 'M112', icon: <AlertTriangle size={14} />, variant: 'danger' },
  { label: 'M999 Reset', gcode: 'M999', icon: <RotateCcw size={14} /> },
  { label: 'G28 Home All', gcode: 'G28', icon: <Home size={14} /> },
  { label: 'M114 Position', gcode: 'M114', icon: <Crosshair size={14} /> },
  { label: 'M503 Settings', gcode: 'M503', icon: <Settings size={14} /> },
  { label: 'M122 Diagnostics', gcode: 'M122', icon: <Cpu size={14} /> },
  { label: 'M115 Firmware', gcode: 'M115', icon: <Info size={14} /> },
];

export const TYPE_COLORS: Record<string, string> = {
  command: '#22d3ee',
  response: '#d4d4d8',
  warning: '#facc15',
  error: '#f87171',
};

export const GCODE_SUGGESTIONS: { code: string; description: string }[] = [
  { code: 'G0', description: 'Rapid move' },
  { code: 'G1', description: 'Linear move' },
  { code: 'G28', description: 'Home all axes' },
  { code: 'G29', description: 'Probe bed' },
  { code: 'G10', description: 'Set offsets / retract' },
  { code: 'G32', description: 'Probe Z / bed leveling' },
  { code: 'G90', description: 'Absolute positioning' },
  { code: 'G91', description: 'Relative positioning' },
  { code: 'M0', description: 'Stop and wait' },
  { code: 'M24', description: 'Resume print' },
  { code: 'M25', description: 'Pause print' },
  { code: 'M80', description: 'ATX power on' },
  { code: 'M81', description: 'ATX power off' },
  { code: 'M104', description: 'Set hotend temp' },
  { code: 'M106', description: 'Set fan speed' },
  { code: 'M112', description: 'Emergency stop' },
  { code: 'M114', description: 'Report position' },
  { code: 'M115', description: 'Firmware info' },
  { code: 'M119', description: 'Endstop status' },
  { code: 'M122', description: 'Diagnostics' },
  { code: 'M140', description: 'Set bed temp' },
  { code: 'M141', description: 'Set chamber temp' },
  { code: 'M220', description: 'Set speed factor' },
  { code: 'M221', description: 'Set flow factor' },
  { code: 'M290', description: 'Baby stepping' },
  { code: 'M291', description: 'Display message' },
  { code: 'M292', description: 'Acknowledge message' },
  { code: 'M486', description: 'Object cancel' },
  { code: 'M500', description: 'Save settings' },
  { code: 'M503', description: 'Report settings' },
  { code: 'M552', description: 'Network config' },
  { code: 'M997', description: 'Update firmware' },
  { code: 'M999', description: 'Reset controller' },
];

export const COMMAND_HISTORY_KEY = 'duet-console-command-history';
export const MAX_HISTORY = 100;
export const TEMP_REPORT_PATTERN = /\b(ok\s+)?(T\d*:\s*[\d.]+|B:\s*[\d.]+)/i;

export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  const digits = q.replace(/[^0-9]/g, '');
  if (digits && t.replace(/[^0-9]/g, '').includes(digits)) return true;
  return false;
}

export function highlightText(text: string, search: string): React.ReactNode {
  if (!search) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="duet-console__search-highlight">
        {text.slice(idx, idx + search.length)}
      </span>
      {text.slice(idx + search.length)}
    </>
  );
}

export function highlightGCode(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .split('\n')
    .map((line) => {
      const commentIdx = line.indexOf(';');
      const codePart = commentIdx === -1 ? line : line.slice(0, commentIdx);
      const commentPart = commentIdx === -1 ? '' : line.slice(commentIdx);

      let highlighted = codePart
        .replace(/\b([GM]\d+(?:\.\d+)?)\b/g, '<span style="color:#7ec8e3;font-weight:bold">$1</span>')
        .replace(/\b([XYZEFRSPT]-?\d+(?:\.\d+)?)\b/g, '<span style="color:#c3e88d">$1</span>');

      if (commentPart) {
        highlighted += `<span style="color:#555;font-style:italic">${commentPart}</span>`;
      }

      return highlighted;
    })
    .join('\n');
}
