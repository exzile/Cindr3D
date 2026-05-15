import type { InspectTestContext } from './types';

interface PhotoGuidanceProps {
  context: InspectTestContext;
}

/**
 * Per-test photo-capture tips for the AI vision step. Dispatches on testType so
 * the host doesn't have to branch — every test that supports AI analysis gets
 * its own guidance panel here.
 */
export function PhotoGuidance({ context }: PhotoGuidanceProps) {
  if (context.testType === 'pressure-advance') {
    return <PressureAdvanceGuidance context={context} />;
  }
  if (context.testType === 'first-layer') {
    return <FirstLayerGuidance context={context} />;
  }
  return null;
}

function PressureAdvanceGuidance({ context }: { context: InspectTestContext }) {
  const pa = context.pressureAdvance;
  return (
    <section className="calib-step__panel calib-inspect__pa-guidance">
      <strong className="calib-inspect__section-title">Photo tips for best AI analysis</strong>
      <p className="calib-step__muted">
        Frame the printed tower so every band is visible top-to-bottom.
        Even, diffuse light from the side reveals corner bulge and gaps clearly.
      </p>
      <ul className="calib-inspect__tips">
        <li>Side-on view, perpendicular to the corner being judged.</li>
        <li>Fill the frame with the tower — avoid wide shots with bed clutter.</li>
        <li>Diffuse lighting (a piece of paper over a desk lamp works well) — no harsh hotspots.</li>
        <li>Two photos help: one of each of the two opposing corners.</li>
      </ul>
      {pa && (
        <div className="calib-inspect__pa-params">
          <span><strong>PA range:</strong> {pa.startValue.toFixed(3)} → {pa.endValue.toFixed(3)}</span>
          <span><strong>Bands:</strong> {pa.bandCount} (every {pa.stepSize} mm)</span>
          <span><strong>Z range:</strong> {pa.startZ}–{pa.endZ} mm</span>
        </div>
      )}
    </section>
  );
}

function FirstLayerGuidance({ context }: { context: InspectTestContext }) {
  const fl = context.firstLayer;
  return (
    <section className="calib-step__panel calib-inspect__pa-guidance">
      <strong className="calib-inspect__section-title">Photo tips for best AI analysis</strong>
      <p className="calib-step__muted">
        The first-layer test prints five small pads at known bed coordinates.
        Photograph each pad straight down so the AI can spot gaps, ridges, or elephant-foot.
      </p>
      <ul className="calib-inspect__tips">
        <li>Photograph each pad straight down — not at an angle.</li>
        <li>Even, diffuse light — avoid harsh shadows that hide line contact.</li>
        <li>Include a coin or ruler in one shot for scale (optional but helpful).</li>
        <li>Take separate top-down shots of each pad, or one wide overhead shot of all five.</li>
      </ul>
      {fl && (
        <div className="calib-inspect__pa-params">
          <span>
            <strong>Pads:</strong>{' '}
            {fl.pads.map((p) => `${p.label} (${p.x},${p.y})`).join(' · ')}
          </span>
          <span><strong>First-layer height:</strong> {fl.firstLayerHeightMm} mm</span>
          <span><strong>Line width:</strong> {fl.lineWidthMm.toFixed(2)} mm</span>
          <span><strong>Bed / nozzle:</strong> {fl.bedTempC}°C / {fl.nozzleTempC}°C</span>
          <span><strong>Material:</strong> {fl.materialName}</span>
        </div>
      )}
    </section>
  );
}
