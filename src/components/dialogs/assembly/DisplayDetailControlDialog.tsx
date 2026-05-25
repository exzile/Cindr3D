import { useState } from 'react';
import * as THREE from 'three';
import { DialogShell } from '../common/DialogShell';
import { useComponentStore } from '../../../store/componentStore';
import { useCADStore } from '../../../store/cadStore';
import { getOccSync } from '../../../engine/occ/loader';
import { globalBRepBodyRegistry } from '../../../engine/occ/globalRegistry';
import { tessellateWithInstance, tessellationToGeometry } from '../../../engine/occ/tessellate';
import { attachTessellationToMesh } from '../../../engine/occ/picking';

interface QualityPreset { label: string; deflection: number }
const PRESETS: QualityPreset[] = [
  { label: 'Ultra (0.01 mm)', deflection: 0.01 },
  { label: 'High (0.03 mm)',  deflection: 0.03 },
  { label: 'Normal (0.1 mm)', deflection: 0.1  },
  { label: 'Low (0.3 mm)',    deflection: 0.3  },
  { label: 'Draft (1.0 mm)',  deflection: 1.0  },
  { label: 'Custom',          deflection: -1   },
];

export function DisplayDetailControlDialog({
  onClose,
  bodyId,
}: {
  onClose: () => void;
  bodyId?: string;
}) {
  const selectedBodyId = useComponentStore((s) => s.selectedBodyId);
  const bodies = useComponentStore((s) => s.bodies);
  const setBodyMesh = useComponentStore((s) => s.setBodyMesh);
  const setBodyDeflectionOverride = useComponentStore((s) => s.setBodyDeflectionOverride);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const resolvedId = bodyId ?? selectedBodyId ?? '';
  const body = bodies[resolvedId];

  const currentDeflection = body?.deflectionOverride ?? 0.1;
  const [deflection, setDeflection] = useState(currentDeflection);
  const [custom, setCustom] = useState(
    !PRESETS.some((p) => p.deflection === currentDeflection && p.deflection !== -1),
  );
  const [applying, setApplying] = useState(false);

  if (!body) {
    return (
      <DialogShell title="Display Detail Control" onClose={onClose} cancelLabel="Close">
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #888)', padding: '8px 0' }}>
          No body selected.
        </div>
      </DialogShell>
    );
  }

  const brepBodyId =
    body.mesh instanceof THREE.Mesh
      ? (body.mesh.userData['brepBodyId'] as string | undefined)
      : undefined;

  const handlePreset = (p: QualityPreset) => {
    if (p.deflection === -1) {
      setCustom(true);
    } else {
      setCustom(false);
      setDeflection(p.deflection);
    }
  };

  const handleApply = () => {
    if (!brepBodyId) {
      setStatusMessage('Body has no OCC representation — detail control not available');
      return;
    }
    const occ = getOccSync();
    if (!occ) {
      setStatusMessage('OCC not loaded');
      return;
    }
    const brepBody = globalBRepBodyRegistry.get(brepBodyId);
    if (!brepBody) {
      setStatusMessage('BRep body not found in registry');
      return;
    }

    setApplying(true);
    try {
      const tess = tessellateWithInstance(occ.oc, brepBody, {
        linearDeflection: deflection,
        useCache: false,
      });
      // Dispose old geometry before replacing to prevent GPU memory leak
      if (body.mesh instanceof THREE.Mesh) {
        body.mesh.geometry.dispose();
      }
      const geo = tessellationToGeometry(tess);
      // Narrow material — meshes can have Material | Material[]
      const srcMat = body.mesh instanceof THREE.Mesh ? body.mesh.material : null;
      const mat = Array.isArray(srcMat) ? srcMat[0] : (srcMat ?? new THREE.MeshStandardMaterial());
      const newMesh = new THREE.Mesh(geo, mat);
      newMesh.userData = { ...(body.mesh as THREE.Mesh)?.userData };
      attachTessellationToMesh(newMesh, tess, brepBodyId);
      setBodyMesh(resolvedId, newMesh);
      setBodyDeflectionOverride(resolvedId, deflection);
      setStatusMessage(`Detail updated: ${deflection} mm deflection`);
      onClose();
    } catch (e) {
      setStatusMessage('Re-tessellation failed');
    } finally {
      setApplying(false);
    }
  };

  const handleReset = () => {
    setDeflection(0.1);
    setCustom(false);
    setBodyDeflectionOverride(resolvedId, undefined);
    setStatusMessage('Reset to global default (0.1 mm)');
  };

  return (
    <DialogShell
      title="Display Detail Control"
      onClose={onClose}
      cancelLabel="Cancel"
      confirmLabel={applying ? 'Applying…' : 'Apply'}
      onConfirm={handleApply}
    >
      <div className="dialog-label" style={{ marginBottom: 6 }}>
        Quality preset — <span style={{ color: 'var(--color-text-secondary, #aaa)' }}>{body.name}</span>
      </div>

      <div className="dialog-field" style={{ flexDirection: 'column', gap: 4 }}>
        {PRESETS.map((p) => {
          const isActive = p.deflection === -1 ? custom : (!custom && deflection === p.deflection);
          return (
            <label
              key={p.label}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="deflection-preset"
                checked={isActive}
                onChange={() => handlePreset(p)}
              />
              {p.label}
            </label>
          );
        })}
      </div>

      {custom && (
        <div className="dialog-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <label className="dialog-label" style={{ whiteSpace: 'nowrap' }}>Deflection (mm)</label>
          <input
            className="dialog-input"
            type="number"
            min={0.001}
            max={5}
            step={0.01}
            value={deflection}
            style={{ width: 80 }}
            onChange={(e) => setDeflection(Math.max(0.001, parseFloat(e.target.value) || 0.1))}
          />
        </div>
      )}

      {!brepBodyId && (
        <div style={{ fontSize: 11, color: 'var(--color-accent-error, #ef4444)', marginTop: 6 }}>
          No OCC shape — re-tessellation unavailable for this body.
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <button className="btn btn-secondary" onClick={handleReset} style={{ fontSize: 11 }}>
          Reset to Default
        </button>
      </div>
    </DialogShell>
  );
}
