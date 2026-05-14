import { useState } from 'react';
import { latestReleaseHighlights, nextReleaseFeatures } from './homeContent';

export function ReleaseRoadmapTabs() {
  type ReleaseTab = 'next' | 'latest';
  const [tab, setTab] = useState<ReleaseTab>('next');

  function handleKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    setTab((current) => current === 'next' ? 'latest' : 'next');
  }
  return (
    <section className="home-band home-band--release" id="v2" aria-labelledby="release-title">
      <div className="rrtabs" style={{ width: 'min(1180px, calc(100% - 40px))', margin: '0 auto' }}>
        <div className="rrtabs__head">
          <div className="home-section-heading" style={{ margin: 0 }}>
            <p>{tab === 'next' ? 'Coming next' : 'Just shipped'}</p>
            <h2 id="release-title">{tab === 'next' ? 'Next release' : 'v0.4.0 release'}</h2>
          </div>
          <div className="rrtabs__nav" role="tablist">
            <button role="tab" aria-selected={tab === 'next'} className={`rrtabs__tab${tab === 'next' ? ' rrtabs__tab--active' : ''}`} onClick={() => setTab('next')} onKeyDown={handleKey}>
              Next release
            </button>
            <button role="tab" aria-selected={tab === 'latest'} className={`rrtabs__tab${tab === 'latest' ? ' rrtabs__tab--active' : ''}`} onClick={() => setTab('latest')} onKeyDown={handleKey}>
              v0.4.0 release
            </button>
          </div>
        </div>

        {tab === 'next' && (
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
        )}

        {tab === 'latest' && (
          <div className="v2-grid">
            {latestReleaseHighlights.map((h) => {
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
        )}
      </div>
    </section>
  );
}
