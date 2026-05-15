import type { InspectTestContext, TowerContext } from './types';

interface PhotoGuidanceProps {
  context: InspectTestContext;
}

/**
 * Per-test photo-capture tips for the AI vision step. Dispatches on testType so
 * the host doesn't have to branch — every test that supports AI analysis gets
 * its own guidance panel here.
 */
export function PhotoGuidance({ context }: PhotoGuidanceProps) {
  switch (context.testType) {
    case 'pressure-advance':     return <PressureAdvanceGuidance context={context} />;
    case 'first-layer':          return <FirstLayerGuidance       context={context} />;
    case 'temperature-tower':    return <TemperatureGuidance      context={context} />;
    case 'retraction':           return <RetractionGuidance       context={context} />;
    case 'max-volumetric-speed': return <MaxVolSpeedGuidance      context={context} />;
    default:                     return null;
  }
}

/** Shared band-summary row used by every tower guidance panel. */
function TowerParams({ tower, unit, valueFormatter }: {
  tower: TowerContext;
  unit: string;
  valueFormatter: (v: number) => string;
}) {
  return (
    <div className="calib-inspect__pa-params">
      <span>
        <strong>Range:</strong> {valueFormatter(tower.startValue)} → {valueFormatter(tower.endValue)} {unit}
      </span>
      <span>
        <strong>Bands:</strong> {tower.bandCount}
        {tower.stepSize > 0 ? ` (every ${tower.stepSize} mm)` : ' (every layer)'}
      </span>
      <span><strong>Z range:</strong> {tower.startZ}–{tower.endZ} mm</span>
    </div>
  );
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
        <li>Take 2 photos: one of each opposing corner — the AI will cross-reference them for a higher-confidence verdict.</li>
      </ul>
      {pa && <TowerParams tower={pa} unit="PA" valueFormatter={(v) => v.toFixed(3)} />}
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
        <li>Take 2-4 photos: one per pad you want judged — cross-frame analysis catches uneven first layers anywhere on the bed.</li>
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

function TemperatureGuidance({ context }: { context: InspectTestContext }) {
  const t = context.temperature;
  return (
    <section className="calib-step__panel calib-inspect__pa-guidance">
      <strong className="calib-inspect__section-title">Photo tips for best AI analysis</strong>
      <p className="calib-step__muted">
        Each band in the temperature tower is printed at a different nozzle
        temperature. Photograph the tower so every band is visible — the AI
        looks for the cleanest combination of bridging, overhangs, stringing,
        and layer adhesion.
      </p>
      <ul className="calib-inspect__tips">
        <li>Side-on view, perpendicular to the bridge / overhang side of the tower.</li>
        <li>Capture all bands top-to-bottom in a single shot so band boundaries line up with Z height.</li>
        <li>Diffuse, even lighting — strong side-light helps reveal stringing between bands.</li>
        <li>A second shot of the back-side (bridges + overhangs) is highly recommended.</li>
        <li>Hotter bands at the bottom: look for glossy surfaces, drooping overhangs, and stringing.</li>
        <li>Cooler bands at the top: look for matte surfaces, weak layer bonding, and rough corners.</li>
        <li>Take 2-3 photos from different angles — cross-frame agreement raises confidence.</li>
      </ul>
      {t && <TowerParams tower={t} unit="°C" valueFormatter={(v) => `${Math.round(v)}`} />}
    </section>
  );
}

function RetractionGuidance({ context }: { context: InspectTestContext }) {
  const r = context.retraction;
  return (
    <section className="calib-step__panel calib-inspect__pa-guidance">
      <strong className="calib-inspect__section-title">Photo tips for best AI analysis</strong>
      <p className="calib-step__muted">
        The retraction tower performs one travel-heavy hop per layer and groups
        layers into bands at increasing retraction distances. The AI compares
        the stringing between bands to pick the lowest distance with clean
        travels.
      </p>
      <ul className="calib-inspect__tips">
        <li>Side-on view of the gap between the tower and the small spike — that travel is where strings form.</li>
        <li>Dark backdrop behind the gap so thin filament strings show up against it.</li>
        <li>Focus on the gap, not the tower walls — band-level differences are subtle.</li>
        <li>Avoid disturbing the strings before photographing; even a fan breeze can flick them off.</li>
        <li>Bottom bands have the shortest retraction (most stringing); top bands the longest (cleanest travel).</li>
        <li>Take 2-3 photos from different angles — cross-frame agreement raises confidence.</li>
      </ul>
      {r && <TowerParams tower={r} unit="mm" valueFormatter={(v) => v.toFixed(1)} />}
    </section>
  );
}

function MaxVolSpeedGuidance({ context }: { context: InspectTestContext }) {
  const m = context.maxVolSpeed;
  return (
    <section className="calib-step__panel calib-inspect__pa-guidance">
      <strong className="calib-inspect__section-title">Photo tips for best AI analysis</strong>
      <p className="calib-step__muted">
        The max-volumetric-speed test is a single-wall vase printed with a
        continuous speed ramp. The AI looks for the Z height where the wall
        first turns rough or gappy — that's the point the hot-end could no
        longer melt filament fast enough.
      </p>
      <ul className="calib-inspect__tips">
        <li>Side-on view, parallel to the wall — perpendicular to the failure plane.</li>
        <li>Strong, raking side-light to expose under-extrusion lines and gaps.</li>
        <li>Photograph all four sides — failures often show on only one rotation of the spiral.</li>
        <li>Include a ruler held against the wall in one shot so the AI can read off the failure height.</li>
        <li>Bottom of the wall is the slow / clean zone; top is fast / failed zone.</li>
        <li>Take 2-3 photos from different angles — cross-frame agreement raises confidence.</li>
      </ul>
      {m && <TowerParams tower={m} unit="% feedrate" valueFormatter={(v) => `${Math.round(v)}`} />}
    </section>
  );
}
