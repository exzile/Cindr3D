import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer2, Minus, Circle, Square, Spline,
  ArrowUpFromLine, RotateCcw, Blend, Ruler, Hexagon,
  Move, RotateCw, Maximize2, Layers,
  Grid3X3, Magnet, FolderOpen, Download,
  Undo2, Redo2, PenTool, Diamond, Printer,
  Box, Combine, Scissors, FlipHorizontal,
  CircleDot, Repeat, Copy, Link2, Axis3D,
  Pipette, AlignCenter, ChevronDown, X, Check,
  Eye, EyeOff, Settings, FileUp, Home,
  MonitorSmartphone, Plug, PlugZap, AlertTriangle,
  ArrowUp, ChevronRight,
  Play, Sun, Moon, Bell, HelpCircle, User,
  Save, Trash2, Wrench, Crosshair,
  Target, Package, Globe,
  // Sketch-specific icons
  PenLine, RectangleHorizontal, Waypoints,
  CornerDownRight, FlipHorizontal2, ChevronsRight,
  ArrowLeftRight, ArrowUpDown, Equal, Tangent,
} from 'lucide-react';
import { useCADStore } from '../store/cadStore';
import { usePrinterStore } from '../store/printerStore';
import { useSlicerStore } from '../store/slicerStore';
import { useThemeStore } from '../store/themeStore';
import { FileImporter } from '../engine/FileImporter';
import type { Tool, Feature } from '../types/cad';

// ─── Types ─────────────────────────────────────────────────────────────────

type Workspace = 'design' | 'prepare';

type DesignTab = 'solid' | 'surface' | 'mesh' | 'sheet-metal' | 'plastic' | 'manage' | 'utilities';
type PrepareTab = 'plate' | 'profiles' | 'slice' | 'export';
type SketchTab = 'sketch';

type RibbonTab = DesignTab | PrepareTab | SketchTab;

interface TabDef {
  id: RibbonTab;
  label: string;
  color: string; // CSS variable for the tab underline color
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  tool?: Tool;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  large?: boolean;
  colorClass?: string; // icon color class
  dropdown?: { label: string; onClick: () => void; icon?: React.ReactNode }[];
}

// ─── Flyout Menu Types ────────────────────────────────────────────────────

interface MenuItem {
  icon?: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean; // if true, render a separator line before this item
  submenu?: MenuItem[]; // for sub-menus with ► arrow
  checked?: boolean;
  disabled?: boolean;
}

// ─── ToolButton Component ──────────────────────────────────────────────────

function ToolButton({ icon, label, tool, active, onClick, disabled, large, colorClass, dropdown }: ToolButtonProps) {
  const activeTool = useCADStore((s) => s.activeTool);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });

  const isActive = active ?? (tool ? activeTool === tool : false);

  const handleClick = () => {
    if (disabled) return;
    if (onClick) onClick();
    else if (tool) setActiveTool(tool);
  };

  const openDropdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 2, left: rect.left });
    }
    setDropdownOpen(!dropdownOpen);
  };

  // Close on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current && !btnRef.current.contains(target) &&
          dropdownRef.current && !dropdownRef.current.contains(target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        className={`ribbon-button ${isActive ? 'active' : ''} ${disabled ? 'disabled' : ''} ${large ? 'large' : ''}`}
        onClick={handleClick}
        title={label}
      >
        <div className={`ribbon-button-icon ${colorClass || ''}`}>{icon}</div>
        <span className="ribbon-button-label">{label}</span>
        {dropdown && (
          <ChevronDown
            size={10}
            className="ribbon-dropdown-arrow"
            onClick={openDropdown}
          />
        )}
      </button>
      {dropdown && dropdownOpen && createPortal(
        <div
          ref={dropdownRef}
          className="ribbon-dropdown-menu"
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left }}
          onMouseLeave={() => setDropdownOpen(false)}
        >
          {dropdown.map((item, i) => (
            <button
              key={i}
              className="ribbon-dropdown-item"
              onClick={() => { item.onClick(); setDropdownOpen(false); }}
            >
              {item.icon && <span className="ribbon-dropdown-item-icon">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Flyout Sub-Menu Item ─────────────────────────────────────────────────

function FlyoutMenuItem({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [submenuOpen, setSubmenuOpen] = useState(false);

  const handleClick = () => {
    if (item.disabled) return;
    if (item.submenu) {
      setSubmenuOpen(!submenuOpen);
      return;
    }
    if (item.onClick) item.onClick();
    onClose();
  };

  return (
    <div
      className="flyout-menu-item-wrapper"
      onMouseEnter={() => item.submenu && setSubmenuOpen(true)}
      onMouseLeave={() => item.submenu && setSubmenuOpen(false)}
    >
      <button
        className={`flyout-menu-item ${item.disabled ? 'disabled' : ''} ${item.checked ? 'checked' : ''}`}
        onClick={handleClick}
      >
        <span className="flyout-menu-item-icon">
          {item.icon || <span style={{ width: 16, height: 16, display: 'inline-block' }} />}
        </span>
        <span className="flyout-menu-item-label">{item.label}</span>
        {item.shortcut && <span className="flyout-menu-item-shortcut">{item.shortcut}</span>}
        {item.submenu && <ChevronRight size={12} className="flyout-menu-item-arrow" />}
        {item.checked && <Check size={12} className="flyout-menu-item-check" />}
      </button>
      {item.submenu && submenuOpen && (
        <div className="flyout-submenu">
          {item.submenu.map((sub, i) => (
            <div key={i}>
              {sub.separator && <div className="flyout-menu-separator" />}
              <FlyoutMenuItem item={sub} onClose={onClose} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Ribbon Section (labeled group with optional flyout dropdown) ─────────

function RibbonSection({ title, children, menuItems, accentColor }: {
  title: string;
  children: React.ReactNode;
  menuItems?: MenuItem[];
  accentColor?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const hasFlyout = !!menuItems && menuItems.length > 0;

  // Position the portal menu below the label
  useEffect(() => {
    if (menuOpen && labelRef.current) {
      const rect = labelRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom, left: rect.left });
    }
  }, [menuOpen]);

  // Close on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        sectionRef.current && !sectionRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [menuOpen]);

  return (
    <div className="ribbon-section" ref={sectionRef}>
      <div className="ribbon-section-content">{children}</div>
      <div
        ref={labelRef}
        className={`ribbon-section-label ${hasFlyout ? 'flyout-trigger' : ''} ${menuOpen ? 'flyout-open' : ''}`}
        style={menuOpen && accentColor ? { background: accentColor, color: '#fff' } as React.CSSProperties : undefined}
        onClick={() => hasFlyout && setMenuOpen(!menuOpen)}
      >
        {title}
        {hasFlyout && <ChevronDown size={8} style={{ marginLeft: 3, opacity: 0.6 }} />}
      </div>
      {hasFlyout && menuOpen && createPortal(
        <div
          ref={menuRef}
          className="flyout-menu"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
        >
          {menuItems!.map((item, i) => (
            <div key={i}>
              {item.separator && <div className="flyout-menu-separator" />}
              <FlyoutMenuItem item={item} onClose={() => setMenuOpen(false)} />
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Tab Definitions ───────────────────────────────────────────────────────

const designTabs: TabDef[] = [
  { id: 'solid', label: 'SOLID', color: 'var(--tab-solid)' },
  { id: 'surface', label: 'SURFACE', color: 'var(--tab-surface)' },
  { id: 'mesh', label: 'MESH', color: 'var(--tab-mesh)' },
  { id: 'sheet-metal', label: 'SHEET METAL', color: 'var(--tab-sheet-metal)' },
  { id: 'plastic', label: 'PLASTIC', color: 'var(--tab-plastic)' },
  { id: 'manage', label: 'MANAGE', color: 'var(--tab-manage)' },
  { id: 'utilities', label: 'UTILITIES', color: 'var(--tab-utilities)' },
];

const prepareTabs: TabDef[] = [
  { id: 'plate', label: 'PLATE', color: 'var(--tab-prepare)' },
  { id: 'profiles', label: 'PROFILES', color: 'var(--tab-prepare)' },
  { id: 'slice', label: 'SLICE', color: 'var(--tab-prepare)' },
  { id: 'export', label: 'EXPORT', color: 'var(--tab-prepare)' },
];

// ─── Main Toolbar ──────────────────────────────────────────────────────────

export default function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState<Workspace>('design');
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const [designTab, setDesignTab] = useState<DesignTab>('solid');
  const [prepareTab, setPrepareTab] = useState<PrepareTab>('plate');

  // Theme
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const theme = useThemeStore((s) => s.theme);

  // CAD store
  const activeSketch = useCADStore((s) => s.activeSketch);
  const startSketch = useCADStore((s) => s.startSketch);
  const finishSketch = useCADStore((s) => s.finishSketch);
  const cancelSketch = useCADStore((s) => s.cancelSketch);
  const sketchPlaneSelecting = useCADStore((s) => s.sketchPlaneSelecting);
  const setSketchPlaneSelecting = useCADStore((s) => s.setSketchPlaneSelecting);
  const beginSketchFlow = () => setSketchPlaneSelecting(true);
  const snapEnabled = useCADStore((s) => s.snapEnabled);
  const setSnapEnabled = useCADStore((s) => s.setSnapEnabled);
  const gridVisible = useCADStore((s) => s.gridVisible);
  const setGridVisible = useCADStore((s) => s.setGridVisible);
  const setShowExtrudeDialog = useCADStore((s) => s.setShowExtrudeDialog);
  const setShowExportDialog = useCADStore((s) => s.setShowExportDialog);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const sketches = useCADStore((s) => s.sketches);
  const setWorkspaceMode = useCADStore((s) => s.setWorkspaceMode);
  const setActiveTool = useCADStore((s) => s.setActiveTool);

  // Printer store
  const showPrinter = usePrinterStore((s) => s.showPrinter);
  const setShowPrinter = usePrinterStore((s) => s.setShowPrinter);
  const setShowSettings = usePrinterStore((s) => s.setShowSettings);
  const printerConnected = usePrinterStore((s) => s.connected);

  // Sketch mode
  const inSketch = !!activeSketch;

  // ─── Helper: "coming soon" action ───
  const comingSoon = useCallback((feature: string) => () => {
    setStatusMessage(`${feature}: coming soon`);
  }, [setStatusMessage]);

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatusMessage(`Importing ${file.name}...`);
    try {
      const group = await FileImporter.importFile(file);
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: file.name,
        type: 'import',
        params: { fileName: file.name },
        mesh: group as any,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Imported ${file.name}`);
    } catch (err) {
      setStatusMessage(`Import failed: ${(err as Error).message}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExtrude = () => {
    if (sketches.length === 0) {
      setStatusMessage('Create a sketch first before extruding');
      return;
    }
    setShowExtrudeDialog(true);
  };

  const handleWorkspaceSwitch = (ws: Workspace) => {
    setWorkspace(ws);
    setWsDropdownOpen(false);
    setWorkspaceMode(ws === 'prepare' ? 'prepare' : 'design');
  };

  // Determine current tabs and active tab
  const currentTabs = workspace === 'design' ? designTabs : prepareTabs;
  const activeTab: RibbonTab = inSketch ? 'sketch' : (workspace === 'design' ? designTab : prepareTab);

  const handleTabClick = (tabId: RibbonTab) => {
    if (inSketch) return;
    if (workspace === 'design') setDesignTab(tabId as DesignTab);
    else setPrepareTab(tabId as PrepareTab);
  };

  const ICON_LG = 28;
  const ICON_SM = 18;
  const MI = 16; // menu item icon size

  // ─── Flyout Menu Definitions for SOLID tab ────────────────────────────

  const createMenuItems: MenuItem[] = [
    { icon: <Package size={MI} />, label: 'New Component', onClick: comingSoon('New Component') },
    { icon: <PenTool size={MI} />, label: 'Create Sketch', shortcut: 'S', onClick: beginSketchFlow },
    { separator: true, icon: <ArrowUpFromLine size={MI} />, label: 'Extrude', shortcut: 'E', onClick: handleExtrude },
    { icon: <RotateCcw size={MI} />, label: 'Revolve', onClick: comingSoon('Revolve') },
    { icon: <Spline size={MI} />, label: 'Sweep', onClick: comingSoon('Sweep') },
    { icon: <Layers size={MI} />, label: 'Loft', onClick: comingSoon('Loft') },
    { separator: true, icon: <CircleDot size={MI} />, label: 'Hole', shortcut: 'H', onClick: () => setActiveDialog('hole') },
    { icon: <Wrench size={MI} />, label: 'Thread', onClick: comingSoon('Thread') },
    { separator: true, icon: <Box size={MI} />, label: 'Box', onClick: comingSoon('Box primitive') },
    { icon: <Circle size={MI} />, label: 'Cylinder', onClick: comingSoon('Cylinder primitive') },
    { icon: <Globe size={MI} />, label: 'Sphere', onClick: comingSoon('Sphere primitive') },
    { icon: <CircleDot size={MI} />, label: 'Torus', onClick: comingSoon('Torus primitive') },
    { icon: <Spline size={MI} />, label: 'Coil', onClick: comingSoon('Coil primitive') },
    { icon: <Minus size={MI} />, label: 'Pipe', onClick: comingSoon('Pipe primitive') },
    {
      separator: true,
      icon: <Repeat size={MI} />,
      label: 'Pattern',
      submenu: [
        { icon: <Repeat size={MI} />, label: 'Linear Pattern', onClick: () => setActiveDialog('linear-pattern') },
        { icon: <Repeat size={MI} />, label: 'Circular Pattern', onClick: () => setActiveDialog('circular-pattern') },
        { icon: <Repeat size={MI} />, label: 'Pattern on Path', onClick: comingSoon('Pattern on Path') },
      ],
    },
    { icon: <FlipHorizontal size={MI} />, label: 'Mirror', onClick: () => setActiveDialog('mirror') },
    { icon: <Layers size={MI} />, label: 'Thicken', onClick: comingSoon('Thicken') },
  ];

  const modifyMenuItems: MenuItem[] = [
    { icon: <ArrowUpFromLine size={MI} />, label: 'Press Pull', shortcut: 'Q', onClick: comingSoon('Press Pull') },
    { icon: <Blend size={MI} />, label: 'Fillet', shortcut: 'F', onClick: () => setActiveTool('fillet' as Tool) },
    { icon: <Blend size={MI} />, label: 'Chamfer', onClick: () => setActiveTool('chamfer' as Tool) },
    { separator: true, icon: <Box size={MI} />, label: 'Shell', onClick: () => setActiveDialog('shell') },
    { icon: <ArrowUp size={MI} />, label: 'Draft', onClick: comingSoon('Draft') },
    { icon: <Maximize2 size={MI} />, label: 'Scale', onClick: () => setActiveTool('scale' as Tool) },
    { icon: <Combine size={MI} />, label: 'Combine', onClick: () => setActiveDialog('combine') },
    { separator: true, icon: <Square size={MI} />, label: 'Offset Face', onClick: comingSoon('Offset Face') },
    { icon: <Square size={MI} />, label: 'Replace Face', onClick: comingSoon('Replace Face') },
    { icon: <Scissors size={MI} />, label: 'Split Face', onClick: comingSoon('Split Face') },
    { icon: <Scissors size={MI} />, label: 'Split Body', onClick: () => setActiveDialog('split') },
    { icon: <Scissors size={MI} />, label: 'Silhouette Split', onClick: comingSoon('Silhouette Split') },
    { separator: true, icon: <Move size={MI} />, label: 'Move/Copy', shortcut: 'M', onClick: () => setActiveTool('move' as Tool) },
    { icon: <AlignCenter size={MI} />, label: 'Align', onClick: () => setActiveTool('align' as Tool) },
    { icon: <Trash2 size={MI} />, label: 'Delete', shortcut: 'Del', onClick: comingSoon('Delete') },
    { icon: <X size={MI} />, label: 'Remove', onClick: comingSoon('Remove') },
    { separator: true, icon: <Diamond size={MI} />, label: 'Physical Material', onClick: comingSoon('Physical Material') },
    { icon: <Pipette size={MI} />, label: 'Appearance', shortcut: 'A', onClick: () => setStatusMessage('Select a body to change materials') },
    { icon: <Diamond size={MI} />, label: 'Change Parameters', shortcut: 'Ctrl+B', onClick: () => setActiveDialog('parameters') },
  ];

  const assembleMenuItems: MenuItem[] = [
    { icon: <FolderOpen size={MI} />, label: 'Insert Component', onClick: comingSoon('Insert Component') },
    { icon: <Package size={MI} />, label: 'New Component', onClick: comingSoon('New Component') },
    { icon: <Copy size={MI} />, label: 'Duplicate With Joints', onClick: comingSoon('Duplicate With Joints') },
    { separator: true, icon: <Link2 size={MI} />, label: 'Constrain Components', onClick: comingSoon('Constrain Components') },
    { icon: <Link2 size={MI} />, label: 'Joint', shortcut: 'J', onClick: () => setActiveDialog('joint') },
    { icon: <Link2 size={MI} />, label: 'As-Built Joint', shortcut: 'Shift+J', onClick: comingSoon('As-Built Joint') },
    { separator: true, icon: <Layers size={MI} />, label: 'Rigid Group', onClick: comingSoon('Rigid Group') },
    { icon: <Crosshair size={MI} />, label: 'Joint Origin', onClick: comingSoon('Joint Origin') },
    { icon: <Play size={MI} />, label: 'Drive Joints', onClick: comingSoon('Drive Joints') },
    { icon: <Play size={MI} />, label: 'Motion Study', onClick: comingSoon('Motion Study') },
  ];

  const constructMenuItems: MenuItem[] = [
    { icon: <Layers size={MI} />, label: 'Offset Plane', onClick: () => setActiveDialog('construction-plane') },
    { icon: <Layers size={MI} />, label: 'Plane at Angle', onClick: comingSoon('Plane at Angle') },
    { icon: <Layers size={MI} />, label: 'Tangent Plane', onClick: comingSoon('Tangent Plane') },
    { icon: <Layers size={MI} />, label: 'Midplane', onClick: comingSoon('Midplane') },
    { separator: true, icon: <Layers size={MI} />, label: 'Plane Through Two Edges', onClick: comingSoon('Plane Through Two Edges') },
    { icon: <Layers size={MI} />, label: 'Plane Through Three Points', onClick: comingSoon('Plane Through Three Points') },
    { icon: <Layers size={MI} />, label: 'Plane Tangent to Face at Point', onClick: comingSoon('Plane Tangent to Face at Point') },
    { icon: <Layers size={MI} />, label: 'Plane Along Path', onClick: comingSoon('Plane Along Path') },
    { separator: true, icon: <Axis3D size={MI} />, label: 'Axis Through Cylinder/Cone/Torus', onClick: comingSoon('Axis Through Cylinder/Cone/Torus') },
    { icon: <Axis3D size={MI} />, label: 'Axis Perpendicular at Point', onClick: comingSoon('Axis Perpendicular at Point') },
    { icon: <Axis3D size={MI} />, label: 'Axis Through Two Planes', onClick: comingSoon('Axis Through Two Planes') },
    { icon: <Axis3D size={MI} />, label: 'Axis Through Two Points', onClick: () => setStatusMessage('Click two points to define an axis') },
    { icon: <Axis3D size={MI} />, label: 'Axis Through Edge', onClick: comingSoon('Axis Through Edge') },
    { separator: true, icon: <CircleDot size={MI} />, label: 'Point at Vertex', onClick: comingSoon('Point at Vertex') },
    { icon: <CircleDot size={MI} />, label: 'Point Through Two Edges', onClick: comingSoon('Point Through Two Edges') },
    { icon: <CircleDot size={MI} />, label: 'Point Through Three Planes', onClick: comingSoon('Point Through Three Planes') },
    { icon: <CircleDot size={MI} />, label: 'Point at Center of Circle/Sphere/Torus', onClick: comingSoon('Point at Center of Circle/Sphere/Torus') },
  ];

  const inspectMenuItems: MenuItem[] = [
    { icon: <Ruler size={MI} />, label: 'Measure', shortcut: 'I', onClick: () => setActiveTool('measure' as Tool) },
    { icon: <AlertTriangle size={MI} />, label: 'Interference', onClick: comingSoon('Interference') },
    { separator: true, icon: <Spline size={MI} />, label: 'Curvature Comb Analysis', onClick: comingSoon('Curvature Comb Analysis') },
    { icon: <Spline size={MI} />, label: 'Zebra Analysis', onClick: comingSoon('Zebra Analysis') },
    { icon: <ArrowUp size={MI} />, label: 'Draft Analysis', onClick: comingSoon('Draft Analysis') },
    { icon: <Spline size={MI} />, label: 'Curvature Map Analysis', onClick: comingSoon('Curvature Map Analysis') },
    { icon: <Scissors size={MI} />, label: 'Section Analysis', onClick: comingSoon('Section Analysis') },
    { icon: <Target size={MI} />, label: 'Center of Mass', onClick: comingSoon('Center of Mass') },
    { separator: true, icon: <Pipette size={MI} />, label: 'Display Component Colors', shortcut: 'Shift+N', onClick: comingSoon('Display Component Colors') },
  ];

  const selectMenuItems: MenuItem[] = [
    { icon: <MousePointer2 size={MI} />, label: 'Select', onClick: () => setActiveTool('select' as Tool) },
    { icon: <Square size={MI} />, label: 'Window Selection', shortcut: '1', onClick: comingSoon('Window Selection') },
    { icon: <Spline size={MI} />, label: 'Freeform Selection', shortcut: '2', onClick: comingSoon('Freeform Selection') },
    { icon: <PenTool size={MI} />, label: 'Paint Selection', shortcut: '3', onClick: comingSoon('Paint Selection') },
    {
      separator: true,
      icon: <MousePointer2 size={MI} />,
      label: 'Selection Priority',
      submenu: [
        { icon: <Box size={MI} />, label: 'Body Priority', onClick: comingSoon('Body Priority') },
        { icon: <Package size={MI} />, label: 'Component Priority', onClick: comingSoon('Component Priority') },
        { icon: <Square size={MI} />, label: 'Face Priority', onClick: comingSoon('Face Priority') },
        { icon: <Minus size={MI} />, label: 'Edge Priority', onClick: comingSoon('Edge Priority') },
      ],
    },
    {
      icon: <MousePointer2 size={MI} />,
      label: 'Selection Filters',
      submenu: [
        { icon: <Box size={MI} />, label: 'Select Bodies', onClick: comingSoon('Select Bodies') },
        { icon: <Square size={MI} />, label: 'Select Faces', onClick: comingSoon('Select Faces') },
        { icon: <Minus size={MI} />, label: 'Select Edges', onClick: comingSoon('Select Edges') },
        { icon: <CircleDot size={MI} />, label: 'Select Vertices', onClick: comingSoon('Select Vertices') },
      ],
    },
  ];

  // ─── Sketch Mode Flyout Menus ──────────────────────────────────────────

  const sketchCreateMenuItems: MenuItem[] = [
    { icon: <Minus size={MI} />, label: 'Line', shortcut: 'L', onClick: () => setActiveTool('line' as Tool) },
    { icon: <Circle size={MI} />, label: 'Circle', shortcut: 'C', onClick: () => setActiveTool('circle' as Tool) },
    { icon: <Square size={MI} />, label: 'Rectangle', shortcut: 'R', onClick: () => setActiveTool('rectangle' as Tool) },
    { icon: <Spline size={MI} />, label: 'Arc', onClick: () => setActiveTool('arc' as Tool) },
    { icon: <Hexagon size={MI} />, label: 'Polygon', onClick: () => setActiveTool('polygon' as Tool) },
    { separator: true, icon: <Spline size={MI} />, label: 'Spline', onClick: comingSoon('Spline') },
    { icon: <Spline size={MI} />, label: 'Fit Point Spline', onClick: comingSoon('Fit Point Spline') },
    { icon: <Spline size={MI} />, label: 'Conic Curve', onClick: comingSoon('Conic Curve') },
    { separator: true, icon: <CircleDot size={MI} />, label: 'Ellipse', onClick: comingSoon('Ellipse') },
    { icon: <Circle size={MI} />, label: 'Slot', onClick: comingSoon('Slot') },
    { separator: true, icon: <CircleDot size={MI} />, label: 'Point', onClick: comingSoon('Point') },
    { icon: <Minus size={MI} />, label: 'Centerline', onClick: comingSoon('Centerline') },
    { separator: true, icon: <ArrowUpFromLine size={MI} />, label: 'Project / Include', onClick: comingSoon('Project') },
    { icon: <Scissors size={MI} />, label: 'Intersect', onClick: comingSoon('Intersect') },
  ];

  const sketchModifyMenuItems: MenuItem[] = [
    { icon: <Blend size={MI} />, label: 'Fillet', shortcut: 'F', onClick: comingSoon('Sketch Fillet') },
    { icon: <Scissors size={MI} />, label: 'Trim', shortcut: 'T', onClick: comingSoon('Trim') },
    { icon: <Maximize2 size={MI} />, label: 'Extend', onClick: comingSoon('Extend') },
    { icon: <Scissors size={MI} />, label: 'Break', onClick: comingSoon('Break') },
    { separator: true, icon: <Copy size={MI} />, label: 'Offset', shortcut: 'O', onClick: comingSoon('Offset') },
    { icon: <FlipHorizontal size={MI} />, label: 'Mirror', onClick: comingSoon('Sketch Mirror') },
    { separator: true, icon: <Repeat size={MI} />, label: 'Circular Pattern', onClick: comingSoon('Sketch Circular Pattern') },
    { icon: <Repeat size={MI} />, label: 'Rectangular Pattern', onClick: comingSoon('Sketch Rectangular Pattern') },
    { separator: true, icon: <Move size={MI} />, label: 'Move / Copy', shortcut: 'M', onClick: comingSoon('Move/Copy') },
    { icon: <Maximize2 size={MI} />, label: 'Scale', onClick: comingSoon('Scale') },
    { icon: <RotateCw size={MI} />, label: 'Rotate', onClick: comingSoon('Rotate') },
  ];

  const sketchConstraintMenuItems: MenuItem[] = [
    { icon: <Ruler size={MI} />, label: 'Sketch Dimension', shortcut: 'D', onClick: () => setActiveTool('dimension' as Tool) },
    { separator: true, icon: <AlignCenter size={MI} />, label: 'Coincident', onClick: comingSoon('Coincident Constraint') },
    { icon: <Minus size={MI} />, label: 'Collinear', onClick: comingSoon('Collinear Constraint') },
    { icon: <AlignCenter size={MI} />, label: 'Concentric', onClick: comingSoon('Concentric Constraint') },
    { icon: <FlipHorizontal size={MI} />, label: 'Midpoint', onClick: comingSoon('Midpoint Constraint') },
    { separator: true, icon: <Minus size={MI} />, label: 'Horizontal', onClick: comingSoon('Horizontal Constraint') },
    { icon: <Minus size={MI} />, label: 'Vertical', onClick: comingSoon('Vertical Constraint') },
    { icon: <Minus size={MI} />, label: 'Perpendicular', onClick: comingSoon('Perpendicular Constraint') },
    { icon: <Minus size={MI} />, label: 'Parallel', onClick: comingSoon('Parallel Constraint') },
    { icon: <Minus size={MI} />, label: 'Tangent', onClick: comingSoon('Tangent Constraint') },
    { separator: true, icon: <Circle size={MI} />, label: 'Equal', onClick: comingSoon('Equal Constraint') },
    { icon: <FlipHorizontal size={MI} />, label: 'Symmetric', onClick: comingSoon('Symmetric Constraint') },
    { icon: <Target size={MI} />, label: 'Fix / Unfix', onClick: comingSoon('Fix/Unfix Constraint') },
  ];

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="ribbon-toolbar">
      {/* ── Quick Access Bar (title bar) ── */}
      <div className="ribbon-quick-access">
        <div className="ribbon-quick-left">
          <button className="ribbon-quick-btn" title="Home" onClick={() => setStatusMessage('Dzign3D Home')}>
            <Home size={14} />
          </button>
          <div className="ribbon-quick-divider" />
          <button className="ribbon-quick-btn" title="Save" onClick={() => setStatusMessage('Save: coming soon')}>
            <Save size={14} />
          </button>
          <button className="ribbon-quick-btn" title="Undo" onClick={() => setStatusMessage('Undo: coming soon')}>
            <Undo2 size={14} />
          </button>
          <button className="ribbon-quick-btn" title="Redo" onClick={() => setStatusMessage('Redo: coming soon')}>
            <Redo2 size={14} />
          </button>
          <div className="ribbon-quick-divider" />
          <button className="ribbon-quick-btn" title="Import" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={14} />
          </button>
          <button className="ribbon-quick-btn" title="Export" onClick={() => setShowExportDialog(true)}>
            <Download size={14} />
          </button>
          <input ref={fileInputRef} type="file" accept=".step,.stp,.f3d,.stl,.obj" style={{ display: 'none' }} onChange={handleImport} />
        </div>
        <div className="ribbon-quick-center">
          <span className="ribbon-title">Untitled - Dzign3D</span>
        </div>
        <div className="ribbon-quick-right">
          <button className="ribbon-quick-btn" title="Toggle theme" onClick={toggleTheme}>
            {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          </button>
          <button className="ribbon-quick-btn" title="Notifications" onClick={() => setStatusMessage('Notifications')}>
            <Bell size={14} />
          </button>
          <button className="ribbon-quick-btn" title="Help" onClick={() => setStatusMessage('Help')}>
            <HelpCircle size={14} />
          </button>
          <button
            className={`ribbon-quick-btn ${printerConnected ? 'connected' : ''}`}
            title={printerConnected ? 'Printer Monitor' : 'Printer Setup'}
            onClick={() => printerConnected ? setShowPrinter(!showPrinter) : setShowSettings(true)}
          >
            <Printer size={14} />
          </button>
          <button className="ribbon-quick-btn" title="Settings" onClick={() => setStatusMessage('Settings: coming soon')}>
            <Settings size={14} />
          </button>
          <div className="ribbon-quick-divider" />
          <button className="ribbon-quick-btn user-btn" title="Profile">
            <User size={14} />
          </button>
        </div>
      </div>

      {/* ── Workspace Selector + Tab Bar ── */}
      <div className="ribbon-tab-row">
        {/* Workspace Dropdown */}
        <div className="ribbon-workspace-selector" onMouseLeave={() => setWsDropdownOpen(false)}>
          <button
            className="ribbon-workspace-btn"
            onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
          >
            {workspace === 'design' ? 'DESIGN' : 'PREPARE'}
            <ChevronDown size={11} style={{ marginLeft: 4 }} />
          </button>
          {wsDropdownOpen && (
            <div className="ribbon-workspace-dropdown">
              <button
                className={`ribbon-workspace-option ${workspace === 'design' ? 'active' : ''}`}
                onClick={() => handleWorkspaceSwitch('design')}
              >
                Design
              </button>
              <button
                className={`ribbon-workspace-option ${workspace === 'prepare' ? 'active' : ''}`}
                onClick={() => handleWorkspaceSwitch('prepare')}
              >
                Prepare (3D Print)
              </button>
            </div>
          )}
        </div>

        <div className="ribbon-tab-divider-v" />

        {/* Tab names */}
        <div className="ribbon-tabs">
          {currentTabs.map((tab) => (
            <button
              key={tab.id}
              className={`ribbon-tab ${!inSketch && activeTab === tab.id ? 'active' : ''} ${inSketch ? 'sketch-passive' : ''}`}
              style={{ '--tab-color': tab.color } as React.CSSProperties}
              onClick={() => !inSketch && handleTabClick(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          {inSketch && (
            <button
              className="ribbon-tab active contextual sketch-contextual-tab"
              style={{ '--tab-color': '#ff8c00' } as React.CSSProperties}
            >
              SKETCH
            </button>
          )}
        </div>

        {/* Plane selection indicator */}
        {sketchPlaneSelecting && !inSketch && (
          <div className="ribbon-sketch-indicator">
            <span style={{ color: 'var(--accent)' }}>Select a plane or planar face</span>
            <button className="ribbon-cancel-btn" onClick={() => setSketchPlaneSelecting(false)} title="Cancel">
              <X size={12} /> Cancel
            </button>
          </div>
        )}
      </div>

      {/* ── Ribbon Content (tool icons in sections) ── */}
      <div className={`ribbon-content${inSketch ? ' sketch-ribbon' : ''}`}>

        {/* ═══════════════ DESIGN > SOLID TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'solid' && (
          <>
            <RibbonSection title="CREATE" menuItems={createMenuItems} accentColor="#0078d7">
              <ToolButton
                icon={<PenTool size={ICON_LG} />}
                label="Sketch"
                large
                colorClass="icon-blue"
                active={sketchPlaneSelecting}
                dropdown={[
                  { label: 'Select Plane (Interactive)', onClick: beginSketchFlow, icon: <PenTool size={14} /> },
                  { label: 'Sketch on XY Plane', onClick: () => startSketch('XY'), icon: <PenTool size={14} /> },
                  { label: 'Sketch on XZ Plane', onClick: () => startSketch('XZ'), icon: <PenTool size={14} /> },
                  { label: 'Sketch on YZ Plane', onClick: () => startSketch('YZ'), icon: <PenTool size={14} /> },
                ]}
                onClick={beginSketchFlow}
              />
              <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Extrude" onClick={handleExtrude} large colorClass="icon-blue" />
              <ToolButton icon={<RotateCcw size={ICON_LG} />} label="Revolve" onClick={() => setStatusMessage('Select a sketch profile to revolve')} large colorClass="icon-blue" />
              <div className="ribbon-stack">
                <ToolButton icon={<CircleDot size={ICON_SM} />} label="Hole" onClick={() => setActiveDialog('hole')} colorClass="icon-blue" />
                <ToolButton icon={<Box size={ICON_SM} />} label="Shell" onClick={() => setActiveDialog('shell')} colorClass="icon-blue" />
              </div>
            </RibbonSection>

            <RibbonSection title="MODIFY" menuItems={modifyMenuItems} accentColor="#ff6b00">
              <ToolButton icon={<Blend size={ICON_LG} />} label="Fillet" tool="fillet" large colorClass="icon-orange" />
              <ToolButton icon={<Blend size={ICON_LG} />} label="Chamfer" tool="chamfer" large colorClass="icon-orange" />
              <div className="ribbon-stack">
                <ToolButton icon={<Scissors size={ICON_SM} />} label="Split" onClick={() => setActiveDialog('split')} colorClass="icon-orange" />
                <ToolButton icon={<Combine size={ICON_SM} />} label="Combine" onClick={() => setActiveDialog('combine')} colorClass="icon-orange" />
              </div>
            </RibbonSection>

            <RibbonSection title="ASSEMBLE" menuItems={assembleMenuItems} accentColor="#4caf50">
              <ToolButton icon={<Copy size={ICON_LG} />} label="Component" onClick={() => setStatusMessage('Use the Browser panel to add components')} large colorClass="icon-green" />
              <div className="ribbon-stack">
                <ToolButton icon={<Link2 size={ICON_SM} />} label="Joint" onClick={() => setActiveDialog('joint')} colorClass="icon-green" />
                <ToolButton icon={<Layers size={ICON_SM} />} label="Plane" onClick={() => setActiveDialog('construction-plane')} colorClass="icon-green" />
              </div>
            </RibbonSection>

            <RibbonSection title="CONSTRUCT" menuItems={constructMenuItems} accentColor="#7b1fa2">
              <div className="ribbon-stack">
                <ToolButton icon={<Layers size={ICON_SM} />} label="Plane" onClick={() => setActiveDialog('construction-plane')} colorClass="icon-purple" />
                <ToolButton icon={<Axis3D size={ICON_SM} />} label="Axis" onClick={() => setStatusMessage('Click two points to define an axis')} colorClass="icon-purple" />
              </div>
            </RibbonSection>

            <RibbonSection title="INSPECT" menuItems={inspectMenuItems} accentColor="#00897b">
              <ToolButton icon={<Ruler size={ICON_LG} />} label="Measure" tool="measure" large colorClass="icon-teal" />
            </RibbonSection>

            <RibbonSection title="INSERT">
              <ToolButton icon={<FolderOpen size={ICON_LG} />} label="Import" onClick={() => fileInputRef.current?.click()} large colorClass="icon-gray" />
            </RibbonSection>

            <RibbonSection title="SELECT" menuItems={selectMenuItems} accentColor="#0078d7">
              <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ DESIGN > SURFACE TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'surface' && (
          <>
            <RibbonSection title="CREATE">
              <ToolButton icon={<PenTool size={ICON_LG} />} label="Sketch" onClick={beginSketchFlow} large colorClass="icon-blue" />
              <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Extrude" onClick={handleExtrude} large colorClass="icon-green" />
              <ToolButton icon={<RotateCcw size={ICON_LG} />} label="Revolve" onClick={() => setStatusMessage('Surface Revolve: coming soon')} large colorClass="icon-green" />
            </RibbonSection>
            <RibbonSection title="MODIFY">
              <ToolButton icon={<Scissors size={ICON_LG} />} label="Trim" onClick={() => setStatusMessage('Surface Trim: coming soon')} large colorClass="icon-orange" />
              <ToolButton icon={<FlipHorizontal size={ICON_LG} />} label="Extend" onClick={() => setStatusMessage('Surface Extend: coming soon')} large colorClass="icon-orange" />
            </RibbonSection>
            <RibbonSection title="SELECT">
              <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ DESIGN > MESH TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'mesh' && (
          <>
            <RibbonSection title="CREATE">
              <ToolButton icon={<Box size={ICON_LG} />} label="Tessellate" onClick={() => setStatusMessage('Mesh: Tessellate - coming soon')} large colorClass="icon-purple" />
            </RibbonSection>
            <RibbonSection title="MODIFY">
              <ToolButton icon={<Blend size={ICON_LG} />} label="Reduce" onClick={() => setStatusMessage('Mesh: Reduce - coming soon')} large colorClass="icon-purple" />
              <ToolButton icon={<Combine size={ICON_LG} />} label="Repair" onClick={() => setStatusMessage('Mesh: Repair - coming soon')} large colorClass="icon-purple" />
            </RibbonSection>
            <RibbonSection title="SELECT">
              <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ DESIGN > SHEET METAL TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'sheet-metal' && (
          <>
            <RibbonSection title="CREATE">
              <ToolButton icon={<Box size={ICON_LG} />} label="Flange" onClick={() => setStatusMessage('Sheet Metal: Flange - coming soon')} large colorClass="icon-teal" />
              <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Bend" onClick={() => setStatusMessage('Sheet Metal: Bend - coming soon')} large colorClass="icon-teal" />
            </RibbonSection>
            <RibbonSection title="MODIFY">
              <ToolButton icon={<Scissors size={ICON_LG} />} label="Unfold" onClick={() => setStatusMessage('Sheet Metal: Unfold - coming soon')} large colorClass="icon-teal" />
              <ToolButton icon={<Layers size={ICON_LG} />} label="Flat Pattern" onClick={() => setStatusMessage('Sheet Metal: Flat Pattern - coming soon')} large colorClass="icon-teal" />
            </RibbonSection>
            <RibbonSection title="SELECT">
              <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ DESIGN > PLASTIC TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'plastic' && (
          <>
            <RibbonSection title="CREATE">
              <ToolButton icon={<Box size={ICON_LG} />} label="Boss" onClick={() => setStatusMessage('Plastic: Boss - coming soon')} large colorClass="icon-blue" />
              <ToolButton icon={<CircleDot size={ICON_LG} />} label="Snap Fit" onClick={() => setStatusMessage('Plastic: Snap Fit - coming soon')} large colorClass="icon-blue" />
            </RibbonSection>
            <RibbonSection title="MODIFY">
              <ToolButton icon={<Blend size={ICON_LG} />} label="Draft" onClick={() => setStatusMessage('Plastic: Draft - coming soon')} large colorClass="icon-blue" />
            </RibbonSection>
            <RibbonSection title="SELECT">
              <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ DESIGN > MANAGE TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'manage' && (
          <>
            <RibbonSection title="PARAMETERS">
              <ToolButton icon={<Diamond size={ICON_LG} />} label="Parameters" onClick={() => setActiveDialog('parameters')} large colorClass="icon-gray" />
            </RibbonSection>
            <RibbonSection title="PATTERN">
              <div className="ribbon-stack">
                <ToolButton icon={<Repeat size={ICON_SM} />} label="Linear" onClick={() => setActiveDialog('linear-pattern')} colorClass="icon-gray" />
                <ToolButton icon={<Repeat size={ICON_SM} />} label="Circular" onClick={() => setActiveDialog('circular-pattern')} colorClass="icon-gray" />
              </div>
              <ToolButton icon={<FlipHorizontal size={ICON_LG} />} label="Mirror" onClick={() => setActiveDialog('mirror')} large colorClass="icon-gray" />
            </RibbonSection>
            <RibbonSection title="TRANSFORM">
              <div className="ribbon-stack">
                <ToolButton icon={<Move size={ICON_SM} />} label="Move" tool="move" colorClass="icon-gray" />
                <ToolButton icon={<RotateCw size={ICON_SM} />} label="Rotate" tool="rotate" colorClass="icon-gray" />
              </div>
              <div className="ribbon-stack">
                <ToolButton icon={<Maximize2 size={ICON_SM} />} label="Scale" tool="scale" colorClass="icon-gray" />
                <ToolButton icon={<AlignCenter size={ICON_SM} />} label="Align" tool="align" colorClass="icon-gray" />
              </div>
            </RibbonSection>
            <RibbonSection title="DISPLAY">
              <ToolButton icon={<Grid3X3 size={ICON_LG} />} label="Grid" active={gridVisible} onClick={() => setGridVisible(!gridVisible)} large colorClass="icon-gray" />
              <ToolButton icon={<Magnet size={ICON_LG} />} label="Snap" active={snapEnabled} onClick={() => setSnapEnabled(!snapEnabled)} large colorClass="icon-gray" />
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ DESIGN > UTILITIES TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'utilities' && (
          <>
            <RibbonSection title="MAKE">
              <ToolButton icon={<Printer size={ICON_LG} />} label="3D Print" onClick={() => setShowExportDialog(true)} large colorClass="icon-gray" />
              <ToolButton icon={<Download size={ICON_LG} />} label="Export" onClick={() => setShowExportDialog(true)} large colorClass="icon-gray" />
            </RibbonSection>
            <RibbonSection title="DISPLAY">
              <ToolButton icon={<Pipette size={ICON_LG} />} label="Appearance" onClick={() => setStatusMessage('Select a body to change materials')} large colorClass="icon-gray" />
              <div className="ribbon-stack">
                <ToolButton icon={<Eye size={ICON_SM} />} label="Show All" onClick={() => setStatusMessage('Show All: coming soon')} colorClass="icon-gray" />
                <ToolButton icon={<EyeOff size={ICON_SM} />} label="Hide" onClick={() => setStatusMessage('Hide: coming soon')} colorClass="icon-gray" />
              </div>
            </RibbonSection>
            <RibbonSection title="3D PRINTER">
              <ToolButton
                icon={printerConnected ? <PlugZap size={ICON_LG} /> : <Plug size={ICON_LG} />}
                label={printerConnected ? 'Connected' : 'Connect'}
                active={printerConnected}
                onClick={() => setShowSettings(true)}
                large
                colorClass="icon-green"
              />
              {printerConnected && (
                <ToolButton
                  icon={<MonitorSmartphone size={ICON_LG} />}
                  label="Monitor"
                  active={showPrinter}
                  onClick={() => setShowPrinter(!showPrinter)}
                  large
                  colorClass="icon-green"
                />
              )}
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ SKETCH MODE ═══════════════ */}
        {inSketch && (
          <>
            {/* ── CREATE ─────────────────────────────────── */}
            <RibbonSection title="CREATE" menuItems={sketchCreateMenuItems} accentColor="#0078d7">
              <ToolButton icon={<PenLine size={20} />}           label="Line"      tool="line"      colorClass="icon-blue" />
              <ToolButton icon={<Spline size={20} />}            label="Arc"       tool="arc"       colorClass="icon-blue" />
              <ToolButton icon={<Circle size={20} />}            label="Circle"    tool="circle"    colorClass="icon-blue" />
              <ToolButton icon={<RectangleHorizontal size={20} />} label="Rectangle" tool="rectangle" colorClass="icon-blue" />
              <ToolButton icon={<Hexagon size={20} />}           label="Polygon"   tool="polygon"   colorClass="icon-blue" />
              <ToolButton icon={<Waypoints size={20} />}         label="Spline"    onClick={comingSoon('Spline')} colorClass="icon-blue" />
            </RibbonSection>

            {/* ── MODIFY ─────────────────────────────────── */}
            <RibbonSection title="MODIFY" menuItems={sketchModifyMenuItems} accentColor="#0078d7">
              <ToolButton icon={<CornerDownRight size={20} />}   label="Fillet"  onClick={comingSoon('Fillet')}  colorClass="icon-blue" />
              <ToolButton icon={<Scissors size={20} />}          label="Trim"    onClick={comingSoon('Trim')}    colorClass="icon-blue" />
              <ToolButton icon={<ChevronsRight size={20} />}     label="Extend"  onClick={comingSoon('Extend')}  colorClass="icon-blue" />
              <ToolButton icon={<Copy size={20} />}              label="Offset"  onClick={comingSoon('Offset')}  colorClass="icon-blue" />
              <ToolButton icon={<FlipHorizontal2 size={20} />}   label="Mirror"  onClick={comingSoon('Mirror')}  colorClass="icon-blue" />
              <ToolButton icon={<Move size={20} />}              label="Move"    onClick={comingSoon('Move')}    colorClass="icon-blue" />
            </RibbonSection>

            {/* ── CONSTRAINTS ────────────────────────────── */}
            <RibbonSection title="CONSTRAINTS" menuItems={sketchConstraintMenuItems} accentColor="#ff6b00">
              <ToolButton icon={<Ruler size={20} />}             label="Dimension"  tool="dimension"                    colorClass="icon-orange" />
              <ToolButton icon={<AlignCenter size={20} />}       label="Coincident" onClick={comingSoon('Coincident')}  colorClass="icon-orange" />
              <ToolButton icon={<ArrowLeftRight size={20} />}    label="Horizontal" onClick={comingSoon('Horizontal')}  colorClass="icon-orange" />
              <ToolButton icon={<ArrowUpDown size={20} />}       label="Vertical"   onClick={comingSoon('Vertical')}    colorClass="icon-orange" />
              <ToolButton icon={<Tangent size={20} />}           label="Tangent"    onClick={comingSoon('Tangent')}     colorClass="icon-orange" />
              <ToolButton icon={<Equal size={20} />}             label="Equal"      onClick={comingSoon('Equal')}       colorClass="icon-orange" />
            </RibbonSection>

            {/* ── CONFIGURE ──────────────────────────────── */}
            <RibbonSection title="CONFIGURE" accentColor="#555">
              <div className="ribbon-stack">
                <ToolButton icon={<Grid3X3 size={ICON_SM} />} label="Grid" onClick={comingSoon('Grid')} colorClass="icon-gray" />
                <ToolButton icon={<Magnet size={ICON_SM} />}  label="Snap" onClick={comingSoon('Snap')} colorClass="icon-gray" />
              </div>
            </RibbonSection>

            {/* ── INSPECT ────────────────────────────────── */}
            <RibbonSection title="INSPECT" accentColor="#555">
              <div className="ribbon-stack">
                <ToolButton icon={<Ruler size={ICON_SM} />} label="Measure" onClick={comingSoon('Measure')} colorClass="icon-gray" />
              </div>
            </RibbonSection>

            {/* ── INSERT ─────────────────────────────────── */}
            <RibbonSection title="INSERT" accentColor="#555">
              <div className="ribbon-stack">
                <ToolButton icon={<FileUp size={ICON_SM} />} label="Insert DXF" onClick={comingSoon('Insert DXF')} colorClass="icon-gray" />
              </div>
            </RibbonSection>

            {/* ── SELECT ─────────────────────────────────── */}
            <RibbonSection title="SELECT" accentColor="#555">
              <ToolButton icon={<MousePointer2 size={20} />} label="Select" tool="select" colorClass="icon-blue" />
            </RibbonSection>

            {/* ── FINISH SKETCH ──────────────────────────── */}
            <div className="sketch-finish-area">
              <button className="sketch-finish-btn" onClick={finishSketch} title="Finish Sketch">
                <Check size={15} />
                <span>FINISH SKETCH</span>
                <ChevronDown size={11} style={{ marginLeft: 2, opacity: 0.7 }} />
              </button>
              <button className="sketch-cancel-btn" onClick={cancelSketch} title="Cancel Sketch">
                <X size={13} />
              </button>
            </div>
          </>
        )}

        {/* ═══════════════ PREPARE > PLATE TAB ═══════════════ */}
        {!inSketch && workspace === 'prepare' && prepareTab === 'plate' && (
          <>
            <RibbonSection title="BUILD PLATE">
              <ToolButton
                icon={<Box size={ICON_LG} />}
                label="Add Model"
                onClick={() => {
                  const features = useCADStore.getState().features;
                  if (features.length === 0) {
                    setStatusMessage('No models to add. Create a design first.');
                  } else {
                    const f = features[0];
                    useSlicerStore.getState().addToPlate(f.id, f.name, f.mesh);
                    setStatusMessage(`Added "${f.name}" to build plate`);
                  }
                }}
                large
                colorClass="icon-blue"
              />
              <div className="ribbon-stack">
                <ToolButton
                  icon={<AlignCenter size={ICON_SM} />}
                  label="Auto Arrange"
                  onClick={() => useSlicerStore.getState().autoArrange()}
                  colorClass="icon-blue"
                />
                <ToolButton
                  icon={<X size={ICON_SM} />}
                  label="Clear Plate"
                  onClick={() => useSlicerStore.getState().clearPlate()}
                  colorClass="icon-red"
                />
              </div>
            </RibbonSection>
            <RibbonSection title="SELECT">
              <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ PREPARE > PROFILES TAB ═══════════════ */}
        {!inSketch && workspace === 'prepare' && prepareTab === 'profiles' && (
          <>
            <RibbonSection title="PROFILES">
              <ToolButton
                icon={<Printer size={ICON_LG} />}
                label="Printer"
                onClick={() => useSlicerStore.getState().setSettingsPanel('printer')}
                large
                colorClass="icon-blue"
              />
              <ToolButton
                icon={<Diamond size={ICON_LG} />}
                label="Material"
                onClick={() => useSlicerStore.getState().setSettingsPanel('material')}
                large
                colorClass="icon-orange"
              />
              <ToolButton
                icon={<Settings size={ICON_LG} />}
                label="Print Settings"
                onClick={() => useSlicerStore.getState().setSettingsPanel('print')}
                large
                colorClass="icon-gray"
              />
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ PREPARE > SLICE TAB ═══════════════ */}
        {!inSketch && workspace === 'prepare' && prepareTab === 'slice' && (
          <>
            <RibbonSection title="SLICE">
              <ToolButton
                icon={<Layers size={ICON_LG} />}
                label="Slice"
                onClick={() => useSlicerStore.getState().startSlice()}
                active={useSlicerStore.getState().sliceProgress.stage === 'slicing'}
                large
                colorClass="icon-blue"
              />
              <ToolButton
                icon={<Eye size={ICON_LG} />}
                label="Preview"
                active={useSlicerStore.getState().previewMode === 'preview'}
                onClick={() => {
                  const store = useSlicerStore.getState();
                  store.setPreviewMode(store.previewMode === 'preview' ? 'model' : 'preview');
                }}
                large
                disabled={!useSlicerStore.getState().sliceResult}
                colorClass="icon-green"
              />
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ PREPARE > EXPORT TAB ═══════════════ */}
        {!inSketch && workspace === 'prepare' && prepareTab === 'export' && (
          <>
            <RibbonSection title="EXPORT">
              <ToolButton
                icon={<Download size={ICON_LG} />}
                label="Save G-code"
                onClick={() => useSlicerStore.getState().downloadGCode()}
                disabled={!useSlicerStore.getState().sliceResult}
                large
                colorClass="icon-blue"
              />
              <ToolButton
                icon={<Printer size={ICON_LG} />}
                label="Send to Printer"
                onClick={() => useSlicerStore.getState().sendToPrinter()}
                disabled={!useSlicerStore.getState().sliceResult || !printerConnected}
                large
                colorClass="icon-green"
              />
            </RibbonSection>
          </>
        )}
      </div>
    </div>
  );
}
