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
  kind?: 'item' | 'heading';
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  type?: 'opacity' | 'selectable';
  tone?: 'organize' | 'create' | 'edit' | 'display' | 'locate' | 'danger';
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
  const removeFeature          = useCADStore((s) => s.removeFeature);
  const setActiveDialog        = useCADStore((s) => s.setActiveDialog);

  // Collect all features to remove when deleting this body:
  // body.featureIds (direct features) + all transitive descendants via parentFeatureId.
  const collectBodyFeatureChain = (): string[] => {
    const all = useCADStore.getState().features;
    const toRemove = new Set<string>(body?.featureIds ?? []);
    // Walk forward through parentFeatureId links (fillet/chamfer → source)
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of all) {
        const parentId = f.parentFeatureId ?? (f.params.parentFeatureId as string | undefined);
        if (!toRemove.has(f.id) && parentId && toRemove.has(parentId)) {
          toRemove.add(f.id);
          changed = true;
        }
      }
    }
    // Return in reverse timeline order so leaf features are removed first
    return all.filter((f) => toRemove.has(f.id)).map((f) => f.id).reverse();
  };
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
    { kind: 'heading', label: 'Prepare', onClick: () => {} },
    {
      label: 'Send to Prepare',
      icon: <Printer size={13} />,
      tone: 'create',
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
    { separator: true, label: '', onClick: () => {} },
    { kind: 'heading', label: 'Organize', onClick: () => {} },
    { label: 'Move/Copy', shortcut: 'M', icon: <Move size={13} />, tone: 'organize', onClick: () => { setActiveDialog('move-body'); onClose(); } },
    { label: 'Move to Group', icon: <FolderOpen size={13} />, tone: 'organize', onClick: cs('Move to Group') },
    { label: 'Create Components from Bodies', icon: <Box size={13} />, tone: 'create', onClick: () => {
        const newCompId = createComponentFromBody(menu.bodyId);
        if (newCompId) setStatusMessage(`Created component from ${bodyName}`);
        onClose();
      } },
    { label: 'Create Selection Set', icon: <Layers size={13} />, tone: 'organize', onClick: () => { setActiveDialog('selection-sets'); onClose(); } },
    { separator: true, label: '', onClick: () => {} },
    { kind: 'heading', label: 'Configure', onClick: () => {} },
    { label: 'Configure', icon: <Settings size={13} />, tone: 'edit', onClick: cs('Configure') },
    { label: 'Enable Contact Sets', icon: <Link2 size={13} />, tone: 'edit', onClick: () => { setActiveDialog('contact-sets'); onClose(); } },
    { separator: true, label: '', onClick: () => {} },
    { kind: 'heading', label: 'Material', onClick: () => {} },
    { label: 'Physical Material', icon: <CircleDot size={13} />, tone: 'edit', onClick: () => { onOpenMaterial(); onClose(); } },
    { label: 'Appearance', shortcut: 'A', icon: <CircleDot size={13} />, tone: 'edit', onClick: () => { setActiveDialog('appearance'); onClose(); } },
    { label: 'Texture Map Controls', icon: <Settings size={13} />, tone: 'edit', onClick: cs('Texture Map Controls') },
    { label: 'Properties', icon: <MoreHorizontal size={13} />, tone: 'edit', onClick: () => { setDialogPayload(menu.bodyId); setActiveDialog('body-properties'); onClose(); } },
    { separator: true, label: '', onClick: () => {} },
    { kind: 'heading', label: 'Export', onClick: () => {} },
    { label: 'Save As STL', icon: <Download size={13} />, tone: 'create', onClick: () => { triggerBodyExport(menu.bodyId, 'stl'); onClose(); } },
    { label: 'Save As GLB', icon: <Download size={13} />, tone: 'create', onClick: () => { triggerBodyExport(menu.bodyId, 'glb'); onClose(); } },
    { separator: true, label: '', onClick: () => {} },
    { kind: 'heading', label: 'Edit', onClick: () => {} },
    { label: 'Copy', shortcut: 'Ctrl+C', icon: <Copy size={13} />, tone: 'edit', onClick: () => {
        const newId = copyBody(menu.bodyId);
        if (newId) setStatusMessage(`Copied ${bodyName}`);
        onClose();
      } },
    { label: 'Cut', shortcut: 'Ctrl+X', icon: <Scissors size={13} />, tone: 'edit', onClick: () => {
        setClipboardBody(menu.bodyId);
        removeBody(menu.bodyId);
        setStatusMessage(`Cut ${bodyName} — use Paste to place it`);
        onClose();
      } },
    { label: 'Paste', shortcut: 'Ctrl+V', icon: <Copy size={13} />, tone: 'edit', onClick: () => {
        const newId = pasteBody();
        if (newId) setStatusMessage('Pasted body');
        onClose();
      }, disabled: !clipboardBodyId },
    {
      label: 'Rename',
      icon: <MoreHorizontal size={13} />,
      tone: 'edit',
      onClick: () => { onClose(); onStartRename(); },
    },
    { separator: true, label: '', onClick: () => {} },
    { kind: 'heading', label: 'Danger', onClick: () => {} },
    {
      label: 'Delete',
      shortcut: 'Del',
      icon: <Trash2 size={13} />,
      danger: true,
      tone: 'danger',
      onClick: () => {
        // Remove the full feature chain (extrude + downstream fillets/chamfers)
        // then ensure the component-store body is gone too.
        for (const featureId of collectBodyFeatureChain()) removeFeature(featureId);
        removeBody(menu.bodyId); // no-op if removeFeature already cleaned it up
        setStatusMessage(`Deleted ${bodyName}`);
        onClose();
      },
    },
    { separator: true, label: '', onClick: () => {} },
    { kind: 'heading', label: 'Visibility', onClick: () => {} },
    { label: 'Display Detail Control', icon: <Settings size={13} />, tone: 'display', onClick: () => { setDialogPayload(menu.bodyId); setActiveDialog('display-detail'); onClose(); } },
    { label: 'Show/Hide', shortcut: 'V', icon: <Eye size={13} />, tone: 'display', onClick: () => { toggleVisibility(menu.bodyId); onClose(); } },
    { label: 'Isolate', icon: <ScanEye size={13} />, tone: 'locate', onClick: () => { isolateBody(menu.bodyId); setStatusMessage(`Isolated: ${bodyName}`); onClose(); } },
    { label: 'Show All Bodies', icon: <Eye size={13} />, tone: 'display', onClick: () => { showAllBodies(); setStatusMessage('All bodies visible'); onClose(); } },
    // CTX-9: Selectable toggle — label reflects current state
    {
      label: isSelectable ? 'Make Unselectable' : 'Make Selectable',
      type: 'selectable',
      icon: <MousePointer2 size={13} />,
      tone: 'display',
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
      tone: 'display',
      onClick: () => setOpacityOpen((prev) => !prev),
    },
    { separator: true, label: '', onClick: () => {} },
    { kind: 'heading', label: 'Find', onClick: () => {} },
    { label: 'Find in Window', icon: <Search size={13} />, tone: 'locate', onClick: handleFindInWindow },
  ];

  return (
    <ContextMenuShell x={menu.x} y={menu.y} onClose={onClose}>
      <div className="sketch-ctx-title">
        <span className="sketch-ctx-title-icon sketch-ctx-title-icon-body"><Box size={14} /></span>
        <span className="sketch-ctx-title-copy">
          <span className="sketch-ctx-title-name">{bodyName}</span>
          <span className="sketch-ctx-title-kind">Body</span>
        </span>
      </div>
      {items.map((item, i) => {
        if (item.kind === 'heading') {
          return <div key={i} className="sketch-ctx-heading">{item.label}</div>;
        }
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
                item.tone ? 'sketch-ctx-has-tone' : '',
                item.tone ? `sketch-ctx-tone-${item.tone}` : '',
                item.danger ? 'danger' : '',
                item.danger ? 'sketch-ctx-danger-zone' : '',
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
