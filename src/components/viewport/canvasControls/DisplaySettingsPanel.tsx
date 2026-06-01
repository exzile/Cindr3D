import { useCADStore } from '../../../store/cadStore';

export default function DisplaySettingsPanel({ onClose }: { onClose: () => void }) {
  void onClose; // available for future use (e.g. close-on-apply)
  const visualStyle = useCADStore((s) => s.visualStyle);
  const setVisualStyle = useCADStore((s) => s.setVisualStyle);
  const showShadows = useCADStore((s) => s.showShadows);
  const setShowShadows = useCADStore((s) => s.setShowShadows);
  const showReflections = useCADStore((s) => s.showReflections);
  const setShowReflections = useCADStore((s) => s.setShowReflections);
  const showGroundPlane = useCADStore((s) => s.showGroundPlane);
  const setShowGroundPlane = useCADStore((s) => s.setShowGroundPlane);
  const environmentPreset = useCADStore((s) => s.environmentPreset);
  const setEnvironmentPreset = useCADStore((s) => s.setEnvironmentPreset);
  const cameraProjection = useCADStore((s) => s.cameraProjection);
  const setCameraProjection = useCADStore((s) => s.setCameraProjection);
  const groundPlaneOffset = useCADStore((s) => s.groundPlaneOffset);
  const setGroundPlaneOffset = useCADStore((s) => s.setGroundPlaneOffset);
  const shadowSoftness = useCADStore((s) => s.shadowSoftness);
  const setShadowSoftness = useCADStore((s) => s.setShadowSoftness);
  const ambientOcclusionEnabled = useCADStore((s) => s.ambientOcclusionEnabled);
  const setAmbientOcclusionEnabled = useCADStore((s) => s.setAmbientOcclusionEnabled);
  const entityVisSketchBodies = useCADStore((s) => s.entityVisSketchBodies);
  const setEntityVisSketchBodies = useCADStore((s) => s.setEntityVisSketchBodies);
  const entityVisConstruction = useCADStore((s) => s.entityVisConstruction);
  const setEntityVisConstruction = useCADStore((s) => s.setEntityVisConstruction);
  const entityVisOrigins = useCADStore((s) => s.entityVisOrigins);
  const setEntityVisOrigins = useCADStore((s) => s.setEntityVisOrigins);
  const entityVisJoints = useCADStore((s) => s.entityVisJoints);
  const setEntityVisJoints = useCADStore((s) => s.setEntityVisJoints);

  const styles: { value: typeof visualStyle; label: string }[] = [
    { value: 'shaded', label: 'Shaded' },
    { value: 'shadedEdges', label: 'Shaded with Edges' },
    { value: 'wireframe', label: 'Wireframe' },
    { value: 'hiddenLines', label: 'Hidden Lines' },
  ];

  return (
    <div className="cc-panel cc-panel--display">
      <div className="cc-panel-title">Display Settings</div>

      <div className="cc-panel-section">
        <div className="cc-panel-section-title">Camera</div>
        <div className="cc-panel-option-grid cc-panel-option-grid--two">
          <button
            className={`cc-panel-option ${cameraProjection === 'perspective' ? 'active' : ''}`}
            onClick={() => setCameraProjection('perspective')}
          >Perspective</button>
          <button
            className={`cc-panel-option ${cameraProjection === 'orthographic' ? 'active' : ''}`}
            onClick={() => setCameraProjection('orthographic')}
          >Orthographic</button>
        </div>
      </div>
      <div className="cc-panel-divider" />

      <div className="cc-panel-section">
        <div className="cc-panel-section-title">Visual Style</div>
        <div className="cc-panel-option-grid">
          {styles.map((s) => (
            <button
              key={s.value}
              className={`cc-panel-option ${visualStyle === s.value ? 'active' : ''}`}
              onClick={() => setVisualStyle(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cc-panel-divider" />

      <div className="cc-panel-section">
        <div className="cc-panel-section-title">Environment</div>
        <label className="cc-panel-check">
          <input
            type="checkbox"
            checked={showReflections}
            onChange={(e) => setShowReflections(e.target.checked)}
          />
          <span>Reflections (IBL)</span>
        </label>
        {showReflections && (
          <div className="cc-panel-row">
            <span className="cc-panel-label">Preset</span>
            <select
              className="cc-panel-select"
              value={environmentPreset}
              onChange={(e) => setEnvironmentPreset(e.target.value)}
            >
              {['apartment','city','dawn','forest','lobby','night','park','studio','sunset','warehouse']
                .map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="cc-panel-divider" />

      {/* NAV-23: Object Visibility per entity type */}
      <div className="cc-panel-section">
        <div className="cc-panel-section-title">Object Visibility</div>
        <label className="cc-panel-check">
          <input type="checkbox" checked={entityVisSketchBodies}
            onChange={(e) => setEntityVisSketchBodies(e.target.checked)} />
          <span>Sketches</span>
        </label>
        <label className="cc-panel-check">
          <input type="checkbox" checked={entityVisConstruction}
            onChange={(e) => setEntityVisConstruction(e.target.checked)} />
          <span>Construction Geometry</span>
        </label>
        <label className="cc-panel-check">
          <input type="checkbox" checked={entityVisOrigins}
            onChange={(e) => setEntityVisOrigins(e.target.checked)} />
          <span>Origins / Axes</span>
        </label>
        <label className="cc-panel-check">
          <input type="checkbox" checked={entityVisJoints}
            onChange={(e) => setEntityVisJoints(e.target.checked)} />
          <span>Joints</span>
        </label>
      </div>

      <div className="cc-panel-divider" />

      <div className="cc-panel-section">
        <div className="cc-panel-section-title">Effects</div>
        <label className="cc-panel-check">
          <input
            type="checkbox"
            checked={showShadows}
            onChange={(e) => setShowShadows(e.target.checked)}
          />
          <span>Shadows</span>
        </label>
        <label className="cc-panel-check">
          <input
            type="checkbox"
            checked={showReflections}
            onChange={(e) => setShowReflections(e.target.checked)}
          />
          <span>Reflections</span>
        </label>
        <label className="cc-panel-check">
          <input
            type="checkbox"
            checked={showGroundPlane}
            onChange={(e) => setShowGroundPlane(e.target.checked)}
          />
          <span>Ground Plane</span>
        </label>
        {/* NAV-21: Ambient Occlusion (SSAO) */}
        <label className="cc-panel-check">
          <input
            type="checkbox"
            checked={ambientOcclusionEnabled}
            onChange={(e) => setAmbientOcclusionEnabled(e.target.checked)}
          />
          <span>Ambient Occlusion</span>
        </label>
        {showGroundPlane && (
          <div className="cc-panel-row">
            <span className="cc-panel-label">GP Offset</span>
            <input
              className="cc-panel-number"
              type="number"
              step="0.1"
              value={groundPlaneOffset}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setGroundPlaneOffset(v); }}
            />
          </div>
        )}
        {showShadows && (
          <div className="cc-panel-row">
            <span className="cc-panel-label">Shadow Blur</span>
            <input
              className="cc-panel-range"
              type="range"
              min="0"
              max="10"
              step="0.5"
              value={shadowSoftness}
              onChange={(e) => setShadowSoftness(parseFloat(e.target.value))}
            />
            <span className="cc-panel-value">{shadowSoftness}</span>
          </div>
        )}
      </div>
    </div>
  );
}
