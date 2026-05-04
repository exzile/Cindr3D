import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Identifies every toggleable settings section on the slicer Settings panel.
// Used by the gear modal (show/hide list) and by the panel itself to filter.
export const SETTINGS_SECTIONS = [
  { id: 'printer',           label: 'Printer',             group: 'Profiles',        defaultOn: true  },
  { id: 'material',          label: 'Material',            group: 'Profiles',        defaultOn: true  },
  { id: 'printProfile',      label: 'Print Profile Picker', group: 'Profiles',       defaultOn: true  },
  { id: 'quality',           label: 'Quality',             group: 'Print Settings',  defaultOn: true  },
  { id: 'walls',             label: 'Walls',               group: 'Print Settings',  defaultOn: true  },
  { id: 'topBottom',         label: 'Top / Bottom',        group: 'Print Settings',  defaultOn: true  },
  { id: 'infill',            label: 'Infill',              group: 'Print Settings',  defaultOn: true  },
  { id: 'speed',             label: 'Speed',               group: 'Print Settings',  defaultOn: true  },
  { id: 'travel',            label: 'Travel',              group: 'Print Settings',  defaultOn: true  },
  { id: 'cooling',           label: 'Cooling',             group: 'Print Settings',  defaultOn: true  },
  { id: 'support',           label: 'Support',             group: 'Print Settings',  defaultOn: true  },
  { id: 'adhesion',          label: 'Build Plate Adhesion', group: 'Print Settings', defaultOn: true  },
  { id: 'specialModes',      label: 'Special Modes',       group: 'Print Settings',  defaultOn: false },
  { id: 'experimental',      label: 'Experimental',        group: 'Print Settings',  defaultOn: false },
  { id: 'acceleration',      label: 'Acceleration & Jerk', group: 'Print Settings',  defaultOn: false },
  { id: 'meshFixes',         label: 'Mesh Fixes',          group: 'Print Settings',  defaultOn: false },
  // Cura-parity advanced groups. Off by default — they're power-user knobs
  // and clutter the panel otherwise. Users flip them on via the gear modal.
  { id: 'compensation',      label: 'Dimensional Compensation', group: 'Advanced',   defaultOn: false },
  { id: 'flow',              label: 'Flow',                 group: 'Advanced',       defaultOn: false },
  { id: 'bridging',          label: 'Bridging',             group: 'Advanced',       defaultOn: false },
  { id: 'smallFeatures',     label: 'Small Features',       group: 'Advanced',       defaultOn: false },
  { id: 'primeTower',        label: 'Prime Tower (Multi-Extruder)', group: 'Advanced', defaultOn: false },
  { id: 'modifierMeshes',    label: 'Modifier Meshes',      group: 'Advanced',       defaultOn: false },
  // NOTE: walls/topBottom/infill/travel/cooling/support/raft/experimental
  // "— Advanced" toggles and the Z-Hop toggle were removed — those fields
  // now live inside their parent section and appear automatically at
  // detail level "advanced" or higher. The Detail Level dropdown in the
  // gear modal controls their visibility instead of per-section toggles.
] as const;

export type { SettingsSectionId, DetailLevel } from '../types/slicer-visibility.types';
import type { SettingsSectionId, DetailLevel } from '../types/slicer-visibility.types';

const DEFAULTS: Record<string, boolean> = Object.fromEntries(
  SETTINGS_SECTIONS.map((s) => [s.id, s.defaultOn]),
);
const LEVEL_RANK: Record<DetailLevel, number> = { basic: 0, advanced: 1, expert: 2 };

interface SlicerVisibilityStore {
  visible: Record<string, boolean>;
  detailLevel: DetailLevel;
  isVisible: (id: SettingsSectionId) => boolean;
  meetsLevel: (required: DetailLevel) => boolean;
  setVisible: (id: SettingsSectionId, on: boolean) => void;
  setDetailLevel: (level: DetailLevel) => void;
  setAll: (on: boolean) => void;
  resetDefaults: () => void;
}

export const useSlicerVisibilityStore = create<SlicerVisibilityStore>()(persist(
  (set, get) => ({
    visible: { ...DEFAULTS },
    detailLevel: 'advanced' as DetailLevel,
    // In expert mode all sections are visible regardless of toggle state.
    isVisible: (id) => get().detailLevel === 'expert' || (get().visible[id] ?? DEFAULTS[id] ?? true),
    meetsLevel: (required) => LEVEL_RANK[get().detailLevel] >= LEVEL_RANK[required],
    setVisible: (id, on) => set((state) => ({ visible: { ...state.visible, [id]: on } })),
    setDetailLevel: (level) => set({ detailLevel: level }),
    setAll: (on) => set({
      visible: Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s.id, on])),
    }),
    resetDefaults: () => set({ visible: { ...DEFAULTS }, detailLevel: 'advanced' }),
  }),
  {
    name: 'cindr3d-slicer-section-visibility',
    storage: createJSONStorage(() => localStorage),
  },
));
