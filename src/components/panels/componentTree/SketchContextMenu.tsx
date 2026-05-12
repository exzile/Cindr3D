import {
  FolderOpen, Layers, Copy, Scissors, Settings, Trash2, MoreHorizontal,
  Eye, EyeOff, Search, PenTool, ScanEye,
} from 'lucide-react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { ContextMenuShell } from '../../ui/ContextMenuShell';

export interface SketchCtxMenu {
  sketchId: string;
  sketchName: string;
  x: number;
  y: number;
}

export function SketchContextMenu({ menu, onClose }: { menu: SketchCtxMenu; onClose: () => void }) {
  const editSketch                = useCADStore((s) => s.editSketch);
  const copySketch                = useCADStore((s) => s.copySketch);
  const deleteSketch              = useCADStore((s) => s.deleteSketch);
  const setActiveDialog           = useCADStore((s) => s.setActiveDialog);
  const setDialogPayload          = useCADStore((s) => s.setDialogPayload);
  const setStatusMessage          = useCADStore((s) => s.setStatusMessage);
  const setCameraTargetQuaternion = useCADStore((s) => s.setCameraTargetQuaternion);
  const toggleFeatureVisibility   = useCADStore((s) => s.toggleFeatureVisibility);
  const features                  = useCADStore((s) => s.features);
  const sketches                  = useCADStore((s) => s.sketches);

  // CTX-11: global sketch display toggles (per-sketch state is a future enhancement)
  const showProfile               = useCADStore((s) => s.showSketchProfile);
  const setShowProfile            = useCADStore((s) => s.setShowSketchProfile);
  const showProjectedGeometries   = useCADStore((s) => s.showProjectedGeometries);
  const setShowProjectedGeometries = useCADStore((s) => s.setShowProjectedGeometries);
  const showConstructionGeometries = useCADStore((s) => s.showConstructionGeometries);
  const setShowConstructionGeometries = useCADStore((s) => s.setShowConstructionGeometries);

  // CTX-10: find the sketch feature to check visibility state
  const sketchFeature = features.find((f) => f.type === 'sketch' && f.sketchId === menu.sketchId);
  const isVisible     = sketchFeature?.visible !== false;

  const cs = (label: string) => () => { setStatusMessage(`${label} — coming soon`); onClose(); };

  const handleLookAt = () => {
    const sketch = sketches.find((s) => s.id === menu.sketchId);
    if (!sketch) { onClose(); return; }
    const normal = sketch.planeNormal.clone().normalize();
    const up = Math.abs(normal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const m = new THREE.Matrix4();
    m.lookAt(normal, new THREE.Vector3(0, 0, 0), up);
    setCameraTargetQuaternion(new THREE.Quaternion().setFromRotationMatrix(m));
    setStatusMessage(`Look At: ${menu.sketchName}`);
    onClose();
  };

  const handleToggleVisibility = () => {
    if (sketchFeature) {
      toggleFeatureVisibility(sketchFeature.id);
      setStatusMessage(`${menu.sketchName}: ${isVisible ? 'hidden' : 'shown'}`);
    }
    onClose();
  };

  const items: Array<{ label: string; shortcut?: string; icon?: React.ReactNode; danger?: boolean; separator?: boolean; onClick: () => void }> = [
    { label: 'Move to Group', icon: <FolderOpen size={13} />, onClick: cs('Move to Group') },
    { label: 'Create Selection Set', icon: <Layers size={13} />, onClick: cs('Create Selection Set') },
    { label: 'Offset Plane', icon: <Layers size={13} />, onClick: () => { setActiveDialog('construction-plane'); onClose(); } },
    { separator: true, label: '', onClick: () => {} },
    { label: 'Edit Sketch', icon: <PenTool size={13} />, onClick: () => { editSketch(menu.sketchId); onClose(); } },
    { label: 'Copy Sketch', icon: <Copy size={13} />, onClick: () => { copySketch(menu.sketchId); onClose(); } },
    { label: 'Redefine Sketch Plane', icon: <PenTool size={13} />, onClick: () => { setActiveDialog('redefine-sketch-plane'); onClose(); } },
    { label: 'Slice Sketch', icon: <Scissors size={13} />, onClick: cs('Slice Sketch') },
    { label: 'Configure', icon: <Settings size={13} />, onClick: cs('Configure') },
    { separator: true, label: '', onClick: () => {} },
    { label: 'Delete', shortcut: 'Del', icon: <Trash2 size={13} />, danger: true, onClick: () => { deleteSketch(menu.sketchId); onClose(); } },
    { label: 'Rename', icon: <MoreHorizontal size={13} />, onClick: () => { setDialogPayload(menu.sketchId); setActiveDialog('rename-sketch'); onClose(); } },
    { separator: true, label: '', onClick: () => {} },
    { label: 'Look At', icon: <ScanEye size={13} />, onClick: handleLookAt },
    // CTX-10: Show/Hide sketch visibility — toggles the sketch feature's visible flag
    {
      label: isVisible ? 'Hide' : 'Show',
      shortcut: 'V',
      icon: isVisible ? <EyeOff size={13} /> : <Eye size={13} />,
      onClick: handleToggleVisibility,
    },
    // CTX-11: Per-context display toggles (currently global — per-sketch is a future enhancement)
    {
      label: showProfile ? 'Hide Profile' : 'Show Profile',
      icon: showProfile ? <EyeOff size={13} /> : <Eye size={13} />,
      onClick: () => { setShowProfile(!showProfile); onClose(); },
    },
    {
      label: showProjectedGeometries ? 'Hide Projected Geometries' : 'Show Projected Geometries',
      icon: showProjectedGeometries ? <EyeOff size={13} /> : <Eye size={13} />,
      onClick: () => { setShowProjectedGeometries(!showProjectedGeometries); onClose(); },
    },
    {
      label: showConstructionGeometries ? 'Hide Construction Geometries' : 'Show Construction Geometries',
      icon: showConstructionGeometries ? <EyeOff size={13} /> : <Eye size={13} />,
      onClick: () => { setShowConstructionGeometries(!showConstructionGeometries); onClose(); },
    },
    { separator: true, label: '', onClick: () => {} },
    { label: 'Find in Window', icon: <Search size={13} />, onClick: cs('Find in Window') },
    { label: 'Find in Timeline', icon: <Search size={13} />, onClick: cs('Find in Timeline') },
  ];

  return (
    <ContextMenuShell x={menu.x} y={menu.y} onClose={onClose}>
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
    </ContextMenuShell>
  );
}
