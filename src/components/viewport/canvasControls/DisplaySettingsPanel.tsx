import { useCADStore } from '../../../store/cadStore';

export default function DisplaySettingsPanel({ onClose: _onClose }: { onClose: () => void }) {
  const visualStyle = useCADStore((s) => s.visualStyle);
  const setVisualStyle = useCADStore((s) => s.setVisualStyle);
  const showEnvironment = useCADStore((s) => s.showEnvironment);
  const setShowEnvironment = useCADStore((s) => s.setShowEnvironment);
  const showShadows = useCADStore((s) => s.showShadows);
  const setShowShadows = useCADStore((s) => s.setShowShadows);
  const showReflections = useCADStore((s) => s.showReflections);
  const setShowReflections = useCADStore((s) => s.setShowReflections);
  const showGroundPlane = useCADStore((s) => s.showGroundPlane);
  const setShowGroundPlane = useCADStore((s) => s.setShowGroundPlane);

  const styles: { value: typeof visualStyle; label: string }[] = [
    { value: 'shaded', label: 'Shaded' },
    { value: 'shadedEdges', label: 'Shaded with Edges' },
    { value: 'wireframe', label: 'Wireframe' },
    { value: 'hiddenLines', label: 'Hidden Lines' },
  ];

  return (
    <div className="cc-panel">
      <div className="cc-panel-title">Display Settings</div>

      <div className="cc-panel-section">
        <div className="cc-panel-section-title">Visual Style</div>
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

      <div className="cc-panel-divider" />

      <div className="cc-panel-section">
        <div className="cc-panel-section-title">Environment</div>
        <label className="cc-panel-check">
          <input
            type="checkbox"
            checked={showEnvironment}
            onChange={(e) => setShowEnvironment(e.target.checked)}
          />
          <span>Show Environment</span>
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
      </div>
    </div>
  );
}
