/** Display controls block in the heightmap sidebar — Mirror X toggle, probe markers toggle + size slider. */
export function DisplayControlsSection({
  mirrorX, setMirrorX,
  viewMode,
  showProbePoints, setShowProbePoints,
  probePointScale, setProbePointScale,
}: {
  mirrorX: boolean;
  setMirrorX: (next: boolean | ((v: boolean) => boolean)) => void;
  viewMode: '3d' | '2d';
  showProbePoints: boolean;
  setShowProbePoints: (next: boolean | ((v: boolean) => boolean)) => void;
  probePointScale: number;
  setProbePointScale: (n: number) => void;
}) {
  return (
    <div className="hm-side-section">
      <div className="hm-probe-toggles">
        <button
          className={`hm-pill-toggle${mirrorX ? ' is-on' : ''}`}
          onClick={() => setMirrorX((v) => !v)}
          title={mirrorX ? 'X axis mirrored — X=0 on right (click to restore)' : 'Mirror X axis — X=0 on right, Y ruler on right side'}
        >
          <span className="hm-pill-toggle__track"><span className="hm-pill-toggle__thumb" /></span>
          <span className="hm-pill-toggle__label">Mirror X</span>
        </button>
        {viewMode === '3d' && (
          <button
            className={`hm-pill-toggle${showProbePoints ? ' is-on' : ''}`}
            onClick={() => setShowProbePoints((v) => !v)}
            title={showProbePoints ? 'Hide probe point markers on the 3D surface' : 'Show probe point markers — hover for exact coordinates'}
          >
            <span className="hm-pill-toggle__track"><span className="hm-pill-toggle__thumb" /></span>
            <span className="hm-pill-toggle__label">Markers</span>
          </button>
        )}
      </div>
      {viewMode === '3d' && showProbePoints && (
        <div className="hm-marker-size" title="Adjust the size of the probe point spheres">
          <input
            type="range" className="hm-size-slider" min={0.25} max={3} step={0.05}
            value={probePointScale} onChange={(e) => setProbePointScale(Number(e.target.value))}
            title={`Marker size: ${probePointScale.toFixed(2)}× (drag to resize)`}
          />
          <span className="hm-grid-unit" style={{ minWidth: 30, textAlign: 'right' }}>{probePointScale.toFixed(2)}×</span>
        </div>
      )}
    </div>
  );
}
