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
  RefreshCw, Unlink, SplitSquareHorizontal, Link, ZoomOut,
  GitMerge, Zap, Type, Shield,
  Lock, LocateFixed,
  ArrowRight, Dot,
  Pencil, Image,
  GitFork,
  TrendingDown, Activity, Grid, BarChart2, AlertCircle,
  Edit2, MapPin,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { useComponentStore } from '../../store/componentStore';
import { usePrinterStore } from '../../store/printerStore';
import { useSlicerStore } from '../../store/slicerStore';
import { useThemeStore } from '../../store/themeStore';
import type { Tool, Feature } from '../../types/cad';

// ─── Types ─────────────────────────────────────────────────────────────────

type Workspace = 'design' | 'prepare' | 'printer';

type DesignTab = 'solid' | 'surface' | 'mesh' | 'form' | 'sheet-metal' | 'plastic' | 'manage' | 'utilities';
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
  { id: 'form', label: 'FORM', color: 'var(--tab-form)' },
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
  const meshInsertInputRef = useRef<HTMLInputElement>(null);
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
  const startExtrudeTool = useCADStore((s) => s.startExtrudeTool);
  const startRevolveTool = useCADStore((s) => s.startRevolveTool);
  const startSweepTool = useCADStore((s) => s.startSweepTool);
  const startLoftTool = useCADStore((s) => s.startLoftTool);
  const startPatchTool = useCADStore((s) => s.startPatchTool);
  const startRuledSurfaceTool = useCADStore((s) => s.startRuledSurfaceTool);
  const startRibTool = useCADStore((s) => s.startRibTool);
  const setShowExportDialog = useCADStore((s) => s.setShowExportDialog);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const setSectionEnabled = useCADStore((s) => s.setSectionEnabled);
  const selectionFilter = useCADStore((s) => s.selectionFilter);
  const setSelectionFilter = useCADStore((s) => s.setSelectionFilter);
  const sketchGridEnabled = useCADStore((s) => s.sketchGridEnabled);
  const setSketchGridEnabled = useCADStore((s) => s.setSketchGridEnabled);
  const sketchSnapEnabled = useCADStore((s) => s.sketchSnapEnabled);
  const setSketchSnapEnabled = useCADStore((s) => s.setSketchSnapEnabled);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);
  const removeFeature = useCADStore((s) => s.removeFeature);
  const addFeature = useCADStore((s) => s.addFeature);
const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const autoConstrainSketch = useCADStore((s) => s.autoConstrainSketch);
  const startSketchTextTool = useCADStore((s) => s.startSketchTextTool);
  const startSketchProjectSurfaceTool = useCADStore((s) => s.startSketchProjectSurfaceTool);
  const sketches = useCADStore((s) => s.sketches);
  const setWorkspaceMode = useCADStore((s) => s.setWorkspaceMode);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const activeTool = useCADStore((s) => s.activeTool);
  const openReplaceFaceDialog = useCADStore((s) => s.openReplaceFaceDialog);
  const openDirectEditDialog = useCADStore((s) => s.openDirectEditDialog);
  const openTextureExtrudeDialog = useCADStore((s) => s.openTextureExtrudeDialog);
  const openDecalDialog = useCADStore((s) => s.openDecalDialog);
  const openAttachedCanvasDialog = useCADStore((s) => s.openAttachedCanvasDialog);
  const openSplitFaceDialog = useCADStore((s) => s.openSplitFaceDialog);
  const openBoundingSolidDialog = useCADStore((s) => s.openBoundingSolidDialog);
  const openJointOriginDialog = useCADStore((s) => s.openJointOriginDialog);
  const openInterferenceDialog = useCADStore((s) => s.openInterferenceDialog);
  const openContactSetsDialog = useCADStore((s) => s.openContactSetsDialog);
  const openInsertComponentDialog = useCADStore((s) => s.openInsertComponentDialog);
  const openSnapFitDialog = useCADStore((s) => s.openSnapFitDialog);
  const openLipGrooveDialog = useCADStore((s) => s.openLipGrooveDialog);
  const setActiveAnalysis = useCADStore((s) => s.setActiveAnalysis);

  // Component store (D193)
  const addComponent = useComponentStore((s) => s.addComponent);
  const rootComponentId = useComponentStore((s) => s.rootComponentId);

  // D193 New Component helper
  const handleNewComponent = useCallback(() => {
    const id = addComponent(rootComponentId);
    setStatusMessage(`New component created (${id.slice(0, 8)})`);
  }, [addComponent, rootComponentId, setStatusMessage]);

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
      const { FileImporter } = await import('../../engine/FileImporter');
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

  // D120: Insert Mesh — loads file as a mesh body (bodyKind: 'mesh')
  const handleMeshInsert = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatusMessage(`Inserting mesh ${file.name}...`);
    try {
      const { FileImporter } = await import('../../engine/FileImporter');
      const group = await FileImporter.importFile(file);
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: file.name,
        type: 'import',
        params: { fileName: file.name, bodyKind: 'mesh' },
        mesh: group as any,
        bodyKind: 'mesh',
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Inserted mesh body: ${file.name}`);
    } catch (err) {
      setStatusMessage(`Mesh insert failed: ${(err as Error).message}`);
    }
    if (meshInsertInputRef.current) meshInsertInputRef.current.value = '';
  };

  const handleExtrude = () => {
    if (sketches.length === 0) {
      setStatusMessage('Create a sketch first before extruding');
      return;
    }
    startExtrudeTool();
  };

  const handleRevolve = () => {
    if (sketches.length === 0) {
      setStatusMessage('Create a sketch first before revolving');
      return;
    }
    startRevolveTool();
  };

  const handleWorkspaceSwitch = (ws: Workspace) => {
    setWorkspace(ws);
    setWsDropdownOpen(false);
    setWorkspaceMode(ws);
  };

  // Determine current tabs and active tab. Printer workspace has no ribbon tabs
  // — the Duet UI brings its own internal tab bar.
  const currentTabs = workspace === 'design' ? designTabs
    : workspace === 'prepare' ? prepareTabs
    : [];
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
    { icon: <Package size={MI} />, label: 'New Component', onClick: handleNewComponent },
    { icon: <Package size={MI} />, label: 'Create Base Feature', onClick: () => setActiveDialog('base-feature') },
    { icon: <PenTool size={MI} />, label: 'Create Sketch', shortcut: 'S', onClick: beginSketchFlow },
    { separator: true, icon: <ArrowUpFromLine size={MI} />, label: 'Extrude', shortcut: 'E', onClick: handleExtrude },
    { icon: <RotateCcw size={MI} />, label: 'Revolve', onClick: handleRevolve },
    { icon: <Spline size={MI} />, label: 'Sweep', onClick: startSweepTool },
    { icon: <Layers size={MI} />, label: 'Loft', onClick: startLoftTool },
    { icon: <Diamond size={MI} />, label: 'Patch', onClick: startPatchTool },
    { icon: <Minus size={MI} />, label: 'Rib', onClick: startRibTool },
    { icon: <Grid3X3 size={MI} />, label: 'Web', onClick: () => setActiveDialog('web') },
    { icon: <ArrowUp size={MI} />, label: 'Emboss', onClick: () => setActiveDialog('emboss') },
    { icon: <AlignCenter size={MI} />, label: 'Rest', onClick: () => setActiveDialog('rest') },
    { separator: true, icon: <CircleDot size={MI} />, label: 'Hole', shortcut: 'H', onClick: () => setActiveDialog('hole') },
    { icon: <Wrench size={MI} />, label: 'Thread', onClick: () => setActiveDialog('thread') },
    { separator: true, icon: <Box size={MI} />, label: 'Box', onClick: () => setActiveDialog('primitive-box') },
    { icon: <Circle size={MI} />, label: 'Cylinder', onClick: () => setActiveDialog('primitive-cylinder') },
    { icon: <Globe size={MI} />, label: 'Sphere', onClick: () => setActiveDialog('primitive-sphere') },
    { icon: <CircleDot size={MI} />, label: 'Torus', onClick: () => setActiveDialog('primitive-torus') },
    { icon: <Spline size={MI} />, label: 'Coil', onClick: () => setActiveDialog('primitive-coil') },
    { icon: <Minus size={MI} />, label: 'Pipe', onClick: () => setActiveDialog('pipe') },
    {
      separator: true,
      icon: <Repeat size={MI} />,
      label: 'Pattern',
      submenu: [
        { icon: <Repeat size={MI} />, label: 'Linear Pattern', onClick: () => setActiveDialog('linear-pattern') },
        { icon: <Repeat size={MI} />, label: 'Circular Pattern', onClick: () => setActiveDialog('circular-pattern') },
        { icon: <Repeat size={MI} />, label: 'Pattern on Path', onClick: () => setActiveDialog('pattern-on-path') },
      ],
    },
    { icon: <FlipHorizontal size={MI} />, label: 'Mirror', onClick: () => setActiveDialog('mirror') },
    { icon: <Layers size={MI} />, label: 'Thicken', onClick: () => setActiveDialog('thicken') },
    { icon: <Square size={MI} />, label: 'Boundary Fill', onClick: () => setActiveDialog('boundary-fill') },
    { separator: true, icon: <Box size={MI} />, label: 'Bounding Solid', onClick: openBoundingSolidDialog },
  ];

  const modifyMenuItems: MenuItem[] = [
    { icon: <ArrowUpFromLine size={MI} />, label: 'Press Pull', shortcut: 'Q', onClick: startExtrudeTool },
    { icon: <Blend size={MI} />, label: 'Fillet', shortcut: 'F', onClick: () => setActiveDialog('fillet') },
    { icon: <Blend size={MI} />, label: 'Chamfer', onClick: () => setActiveDialog('chamfer') },
    { separator: true, icon: <Box size={MI} />, label: 'Shell', onClick: () => setActiveDialog('shell') },
    { icon: <ArrowUp size={MI} />, label: 'Draft', onClick: () => setActiveDialog('draft') },
    { icon: <Maximize2 size={MI} />, label: 'Scale', onClick: () => setActiveDialog('scale') },
    { icon: <Combine size={MI} />, label: 'Combine', onClick: () => setActiveDialog('combine') },
    { separator: true, icon: <Square size={MI} />, label: 'Offset Face', onClick: () => setActiveDialog('offset-face') },
    { icon: <Square size={MI} />, label: 'Replace Face', onClick: openReplaceFaceDialog },
    { icon: <Pencil size={MI} />, label: 'Direct Edit', onClick: openDirectEditDialog },
    { icon: <Image size={MI} />, label: 'Texture Extrude', onClick: openTextureExtrudeDialog },
    { icon: <Scissors size={MI} />, label: 'Split Face', onClick: openSplitFaceDialog },
    { icon: <Scissors size={MI} />, label: 'Split Body', onClick: () => setActiveDialog('split') },
    { icon: <Scissors size={MI} />, label: 'Silhouette Split', onClick: () => setActiveDialog('silhouette-split') },
    { separator: true, icon: <Move size={MI} />, label: 'Move/Copy', shortcut: 'M', onClick: () => setActiveTool('move' as Tool) },
    { icon: <Move size={MI} />, label: 'Move/Copy Body', onClick: () => setActiveDialog('move-body') },
    { icon: <AlignCenter size={MI} />, label: 'Align', onClick: () => setActiveDialog('align-dialog') },
    { icon: <Trash2 size={MI} />, label: 'Delete', shortcut: 'Del', onClick: () => {
      if (selectedFeatureId) { removeFeature(selectedFeatureId); setStatusMessage('Feature deleted'); }
      else setStatusMessage('Select a feature to delete');
    } },
    { icon: <Trash2 size={MI} />, label: 'Remove Face', onClick: () => setActiveDialog('remove-face') },
    { separator: true, icon: <Diamond size={MI} />, label: 'Physical Material', onClick: () => setActiveDialog('physical-material') },
    { icon: <Pipette size={MI} />, label: 'Appearance', shortcut: 'A', onClick: () => setActiveDialog('appearance') },
    { icon: <Diamond size={MI} />, label: 'Change Parameters', shortcut: 'Ctrl+B', onClick: () => setActiveDialog('parameters') },
  ];

  const assembleMenuItems: MenuItem[] = [
    { icon: <Download size={MI} />, label: 'Insert Component', onClick: openInsertComponentDialog },
    { separator: true, icon: <Shield size={MI} />, label: 'Contact Sets', onClick: openContactSetsDialog },
    { icon: <Package size={MI} />, label: 'New Component', onClick: handleNewComponent },
    { icon: <Copy size={MI} />, label: 'Duplicate With Joints', onClick: comingSoon('Duplicate With Joints') },
    { separator: true, icon: <Link2 size={MI} />, label: 'Constrain Components', onClick: comingSoon('Constrain Components') },
    { icon: <Link2 size={MI} />, label: 'Joint', shortcut: 'J', onClick: () => setActiveDialog('joint') },
    { icon: <Link2 size={MI} />, label: 'As-Built Joint', shortcut: 'Shift+J', onClick: () => setActiveDialog('as-built-joint') },
    { separator: true, icon: <Layers size={MI} />, label: 'Rigid Group', onClick: () => setActiveDialog('rigid-group') },
    { icon: <MapPin size={MI} />, label: 'Joint Origin', onClick: () => openJointOriginDialog() },
    { icon: <Play size={MI} />, label: 'Drive Joints', onClick: () => setActiveDialog('drive-joints') },
    { icon: <GitMerge size={MI} />, label: 'Motion Link', onClick: () => setActiveDialog('motion-link') },
    { icon: <Play size={MI} />, label: 'Motion Study', onClick: comingSoon('Motion Study') },
    { separator: true, icon: <Repeat size={MI} />, label: 'Component Pattern', onClick: () => setActiveDialog('component-pattern') },
  ];

  const constructMenuItems: MenuItem[] = [
    { icon: <Layers size={MI} />, label: 'Offset Plane', onClick: () => setActiveDialog('construction-plane') },
    { icon: <Layers size={MI} />, label: 'Plane at Angle', onClick: () => setActiveDialog('construction-plane-angle') },
    { icon: <Hexagon size={MI} />, label: 'Tangent Plane', onClick: () => { setActiveTool('construct-tangent-plane'); setStatusMessage('Tangent Plane: click a curved face'); } },
    { icon: <Layers size={MI} />, label: 'Midplane', onClick: () => setActiveDialog('construction-plane-midplane') },
    { icon: <Layers size={MI} />, label: 'Perpendicular Plane', onClick: () => setActiveDialog('perpendicular-plane') },
    { separator: true, icon: <Square size={MI} />, label: 'Plane Through Two Edges', onClick: () => { setActiveTool('construct-plane-two-edges'); setStatusMessage('Plane Through Two Edges: click first edge, then second edge'); } },
    { icon: <Layers size={MI} />, label: 'Plane Through Three Points', onClick: comingSoon('Plane Through Three Points') },
    { icon: <Layers size={MI} />, label: 'Plane Tangent to Face at Point', onClick: () => { setActiveTool('construct-plane-tangent-at-point'); setStatusMessage('Plane Tangent at Point: click a curved face, then a vertex'); } },
    { icon: <Layers size={MI} />, label: 'Plane Along Path', onClick: () => setActiveDialog('plane-along-path') },
    { separator: true, icon: <RotateCcw size={MI} />, label: 'Axis Through Cylinder/Cone/Torus', onClick: () => { setActiveTool('construct-axis-cylinder'); setStatusMessage('Axis Through Cylinder: click a curved face'); } },
    { icon: <Axis3D size={MI} />, label: 'Axis Perpendicular To Face', onClick: () => setActiveDialog('axis-perp-to-face') },
    { icon: <ArrowUpFromLine size={MI} />, label: 'Axis Perpendicular at Point', onClick: () => { setActiveTool('construct-axis-perp-at-point'); setStatusMessage('Axis Perpendicular at Point: click a planar face, then a vertex'); } },
    { icon: <GitFork size={MI} />, label: 'Axis Through Two Planes', onClick: () => { setActiveTool('construct-axis-two-planes'); setStatusMessage('Axis Through Two Planes: select two construction planes in the panel'); } },
    { icon: <ArrowRight size={MI} />, label: 'Axis Through Two Points', onClick: () => { setActiveTool('construct-axis-two-points'); setStatusMessage('Axis Through Two Points: click first point, then second point'); } },
    { icon: <Minus size={MI} />, label: 'Axis Through Edge', onClick: () => { setActiveTool('construct-axis-through-edge'); setStatusMessage('Axis Through Edge: click an edge to create axis along it'); } },
    { separator: true, icon: <Dot size={MI} />, label: 'Point at Vertex', onClick: () => { setActiveTool('construct-point-vertex'); setStatusMessage('Point at Vertex: click a vertex to create a construction point'); } },
    { icon: <Crosshair size={MI} />, label: 'Point Through Two Edges', onClick: () => { setActiveTool('construct-point-two-edges'); setStatusMessage('Point Through Two Edges: click first edge, then second edge'); } },
    { icon: <Crosshair size={MI} />, label: 'Point Through Three Planes', onClick: () => { setActiveTool('construct-point-three-planes'); setStatusMessage('Point Through Three Planes: select three construction planes in the panel'); } },
    { icon: <Target size={MI} />, label: 'Point at Center of Circle/Sphere/Torus', onClick: () => { setActiveTool('construct-point-center'); setStatusMessage('Point at Center: click a circular face to create a point at its center'); } },
    { icon: <CircleDot size={MI} />, label: 'Point At Edge And Plane', onClick: () => setActiveDialog('point-at-edge-plane') },
    { icon: <CircleDot size={MI} />, label: 'Point Along Path', onClick: () => setActiveDialog('point-along-path') },
  ];

  const inspectMenuItems: MenuItem[] = [
    { icon: <Ruler size={MI} />, label: 'Measure', shortcut: 'I', onClick: () => { setActiveTool('measure' as Tool); setStatusMessage('Measure: click two points or entities to measure distance'); } },
    { icon: <AlertTriangle size={MI} />, label: 'Interference', onClick: () => openInterferenceDialog() },
    { separator: true, icon: <BarChart2 size={MI} />, label: 'Curvature Comb Analysis', onClick: () => setActiveAnalysis('curvature-comb') },
    { icon: <Layers size={MI} />, label: 'Zebra Analysis', onClick: () => setActiveAnalysis('zebra') },
    { icon: <TrendingDown size={MI} />, label: 'Draft Analysis', onClick: () => setActiveAnalysis('draft') },
    { icon: <Activity size={MI} />, label: 'Curvature Map Analysis', onClick: () => setActiveAnalysis('curvature-map') },
    { icon: <Grid size={MI} />, label: 'Isocurve Analysis', onClick: () => setActiveAnalysis('isocurve') },
    { icon: <Eye size={MI} />, label: 'Accessibility Analysis', onClick: () => setActiveAnalysis('accessibility') },
    { icon: <AlertCircle size={MI} />, label: 'Minimum Radius Analysis', onClick: () => setActiveAnalysis('min-radius') },
    { icon: <Scissors size={MI} />, label: 'Section Analysis', onClick: () => setSectionEnabled(true) },
    { icon: <Target size={MI} />, label: 'Center of Mass', onClick: () => {
      const fs = useCADStore.getState().features.filter((f) => f.visible && f.type === 'primitive');
      if (fs.length === 0) { setStatusMessage('No primitive bodies visible — Center of Mass: (0, 0, 0) mm'); return; }
      const sum = fs.reduce((acc, f) => {
        const p = f.params as Record<string, number>;
        return { x: acc.x + (p.x ?? 0), y: acc.y + (p.y ?? 0), z: acc.z + (p.z ?? 0) };
      }, { x: 0, y: 0, z: 0 });
      const n = fs.length;
      const cx = (sum.x / n).toFixed(2); const cy = (sum.y / n).toFixed(2); const cz = (sum.z / n).toFixed(2);
      setStatusMessage(`Center of Mass (approx): X=${cx} Y=${cy} Z=${cz} mm`);
    } },
    { separator: true, icon: <Pipette size={MI} />, label: 'Display Component Colors', shortcut: 'Shift+N', checked: useCADStore.getState().showComponentColors, onClick: () => { const s = useCADStore.getState(); s.setShowComponentColors(!s.showComponentColors); s.setStatusMessage(s.showComponentColors ? 'Component colors: OFF' : 'Component colors: ON'); } },
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
        { icon: <MousePointer2 size={MI} />, label: 'Select All', onClick: () => { setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true, sketches: true, construction: true }); setStatusMessage('Selection filter: All'); } },
        { icon: <Box size={MI} />, label: 'Select Bodies', onClick: () => { setSelectionFilter({ bodies: true, faces: false, edges: false, vertices: false, sketches: false, construction: false }); setStatusMessage('Selection filter: Bodies only'); } },
        { icon: <Square size={MI} />, label: 'Select Faces', onClick: () => { setSelectionFilter({ bodies: false, faces: true, edges: false, vertices: false, sketches: false, construction: false }); setStatusMessage('Selection filter: Faces only'); } },
        { icon: <Minus size={MI} />, label: 'Select Edges', onClick: () => { setSelectionFilter({ bodies: false, faces: false, edges: true, vertices: false, sketches: false, construction: false }); setStatusMessage('Selection filter: Edges only'); } },
        { icon: <PenTool size={MI} />, label: 'Select Sketches', onClick: () => { setSelectionFilter({ bodies: false, faces: false, edges: false, vertices: false, sketches: true, construction: false }); setStatusMessage('Selection filter: Sketches only'); } },
      ],
    },
  ];

  // ─── Sketch Mode Flyout Menus ──────────────────────────────────────────

  const sketchCreateMenuItems: MenuItem[] = [
    {
      icon: <Minus size={MI} />, label: 'Line', shortcut: 'L',
      submenu: [
        { icon: <Minus size={MI} />, label: 'Line', shortcut: 'L', onClick: () => setActiveTool('line' as Tool) },
        { icon: <Minus size={MI} />, label: 'Construction Line', onClick: () => setActiveTool('construction-line' as Tool) },
        { icon: <Minus size={MI} />, label: 'Centerline', onClick: () => setActiveTool('centerline' as Tool) },
        { icon: <Minus size={MI} />, label: 'Midpoint Line', onClick: () => { setActiveTool('midpoint-line' as Tool); setStatusMessage('Midpoint Line: click the midpoint, then one endpoint'); } },
      ],
    },
    {
      icon: <Square size={MI} />, label: 'Rectangle', shortcut: 'R',
      submenu: [
        { icon: <RectangleHorizontal size={MI} />, label: '2-Point Rectangle', shortcut: 'R', onClick: () => setActiveTool('rectangle' as Tool) },
        { icon: <Square size={MI} />, label: '3-Point Rectangle', onClick: () => setActiveTool('rectangle-3point' as Tool) },
        { icon: <Crosshair size={MI} />, label: 'Center Rectangle', onClick: () => setActiveTool('rectangle-center' as Tool) },
      ],
    },
    {
      icon: <Circle size={MI} />, label: 'Circle', shortcut: 'C',
      submenu: [
        { icon: <Circle size={MI} />, label: 'Center Diameter Circle', shortcut: 'C', onClick: () => setActiveTool('circle' as Tool) },
        { icon: <Circle size={MI} />, label: '2-Point Circle', onClick: () => setActiveTool('circle-2point' as Tool) },
        { icon: <Circle size={MI} />, label: '3-Point Circle', onClick: () => setActiveTool('circle-3point' as Tool) },
        { icon: <Circle size={MI} />, label: '2-Tangent Circle', onClick: () => { setActiveTool('circle-2tangent' as Tool); setStatusMessage('2-Tangent Circle: click first line, then second line — set radius in palette'); } },
        { icon: <Circle size={MI} />, label: '3-Tangent Circle', onClick: () => { setActiveTool('circle-3tangent' as Tool); setStatusMessage('3-Tangent Circle: click three lines to create the incircle'); } },
      ],
    },
    {
      icon: <Spline size={MI} />, label: 'Arc',
      submenu: [
        { icon: <Spline size={MI} />, label: '3-Point Arc', onClick: () => setActiveTool('arc-3point' as Tool) },
        { icon: <Spline size={MI} />, label: 'Center Point Arc', onClick: () => setActiveTool('arc' as Tool) },
        { icon: <Spline size={MI} />, label: 'Tangent Arc', onClick: () => setActiveTool('arc-tangent' as Tool) },
      ],
    },
    {
      icon: <Hexagon size={MI} />, label: 'Polygon',
      submenu: [
        { icon: <Hexagon size={MI} />, label: 'Inscribed Polygon', onClick: () => setActiveTool('polygon-inscribed' as Tool) },
        { icon: <Hexagon size={MI} />, label: 'Circumscribed Polygon', onClick: () => setActiveTool('polygon-circumscribed' as Tool) },
        { icon: <Hexagon size={MI} />, label: 'Edge Polygon', onClick: () => setActiveTool('polygon-edge' as Tool) },
      ],
    },
    {
      separator: true, icon: <CircleDot size={MI} />, label: 'Ellipse',
      onClick: () => { setActiveTool('ellipse'); setStatusMessage('Ellipse: click centre, then major-axis, then minor-axis endpoint'); },
      submenu: [
        { icon: <CircleDot size={MI} />, label: 'Ellipse', onClick: () => { setActiveTool('ellipse'); setStatusMessage('Ellipse: click centre, then major-axis, then minor-axis endpoint'); } },
        { icon: <CircleDot size={MI} />, label: 'Elliptical Arc', onClick: () => { setActiveTool('elliptical-arc' as Tool); setStatusMessage('Elliptical Arc: click centre, major-axis, minor-axis, then end angle point'); } },
      ],
    },
    {
      icon: <Circle size={MI} />, label: 'Slot',
      submenu: [
        { icon: <Circle size={MI} />, label: 'Center to Center Slot', onClick: () => { setActiveTool('slot-center'); setStatusMessage('Center Slot: click first centre, then second centre, then width'); } },
        { icon: <Circle size={MI} />, label: 'Overall Slot', onClick: () => { setActiveTool('slot-overall'); setStatusMessage('Overall Slot: click first end, then second end, then width'); } },
        { icon: <Circle size={MI} />, label: 'Center Point Slot', onClick: () => { setActiveTool('slot-center-point'); setStatusMessage('Center Point Slot: click centre, then end, then width'); } },
        { icon: <Circle size={MI} />, label: 'Three Point Arc Slot', onClick: () => { setActiveTool('slot-3point-arc'); setStatusMessage('Three Point Arc Slot: click arc start, arc end, point on arc, then width'); } },
        { icon: <Circle size={MI} />, label: 'Center Point Arc Slot', onClick: () => { setActiveTool('slot-center-arc'); setStatusMessage('Center Point Arc Slot: click arc centre, arc start, arc end, then width'); } },
      ],
    },
    { separator: true, icon: <Waypoints size={MI} />, label: 'Spline', onClick: () => { setActiveTool('spline' as Tool); setStatusMessage('Spline: click to place fit points, right-click to finish'); },
      submenu: [
        { icon: <Waypoints size={MI} />, label: 'Fit Point Spline', onClick: () => { setActiveTool('spline' as Tool); setStatusMessage('Spline: click to place fit points, right-click to finish'); } },
        { icon: <Waypoints size={MI} />, label: 'Control Point Spline', onClick: () => { setActiveTool('spline-control' as Tool); setStatusMessage('Control Point Spline: click to add control points, right-click to commit'); } },
      ],
    },
    { icon: <Waypoints size={MI} />, label: 'Conic Curve', onClick: () => { setActiveTool('conic' as Tool); setStatusMessage('Conic: click start, then end, then shoulder point — set ρ in palette'); } },
    { separator: true, icon: <CircleDot size={MI} />, label: 'Point', onClick: () => setActiveTool('point' as Tool) },
    { separator: true, icon: <ArrowUpFromLine size={MI} />, label: 'Project / Include', shortcut: 'P', onClick: () => { setActiveTool('sketch-project' as Tool); setStatusMessage('Project: click a solid face to project its boundary onto the sketch plane'); } },
    { icon: <Scissors size={MI} />, label: 'Intersect', onClick: () => { setActiveTool('sketch-intersect' as Tool); setStatusMessage('Click a solid face to create intersection curve with sketch plane'); } },
    { icon: <Download size={MI} />, label: 'Project to Surface', onClick: startSketchProjectSurfaceTool },
    { separator: true, icon: <Type size={MI} />, label: 'Text', onClick: startSketchTextTool },
  ];

  const sketchModifyMenuItems: MenuItem[] = [
    { icon: <Blend size={MI} />, label: 'Fillet', shortcut: 'F', onClick: () => { setActiveTool('sketch-fillet' as Tool); setStatusMessage('Sketch Fillet: click near the corner of two intersecting lines'); } },
    { icon: <Minus size={MI} />, label: 'Linetype', onClick: () => { setActiveTool('linetype-convert' as Tool); setStatusMessage('Linetype Convert: click a line to cycle Normal → Construction → Centerline'); } },
    { icon: <Blend size={MI} />, label: 'Chamfer (Equal)', onClick: () => { setActiveTool('sketch-chamfer-equal' as Tool); setStatusMessage('Sketch Chamfer: click near a corner to chamfer — set distance in palette'); } },
    { icon: <Blend size={MI} />, label: 'Chamfer (Two Dist)', onClick: () => { setActiveTool('sketch-chamfer-two-dist' as Tool); setStatusMessage('Sketch Chamfer: click near a corner — set Dist 1 and Dist 2 in palette'); } },
    { icon: <Blend size={MI} />, label: 'Chamfer (Dist+Angle)', onClick: () => { setActiveTool('sketch-chamfer-dist-angle' as Tool); setStatusMessage('Sketch Chamfer: click near a corner — set Dist and Angle in palette'); } },
    { icon: <Blend size={MI} />, label: 'Blend Curve', onClick: () => { setActiveTool('blend-curve' as Tool); setStatusMessage('Blend Curve: click near an endpoint of a sketch entity, then click a second endpoint'); } },
    { icon: <Scissors size={MI} />, label: 'Trim', shortcut: 'T', onClick: () => { setActiveTool('trim' as Tool); setStatusMessage('Trim: click a segment portion to remove it'); } },
    { icon: <Maximize2 size={MI} />, label: 'Extend', onClick: () => { setActiveTool('extend' as Tool); setStatusMessage('Extend: click near an endpoint of a line to extend it to the nearest intersection'); } },
    { icon: <Scissors size={MI} />, label: 'Break', onClick: () => { setActiveTool('break' as Tool); setStatusMessage('Break: click on a line to split it at that point'); } },
    { separator: true, icon: <Copy size={MI} />, label: 'Offset', shortcut: 'O', onClick: () => { setActiveTool('sketch-offset' as Tool); setStatusMessage('Offset: click a line, then click the side to offset towards'); } },
    { icon: <FlipHorizontal size={MI} />, label: 'Mirror', onClick: () => { setActiveTool('sketch-mirror' as Tool); setStatusMessage('Mirror: select axis direction, then click OK'); } },
    { separator: true, icon: <Repeat size={MI} />, label: 'Circular Pattern', onClick: () => { setActiveTool('sketch-circ-pattern' as Tool); setStatusMessage('Circular Pattern: set count and angle, then click OK'); } },
    { icon: <Repeat size={MI} />, label: 'Rectangular Pattern', onClick: () => { setActiveTool('sketch-rect-pattern' as Tool); setStatusMessage('Rectangular Pattern: set counts and spacing, then click OK'); } },
    { separator: true, icon: <Move size={MI} />, label: 'Move', shortcut: 'M', onClick: () => { setActiveTool('sketch-move' as Tool); setStatusMessage('Move: set X/Y offset in plane-local coords, then click OK'); } },
    { icon: <Copy size={MI} />, label: 'Copy', onClick: () => { setActiveTool('sketch-copy' as Tool); setStatusMessage('Copy: set X/Y offset, then click OK to duplicate entities'); } },
    { icon: <Maximize2 size={MI} />, label: 'Scale', onClick: () => { setActiveTool('sketch-scale' as Tool); setStatusMessage('Scale: set factor about centroid, then click OK'); } },
    { icon: <RotateCw size={MI} />, label: 'Rotate', onClick: () => { setActiveTool('sketch-rotate' as Tool); setStatusMessage('Rotate: set angle about centroid, then click OK'); } },
  ];

  const sketchConstraintMenuItems: MenuItem[] = [
    { icon: <Ruler size={MI} />, label: 'Sketch Dimension', shortcut: 'D', onClick: () => setActiveTool('dimension' as Tool) },
    { separator: true, icon: <AlignCenter size={MI} />, label: 'Coincident', onClick: () => { setActiveTool('constrain-coincident' as Tool); setStatusMessage('Coincident: click two entities to apply constraint'); } },
    { icon: <Minus size={MI} />, label: 'Collinear', onClick: () => { setActiveTool('constrain-collinear' as Tool); setStatusMessage('Collinear: click two lines to apply constraint'); } },
    { icon: <CircleDot size={MI} />, label: 'Concentric', onClick: () => { setActiveTool('constrain-concentric' as Tool); setStatusMessage('Concentric: click two circles/arcs to apply constraint'); } },
    { icon: <LocateFixed size={MI} />, label: 'Midpoint', onClick: () => { setActiveTool('constrain-midpoint' as Tool); setStatusMessage('Midpoint: click a point and a line to apply constraint'); } },
    { separator: true, icon: <ArrowLeftRight size={MI} />, label: 'Horizontal', onClick: () => { setActiveTool('constrain-horizontal' as Tool); setStatusMessage('Horizontal: click a line or two points to apply constraint'); } },
    { icon: <ArrowUpDown size={MI} />, label: 'Vertical', onClick: () => { setActiveTool('constrain-vertical' as Tool); setStatusMessage('Vertical: click a line or two points to apply constraint'); } },
    { icon: <CornerDownRight size={MI} />, label: 'Perpendicular', onClick: () => { setActiveTool('constrain-perpendicular' as Tool); setStatusMessage('Perpendicular: click two lines to apply constraint'); } },
    { icon: <Minus size={MI} />, label: 'Parallel', onClick: () => { setActiveTool('constrain-parallel' as Tool); setStatusMessage('Parallel: click two lines to apply constraint'); } },
    { icon: <Tangent size={MI} />, label: 'Tangent', onClick: () => { setActiveTool('constrain-tangent' as Tool); setStatusMessage('Tangent: click two curves to apply constraint'); } },
    { separator: true, icon: <Equal size={MI} />, label: 'Equal', onClick: () => { setActiveTool('constrain-equal' as Tool); setStatusMessage('Equal: click two entities to apply constraint'); } },
    { icon: <FlipHorizontal size={MI} />, label: 'Symmetric', onClick: () => { setActiveTool('constrain-symmetric' as Tool); setStatusMessage('Symmetric: click two entities and a symmetry line'); } },
    { icon: <Lock size={MI} />, label: 'Fix / Unfix', onClick: () => { setActiveTool('constrain-fix' as Tool); setStatusMessage('Fix: click an entity to fix its position'); } },
    { icon: <GitMerge size={MI} />, label: 'Curvature (G2)', onClick: () => { setActiveTool('constrain-curvature' as Tool); setStatusMessage('Curvature (G2): click two splines sharing a point to apply G2 continuity'); } },
    { separator: true, icon: <Zap size={MI} />, label: 'AutoConstrain', onClick: () => autoConstrainSketch() },
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
            {workspace === 'design' ? 'DESIGN' : workspace === 'prepare' ? 'PREPARE' : '3D PRINTER'}
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
              <button
                className={`ribbon-workspace-option ${workspace === 'printer' ? 'active' : ''}`}
                onClick={() => handleWorkspaceSwitch('printer')}
              >
                3D Printer
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
              <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Extrude" onClick={handleExtrude} active={activeTool === 'extrude'} large colorClass="icon-blue" />
              <ToolButton icon={<RotateCcw size={ICON_LG} />} label="Revolve" onClick={handleRevolve} active={activeTool === 'revolve'} large colorClass="icon-blue" />
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
              <div className="ribbon-stack">
                <ToolButton icon={<Image size={ICON_SM} />} label="Decal" onClick={openDecalDialog} colorClass="icon-gray" />
                <ToolButton icon={<Edit2 size={ICON_SM} />} label="Attached Canvas" onClick={() => openAttachedCanvasDialog()} colorClass="icon-gray" />
                <ToolButton icon={<Box size={ICON_SM} />} label="Bounding Solid" onClick={openBoundingSolidDialog} colorClass="icon-gray" />
              </div>
            </RibbonSection>

            <RibbonSection title="SELECT" menuItems={selectMenuItems} accentColor="#0078d7">
              <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
              <div className="ribbon-stack">
                <ToolButton icon={<Box size={ICON_SM} />}      label="Bodies"       active={selectionFilter.bodies}       onClick={() => setSelectionFilter({ bodies: !selectionFilter.bodies })}       colorClass="icon-blue" />
                <ToolButton icon={<Square size={ICON_SM} />}   label="Faces"        active={selectionFilter.faces}        onClick={() => setSelectionFilter({ faces: !selectionFilter.faces })}        colorClass="icon-blue" />
                <ToolButton icon={<Minus size={ICON_SM} />}    label="Edges"        active={selectionFilter.edges}        onClick={() => setSelectionFilter({ edges: !selectionFilter.edges })}        colorClass="icon-blue" />
                <ToolButton icon={<Dot size={ICON_SM} />}      label="Vertices"     active={selectionFilter.vertices}     onClick={() => setSelectionFilter({ vertices: !selectionFilter.vertices })}  colorClass="icon-blue" />
                <ToolButton icon={<PenLine size={ICON_SM} />}  label="Sketches"     active={selectionFilter.sketches}     onClick={() => setSelectionFilter({ sketches: !selectionFilter.sketches })}  colorClass="icon-blue" />
                <ToolButton icon={<Layers size={ICON_SM} />}   label="Construction" active={selectionFilter.construction} onClick={() => setSelectionFilter({ construction: !selectionFilter.construction })} colorClass="icon-blue" />
              </div>
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ DESIGN > SURFACE TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'surface' && (
          <>
            <RibbonSection title="CREATE">
              <ToolButton icon={<PenTool size={ICON_LG} />} label="Sketch" onClick={beginSketchFlow} large colorClass="icon-blue" />
              <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Extrude" onClick={handleExtrude} active={activeTool === 'extrude'} large colorClass="icon-green" />
              <ToolButton icon={<RotateCcw size={ICON_LG} />} label="Revolve" onClick={startRevolveTool} active={activeTool === 'revolve'} large colorClass="icon-green" />
              <ToolButton icon={<Spline size={ICON_LG} />} label="Sweep" onClick={startSweepTool} large colorClass="icon-green" />
              <ToolButton icon={<Layers size={ICON_LG} />} label="Loft" onClick={startLoftTool} large colorClass="icon-green" />
              <ToolButton icon={<Diamond size={ICON_LG} />} label="Patch" onClick={startPatchTool} large colorClass="icon-green" />
              <ToolButton icon={<Grid3X3 size={ICON_LG} />} label="Ruled Surface" onClick={startRuledSurfaceTool} large colorClass="icon-green" />
            </RibbonSection>
            <RibbonSection title="MODIFY">
              <ToolButton icon={<ZoomOut size={ICON_LG} />} label="Offset Surface" onClick={() => setActiveDialog('offset-surface')} large colorClass="icon-orange" />
              <ToolButton icon={<Scissors size={ICON_LG} />} label="Trim" onClick={() => setActiveDialog('surface-trim')} large colorClass="icon-orange" />
              <ToolButton icon={<FlipHorizontal size={ICON_LG} />} label="Extend" onClick={() => setActiveDialog('surface-extend')} large colorClass="icon-orange" />
              <ToolButton icon={<Link size={ICON_LG} />} label="Stitch" onClick={() => setActiveDialog('stitch')} large colorClass="icon-orange" />
              <ToolButton icon={<Unlink size={ICON_LG} />} label="Unstitch" onClick={() => setActiveDialog('unstitch')} large colorClass="icon-orange" />
              <ToolButton icon={<SplitSquareHorizontal size={ICON_LG} />} label="Surface Split" onClick={() => setActiveDialog('surface-split')} large colorClass="icon-orange" />
              <ToolButton icon={<RefreshCw size={ICON_LG} />} label="Reverse Normal" onClick={() => setActiveDialog('reverse-normal')} large colorClass="icon-orange" />
              <ToolButton icon={<Layers size={ICON_LG} />} label="Untrim" onClick={() => setActiveDialog('untrim')} large colorClass="icon-orange" />
              <ToolButton icon={<Combine size={ICON_LG} />} label="Merge" onClick={() => setActiveDialog('surface-merge')} large colorClass="icon-orange" />
              <ToolButton icon={<Layers size={ICON_LG} />} label="Thicken" onClick={() => setActiveDialog('thicken')} large colorClass="icon-orange" />
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
              <ToolButton icon={<Box size={ICON_LG} />} label="Tessellate" onClick={() => setActiveDialog('tessellate')} large colorClass="icon-purple" />
              {/* D120: Insert Mesh */}
              <ToolButton icon={<FolderOpen size={ICON_LG} />} label="Insert Mesh" onClick={() => meshInsertInputRef.current?.click()} large colorClass="icon-purple" />
              <input
                ref={meshInsertInputRef}
                type="file"
                accept=".stl,.obj,.3mf,.gltf,.glb"
                style={{ display: 'none' }}
                onChange={handleMeshInsert}
              />
              {/* D121: Mesh Section Sketch */}
              <ToolButton icon={<Scissors size={ICON_LG} />} label="Section Sketch" onClick={() => setActiveDialog('mesh-section-sketch')} large colorClass="icon-purple" />
              {/* D122: Mesh Primitives */}
              <ToolButton icon={<CircleDot size={ICON_LG} />} label="Primitives" onClick={() => setActiveDialog('mesh-primitives')} large colorClass="icon-purple" />
            </RibbonSection>
            <RibbonSection title="MODIFY">
              <ToolButton icon={<Blend size={ICON_LG} />} label="Reduce" onClick={() => setActiveDialog('mesh-reduce')} large colorClass="icon-purple" />
              {/* D124: Remesh */}
              <ToolButton icon={<RefreshCw size={ICON_LG} />} label="Remesh" onClick={() => setActiveDialog('remesh')} large colorClass="icon-purple" />
              {/* D126: Plane Cut */}
              <ToolButton icon={<SplitSquareHorizontal size={ICON_LG} />} label="Plane Cut" onClick={() => setActiveDialog('plane-cut')} large colorClass="icon-purple" />
              {/* D127: Make Closed Mesh */}
              <ToolButton icon={<Combine size={ICON_LG} />} label="Make Closed" onClick={() => setActiveDialog('make-closed-mesh')} large colorClass="icon-purple" />
              {/* D128: Erase And Fill */}
              <ToolButton icon={<Trash2 size={ICON_LG} />} label="Erase &amp; Fill" onClick={() => setActiveDialog('erase-and-fill')} large colorClass="icon-purple" />
              {/* D129: Mesh Smooth */}
              <ToolButton icon={<Blend size={ICON_LG} />} label="Smooth" onClick={() => setActiveDialog('mesh-smooth')} large colorClass="icon-purple" />
              {/* D130: Mesh Shell */}
              <ToolButton icon={<Box size={ICON_LG} />} label="Shell" onClick={() => setActiveDialog('mesh-shell')} large colorClass="icon-purple" />
              {/* D131: Mesh Combine */}
              <ToolButton icon={<Link2 size={ICON_LG} />} label="Combine" onClick={() => setActiveDialog('mesh-combine')} large colorClass="icon-purple" />
              {/* D132: Mesh Reverse Normal */}
              <ToolButton icon={<FlipHorizontal size={ICON_LG} />} label="Reverse Normal" onClick={() => setActiveDialog('mesh-reverse-normal')} large colorClass="icon-purple" />
              {/* D133: Mesh Align */}
              <ToolButton icon={<AlignCenter size={ICON_LG} />} label="Align" onClick={() => setActiveDialog('mesh-align')} large colorClass="icon-purple" />
              {/* D134: Mesh Separate */}
              <ToolButton icon={<Unlink size={ICON_LG} />} label="Separate" onClick={() => setActiveDialog('mesh-separate')} large colorClass="icon-purple" />
              {/* D135: Mesh Transform */}
              <ToolButton icon={<Move size={ICON_LG} />} label="Transform" onClick={() => setActiveDialog('mesh-transform')} large colorClass="icon-purple" />
              {/* D136: Convert Mesh to BRep */}
              <ToolButton icon={<Package size={ICON_LG} />} label="To BRep" onClick={() => setActiveDialog('convert-mesh-to-brep')} large colorClass="icon-purple" />
            </RibbonSection>
            <RibbonSection title="SELECT">
              <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
            </RibbonSection>
          </>
        )}

        {/* ═══════════════ DESIGN > FORM TAB ═══════════════ */}
        {!inSketch && workspace === 'design' && designTab === 'form' && (
          <>
            {/* D140-D151: CREATE panel — T-Spline primitives */}
            <RibbonSection title="CREATE">
              <ToolButton icon={<Box size={ICON_LG} />} label="Box" tool="form-box" large colorClass="icon-orange" />
              <ToolButton icon={<Square size={ICON_LG} />} label="Plane" tool="form-plane" large colorClass="icon-orange" />
              <ToolButton icon={<Circle size={ICON_LG} />} label="Cylinder" tool="form-cylinder" large colorClass="icon-orange" />
              <ToolButton icon={<CircleDot size={ICON_LG} />} label="Sphere" tool="form-sphere" large colorClass="icon-orange" />
              <ToolButton icon={<Repeat size={ICON_LG} />} label="Torus" tool="form-torus" large colorClass="icon-orange" />
              <ToolButton icon={<Diamond size={ICON_LG} />} label="Quadball" tool="form-quadball" large colorClass="icon-orange" />
              <ToolButton icon={<Spline size={ICON_LG} />} label="Pipe" tool="form-pipe" large colorClass="icon-orange" />
              <ToolButton icon={<PenTool size={ICON_LG} />} label="Face" tool="form-face" large colorClass="icon-orange" />
              <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Extrude" tool="form-extrude" large colorClass="icon-orange" />
              <ToolButton icon={<RotateCw size={ICON_LG} />} label="Revolve" tool="form-revolve" large colorClass="icon-orange" />
              <ToolButton icon={<Waypoints size={ICON_LG} />} label="Sweep" tool="form-sweep" large colorClass="icon-orange" />
              <ToolButton icon={<Layers size={ICON_LG} />} label="Loft" tool="form-loft" large colorClass="icon-orange" />
            </RibbonSection>

            {/* D152-D167: MODIFY panel */}
            <RibbonSection title="MODIFY">
              <ToolButton icon={<Move size={ICON_LG} />} label="Edit Form" tool="form-edit" large colorClass="icon-orange" />
              <ToolButton icon={<Minus size={ICON_LG} />} label="Insert Edge" tool="form-insert-edge" large colorClass="icon-orange" />
              <ToolButton icon={<Diamond size={ICON_LG} />} label="Insert Point" tool="form-insert-point" large colorClass="icon-orange" />
              <ToolButton icon={<Grid3X3 size={ICON_LG} />} label="Subdivide" tool="form-subdivide" large colorClass="icon-orange" />
              <ToolButton icon={<Link2 size={ICON_LG} />} label="Bridge" tool="form-bridge" large colorClass="icon-orange" />
              <ToolButton icon={<Target size={ICON_LG} />} label="Fill Hole" tool="form-fill-hole" large colorClass="icon-orange" />
              <ToolButton icon={<Combine size={ICON_LG} />} label="Weld" tool="form-weld" large colorClass="icon-orange" />
              <ToolButton icon={<Blend size={ICON_LG} />} label="Unweld" tool="form-unweld" large colorClass="icon-orange" />
              <ToolButton icon={<Maximize2 size={ICON_LG} />} label="Crease" tool="form-crease" large colorClass="icon-orange" />
              <ToolButton icon={<Blend size={ICON_LG} />} label="Uncrease" tool="form-uncrease" large colorClass="icon-orange" />
              <ToolButton icon={<AlignCenter size={ICON_LG} />} label="Flatten" tool="form-flatten" large colorClass="icon-orange" />
              <ToolButton icon={<Equal size={ICON_LG} />} label="Uniform" tool="form-uniform" large colorClass="icon-orange" />
              <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Pull" tool="form-pull" large colorClass="icon-orange" />
              <ToolButton icon={<Tangent size={ICON_LG} />} label="Interpolate" tool="form-interpolate" large colorClass="icon-orange" />
              <ToolButton icon={<Layers size={ICON_LG} />} label="Thicken" tool="form-thicken" large colorClass="icon-orange" />
              <ToolButton icon={<Package size={ICON_LG} />} label="Freeze" tool="form-freeze" large colorClass="icon-orange" />
              {/* D167: Delete — remove selected cage elements */}
              <ToolButton icon={<Trash2 size={ICON_LG} />} label="Delete" tool="form-delete" large colorClass="icon-red" />
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
              <ToolButton icon={<Zap size={ICON_LG} />} label="Snap Fit" onClick={openSnapFitDialog} large colorClass="icon-blue" />
              <ToolButton icon={<Layers size={ICON_LG} />} label="Lip / Groove" onClick={openLipGrooveDialog} large colorClass="icon-blue" />
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
                <ToolButton icon={<Maximize2 size={ICON_SM} />} label="Scale" onClick={() => setActiveDialog('scale')} colorClass="icon-gray" />
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
              <ToolButton
                icon={<PenLine size={20} />}
                label="Line"
                tool="line"
                colorClass="icon-blue"
              />
              <ToolButton
                icon={<RectangleHorizontal size={20} />}
                label="Rectangle"
                active={['rectangle','rectangle-3point','rectangle-center'].includes(activeTool)}
                onClick={() => setActiveTool('rectangle' as Tool)}
                colorClass="icon-blue"
                dropdown={[
                  { label: '2-Point Rectangle', icon: <RectangleHorizontal size={14} />, onClick: () => setActiveTool('rectangle' as Tool) },
                  { label: '3-Point Rectangle', icon: <Square size={14} />, onClick: () => setActiveTool('rectangle-3point' as Tool) },
                  { label: 'Center Rectangle', icon: <Crosshair size={14} />, onClick: () => setActiveTool('rectangle-center' as Tool) },
                ]}
              />
              <ToolButton
                icon={<Circle size={20} />}
                label="Circle"
                active={['circle','circle-2point','circle-3point'].includes(activeTool)}
                onClick={() => setActiveTool('circle' as Tool)}
                colorClass="icon-blue"
                dropdown={[
                  { label: 'Center Diameter Circle', icon: <Circle size={14} />, onClick: () => setActiveTool('circle' as Tool) },
                  { label: '2-Point Circle', icon: <Circle size={14} />, onClick: () => setActiveTool('circle-2point' as Tool) },
                  { label: '3-Point Circle', icon: <Circle size={14} />, onClick: () => setActiveTool('circle-3point' as Tool) },
                ]}
              />
              <ToolButton
                icon={<Spline size={20} />}
                label="Arc"
                active={['arc','arc-3point','arc-tangent'].includes(activeTool)}
                onClick={() => setActiveTool('arc-3point' as Tool)}
                colorClass="icon-blue"
                dropdown={[
                  { label: '3-Point Arc', icon: <Spline size={14} />, onClick: () => setActiveTool('arc-3point' as Tool) },
                  { label: 'Center Point Arc', icon: <Spline size={14} />, onClick: () => setActiveTool('arc' as Tool) },
                  { label: 'Tangent Arc', icon: <Spline size={14} />, onClick: () => setActiveTool('arc-tangent' as Tool) },
                ]}
              />
              <ToolButton
                icon={<Hexagon size={20} />}
                label="Polygon"
                active={['polygon','polygon-inscribed','polygon-circumscribed','polygon-edge'].includes(activeTool)}
                onClick={() => setActiveTool('polygon-inscribed' as Tool)}
                colorClass="icon-blue"
                dropdown={[
                  { label: 'Inscribed Polygon', icon: <Hexagon size={14} />, onClick: () => setActiveTool('polygon-inscribed' as Tool) },
                  { label: 'Circumscribed Polygon', icon: <Hexagon size={14} />, onClick: () => setActiveTool('polygon-circumscribed' as Tool) },
                  { label: 'Edge Polygon', icon: <Hexagon size={14} />, onClick: () => setActiveTool('polygon-edge' as Tool) },
                ]}
              />
              <ToolButton icon={<CircleDot size={20} />}          label="Ellipse"
                active={activeTool === 'ellipse' || activeTool === 'elliptical-arc'}
                onClick={() => { setActiveTool('ellipse'); setStatusMessage('Ellipse: click centre, then major-axis, then minor-axis endpoint'); }}
                colorClass="icon-blue"
                dropdown={[
                  { label: 'Ellipse', icon: <CircleDot size={14} />, onClick: () => { setActiveTool('ellipse'); setStatusMessage('Ellipse: click centre, then major-axis, then minor-axis endpoint'); } },
                  { label: 'Elliptical Arc', icon: <CircleDot size={14} />, onClick: () => { setActiveTool('elliptical-arc' as import('../../types/cad').Tool); setStatusMessage('Elliptical Arc: click centre, major-axis, minor-axis, then end angle point'); } },
                ]}
              />
              <ToolButton icon={<CircleDot size={20} />}          label="Point"     tool="point"                     colorClass="icon-blue" />
              <ToolButton icon={<Waypoints size={20} />}          label="Spline"    onClick={() => { setActiveTool('spline' as Tool); setStatusMessage('Spline: click to place fit points, right-click to finish'); }}   colorClass="icon-blue"
                dropdown={[
                  { label: 'Fit Point Spline', icon: <Waypoints size={14} />, onClick: () => { setActiveTool('spline' as Tool); setStatusMessage('Spline: click to place fit points, right-click to finish'); } },
                  { label: 'Control Point Spline', icon: <Waypoints size={14} />, onClick: () => { setActiveTool('spline-control' as Tool); setStatusMessage('Control Point Spline: click to add control points, right-click to commit'); } },
                ]}
              />
              <ToolButton icon={<ArrowUpFromLine size={20} />}    label="Project"   active={activeTool === 'sketch-project'} onClick={() => { setActiveTool('sketch-project' as Tool); setStatusMessage('Project: click a solid face to project its boundary onto the sketch plane'); }}  colorClass="icon-blue" />
              <ToolButton icon={<Scissors size={20} />}           label="Intersect" active={activeTool === 'sketch-intersect'} onClick={() => { setActiveTool('sketch-intersect' as Tool); setStatusMessage('Click a solid face to create intersection curve with sketch plane'); }} colorClass="icon-blue" />
              <ToolButton icon={<Download size={20} />}           label="Proj Surface" active={activeTool === 'sketch-project-surface'} onClick={startSketchProjectSurfaceTool} colorClass="icon-blue" />
              <ToolButton icon={<Type size={20} />}               label="Text"      active={activeTool === 'sketch-text'} onClick={startSketchTextTool}  colorClass="icon-blue" />
            </RibbonSection>

            {/* ── MODIFY ─────────────────────────────────── */}
            <RibbonSection title="MODIFY" menuItems={sketchModifyMenuItems} accentColor="#0078d7">
              <ToolButton icon={<CornerDownRight size={20} />}   label="Fillet"   onClick={() => { setActiveTool('sketch-fillet' as Tool); setStatusMessage('Sketch Fillet: click near the corner of two lines'); }}  colorClass="icon-blue" />
              <ToolButton icon={<Blend size={20} />}             label="Chamfer"  onClick={() => { setActiveTool('sketch-chamfer-equal' as Tool); setStatusMessage('Sketch Chamfer: click near a corner — set distance in palette'); }}  colorClass="icon-blue" />
              <ToolButton icon={<Scissors size={20} />}          label="Trim"    onClick={() => { setActiveTool('trim' as Tool); setStatusMessage('Trim: click a segment portion to remove it'); }}    colorClass="icon-blue" />
              <ToolButton icon={<ChevronsRight size={20} />}     label="Extend"  onClick={() => { setActiveTool('extend' as Tool); setStatusMessage('Extend: click near an endpoint to extend to nearest intersection'); }}  colorClass="icon-blue" />
              <ToolButton icon={<Copy size={20} />}              label="Offset"  active={activeTool === 'sketch-offset'}  onClick={() => { setActiveTool('sketch-offset' as Tool); setStatusMessage('Offset: click a line, then click the side to offset towards'); }}  colorClass="icon-blue" />
              <ToolButton icon={<FlipHorizontal2 size={20} />}   label="Mirror"  active={activeTool === 'sketch-mirror'}  onClick={() => { setActiveTool('sketch-mirror' as Tool); setStatusMessage('Mirror: select axis direction, then click OK'); }}  colorClass="icon-blue" />
              <ToolButton icon={<Move size={20} />}              label="Move"    onClick={() => { setActiveTool('sketch-move' as Tool); setStatusMessage('Move: set X/Y offset, then click OK'); }}    colorClass="icon-blue" />
            </RibbonSection>

            {/* ── CONSTRAINTS ────────────────────────────── */}
            <RibbonSection title="CONSTRAINTS" menuItems={sketchConstraintMenuItems} accentColor="#ff6b00">
              <ToolButton icon={<Ruler size={20} />}            label="Dimension"    tool="dimension"                                                                                                                                  colorClass="icon-orange" />
              <ToolButton icon={<AlignCenter size={20} />}      label="Coincident"   active={activeTool === 'constrain-coincident'}   onClick={() => { setActiveTool('constrain-coincident' as Tool);   setStatusMessage('Coincident: click two entities to apply constraint'); }}   colorClass="icon-orange" />
              <ToolButton icon={<Minus size={20} />}            label="Collinear"    active={activeTool === 'constrain-collinear'}    onClick={() => { setActiveTool('constrain-collinear' as Tool);    setStatusMessage('Collinear: click two lines to apply constraint'); }}         colorClass="icon-orange" />
              <ToolButton icon={<CircleDot size={20} />}        label="Concentric"   active={activeTool === 'constrain-concentric'}   onClick={() => { setActiveTool('constrain-concentric' as Tool);   setStatusMessage('Concentric: click two circles/arcs to apply constraint'); }} colorClass="icon-orange" />
              <ToolButton icon={<Lock size={20} />}             label="Fix"          active={activeTool === 'constrain-fix'}          onClick={() => { setActiveTool('constrain-fix' as Tool);          setStatusMessage('Fix: click an entity to fix its position'); }}              colorClass="icon-orange" />
              <ToolButton icon={<Minus size={20} />}            label="Parallel"     active={activeTool === 'constrain-parallel'}     onClick={() => { setActiveTool('constrain-parallel' as Tool);     setStatusMessage('Parallel: click two lines to apply constraint'); }}         colorClass="icon-orange" />
              <ToolButton icon={<CornerDownRight size={20} />}  label="Perpendicular" active={activeTool === 'constrain-perpendicular'} onClick={() => { setActiveTool('constrain-perpendicular' as Tool); setStatusMessage('Perpendicular: click two lines to apply constraint'); }} colorClass="icon-orange" />
              <ToolButton icon={<ArrowLeftRight size={20} />}   label="Horizontal"   active={activeTool === 'constrain-horizontal'}   onClick={() => { setActiveTool('constrain-horizontal' as Tool);   setStatusMessage('Horizontal: click a line or two points to apply constraint'); }} colorClass="icon-orange" />
              <ToolButton icon={<ArrowUpDown size={20} />}      label="Vertical"     active={activeTool === 'constrain-vertical'}     onClick={() => { setActiveTool('constrain-vertical' as Tool);     setStatusMessage('Vertical: click a line or two points to apply constraint'); }} colorClass="icon-orange" />
              <ToolButton icon={<Tangent size={20} />}          label="Tangent"      active={activeTool === 'constrain-tangent'}      onClick={() => { setActiveTool('constrain-tangent' as Tool);      setStatusMessage('Tangent: click two curves to apply constraint'); }}          colorClass="icon-orange" />
              <ToolButton icon={<Equal size={20} />}            label="Equal"        active={activeTool === 'constrain-equal'}        onClick={() => { setActiveTool('constrain-equal' as Tool);        setStatusMessage('Equal: click two entities to apply constraint'); }}          colorClass="icon-orange" />
              <ToolButton icon={<LocateFixed size={20} />}      label="Midpoint"     active={activeTool === 'constrain-midpoint'}     onClick={() => { setActiveTool('constrain-midpoint' as Tool);     setStatusMessage('Midpoint: click a point and a line to apply constraint'); }}  colorClass="icon-orange" />
              <ToolButton icon={<FlipHorizontal size={20} />}   label="Symmetric"    active={activeTool === 'constrain-symmetric'}    onClick={() => { setActiveTool('constrain-symmetric' as Tool);    setStatusMessage('Symmetric: click two entities and a symmetry line'); }}     colorClass="icon-orange" />
              <ToolButton icon={<GitMerge size={20} />}         label="Curvature (G2)" active={activeTool === 'constrain-curvature'} onClick={() => { setActiveTool('constrain-curvature' as Tool); setStatusMessage('Curvature (G2): click two splines sharing a point to apply G2 continuity'); }} colorClass="icon-orange" />
              <ToolButton icon={<Zap size={20} />}              label="AutoConstrain" onClick={() => autoConstrainSketch()}                                                                                                             colorClass="icon-orange" />
            </RibbonSection>

            {/* ── CONFIGURE ──────────────────────────────── */}
            <RibbonSection title="CONFIGURE" accentColor="#555">
              <div className="ribbon-stack">
                <ToolButton icon={<Grid3X3 size={ICON_SM} />} label="Grid" active={sketchGridEnabled} onClick={() => { setSketchGridEnabled(!sketchGridEnabled); setStatusMessage(`Sketch grid: ${sketchGridEnabled ? 'OFF' : 'ON'}`); }} colorClass="icon-gray" />
                <ToolButton icon={<Magnet size={ICON_SM} />}  label="Snap" active={sketchSnapEnabled} onClick={() => { setSketchSnapEnabled(!sketchSnapEnabled); setStatusMessage(`Sketch snap: ${sketchSnapEnabled ? 'OFF' : 'ON'}`); }} colorClass="icon-gray" />
              </div>
            </RibbonSection>

            {/* ── INSPECT ────────────────────────────────── */}
            <RibbonSection title="INSPECT" accentColor="#555">
              <div className="ribbon-stack">
                <ToolButton icon={<Ruler size={ICON_SM} />} label="Measure" tool="measure" colorClass="icon-gray" />
              </div>
            </RibbonSection>

            {/* ── INSERT ─────────────────────────────────── */}
            <RibbonSection title="INSERT" accentColor="#555">
              <div className="ribbon-stack">
                <ToolButton icon={<FileUp size={ICON_SM} />} label="Insert SVG" onClick={() => setActiveDialog('insert-svg')} colorClass="icon-gray" />
                <ToolButton icon={<FileUp size={ICON_SM} />} label="Insert DXF" onClick={() => setActiveDialog('insert-dxf')} colorClass="icon-gray" />
                <ToolButton icon={<FileUp size={ICON_SM} />} label="Insert Canvas" onClick={() => setActiveDialog('insert-canvas')} colorClass="icon-gray" />
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
