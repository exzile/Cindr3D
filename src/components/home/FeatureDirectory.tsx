import { useState } from 'react';
import { PAGE_COLORS, featureGroups } from './homeContent';

export function FeatureDirectory() {
  const workspacePages = Array.from(new Set(featureGroups.map((g) => g.page)));
  const pages = ['Summary', 'All', ...workspacePages];
  const [activePage, setActivePage] = useState('Summary');

  const countByPage = Object.fromEntries(
    workspacePages.map((p) => [
      p,
      featureGroups.filter((g) => g.page === p).reduce((n, g) => n + g.details.length, 0),
    ]),
  );
  const totalCount = featureGroups.reduce((n, g) => n + g.details.length, 0);

  const visibleGroups = activePage === 'All' || activePage === 'Summary'
    ? featureGroups
    : featureGroups.filter((g) => g.page === activePage);

  return (
    <section className="home-band home-band--features" id="features" aria-labelledby="features-title">
      <div className="home-section-heading">
        <p>Complete feature list</p>
        <h2 id="features-title">Everything Cindr3D does</h2>
      </div>

      <div className="fd-filters" role="group" aria-label="Filter by workspace">
        {pages.map((page) => {
          const count = page === 'Summary'
            ? featureGroups.length
            : page === 'All'
              ? totalCount
              : countByPage[page];
          const isActive = activePage === page;
          const color = PAGE_COLORS[page];
          return (
            <button
              key={page}
              className={`fd-filter-tab${isActive ? ' fd-filter-tab--active' : ''}`}
              onClick={() => setActivePage(page)}
              aria-pressed={isActive}
              style={isActive && color ? ({ '--ft-color': color } as React.CSSProperties) : undefined}
            >
              {page}
              <span className="fd-filter-tab__count">{count}</span>
            </button>
          );
        })}
      </div>

      {activePage === 'Summary' ? (
        <div className="fd-summary-grid">
          {featureGroups.map((group) => {
            const Icon = group.icon;
            const color = PAGE_COLORS[group.page] ?? '#f06c3f';
            return (
              <div
                className="fd-summary-card"
                key={`${group.page}-${group.section}`}
                style={{ '--fd-color': color } as React.CSSProperties}
              >
                <div className="fd-summary-card__header">
                  <div className="fd-summary-card__icon"><Icon size={16} /></div>
                  <div>
                    <span className="fd-summary-card__page">{group.page}</span>
                    <h3 className="fd-summary-card__name">{group.section}</h3>
                  </div>
                </div>
                <ul className="fd-summary-card__list">
                  {group.details.map((feat) => (
                    <li key={feat.title}>{feat.title}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="fd-table">
          {visibleGroups.map((group) => {
            const Icon = group.icon;
            const color = PAGE_COLORS[group.page] ?? '#f06c3f';
            return (
              <div
                className="fd-row"
                key={`${group.page}-${group.section}`}
                style={{ '--fd-color': color } as React.CSSProperties}
              >
                <div className="fd-row__head">
                  <div className="fd-row__meta">
                    <div className="fd-row__icon"><Icon size={15} /></div>
                    <span className="fd-row__page">{group.page}</span>
                  </div>
                  <h3 className="fd-row__name">{group.section}</h3>
                  <p className="fd-row__summary">{group.summary}</p>
                  <span className="fd-row__count">{group.details.length} features</span>
                </div>
                <ul className="fd-row__features">
                  {group.details.map((feat) => {
                    const FeatIcon = feat.icon;
                    return (
                      <li key={feat.title} className="fd-feat">
                        <div className="fd-feat__head">
                          <span className="fd-feat__ico" aria-hidden="true"><FeatIcon size={13} /></span>
                          <h4 className="fd-feat__title">{feat.title}</h4>
                        </div>
                        <p className="fd-feat__body">{feat.body}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
