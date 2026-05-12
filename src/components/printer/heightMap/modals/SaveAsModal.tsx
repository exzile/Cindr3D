import { useCallback, useState } from 'react';
import { Save } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../ui/Modal';

export function SaveAsModal({
  onConfirm, onCancel,
}: {
  onConfirm: (filename: string) => void;
  onCancel: () => void;
}) {
  const [filename, setFilename] = useState('heightmap_backup');
  const safeName = filename.trim().replace(/[^a-zA-Z0-9_-]/g, '_');

  const handleConfirm = useCallback(() => {
    if (safeName) onConfirm(safeName);
  }, [onConfirm, safeName]);

  return (
    <Modal
      onClose={onCancel}
      onEnter={handleConfirm}
      title="Save Height Map As"
      titleIcon={<Save size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />}
      ariaLabelledBy="hm-saveas-title"
      closeButtonTitle="Cancel"
    >
      <ModalBody>
        <p className="bc-modal-desc">
          Saves the current height map to the printer's <code>0:/sys</code> folder.
          Filenames are sanitised to letters, numbers, dashes and underscores.
        </p>
        <div className="bc-modal-repeat-row">
          <label className="bc-modal-repeat-label" htmlFor="hm-saveas-name">Filename</label>
          <input
            id="hm-saveas-name"
            type="text"
            className="bc-modal-num-input"
            style={{ minWidth: 200 }}
            value={filename}
            autoFocus
            onChange={(e) => setFilename(e.target.value)}
          />
          <span className="bc-modal-repeat-hint">
            <code>0:/sys/{safeName || 'heightmap'}.csv</code>
          </span>
        </div>
      </ModalBody>

      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onCancel}>Cancel</button>
        <button
          className="bc-modal-btn bc-modal-btn--confirm"
          disabled={!safeName}
          onClick={handleConfirm}
        >
          <Save size={13} /> Save
        </button>
      </ModalFooter>
    </Modal>
  );
}
