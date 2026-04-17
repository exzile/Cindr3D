import { createPortal } from 'react-dom';
import {
  Move, FolderOpen, Box, Layers, Settings, Link2, CircleDot,
  Download, Copy, Scissors, Trash2, MoreHorizontal, Eye, EyeOff,
  Search, MousePointer2,
} from 'lucide-react';
import { useComponentStore } from '../../../store/componentStore';
import { useCADStore } from '../../../store/cadStore';

export interface BodyCtxMenu {
  bodyId: string;
  x: number;
  y: number;
}

export function BodyContextMenu({
  menu,
  bodyName,
  onClose,
  onOpenMaterial,
}: {
  menu: BodyCtxMenu;
  bodyName: string;
  onClose: () => void;
  onOpenMaterial: () => void;
}) {
  const removeBody = useComponentStore((s) => s.removeBody);
  const renameBody = useComponentStore((s) => s.renameBody);
  const toggleVisibility = useComponentStore((s) => s.toggleBodyVisibility);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);

  const cs = (label: string) => () => {
    setStatusMessage(`${label} — coming soon`);
    onClose();
  };

  const items: Array<{ label: string; shortcut?: string; icon?: React.ReactNode; danger?: boolean; separator?: boolean; onClick: () => void }> = [
    { label: 'Move/Copy', shortcut: 'M', icon: <Move size={13} />, onClick: cs('Move/Copy') },
    { label: 'Move to Group', icon: <FolderOpen size={13} />, onClick: cs('Move to Group') },
    { separator: true, label: 'Create Components from Bodies', icon: <Box size={13} />, onClick: cs('Create Components from Bodies') },
    { label: 'Create Selection Set', icon: <Layers size={13} />, onClick: cs('Create Selection Set') },
    { separator: true, label: 'Configure', icon: <Settings size={13} />, onClick: cs('Configure') },
    { label: 'Enable Contact Sets', icon: <Link2 size={13} />, onClick: cs('Enable Contact Sets') },
    { separator: true, label: 'Physical Material', icon: <CircleDot size={13} />, onClick: () => { onOpenMaterial(); onClose(); } },
    { label: 'Appearance', shortcut: 'A', icon: <CircleDot size={13} />, onClick: () => { setActiveDialog('appearance'); onClose(); } },
    { label: 'Texture Map Controls', icon: <Settings size={13} />, onClick: cs('Texture Map Controls') },
    { label: 'Properties', icon: <MoreHorizontal size={13} />, onClick: cs('Properties') },
    { separator: true, label: 'Save As Mesh', icon: <Download size={13} />, onClick: cs('Save As Mesh') },
    { label: 'Copy', shortcut: 'Ctrl+C', icon: <Copy size={13} />, onClick: cs('Copy') },
    { label: 'Cut', shortcut: 'Ctrl+X', icon: <Scissors size={13} />, onClick: cs('Cut') },
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
    { label: 'Remove', icon: <Trash2 size={13} />, onClick: cs('Remove') },
    {
      label: 'Rename',
      icon: <MoreHorizontal size={13} />,
      onClick: () => {
        const name = window.prompt('Rename body', bodyName);
        if (name && name.trim()) {
          renameBody(menu.bodyId, name.trim());
          setStatusMessage(`Body renamed to "${name.trim()}"`);
        }
        onClose();
      },
    },
    { separator: true, label: 'Display Detail Control', icon: <Settings size={13} />, onClick: cs('Display Detail Control') },
    { label: 'Show/Hide', shortcut: 'V', icon: <Eye size={13} />, onClick: () => { toggleVisibility(menu.bodyId); onClose(); } },
    { label: 'Selectable/Unselectable', icon: <MousePointer2 size={13} />, onClick: cs('Selectable/Unselectable') },
    { label: 'Opacity Control', icon: <CircleDot size={13} />, onClick: cs('Opacity Control') },
    { label: 'Isolate', icon: <EyeOff size={13} />, onClick: cs('Isolate') },
    { separator: true, label: 'Find in Window', icon: <Search size={13} />, onClick: cs('Find in Window') },
  ];

  return createPortal(
    <>
      <div className="sketch-ctx-backdrop" onClick={onClose} />
      {/* top/left are dynamic (cursor position) — must stay inline */}
      <div className="sketch-ctx-menu" style={{ top: menu.y, left: menu.x }}>
        {items.map((item, i) =>
          item.separator ? (
            <div key={i} className="sketch-ctx-sep" />
          ) : (
            <button
              key={i}
              className={`sketch-ctx-item${item.danger ? ' danger' : ''}`}
              onClick={item.onClick}
            >
              <span className="sketch-ctx-icon">{item.icon}</span>
              <span className="sketch-ctx-label">{item.label}</span>
              {item.shortcut && <span className="sketch-ctx-shortcut">{item.shortcut}</span>}
            </button>
          )
        )}
      </div>
    </>,
    document.body,
  );
}
