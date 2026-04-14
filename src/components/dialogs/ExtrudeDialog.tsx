import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import type { Feature } from '../../types/cad';

export default function ExtrudeDialog() {
  const showExtrudeDialog = useCADStore((s) => s.showExtrudeDialog);
  const setShowExtrudeDialog = useCADStore((s) => s.setShowExtrudeDialog);
  const sketches = useCADStore((s) => s.sketches);
  const features = useCADStore((s) => s.features);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [distanceExpr, setDistanceExpr] = useState('10');
  const [selectedSketchId, setSelectedSketchId] = useState<string>('');
  const evaluateExpression = useCADStore((s) => s.evaluateExpression);
  const resolvedDistance = evaluateExpression(distanceExpr);
  const [direction, setDirection] = useState<'normal' | 'both'>('normal');
  const [operation, setOperation] = useState<'new' | 'join' | 'cut'>('new');

  if (!showExtrudeDialog) return null;

  // Get sketches that have entities
  const availableSketches = sketches.filter(s => s.entities.length > 0);

  const handleExtrude = () => {
    const sketchId = selectedSketchId || availableSketches[0]?.id;
    if (!sketchId) {
      setStatusMessage('No sketch selected');
      return;
    }

    const sketch = sketches.find(s => s.id === sketchId);
    if (!sketch) return;

    if (resolvedDistance === null || resolvedDistance <= 0) {
      setStatusMessage('Invalid distance expression');
      return;
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Extrude ${features.filter(f => f.type === 'extrude').length + 1}`,
      type: 'extrude',
      sketchId,
      params: {
        distance: direction === 'both' ? resolvedDistance / 2 : resolvedDistance,
        distanceExpr: distanceExpr,
        direction,
        operation,
      },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };

    addFeature(feature);
    setShowExtrudeDialog(false);
    setStatusMessage(`Extruded ${sketch.name} by ${resolvedDistance}mm`);
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>Extrude</h3>
          <button className="dialog-close" onClick={() => setShowExtrudeDialog(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="form-group">
            <label>Profile (Sketch)</label>
            <select
              value={selectedSketchId || availableSketches[0]?.id || ''}
              onChange={(e) => setSelectedSketchId(e.target.value)}
            >
              {availableSketches.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Distance</label>
            <div className="input-with-unit">
              <input
                type="text"
                value={distanceExpr}
                onChange={(e) => setDistanceExpr(e.target.value)}
                placeholder="e.g. 10 or height / 2"
                style={{ borderColor: resolvedDistance === null ? '#ef4444' : undefined }}
              />
              <span className="unit">mm</span>
            </div>
            {resolvedDistance !== null ? (
              <input
                type="range"
                value={resolvedDistance}
                onChange={(e) => setDistanceExpr(e.target.value)}
                min={0.1}
                max={200}
                step={0.5}
                className="distance-slider"
              />
            ) : (
              <div className="expr-error">
                <AlertCircle size={12} /> Invalid expression
              </div>
            )}
            {resolvedDistance !== null && distanceExpr !== String(resolvedDistance) && (
              <div className="expr-resolved">= {resolvedDistance} mm</div>
            )}
          </div>

          <div className="form-group">
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
              <option value="normal">One Direction</option>
              <option value="both">Symmetric</option>
            </select>
          </div>

          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as any)}>
              <option value="new">New Body</option>
              <option value="join">Join</option>
              <option value="cut">Cut</option>
            </select>
          </div>
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={() => setShowExtrudeDialog(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleExtrude}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
