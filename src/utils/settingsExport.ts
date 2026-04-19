// =============================================================================
// Settings Export / Import
// Serializes all user preferences across the three workspaces (Design, Prepare,
// 3D Print) to a single JSON file that can be downloaded and re-imported on
// any device or browser.
//
// What IS included:  workspace display prefs, printer connection config, slicer
//                    profiles + active selections, duet UI prefs, theme.
// What is NOT included: model geometry, sketch data, plate objects (those are
//                        saved via .dzn / export flows).
// =============================================================================

import { getDuetPrefs, updateDuetPrefs, type DuetPrefs } from './duetPrefs';
import { useCADStore } from '../store/cadStore';
import { usePrinterStore } from '../store/printerStore';
import { useSlicerStore } from '../store/slicerStore';
import { useThemeStore } from '../store/themeStore';
import type { PrinterProfile, MaterialProfile, PrintProfile } from '../types/slicer';
import type { DuetConfig } from '../types/duet';

const EXPORT_VERSION = 1;
const FILE_MIME = 'application/json';
const FILE_EXT = 'dzign3d-settings.json';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

interface CadPrefs {
  gridSize: number;
  snapEnabled: boolean;
  gridVisible: boolean;
  sketchPolygonSides: number;
  sketchFilletRadius: number;
  units: 'mm' | 'cm' | 'in';
  visualStyle: 'shaded' | 'shadedEdges' | 'wireframe' | 'hiddenLines';
  showEnvironment: boolean;
  showShadows: boolean;
  showGroundPlane: boolean;
  showComponentColors: boolean;
  viewportLayout: '1' | '2h' | '2v' | '4';
  ambientOcclusionEnabled: boolean;
  dimensionToleranceMode: 'none' | 'symmetric' | 'deviation';
  dimensionToleranceUpper: number;
  dimensionToleranceLower: number;
}

interface SlicerPrefs {
  activePrinterProfileId: string;
  activeMaterialProfileId: string;
  activePrintProfileId: string;
  printerProfiles: PrinterProfile[];
  materialProfiles: MaterialProfile[];
  printProfiles: PrintProfile[];
}

interface PrinterPrefs {
  config: DuetConfig;
  prefs: DuetPrefs;
}

export interface ExportedSettings {
  version: number;
  app: 'dzign3d';
  exportedAt: string;
  cad: CadPrefs;
  slicer: SlicerPrefs;
  printer: PrinterPrefs;
  theme: 'light' | 'dark';
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function buildExportPayload(): ExportedSettings {
  const cad = useCADStore.getState();
  const slicer = useSlicerStore.getState();
  const printer = usePrinterStore.getState();
  const theme = useThemeStore.getState();

  return {
    version: EXPORT_VERSION,
    app: 'dzign3d',
    exportedAt: new Date().toISOString(),

    cad: {
      gridSize: cad.gridSize,
      snapEnabled: cad.snapEnabled,
      gridVisible: cad.gridVisible,
      sketchPolygonSides: cad.sketchPolygonSides,
      sketchFilletRadius: cad.sketchFilletRadius,
      units: cad.units,
      visualStyle: cad.visualStyle,
      showEnvironment: cad.showEnvironment,
      showShadows: cad.showShadows,
      showGroundPlane: cad.showGroundPlane,
      showComponentColors: cad.showComponentColors,
      viewportLayout: cad.viewportLayout,
      ambientOcclusionEnabled: cad.ambientOcclusionEnabled,
      dimensionToleranceMode: cad.dimensionToleranceMode,
      dimensionToleranceUpper: cad.dimensionToleranceUpper,
      dimensionToleranceLower: cad.dimensionToleranceLower,
    },

    slicer: {
      activePrinterProfileId: slicer.activePrinterProfileId,
      activeMaterialProfileId: slicer.activeMaterialProfileId,
      activePrintProfileId: slicer.activePrintProfileId,
      printerProfiles: slicer.printerProfiles,
      materialProfiles: slicer.materialProfiles,
      printProfiles: slicer.printProfiles,
    },

    printer: {
      config: { ...printer.config },
      prefs: getDuetPrefs(),
    },

    theme: theme.theme,
  };
}

export function downloadSettings(): void {
  const payload = buildExportPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: FILE_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = FILE_EXT;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportResult {
  ok: boolean;
  appliedSections: string[];
  warnings: string[];
  error?: string;
}

export function applySettings(raw: unknown): ImportResult {
  const result: ImportResult = { ok: false, appliedSections: [], warnings: [] };

  if (!raw || typeof raw !== 'object') {
    result.error = 'Invalid file: not a JSON object.';
    return result;
  }

  const s = raw as Partial<ExportedSettings>;

  if (s.app !== 'dzign3d') {
    result.error = 'Invalid file: not a Dzign3D settings export.';
    return result;
  }

  if (typeof s.version !== 'number' || s.version > EXPORT_VERSION) {
    result.warnings.push(`Settings file version (${s.version}) is newer than this app — some settings may not apply.`);
  }

  // ── Theme ────────────────────────────────────────────────────────────────
  if (s.theme === 'light' || s.theme === 'dark') {
    useThemeStore.getState().setTheme(s.theme);
    result.appliedSections.push('Theme');
  }

  // ── Design workspace (CAD prefs) ─────────────────────────────────────────
  if (s.cad && typeof s.cad === 'object') {
    const c = s.cad;
    const cad = useCADStore.getState();
    if (typeof c.gridSize === 'number')           cad.setGridSize(c.gridSize);
    if (typeof c.snapEnabled === 'boolean')       cad.setSnapEnabled(c.snapEnabled);
    if (typeof c.gridVisible === 'boolean')       cad.setGridVisible(c.gridVisible);
    if (typeof c.sketchPolygonSides === 'number') cad.setSketchPolygonSides(c.sketchPolygonSides);
    if (typeof c.sketchFilletRadius === 'number') cad.setSketchFilletRadius(c.sketchFilletRadius);
    if (c.units === 'mm' || c.units === 'cm' || c.units === 'in') cad.setUnits(c.units);
    if (c.visualStyle)      cad.setVisualStyle(c.visualStyle);
    if (typeof c.showEnvironment === 'boolean')   cad.setShowEnvironment(c.showEnvironment);
    if (typeof c.showShadows === 'boolean')       cad.setShowShadows(c.showShadows);
    if (typeof c.showGroundPlane === 'boolean')   cad.setShowGroundPlane(c.showGroundPlane);
    if (typeof c.showComponentColors === 'boolean') cad.setShowComponentColors(c.showComponentColors);
    if (c.viewportLayout)   cad.setViewportLayout(c.viewportLayout);
    if (typeof c.ambientOcclusionEnabled === 'boolean') cad.setAmbientOcclusionEnabled(c.ambientOcclusionEnabled);
    if (c.dimensionToleranceMode) cad.setDimensionToleranceMode(c.dimensionToleranceMode);
    if (typeof c.dimensionToleranceUpper === 'number') cad.setDimensionToleranceUpper(c.dimensionToleranceUpper);
    if (typeof c.dimensionToleranceLower === 'number') cad.setDimensionToleranceLower(c.dimensionToleranceLower);
    result.appliedSections.push('Design Workspace');
  }

  // ── Prepare workspace (slicer) ───────────────────────────────────────────
  if (s.slicer && typeof s.slicer === 'object') {
    const sl = s.slicer;
    const slicer = useSlicerStore.getState();

    if (Array.isArray(sl.printerProfiles) && sl.printerProfiles.length > 0) {
      sl.printerProfiles.forEach((p) => {
        const exists = slicer.printerProfiles.some((x) => x.id === p.id);
        if (exists) slicer.updatePrinterProfile(p.id, p);
        else slicer.addPrinterProfile(p);
      });
    }
    if (Array.isArray(sl.materialProfiles) && sl.materialProfiles.length > 0) {
      sl.materialProfiles.forEach((p) => {
        const exists = slicer.materialProfiles.some((x) => x.id === p.id);
        if (exists) slicer.updateMaterialProfile(p.id, p);
        else slicer.addMaterialProfile(p);
      });
    }
    if (Array.isArray(sl.printProfiles) && sl.printProfiles.length > 0) {
      sl.printProfiles.forEach((p) => {
        const exists = slicer.printProfiles.some((x) => x.id === p.id);
        if (exists) slicer.updatePrintProfile(p.id, p);
        else slicer.addPrintProfile(p);
      });
    }

    if (sl.activePrinterProfileId) slicer.setActivePrinterProfile(sl.activePrinterProfileId);
    if (sl.activeMaterialProfileId) slicer.setActiveMaterialProfile(sl.activeMaterialProfileId);
    if (sl.activePrintProfileId) slicer.setActivePrintProfile(sl.activePrintProfileId);

    result.appliedSections.push('Prepare Workspace');
  }

  // ── 3D Print workspace (printer config + duet prefs) ─────────────────────
  if (s.printer && typeof s.printer === 'object') {
    const { config, prefs } = s.printer;
    if (config && typeof config.hostname === 'string') {
      usePrinterStore.getState().setConfig(config);
    }
    if (prefs && typeof prefs === 'object') {
      updateDuetPrefs(prefs);
    }
    result.appliedSections.push('3D Print Workspace');
  }

  result.ok = true;
  return result;
}

export function importSettingsFromFile(file: File): Promise<ImportResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        resolve(applySettings(parsed));
      } catch {
        resolve({ ok: false, appliedSections: [], warnings: [], error: 'Could not parse file — is it a valid JSON settings export?' });
      }
    };
    reader.onerror = () => resolve({ ok: false, appliedSections: [], warnings: [], error: 'Failed to read file.' });
    reader.readAsText(file);
  });
}
