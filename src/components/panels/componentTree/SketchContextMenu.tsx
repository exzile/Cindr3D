import { createPortal } from 'react-dom';
import {
  FolderOpen, Layers, Copy, Scissors, Settings, Trash2, MoreHorizontal,
  Eye, EyeOff, Search, PenTool, ScanEye,
} from 'lucide-react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';

export interface SketchCtxMenu {
  sketchId: string;
  sketchName: string;
  x: number;
  y: number;
}

export function SketchContextMenu({ menu, onClose }: { menu: SketchCtxMenu; onClose: () => void }) {
  const editSketch = useCADStore((s) => s.editSketch);
  const copySketch = useCADStore((s) => s.copySketch);
  const deleteSketch = useCADStore((s) => s.deleteSketch);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const setDialogPayload = useCADStore((s) => s.setDialogPayload);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const setCameraTargetQuaternion = useCADStore((s) => s.setCameraTargetQuaternion);
  const sketches = useCADStore((s) => s.sketches);

  const cs = (label: string) => () => { setStatusMessage(`${label} — coming soon`); onClose(); };

  const handleLookAt = () => {
    const sketch = sketches.find((s) => s.id === menu.sketchId);
    if (!sketch) { onClose(); return; }
    // Orient camera to look along the sketch's plane normal (from outside)
    const normal = sketch.planeNormal.clone().normalize();
    // Build a look-at quaternion: camera sitting at normal * distance, looking at origin
    const up = Math.abs(normal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const m = new THREE.Matrix4();
    m.lookAt(normal, new THREE.Vector3(0, 0, 0), up);
    setCameraTargetQuaternion(new THREE.Quaternion().setFromRotationMatrix(m));
    setStatusMessage(`Look At: ${sketch.name}`);
    onClose();
  };

  const items: Array<{ label: string; shortcut?: string; icon?: React.ReactNode; danger?: boolean; separator?: boolean; onClick: () => void }> = [
    { label: 'Move to Group', icon: <FolderOpen size={13} />, onClick: cs('Move to Group') },
    { label: 'Create Selection Set', icon: <Layers size={13} />, onClick: cs('Create Selection Set') },
    { label: 'Offset Plane', icon: <Layers size={13} />, onClick: () => { setActiveDialog('construction-plane'); onClose(); } },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Edit Sketch', icon: <PenTool size={13} />, onClick: () => { editSketch(menu.sketchId); onClose(); } },
    { label: 'Copy Sketch', icon: <Copy size={13} />, onClick: () => { copySketch(menu.sketchId); onClose(); } },
    { label: 'Redefine Sketch Plane', icon: <PenTool size={13} />, onClick: () => { setActiveDialog('redefine-sketch-plane'); onClose(); } },
    { label: 'Slice Sketch', icon: <Scissors size={13} />, onClick: cs('Slice Sketch') },
    { label: 'Configure', icon: <Settings size={13} />, onClick: cs('Configure') },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Delete', shortcut: 'Del', icon: <Trash2 size={13} />, danger: true, onClick: () => { deleteSketch(menu.sketchId); onClose(); } },
    { label: 'Rename', icon: <MoreHorizontal size={13} />, onClick: () => { setDialogPayload(menu.sketchId); setActiveDialog('rename-sketch'); onClose(); } },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Look At', icon: <ScanEye size={13} />, onClick: handleLookAt },
    { label: 'Hide Profile', icon: <EyeOff size={13} />, onClick: cs('Hide Profile') },
    { label: 'Show Dimension', icon: <Eye size={13} />, onClick: cs('Show Dimension') },
    { label: 'Hide Projected Geometries', icon: <EyeOff size={13} />, onClick: cs('Hide Projected Geometries') },
    { label: 'Hide Construction Geometries', icon: <EyeOff size={13} />, onClick: cs('Hide Construction Geometries') },
    { label: 'Show/Hide', shortcut: 'V', icon: <Eye size={13} />, onClick: cs('Show/Hide') },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Find in Window', icon: <Search size={13} />, onClick: cs('Find in Window') },
    { label: 'Find in Timeline', icon: <Search size={13} />, onClick: cs('Find in Timeline') },
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
    document.body
  );
}
