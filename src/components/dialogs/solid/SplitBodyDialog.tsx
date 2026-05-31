import { useState } from 'react';
import type * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import { liveBodyMeshes } from '../../../store/meshRegistry';

export function SplitBodyDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitSplitBody = useCADStore((s) => s.commitSplitBody);

  // Exclude sketch and construction geometry — only solid/surface features
  // can be split.
  const solidFeatures = features.filter(
    (f) =>
      f.type !== 'sketch' &&
      f.type !== 'construction-plane' &&
      f.type !== 'construction-axis',
  );

  const [bodyFeatureId, setBodyFeatureId] = useState(solidFeatures[0]?.id ?? '');
  const [toolType, setToolType] = useState<'plane' | 'sketch' | 'face'>('plane');
  const [toolId, setToolId] = useState('XY');
  const [planeOffset, setPlaneOffset] = useState(0);
  const [isSplittingToolExtended, setIsSplittingToolExtended] = useState(true);

  // For face/body tool mode — pick a second body from the feature list.
  // The OCC brepBodyId is resolved from the mesh's userData at commit time.
  const [splitToolFeatureId, setSplitToolFeatureId] = useState<string>('');

  // Candidate splitting bodies = all solid features except the one being split.
  const toolBodyCandidates = solidFeatures.filter((f) => f.id !== bodyFeatureId);

  /**
   * Resolve the OCC brepBodyId for a feature by walking liveBodyMeshes.
   * Returns null if the feature has no registered OCC body yet.
   */
  function resolveOccBodyId(featureId: string): string | null {
    // Check feature's own mesh first.
    const feat = features.find((f) => f.id === featureId);
    const ownMesh = feat?.mesh as (THREE.Mesh & { userData?: Record<string, unknown> }) | undefined;
    if (ownMesh?.userData?.brepBodyId) return ownMesh.userData.brepBodyId as string;
    // Fall back to live mesh registry.
    for (const [, m] of liveBodyMeshes) {
      const mesh = m as THREE.Mesh & { userData?: Record<string, unknown> };
      if (mesh.userData?.featureId === featureId && mesh.userData?.brepBodyId) {
        return mesh.userData.brepBodyId as string;
      }
    }
    return null;
  }

  const handleApply = () => {
    if (!bodyFeatureId) return;

    if (toolType === 'face') {
      const splitToolOccBodyId = splitToolFeatureId
        ? resolveOccBodyId(splitToolFeatureId)
        : null;
      commitSplitBody({
        bodyFeatureId,
        toolType,
        toolId: splitToolFeatureId,
        isSplittingToolExtended,
        splitToolOccBodyId: splitToolOccBodyId ?? null,
        splitToolOccFaceId: null,
        splitToolFeatureId: splitToolFeatureId || null,
      });
    } else {
      commitSplitBody({
        bodyFeatureId,
        toolType,
        toolId,
        isSplittingToolExtended,
        planeOffset,
      });
    }
    onClose();
  };

  return (
    <DialogShell title="Split Body" onClose={onClose} size="sm" onConfirm={handleApply}>
      <div className="form-group">
        <label>Body to Split</label>
        <select value={bodyFeatureId} onChange={(e) => setBodyFeatureId(e.target.value)}>
          {solidFeatures.length === 0
            ? <option value="">— no bodies —</option>
            : solidFeatures.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)
          }
        </select>
      </div>

      <div className="form-group">
        <label>Splitting Tool Type</label>
        <select value={toolType} onChange={(e) => setToolType(e.target.value as 'plane' | 'sketch' | 'face')}>
          <option value="plane">Plane</option>
          <option value="face">Body / Face</option>
          <option value="sketch">Sketch (not yet supported)</option>
        </select>
      </div>

      {toolType === 'plane' && (
        <>
          <div className="form-group">
            <label>Plane</label>
            <select value={toolId} onChange={(e) => setToolId(e.target.value)}>
              <option value="XY">XY</option>
              <option value="XZ">XZ</option>
              <option value="YZ">YZ</option>
            </select>
          </div>
          <div className="form-group">
            <label>Plane Offset</label>
            <input
              type="number"
              step={0.5}
              value={planeOffset}
              onChange={(e) => setPlaneOffset(parseFloat(e.target.value) || 0)}
            />
          </div>
        </>
      )}

      {toolType === 'face' && (
        <div className="form-group">
          <label>Splitting Body</label>
          {toolBodyCandidates.length === 0 ? (
            <p className="form-hint" style={{ color: 'var(--color-warn, #f5a623)', fontSize: '0.85em', margin: 0 }}>
              No other bodies available. Create a second solid to use as the splitting tool.
            </p>
          ) : (
            <select value={splitToolFeatureId} onChange={(e) => setSplitToolFeatureId(e.target.value)}>
              <option value="">— pick a body —</option>
              {toolBodyCandidates.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
          <p className="form-hint" style={{ fontSize: '0.8em', color: 'var(--color-text-muted, #888)', margin: '4px 0 0' }}>
            Uses BRepAlgoAPI_Splitter — can produce N pieces where the tool body intersects the target.
          </p>
        </div>
      )}

      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          id="splitExtended"
          type="checkbox"
          checked={isSplittingToolExtended}
          onChange={(e) => setIsSplittingToolExtended(e.target.checked)}
        />
        <label htmlFor="splitExtended" style={{ margin: 0 }}>Extend splitting tool</label>
      </div>
    </DialogShell>
  );
}
