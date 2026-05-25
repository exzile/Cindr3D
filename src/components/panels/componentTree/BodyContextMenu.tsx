import { useState } from 'react';
import * as THREE from 'three';
import {
  Move, FolderOpen, Box, Layers, Settings, Link2, CircleDot,
  Download, Copy, Scissors, Trash2, MoreHorizontal, Eye,
  Search, MousePointer2, ScanEye, Printer,
} from 'lucide-react';
import { useComponentStore } from '../../../store/componentStore';
import { useCADStore } from '../../../store/cadStore';
import { useSlicerStore } from '../../../store/slicerStore';
import { bodyIdGeometryCache } from '../../../store/meshRegistry';
import { ContextMenuShell } from '../../ui/ContextMenuShell';

export interface BodyCtxMenu {
  bodyId: string;
  x: number;
  y: number;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  type?: 'opacity' | 'selectable';
  onClick: () => void;
}

// ── Sub-component: opacity slider row ──────────────────────────────────────
interface OpacityRowProps {
  opacity: number;
  onChange: (v: number) => void;
}
function OpacityRow({ opacity, onChange }: OpacityRowProps) {
  return (
    <div className="ctx-opacity-row">
      <input
        className="ctx-opacity-slider"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={opacity}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="ctx-opacity-value">{Math.round(opacity * 100)}%</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function BodyContextMenu({
  menu,
  bodyName,
  onClose,
  onOpenMaterial,
  onStartRename,
}: {
  menu: BodyCtxMenu;
  bodyName: string;
  onClose: () => void;
  onOpenMaterial: () => void;
  onStartRename: () => void;
}) {
  const [opacityOpen, setOpacityOpen] = useState(false);

  const removeBody           = useComponentStore((s) => s.removeBody);
  const toggleVisibility     = useComponentStore((s) => s.toggleBodyVisibility);
  const isolateBody          = useComponentStore((s) => s.isolateBody);
  const showAllBodies        = useComponentStore((s) => s.showAllBodies);
  const setBodyOpacity       = useComponentStore((s) => s.setBodyOpacity);
  const toggleBodySelectable = useComponentStore((s) => s.toggleBodySelectable);
  const copyBody             = useComponentStore((s) => s.copyBody);
  const createComponentFromBody = useComponentStore((s) => s.createComponentFromBody);
  const clipboardBodyId      = useComponentStore((s) => s.clipboardBodyId);
  const setClipboardBody     = useComponentStore((s) => s.setClipboardBody);
  const pasteBody            = useComponentStore((s) => s.pasteBody);
  const setSelectedBodyId    = useComponentStore((s) => s.setSelectedBodyId);
  const body                 = useComponentStore((s) => s.bodies[menu.bodyId]);

  const setStatusMessage       = useCADStore((s) => s.setStatusMessage);
  const setActiveDialog        = useCADStore((s) => s.setActiveDialog);
  const setDialogPayload       = useCADStore((s) => s.setDialogPayload);
  const triggerBodyExport      = useCADStore((s) => s.triggerBodyExport);
  const setWorkspaceMode       = useCADStore((s) => s.setWorkspaceMode);
  const setCameraTargetOrbit   = useCADStore((s) => s.setCameraTargetOrbit);
  const addToPlate         = useSlicerStore((s) => s.addToPlate);

  const isSelectable = body?.selectable !== false;
  const currentOpacity = body?.opacity ?? 1;

  const cs = (label: string) => () => {
    setStatusMessage(`${label} — coming soon`);
    onClose();
  };

  const handleFindInWindow = () => {
    setSelectedBodyId(menu.bodyId);
    const mesh = body?.mesh;
    if (mesh) {
      const bbox = new THREE.Box3().setFromObject(mesh);
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      setCameraTargetOrbit(center);
      setStatusMessage(`Found: ${bodyName}`);
    } else {
      setStatusMessage(`Selected: ${bodyName}`);
    }
    onClose();
  };

  const items: MenuItem[] = [
    {
      label: 'Send to Prepare',
      icon: <Printer size={13} />,
      onClick: () => {
        const geomSrc = bodyIdGeometryCache.get(menu.bodyId);
        if (geomSrc) {
          // Clone so the slicer owns an independent copy.
          const geom = geomSrc.clone();
          // bodyIdGeometryCache stores world-space geometry. The slicer plateObject
          // applies its own position transform, so we need local-space vertices:
          // center XY at origin and floor Z at 0 (bottom of body on build plate).
          geom.computeBoundingBox();
          const bbox = geom.boundingBox!;
          const cx = (bbox.min.x + bbox.max.x) / 2;
          const cy = (bbox.min.y + bbox.max.y) / 2;
          geom.translate(-cx, -cy, -bbox.min.z);
          geom.computeBoundingBox(); // recompute after normalizing
          addToPlate(menu.bodyId, bodyName, geom);
          setWorkspaceMode('prepare');
          setStatusMessage(`Sent "${bodyName}" to Prepare`);
        } else {
          setStatusMessage('Body geometry not available — try again after the model renders');
        }
        onClose();
      },
    },
    { separator: true, label: 'Move/Copy', shortcut: 'M', icon: <Move size={13} />, onClick: () => { setActiveDialog('move-body'); onClose(); } },
    { label: 'Move to Group', icon: <FolderOpen size={13} />, onClick: cs('Move to Group') },
    { separator: true, label: 'Create Components from Bodies', icon: <Box size={13} />, onClick: () => {
        const newCompId = createComponentFromBody(menu.bodyId);
        if (newCompId) setStatusMessage(`Created component from ${bodyName}`);
        onClose();
      } },
    { label: 'Create Selection Set', icon: <Layers size={13} />, onClick: () => { setActiveDialog('selection-sets'); onClose(); } },
    { separator: true, label: 'Configure', icon: <Settings size={13} />, onClick: cs('Configure') },
    { label: 'Enable Contact Sets', icon: <Link2 size={13} />, onClick: () => { setActiveDialog('contact-sets'); onClose(); } },
    { separator: true, label: 'Physical Material', icon: <CircleDot size={13} />, onClick: () => { onOpenMaterial(); onClose(); } },
    { label: 'Appearance', shortcut: 'A', icon: <CircleDot size={13} />, onClick: () => { setActiveDialog('appearance'); onClose(); } },
    { label: 'Texture Map Controls', icon: <Settings size={13} />, onClick: cs('Texture Map Controls') },
    { label: 'Properties', icon: <MoreHorizontal size={13} />, onClick: () => { setDialogPayload(menu.bodyId); setActiveDialog('body-properties'); onClose(); } },
    { separator: true, label: 'Save As STL', icon: <Download size={13} />, onClick: () => { triggerBodyExport(menu.bodyId, 'stl'); onClose(); } },
    { label: 'Save As GLB', icon: <Download size={13} />, onClick: () => { triggerBodyExport(menu.bodyId, 'glb'); onClose(); } },
    { label: 'Copy', shortcut: 'Ctrl+C', icon: <Copy size={13} />, onClick: () => {
        const newId = copyBody(menu.bodyId);
        if (newId) setStatusMessage(`Copied ${bodyName}`);
        onClose();
      } },
    { label: 'Cut', shortcut: 'Ctrl+X', icon: <Scissors size={13} />, onClick: () => {
        setClipboardBody(menu.bodyId);
        removeBody(menu.bodyId);
        setStatusMessage(`Cut ${bodyName} — use Paste to place it`);
        onClose();
      } },
    { label: 'Paste', shortcut: 'Ctrl+V', icon: <Copy size={13} />, onClick: () => {
        const newId = pasteBody();
        if (newId) setStatusMessage('Pasted body');
        onClose();
      }, disabled: !clipboardBodyId },
    {
      label: 'Delete',
      shortcut: 'Del',
      icon: <Trash2 size={13} />,
      danger: true,
      onClick: () => {
        removeBody(menu.bodyId);
        setStatusMessage(`Deleted ${bodyName}`);
        onClose();
      },
    },
    { label: 'Remove', icon: <Trash2 size={13} />, danger: true, onClick: () => { removeBody(menu.bodyId); setStatusMessage(`Removed ${bodyName}`); onClose(); } },
    {
      label: 'Rename',
      icon: <MoreHorizontal size={13} />,
      onClick: () => { onClose(); onStartRename(); },
    },
    { separator: true, label: 'Display Detail Control', icon: <Settings size={13} />, onClick: () => { setDialogPayload(menu.bodyId); setActiveDialog('display-detail'); onClose(); } },
    { label: 'Show/Hide', shortcut: 'V', icon: <Eye size={13} />, onClick: () => { toggleVisibility(menu.bodyId); onClose(); } },
    { label: 'Isolate', icon: <ScanEye size={13} />, onClick: () => { isolateBody(menu.bodyId); setStatusMessage(`Isolated: ${bodyName}`); onClose(); } },
    { label: 'Show All Bodies', icon: <Eye size={13} />, onClick: () => { showAllBodies(); setStatusMessage('All bodies visible'); onClose(); } },
    // CTX-9: Selectable toggle — label reflects current state
    {
      label: isSelectable ? 'Make Unselectable' : 'Make Selectable',
      type: 'selectable',
      icon: <MousePointer2 size={13} />,
      onClick: () => {
        toggleBodySelectable(menu.bodyId);
        setStatusMessage(isSelectable ? `${bodyName}: unselectable` : `${bodyName}: selectable`);
        onClose();
      },
    },
    // CTX-7: Opacity — expands slider inline, does NOT close menu
    {
      label: 'Opacity Control',
      type: 'opacity',
      icon: <CircleDot size={13} />,
      onClick: () => setOpacityOpen((prev) => !prev),
    },
    { separator: true, label: 'Find in Window', icon: <Search size={13} />, onClick: handleFindInWindow },
  ];

  return (
    <ContextMenuShell x={menu.x} y={menu.y} onClose={onClose}>
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="sketch-ctx-sep" />;
        }

        const isActive = item.type === 'opacity' && opacityOpen;
        const isToggledOn = item.type === 'selectable' && !isSelectable;

        return (
          <div key={i}>
            <button
              className={[
                'sketch-ctx-item',
                item.danger ? 'danger' : '',
                isActive ? 'active' : '',
                isToggledOn ? 'toggled-on' : '',
                item.disabled ? 'disabled' : '',
              ].filter(Boolean).join(' ')}
              onClick={item.disabled ? undefined : item.onClick}
              disabled={item.disabled}
            >
              <span className="sketch-ctx-icon">{item.icon}</span>
              <span className="sketch-ctx-label">{item.label}</span>
              {item.shortcut && <span className="sketch-ctx-shortcut">{item.shortcut}</span>}
            </button>

            {item.type === 'opacity' && opacityOpen && (
              <OpacityRow
                opacity={currentOpacity}
                onChange={(v) => setBodyOpacity(menu.bodyId, v)}
              />
            )}
          </div>
        );
      })}
    </ContextMenuShell>
  );
}
