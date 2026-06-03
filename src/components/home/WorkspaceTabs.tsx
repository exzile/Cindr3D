import { useState, type CSSProperties } from 'react';
import { workflows } from './homeContent';

export function WorkspaceTabs() {
  const [selectedShots, setSelectedShots] = useState<Record<string, number>>({});

  return (
    <div className="wspages">
      {workflows.map((wf, index) => {
        const gallery = wf.screenshots ?? [{ src: wf.image, label: `${wf.title} workspace` }];
        const activeShotIndex = selectedShots[wf.title] ?? 0;
        const primary = gallery[activeShotIndex] ?? gallery[0];

        return (
          <article
            className="wspage"
            key={wf.title}
            style={{ '--ws-color': wf.color, '--ws-index': index } as CSSProperties}
          >
            <div className="wspage__copy">
              <h3>{wf.title} workspace</h3>
              <p className="wspage__lead">{wf.copy}</p>
              <div className="wspage__sections">
                {wf.sections.slice(0, 4).map((section) => (
                  <div className="wspage__section" key={section.label}>
                    <span>{section.label}</span>
                    <p>{section.items[0]}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="wspage__gallery">
              <figure className="wspage__hero-shot">
                <img src={primary.src} alt={primary.label} />
                <figcaption>{primary.label}</figcaption>
              </figure>
              <div className="wspage__shot-grid" aria-label={`${wf.title} screenshots`}>
                {gallery.map((shot, shotIndex) => (
                  <button
                    type="button"
                    className={`wspage__shot${shotIndex === activeShotIndex ? ' wspage__shot--active' : ''}`}
                    key={shot.src}
                    onClick={() => setSelectedShots((current) => ({ ...current, [wf.title]: shotIndex }))}
                    aria-label={`Show ${shot.label}`}
                    aria-pressed={shotIndex === activeShotIndex}
                  >
                    <img src={shot.src} alt="" />
                    <span>{shot.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
