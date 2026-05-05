import { X, HelpCircle } from 'lucide-react';
import type { SettingHelp } from '../../../../utils/settingsHelpContent';
import { useEscapeKey } from '../../../../hooks/useEscapeKey';
import './SettingsHelpModal.css';

const SETTING_GUIDES = import.meta.glob('../../../../help/settings/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function referenceSlug(reference: string): string {
  return reference
    .replace(/\s+setting guide$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function guideForReference(reference: string): string | null {
  return SETTING_GUIDES[`../../../../help/settings/${referenceSlug(reference)}.md`] ?? null;
}

export function SettingsHelpModal({
  title,
  help,
  onClose,
}: {
  title: string;
  help: SettingHelp;
  onClose: () => void;
}) {
  useEscapeKey(onClose);

  return (
    <>
      <div className="settings-help-modal__backdrop" onClick={onClose} />

      <div className="settings-help-modal" role="dialog" aria-modal="true" aria-labelledby="shm-title">
        <div className="settings-help-modal__header">
          <div className="settings-help-modal__header-icon">
            <HelpCircle size={16} />
          </div>
          <h2 className="settings-help-modal__title" id="shm-title">{title}</h2>
          <button
            className="settings-help-modal__close"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        <div className="settings-help-modal__content">
          <div className="settings-help-modal__brief">
            {help.brief}
          </div>

          {help.imageUrl && (
            <div className="settings-help-modal__image-wrap">
              <img
                src={help.imageUrl}
                alt={`${title} demonstration`}
                className="settings-help-modal__image"
              />
            </div>
          )}

          <p className="settings-help-modal__description">{help.detailed}</p>

          {help.whenToChange && help.whenToChange.length > 0 && (
            <section className="settings-help-modal__section">
              <h3>When to change</h3>
              <ul>
                {help.whenToChange.map((item, index) => <li key={`when:${index}:${item}`}>{item}</li>)}
              </ul>
            </section>
          )}

          {help.commonValues && help.commonValues.length > 0 && (
            <section className="settings-help-modal__section">
              <h3>Common values</h3>
              <ul>
                {help.commonValues.map((item, index) => <li key={`value:${index}:${item}`}>{item}</li>)}
              </ul>
            </section>
          )}

          {help.relatedSettings && help.relatedSettings.length > 0 && (
            <section className="settings-help-modal__section">
              <h3>Related settings</h3>
              <div className="settings-help-modal__chips">
                {help.relatedSettings.map((item, index) => <span key={`related:${index}:${item}`}>{item}</span>)}
              </div>
            </section>
          )}

          {help.references && help.references.length > 0 && (
            <section className="settings-help-modal__section">
              <h3>References</h3>
              <ul className="settings-help-modal__references">
                {help.references.map((item, index) => {
                  const guide = guideForReference(item);
                  return (
                    <li key={`reference:${index}:${item}`}>
                      {guide ? (
                        <details>
                          <summary>{item}</summary>
                          <pre>{guide}</pre>
                        </details>
                      ) : item}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
