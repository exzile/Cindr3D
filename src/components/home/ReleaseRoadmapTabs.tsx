import { nextReleaseFeatures } from './homeContent';

export function ReleaseRoadmapTabs() {
  return (
    <div className="release-block rrtabs">
      <div className="rrtabs__head">
        <div className="home-section-heading" style={{ margin: 0 }}>
          <p>Now available</p>
          <h2 id="release-title">v0.5.3 new release</h2>
        </div>
      </div>

      <div className="v2-grid">
        {nextReleaseFeatures.map((h) => {
          const Icon = h.icon;
          return (
            <article className="v2-card" key={h.label}>
              <div className="v2-card__icon"><Icon size={18} /></div>
              <div>
                <h3>{h.label}</h3>
                <p>{h.detail}</p>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
