import { X, HelpCircle } from 'lucide-react';
import type { SettingHelp } from '../../../../utils/settingsHelpContent';
import { useEscapeKey } from '../../../../hooks/useEscapeKey';
import './SettingsHelpModal.css';

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
                {help.whenToChange.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          )}

          {help.commonValues && help.commonValues.length > 0 && (
            <section className="settings-help-modal__section">
              <h3>Common values</h3>
              <ul>
                {help.commonValues.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          )}

          {help.relatedSettings && help.relatedSettings.length > 0 && (
            <section className="settings-help-modal__section">
              <h3>Related settings</h3>
              <div className="settings-help-modal__chips">
                {help.relatedSettings.map((item) => <span key={item}>{item}</span>)}
              </div>
            </section>
          )}

          {help.references && help.references.length > 0 && (
            <section className="settings-help-modal__section">
              <h3>References</h3>
              <ul>
                {help.references.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
