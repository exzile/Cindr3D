/**
 * Panel-geometry persistence + clamping for the floating AI Assistant panel.
 * The geometry is stored under a single localStorage key so the panel
 * remembers its position across sessions; clamp keeps it on-screen after
 * window resizes.
 */
import type { PanelGeometry } from './types';

export const PANEL_GEOMETRY_KEY = 'cindr3d-ai-assistant-geometry';
export const PANEL_MIN_WIDTH = 360;
export const PANEL_MIN_HEIGHT = 380;
export const PANEL_EDGE_GAP = 8;

export function defaultPanelGeometry(): PanelGeometry {
  const width = Math.min(440, Math.max(PANEL_MIN_WIDTH, window.innerWidth - 32));
  const height = Math.min(620, Math.max(PANEL_MIN_HEIGHT, window.innerHeight - 88));
  return {
    left: Math.max(PANEL_EDGE_GAP, window.innerWidth - width - 16),
    top: 48,
    width,
    height,
  };
}

export function clampPanelGeometry(next: PanelGeometry): PanelGeometry {
  const maxWidth = Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_EDGE_GAP * 2);
  const maxHeight = Math.max(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_EDGE_GAP * 2);
  const width = Math.min(Math.max(next.width, PANEL_MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(next.height, PANEL_MIN_HEIGHT), maxHeight);
  const maxLeft = Math.max(PANEL_EDGE_GAP, window.innerWidth - width - PANEL_EDGE_GAP);
  const maxTop = Math.max(PANEL_EDGE_GAP, window.innerHeight - height - PANEL_EDGE_GAP);
  return {
    width,
    height,
    left: Math.min(Math.max(next.left, PANEL_EDGE_GAP), maxLeft),
    top: Math.min(Math.max(next.top, PANEL_EDGE_GAP), maxTop),
  };
}

export function loadPanelGeometry(): PanelGeometry {
  try {
    const raw = localStorage.getItem(PANEL_GEOMETRY_KEY);
    if (!raw) return defaultPanelGeometry();
    const parsed = JSON.parse(raw) as Partial<PanelGeometry>;
    if (
      typeof parsed.left === 'number' &&
      typeof parsed.top === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return clampPanelGeometry(parsed as PanelGeometry);
    }
  } catch {
    // Fall through to a fresh placement when persisted geometry is invalid.
  }
  return defaultPanelGeometry();
}
