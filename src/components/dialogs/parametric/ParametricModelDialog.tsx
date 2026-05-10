import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Box, Check, X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';
import { PARAMETRIC_MODELS, getDefaultParams } from '../../../parametric';
import type { ParametricModelDefinition, ParametricParameterDefinition, ParametricParameterValue } from '../../../parametric';
import '../common/ToolPanel.css';

function coerceValue(parameter: ParametricParameterDefinition, raw: string, previous: ParametricParameterValue): ParametricParameterValue {
  if (parameter.type === 'boolean') return raw === 'true';
  if (parameter.type === 'number') {
    const parsed = Number(raw);
    const fallback =
      typeof previous === 'number' && Number.isFinite(previous) ? previous :
      typeof parameter.defaultValue === 'number' && Number.isFinite(parameter.defaultValue) ? parameter.defaultValue :
      parameter.min ?? 0;
    const finite = Number.isFinite(parsed) ? parsed : fallback;
    const minClamped = parameter.min === undefined ? finite : Math.max(parameter.min, finite);
    return parameter.max === undefined ? minClamped : Math.min(parameter.max, minClamped);
  }
  return raw;
}

export function ParametricModelDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const [modelId, setModelId] = useState(PARAMETRIC_MODELS[0]?.id ?? '');
  const model = PARAMETRIC_MODELS.find((candidate) => candidate.id === modelId) ?? PARAMETRIC_MODELS[0];
  const [paramsByModel, setParamsByModel] = useState<Record<string, Record<string, ParametricParameterValue>>>(() =>
    Object.fromEntries(PARAMETRIC_MODELS.map((candidate) => [candidate.id, getDefaultParams(candidate)])),
  );
  const params = paramsByModel[model.id] ?? getDefaultParams(model);
  const [canPreview, setCanPreview] = useState(false);
  const builtMeshRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    let disposed = false;
    const prev = builtMeshRef.current;
    if (prev) {
      prev.geometry.dispose();
      if (prev.material instanceof THREE.Material) prev.material.dispose();
    }
    builtMeshRef.current = null;
    try {
      builtMeshRef.current = model.build(params);
      queueMicrotask(() => {
        if (!disposed) setCanPreview(true);
      });
    } catch {
      queueMicrotask(() => {
        if (!disposed) setCanPreview(false);
      });
    }
    return () => {
      disposed = true;
      const mesh = builtMeshRef.current;
      if (mesh) {
        mesh.geometry.dispose();
        if (mesh.material instanceof THREE.Material) mesh.material.dispose();
      }
      builtMeshRef.current = null;
    };
  }, [model, params]);

  const updateParam = (parameter: ParametricParameterDefinition, raw: string) => {
    setParamsByModel((current) => ({
      ...current,
      [model.id]: {
        ...(current[model.id] ?? getDefaultParams(model)),
        [parameter.key]: coerceValue(parameter, raw, (current[model.id] ?? getDefaultParams(model))[parameter.key]),
      },
    }));
  };

  const handleInsert = () => {
    const mesh = builtMeshRef.current;
    if (!mesh) return;
    builtMeshRef.current = null;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: model.name,
      type: 'primitive',
      params: {
        kind: 'parametric',
        parametricModelId: model.id,
        parametricModelName: model.name,
        parametricParameters: params,
      },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'solid',
    };
    addFeature(feature);
    setStatusMessage(`Inserted parametric model: ${model.name}`);
    onClose();
  };

  return (
    <div className="tool-panel-overlay">
      <div className="tool-panel" style={{ width: 340 }}>
        <div className="tp-header">
          <div className="tp-header-icon"><Box size={12} /></div>
          <span className="tp-header-title">Parametric Library</span>
          <button className="tp-close" onClick={onClose} title="Close"><X size={14} /></button>
        </div>
        <div className="tp-body">
          <div className="tp-section">
            <div className="tp-section-title">Model</div>
            <select className="tp-select" value={model.id} onChange={(event) => setModelId(event.target.value)}>
              {PARAMETRIC_MODELS.map((candidate: ParametricModelDefinition) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
            <p className="dialog-hint">{model.description}</p>
          </div>

          <div className="tp-section">
            <div className="tp-section-title">Parameters</div>
            {model.parameters.map((parameter) => (
              <div key={parameter.key} className="tp-row">
                <span className="tp-label">{parameter.label}</span>
                {parameter.type === 'select' ? (
                  <select className="tp-select" value={String(params[parameter.key])} onChange={(event) => updateParam(parameter, event.target.value)}>
                    {(parameter.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : parameter.type === 'boolean' ? (
                  <input type="checkbox" checked={Boolean(params[parameter.key])} onChange={(event) => updateParam(parameter, String(event.target.checked))} />
                ) : (
                  <div className="tp-input-group">
                    <input
                      type="number"
                      value={Number(params[parameter.key])}
                      min={parameter.min}
                      max={parameter.max}
                      step={parameter.step ?? 1}
                      onChange={(event) => updateParam(parameter, event.target.value)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="tp-section">
            <div className="tp-section-title">Preview</div>
            <div style={{ fontSize: 11, color: '#aaa', padding: '0 2px' }}>
              {canPreview ? `${model.name} geometry ready` : 'Preview could not be generated'}
            </div>
          </div>
        </div>
        <div className="tp-actions">
          <button className="tp-btn tp-btn-cancel" onClick={onClose}><X size={13} /> Cancel</button>
          <button className="tp-btn tp-btn-ok" onClick={handleInsert} disabled={!canPreview}><Check size={13} /> Insert</button>
        </div>
      </div>
    </div>
  );
}
