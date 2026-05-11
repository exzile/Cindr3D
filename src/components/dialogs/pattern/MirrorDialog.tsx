import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { DialogShell } from '../common/DialogShell';
import type { Feature } from '../../../types/cad';

type MirrorType = 'features' | 'bodies' | 'components';
type ComputeType = 'optimized' | 'identical' | 'adjust';
type MirrorPlane = 'XY' | 'XZ' | 'YZ';

// D168 Mirror — features / bodies / components with compute-type option
export function MirrorDialog({ onClose }: { onClose: () => void }) {
  // D186: pre-fill from feature being edited
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [mirrorType, setMirrorType] = useState<MirrorType>((p.mirrorType as MirrorType) ?? 'features');
  const [mirrorPlane, setMirrorPlane] = useState<MirrorPlane>((p.mirrorPlane as MirrorPlane) ?? 'XY');
  const [computeType, setComputeType] = useState<ComputeType>((p.computeType as ComputeType) ?? 'optimized');
  const [selectedId, setSelectedId] = useState<string>(String(p.selectedId ?? ''));

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const commitMirrorFeature = useCADStore((s) => s.commitMirrorFeature);
  const bodies = useComponentStore((s) => s.bodies);
  const components = useComponentStore((s) => s.components);
  const mirrorBody = useComponentStore((s) => s.mirrorBody);
  const mirrorComponent = useComponentStore((s) => s.mirrorComponent);

  const bodyList = Object.values(bodies);
  const componentList = Object.values(components).filter((c) => c.parentId !== null);

  const handleApply = () => {
    // D168 body branch: actually reflect the body via mirrorMesh
    if (mirrorType === 'bodies' && selectedId) {
      const newId = mirrorBody(selectedId, mirrorPlane);
      if (newId) {
        setStatusMessage(`Mirrored body on ${mirrorPlane} plane`);
        onClose();
        return;
      }
    }

    // SLD17 features branch: mirror a feature's mesh geometry
    if (mirrorType === 'features' && selectedId) {
      commitMirrorFeature(selectedId, mirrorPlane);
      onClose();
      return;
    }

    // SLD17 components branch: mirror a component
    if (mirrorType === 'components' && selectedId) {
      const newId = mirrorComponent({ componentId: selectedId, mirrorPlane, createLinked: false });
      if (newId) {
        setStatusMessage(`Mirrored component on ${mirrorPlane} plane`);
        onClose();
        return;
      }
    }

    const params: Record<string, string | number | boolean | number[]> = {
      mirrorType, mirrorPlane, computeType, selectedId,
    };
    if (editing) {
      updateFeatureParams(editing.id, params);
      setStatusMessage(`Updated mirror (${mirrorType} / ${mirrorPlane})`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Mirror (${mirrorType}/${mirrorPlane})`,
        type: 'mirror',
        params,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created mirror on ${mirrorPlane} plane`);
    }
    onClose();
  };

  return (
    <DialogShell title={editing ? 'Edit Mirror' : 'Mirror'} onClose={onClose} size="sm" onConfirm={handleApply}>
      <div className="form-group">
        <label>Type</label>
        <select value={mirrorType} onChange={(e) => setMirrorType(e.target.value as MirrorType)}>
          <option value="features">Features</option>
          <option value="bodies">Bodies</option>
          <option value="components">Components</option>
        </select>
      </div>

      {mirrorType === 'features' && (
        <div className="form-group">
          <label>Feature</label>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">(pick all)</option>
            {features.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}
      {mirrorType === 'bodies' && (
        <div className="form-group">
          <label>Body</label>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">(select a body)</option>
            {bodyList.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}
      {mirrorType === 'components' && (
        <div className="form-group">
          <label>Component</label>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">(select a component)</option>
            {componentList.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="form-group">
        <label>Mirror Plane</label>
        <select value={mirrorPlane} onChange={(e) => setMirrorPlane(e.target.value as MirrorPlane)}>
          <option value="XY">XY Plane</option>
          <option value="XZ">XZ Plane</option>
          <option value="YZ">YZ Plane</option>
        </select>
      </div>
      <div className="form-group">
        <label>Compute Type</label>
        <select value={computeType} onChange={(e) => setComputeType(e.target.value as ComputeType)}>
          <option value="optimized">Optimized</option>
          <option value="identical">Identical</option>
          <option value="adjust">Adjust</option>
        </select>
      </div>
    </DialogShell>
  );
}
