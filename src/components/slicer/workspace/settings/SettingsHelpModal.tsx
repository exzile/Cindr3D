import { useEffect } from 'react';
import { X, HelpCircle } from 'lucide-react';
import type { SettingHelp } from '../../../../utils/settingsHelpContent';
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        </div>
      </div>
    </>
  );
}
