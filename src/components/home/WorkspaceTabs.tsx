import { useState } from 'react';
import { workflows } from './homeContent';

export function WorkspaceTabs() {
  const [active, setActive] = useState(0);
  const wf = workflows[active];

  function handleKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    setActive((current) =>
      e.key === 'ArrowRight'
        ? (current + 1) % workflows.length
        : (current - 1 + workflows.length) % workflows.length,
    );
  }

  return (
    <div className="wstabs" style={{ '--ws-color': wf.color } as React.CSSProperties}>
      <div className="wstabs__nav" role="tablist">
        {workflows.map((w, i) => (
          <button
            key={w.title}
            role="tab"
            aria-selected={i === active}
            className={`wstabs__tab${i === active ? ' wstabs__tab--active' : ''}`}
            style={i === active ? { '--ws-color': w.color } as React.CSSProperties : undefined}
            onClick={() => setActive(i)}
            onKeyDown={handleKey}
          >
            {w.title}
          </button>
        ))}
      </div>
      <div className="wstabs__panel" key={active}>
        <div className="wstabs__media">
          <img src={wf.image} alt={`${wf.title} workspace`} />
        </div>
        <div className="wstabs__body">
          <p className="wstabs__copy">{wf.copy}</p>
          <div className="wstabs__sections">
            {wf.sections.map((section) => (
              <div key={section.label} className="wstabs__section">
                <p className="wstabs__section-label">{section.label}</p>
                <ul className="wstabs__list">
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
