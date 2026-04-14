import {
  Eye, EyeOff, Trash2, PenTool, ArrowUpFromLine,
  RotateCcw, Blend, FileBox, ChevronDown
} from 'lucide-react';
import { useCADStore } from '../store/cadStore';
import type { Feature } from '../types/cad';

function FeatureIcon({ type }: { type: Feature['type'] }) {
  switch (type) {
    case 'sketch': return <PenTool size={14} />;
    case 'extrude': return <ArrowUpFromLine size={14} />;
    case 'revolve': return <RotateCcw size={14} />;
    case 'fillet': return <Blend size={14} />;
    case 'chamfer': return <ChevronDown size={14} />;
    case 'import': return <FileBox size={14} />;
    default: return <FileBox size={14} />;
  }
}

function FeatureItem({ feature }: { feature: Feature }) {
  const toggleVisibility = useCADStore((s) => s.toggleFeatureVisibility);
  const removeFeature = useCADStore((s) => s.removeFeature);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);
  const setSelectedFeatureId = useCADStore((s) => s.setSelectedFeatureId);

  const isSelected = selectedFeatureId === feature.id;

  return (
    <div
      className={`timeline-item ${isSelected ? 'selected' : ''}`}
      onClick={() => setSelectedFeatureId(isSelected ? null : feature.id)}
    >
      <div className="timeline-item-icon">
        <FeatureIcon type={feature.type} />
      </div>
      <div className="timeline-item-info">
        <span className="timeline-item-name">{feature.name}</span>
        <span className="timeline-item-type">{feature.type}</span>
      </div>
      <div className="timeline-item-actions">
        <button
          className="timeline-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            toggleVisibility(feature.id);
          }}
          title={feature.visible ? 'Hide' : 'Show'}
        >
          {feature.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          className="timeline-action-btn danger"
          onClick={(e) => {
            e.stopPropagation();
            removeFeature(feature.id);
          }}
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export default function Timeline() {
  const features = useCADStore((s) => s.features);

  return (
    <div className="timeline-panel">
      <div className="timeline-header">
        <h3>Timeline</h3>
        <span className="feature-count">{features.length} features</span>
      </div>
      <div className="timeline-list">
        {features.length === 0 ? (
          <div className="timeline-empty">
            <p>No features yet</p>
            <p className="timeline-hint">Start by creating a sketch</p>
          </div>
        ) : (
          features.map((feature) => (
            <FeatureItem key={feature.id} feature={feature} />
          ))
        )}
      </div>
    </div>
  );
}
