export type Workspace = 'design' | 'prepare' | 'printer';

export type DesignTab = 'solid' | 'surface' | 'mesh' | 'form' | 'manage' | 'utilities';
export type PrepareTab = 'plate' | 'profiles' | 'slice' | 'export';
export type PrinterTab = 'dashboard' | 'status' | 'console' | 'job' | 'history' | 'files' | 'filaments' | 'macros' | 'heightmap' | 'model' | 'config' | 'plugins';
export type SketchTab = 'sketch';

export type RibbonTab = DesignTab | PrepareTab | PrinterTab | SketchTab;

export interface TabDef {
  id: RibbonTab;
  label: string;
  color: string; // CSS variable for the tab underline color
}

export interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  tool?: import('./cad').Tool;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  large?: boolean;
  colorClass?: string;
  dropdown?: { label: string; onClick: () => void; icon?: React.ReactNode; divider?: boolean }[];
}

export interface MenuItem {
  icon?: React.ReactNode;
  ribbonIcon?: React.ReactNode;
  ribbonLabel?: string;
  ribbonColorClass?: string;
  ribbonTool?: import('./cad').Tool;
  ribbonActiveTools?: import('./cad').Tool[];
  promoteToRibbon?: boolean;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean;
  submenu?: MenuItem[];
  checked?: boolean;
  disabled?: boolean;
}
