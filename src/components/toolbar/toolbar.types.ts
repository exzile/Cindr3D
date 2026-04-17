// Shared types for toolbar subcomponents

export type Workspace = 'design' | 'prepare' | 'printer';

export type DesignTab = 'solid' | 'surface' | 'mesh' | 'form' | 'manage' | 'utilities';
export type PrepareTab = 'plate' | 'profiles' | 'slice' | 'export';
export type SketchTab = 'sketch';

export type RibbonTab = DesignTab | PrepareTab | SketchTab;

export interface TabDef {
  id: RibbonTab;
  label: string;
  color: string; // CSS variable for the tab underline color
}

export interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  tool?: import('../../types/cad').Tool;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  large?: boolean;
  colorClass?: string;
  dropdown?: { label: string; onClick: () => void; icon?: React.ReactNode }[];
}

export interface MenuItem {
  icon?: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean;
  submenu?: MenuItem[];
  checked?: boolean;
  disabled?: boolean;
}
