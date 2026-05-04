/**
 * SpoolStore — universal filament spool inventory.
 * Persisted in localStorage. Works across all printer firmware types.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Spool {
  id: string;
  brand: string;
  material: string;
  /** CSS hex color WITHOUT the leading # (e.g. "ff5500") */
  colorHex: string;
  colorName: string;
  /** Spool initial weight in grams (filament only, not spool itself) */
  initialWeightG: number;
  /** Amount already used in grams */
  usedWeightG: number;
  /** Filament diameter in mm (typically 1.75 or 2.85) */
  diameterMm: number;
  notes: string;
  /** epoch ms */
  addedAt: number;
}

export interface MaterialInventorySummary {
  material: string;
  spoolCount: number;
  remainingG: number;
  thresholdG: number;
  lowStock: boolean;
}

interface SpoolStore {
  spools: Spool[];
  activeSpoolId: string | null;
  loadedSpoolByPrinterId: Record<string, string | null>;
  lowStockThresholdByMaterial: Record<string, number>;

  addSpool: (spool: Omit<Spool, 'id' | 'addedAt'>) => string;
  removeSpool: (id: string) => void;
  updateSpool: (id: string, patch: Partial<Omit<Spool, 'id' | 'addedAt'>>) => void;
  setActiveSpool: (id: string | null) => void;
  setPrinterLoadedSpool: (printerId: string, spoolId: string | null) => void;
  setMaterialThreshold: (material: string, thresholdG: number) => void;
  /** Record that `grams` of filament was used from the active spool */
  deductFilament: (grams: number) => void;
  deductFilamentForPrinter: (printerId: string, filamentLengthMm: number) => void;
}

const MATERIAL_DENSITY_G_CM3: Record<string, number> = {
  pla: 1.24,
  'pla+': 1.24,
  'silk pla': 1.24,
  petg: 1.27,
  abs: 1.04,
  asa: 1.07,
  tpu: 1.21,
  nylon: 1.14,
  pc: 1.2,
};

const DEFAULT_LOW_STOCK_THRESHOLD_G = 150;

export function remainingG(spool: Spool): number {
  return Math.max(0, spool.initialWeightG - spool.usedWeightG);
}

export function filamentLengthToGrams(lengthMm: number, diameterMm: number, material: string): number {
  if (lengthMm <= 0 || diameterMm <= 0) return 0;
  const radiusMm = diameterMm / 2;
  const volumeMm3 = Math.PI * radiusMm * radiusMm * lengthMm;
  const density = MATERIAL_DENSITY_G_CM3[material.toLowerCase()] ?? 1.24;
  return (volumeMm3 / 1000) * density;
}

export function aggregateInventory(
  spools: Spool[],
  thresholds: Record<string, number> = {},
): MaterialInventorySummary[] {
  const byMaterial = new Map<string, { spoolCount: number; remainingG: number }>();
  for (const spool of spools) {
    const current = byMaterial.get(spool.material) ?? { spoolCount: 0, remainingG: 0 };
    current.spoolCount += 1;
    current.remainingG += remainingG(spool);
    byMaterial.set(spool.material, current);
  }
  return Array.from(byMaterial.entries())
    .map(([material, summary]) => {
      const thresholdG = thresholds[material] ?? DEFAULT_LOW_STOCK_THRESHOLD_G;
      return {
        material,
        spoolCount: summary.spoolCount,
        remainingG: summary.remainingG,
        thresholdG,
        lowStock: summary.remainingG <= thresholdG,
      };
    })
    .sort((a, b) => a.material.localeCompare(b.material));
}

export const useSpoolStore = create<SpoolStore>()(
  persist(
    (set, get) => ({
      spools: [],
      activeSpoolId: null,
      loadedSpoolByPrinterId: {},
      lowStockThresholdByMaterial: {},

      addSpool: (spool) => {
        const id = `spool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        set((s) => ({
          spools: [
            ...s.spools,
            { ...spool, id, addedAt: Date.now() },
          ],
        }));
        return id;
      },

      removeSpool: (id) =>
        set((s) => ({
          spools: s.spools.filter((sp) => sp.id !== id),
          activeSpoolId: s.activeSpoolId === id ? null : s.activeSpoolId,
          loadedSpoolByPrinterId: Object.fromEntries(
            Object.entries(s.loadedSpoolByPrinterId).map(([printerId, spoolId]) => [printerId, spoolId === id ? null : spoolId]),
          ),
        })),

      updateSpool: (id, patch) =>
        set((s) => ({
          spools: s.spools.map((sp) => (sp.id === id ? { ...sp, ...patch } : sp)),
        })),

      setActiveSpool: (id) => set({ activeSpoolId: id }),

      setPrinterLoadedSpool: (printerId, spoolId) =>
        set((s) => ({
          loadedSpoolByPrinterId: {
            ...s.loadedSpoolByPrinterId,
            [printerId]: spoolId,
          },
          activeSpoolId: spoolId ?? s.activeSpoolId,
        })),

      setMaterialThreshold: (material, thresholdG) =>
        set((s) => ({
          lowStockThresholdByMaterial: {
            ...s.lowStockThresholdByMaterial,
            [material]: Math.max(0, thresholdG),
          },
        })),

      deductFilament: (grams) => {
        const { activeSpoolId, spools } = get();
        if (!activeSpoolId) return;
        set({
          spools: spools.map((sp) =>
            sp.id === activeSpoolId
              ? { ...sp, usedWeightG: Math.min(sp.usedWeightG + grams, sp.initialWeightG) }
              : sp,
          ),
        });
      },

      deductFilamentForPrinter: (printerId, filamentLengthMm) => {
        const { activeSpoolId, loadedSpoolByPrinterId, spools } = get();
        const spoolId = loadedSpoolByPrinterId[printerId] ?? activeSpoolId;
        const spool = spools.find((candidate) => candidate.id === spoolId);
        if (!spool) return;
        const grams = filamentLengthToGrams(filamentLengthMm, spool.diameterMm, spool.material);
        set({
          spools: spools.map((candidate) =>
            candidate.id === spool.id
              ? { ...candidate, usedWeightG: Math.min(candidate.usedWeightG + grams, candidate.initialWeightG) }
              : candidate,
          ),
        });
      },
    }),
    {
      name: 'cindr3d-spools',
      version: 2,
    },
  ),
);
