import { Fragment } from 'react';
import type { HelpSection as HelpSectionData } from './helpContent';

function renderShortcutKeys(keys: string) {
  return keys.split('+').map((key, idx, arr) => (
    <Fragment key={`${key}-${idx}`}>
      <kbd>{key}</kbd>
      {idx < arr.length - 1 && <span className="app-help-kbd-sep">+</span>}
    </Fragment>
  ));
}

export function HelpSection({ section }: { section: HelpSectionData }) {
  return (
    <section className="app-help-section">
      <h4>{section.heading}</h4>
      {section.intro && <p className="app-help-intro">{section.intro}</p>}
      {section.image && (
        <figure className="app-help-figure">
          <img src={section.image.src} alt={section.image.alt} className="app-help-img" />
          {section.image.caption && <figcaption className="app-help-caption">{section.image.caption}</figcaption>}
        </figure>
      )}
      {section.items && section.items.length > 0 && (
        <ul>
          {section.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {section.shortcuts && section.shortcuts.length > 0 && (
        <table className="app-help-shortcuts">
          <thead>
            <tr>
              <th>Keys</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {section.shortcuts.map((s) => (
              <tr key={`${s.keys}-${s.action}`}>
                <td>{renderShortcutKeys(s.keys)}</td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {section.notes && section.notes.length > 0 && (
        <div className="app-help-notes">
          {section.notes.map((note) => (
            <p key={note} className="app-help-note">{note}</p>
          ))}
        </div>
      )}
    </section>
  );
}
