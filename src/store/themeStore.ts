import { create } from 'zustand';
import type { ThemeMode, ThemeColors } from '../types/theme.types';

export type { ThemeMode, ThemeColors };

interface ThemeStore {
  theme: ThemeMode;
  colors: ThemeColors;
  reducedMotion: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setReducedMotion: (enabled: boolean) => void;
}

// ─── Light Theme (Fusion 360 style) ────────────────────────────────────────

const lightColors: ThemeColors = {
  bgPrimary: '#ffffff',
  bgSecondary: '#f5f5f5',
  bgToolbar: '#fafafa',
  bgPanel: '#ffffff',
  bgCanvas: '#e8e8e8',
  bgInput: '#f9f9f9',
  bgElevated: '#f0f0f0',
  bgElevatedHover: '#e8e8e8',
  bgHover: 'rgba(0, 0, 0, 0.04)',
  bgActive: 'rgba(0, 120, 215, 0.08)',
  textPrimary: '#1a1a1a',
  textSecondary: '#555555',
  textMuted: '#888888',
  border: '#d0d0d0',
  borderLight: '#e5e5e5',
  borderStrong: '#b8b8b8',
  accent: '#0078d7',
  accentHover: '#006abf',
  accentLight: 'rgba(0, 120, 215, 0.1)',
  accentDim: '#0057a8',
  tabSolid: '#ff6b00',
  tabSurface: '#4caf50',
  tabMesh: '#7b1fa2',
  tabForm: '#e65100',
  tabManage: '#757575',
  tabUtilities: '#546e7a',
  tabPrepare: '#0288d1',
  tabPrinter: '#43a047',
  success: '#4caf50',
  warning: '#ff9800',
  error: '#f44336',
  info: '#2196f3',
  overlay: 'rgba(0, 0, 0, 0.5)',
  // 3D Viewport
  canvasBg: '#d6dce4',
  gridCell: '#c4cbd5',
  gridSection: '#a8b0bc',
  groundPlane: '#cdd4dc',
  groundPlaneEdge: '#a0a8b4',
  axisRed: '#d45050',
  axisGreen: '#50b050',
  axisBlue: '#5080d4',
  hemisphereColor: '#a8b8d8',
  hemisphereGround: '#888888',
};

// ─── Dark Theme (existing scheme) ──────────────────────────────────────────

const darkColors: ThemeColors = {
  bgPrimary: '#0d0d1a',
  bgSecondary: '#12122a',
  bgToolbar: '#1a1a36',
  bgPanel: '#12122a',
  bgCanvas: '#0a0a18',
  bgInput: '#0a0a1a',
  bgElevated: '#181838',
  bgElevatedHover: '#1f1f44',
  bgHover: 'rgba(100, 120, 255, 0.1)',
  bgActive: 'rgba(80, 120, 255, 0.2)',
  textPrimary: '#e0e0e0',
  textSecondary: '#b0b0c8',
  textMuted: '#7777aa',
  border: '#2a2a4a',
  borderLight: '#22223a',
  borderStrong: '#1e1e3a',
  accent: '#7090ff',
  accentHover: '#5577ff',
  accentLight: 'rgba(80, 120, 255, 0.15)',
  accentDim: '#4a62cc',
  tabSolid: '#ff8c40',
  tabSurface: '#66bb6a',
  tabMesh: '#ab47bc',
  tabForm: '#ff7043',
  tabManage: '#9e9e9e',
  tabUtilities: '#78909c',
  tabPrepare: '#29b6f6',
  tabPrinter: '#66bb6a',
  success: '#4ade80',
  warning: '#ffaa44',
  error: '#ef4444',
  info: '#44aaff',
  overlay: 'rgba(0, 0, 0, 0.7)',
  // 3D Viewport
  canvasBg: '#1a1a2e',
  gridCell: '#2a2a4a',
  gridSection: '#3a3a6a',
  groundPlane: '#20203a',
  groundPlaneEdge: '#161630',
  axisRed: '#ff4444',
  axisGreen: '#44cc44',
  axisBlue: '#4488ff',
  hemisphereColor: '#8888ff',
  hemisphereGround: '#444444',
};

// ─── Apply theme CSS custom properties ─────────────────────────────────────

function applyTheme(colors: ThemeColors, mode: ThemeMode) {
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);
  root.style.setProperty('--bg-primary', colors.bgPrimary);
  root.style.setProperty('--bg-secondary', colors.bgSecondary);
  root.style.setProperty('--bg-toolbar', colors.bgToolbar);
  root.style.setProperty('--bg-panel', colors.bgPanel);
  root.style.setProperty('--bg-canvas', colors.bgCanvas);
  root.style.setProperty('--bg-input', colors.bgInput);
  root.style.setProperty('--bg-elevated', colors.bgElevated);
  root.style.setProperty('--bg-elevated-hover', colors.bgElevatedHover);
  root.style.setProperty('--bg-hover', colors.bgHover);
  root.style.setProperty('--bg-active', colors.bgActive);
  root.style.setProperty('--text-primary', colors.textPrimary);
  root.style.setProperty('--text-secondary', colors.textSecondary);
  root.style.setProperty('--text-muted', colors.textMuted);
  root.style.setProperty('--border', colors.border);
  root.style.setProperty('--border-light', colors.borderLight);
  root.style.setProperty('--border-strong', colors.borderStrong);
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--accent-hover', colors.accentHover);
  root.style.setProperty('--accent-light', colors.accentLight);
  root.style.setProperty('--accent-dim', colors.accentDim);
  root.style.setProperty('--tab-solid', colors.tabSolid);
  root.style.setProperty('--tab-surface', colors.tabSurface);
  root.style.setProperty('--tab-mesh', colors.tabMesh);
  root.style.setProperty('--tab-form', colors.tabForm);
root.style.setProperty('--tab-manage', colors.tabManage);
  root.style.setProperty('--tab-utilities', colors.tabUtilities);
  root.style.setProperty('--tab-prepare', colors.tabPrepare);
  root.style.setProperty('--tab-printer', colors.tabPrinter);
  root.style.setProperty('--success', colors.success);
  root.style.setProperty('--warning', colors.warning);
  root.style.setProperty('--error', colors.error);
  root.style.setProperty('--info', colors.info);
  root.style.setProperty('--overlay-bg', colors.overlay);
  // 3D viewport
  root.style.setProperty('--canvas-bg', colors.canvasBg);
  root.style.setProperty('--grid-cell', colors.gridCell);
  root.style.setProperty('--grid-section', colors.gridSection);
  root.style.setProperty('--ground-plane', colors.groundPlane);
  root.style.setProperty('--hemisphere-color', colors.hemisphereColor);
  root.style.setProperty('--hemisphere-ground', colors.hemisphereGround);
}

function applyReducedMotion(enabled: boolean) {
  document.documentElement.toggleAttribute('data-reduced-motion', enabled);
}

// ─── Store ─────────────────────────────────────────────────────────────────

function getColorsForTheme(theme: ThemeMode): ThemeColors {
  return theme === 'light' ? lightColors : darkColors;
}

function getSavedTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem('cindr3d-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* noop */ }
  return 'light'; // Default to light (Fusion 360 style)
}

function getSavedReducedMotion(): boolean {
  try {
    const saved = localStorage.getItem('cindr3d-reduced-motion');
    if (saved === 'true') return true;
    if (saved === 'false') return false;
  } catch { /* noop */ }
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

const initialTheme = getSavedTheme();
const initialColors = getColorsForTheme(initialTheme);
const initialReducedMotion = getSavedReducedMotion();

// Apply theme immediately on load
applyTheme(initialColors, initialTheme);
applyReducedMotion(initialReducedMotion);

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: initialTheme,
  colors: initialColors,
  reducedMotion: initialReducedMotion,

  setTheme: (theme: ThemeMode) => {
    const colors = getColorsForTheme(theme);
    applyTheme(colors, theme);
    try { localStorage.setItem('cindr3d-theme', theme); } catch { /* noop */ }
    set({ theme, colors });
  },

  toggleTheme: () => {
    set((state) => {
      const newTheme: ThemeMode = state.theme === 'light' ? 'dark' : 'light';
      const colors = getColorsForTheme(newTheme);
      applyTheme(colors, newTheme);
      try { localStorage.setItem('cindr3d-theme', newTheme); } catch { /* noop */ }
      return { theme: newTheme, colors };
    });
  },

  setReducedMotion: (enabled: boolean) => {
    applyReducedMotion(enabled);
    try { localStorage.setItem('cindr3d-reduced-motion', String(enabled)); } catch { /* noop */ }
    set({ reducedMotion: enabled });
  },
}));
