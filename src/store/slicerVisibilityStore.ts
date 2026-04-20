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
] as const;

export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id'];

const DEFAULTS: Record<string, boolean> = Object.fromEntries(
  SETTINGS_SECTIONS.map((s) => [s.id, s.defaultOn]),
);

interface SlicerVisibilityStore {
  visible: Record<string, boolean>;
  isVisible: (id: SettingsSectionId) => boolean;
  setVisible: (id: SettingsSectionId, on: boolean) => void;
  setAll: (on: boolean) => void;
  resetDefaults: () => void;
}

export const useSlicerVisibilityStore = create<SlicerVisibilityStore>()(persist(
  (set, get) => ({
    visible: { ...DEFAULTS },
    isVisible: (id) => get().visible[id] ?? DEFAULTS[id] ?? true,
    setVisible: (id, on) => set((state) => ({ visible: { ...state.visible, [id]: on } })),
    setAll: (on) => set({
      visible: Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s.id, on])),
    }),
    resetDefaults: () => set({ visible: { ...DEFAULTS } }),
  }),
  {
    name: 'dzign3d-slicer-section-visibility',
    storage: createJSONStorage(() => localStorage),
  },
));
