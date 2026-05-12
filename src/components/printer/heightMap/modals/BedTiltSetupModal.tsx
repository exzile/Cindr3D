import { useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle, Copy, FilePlus, Loader2, TriangleAlert } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../ui/Modal';

export function BedTiltSetupModal({
  content,
  derived,
  noG30Warning,
  creating,
  onCreateFile,
  onClose,
}: {
  content: string;
  derived: boolean;
  noG30Warning?: boolean;
  creating: boolean;
  onCreateFile: (content: string) => void;
  onClose: () => void;
}) {
  const [editedContent, setEditedContent] = useState(content);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editedContent);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2_000);
    } catch { /* ignore */ }
  }, [editedContent]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const hasActiveG30 = editedContent.split('\n').some(
    (line) => /^G30\b/i.test(line.replace(/;.*$/, '').trim()),
  );

  let description: React.ReactNode;
  if (noG30Warning) {
    description = (
      <>
        <strong>bed_tilt.g</strong> exists but has no active <code>G30</code> commands — this is
        why no tilt-correction data was reported. Edit the file below: uncomment (or add) your{' '}
        <code>G30</code> lines using the leadscrew XY positions from your <code>M671</code> in{' '}
        <code>config.g</code>, then click <em>Save &amp; Continue</em>.
      </>
    );
  } else if (derived) {
    description = (
      <>
        <strong>bed_tilt.g</strong> was not found on your printer. The content below
        was derived from your <code>bed.g</code> with <code>G29</code> and{' '}
        <code>M374</code> removed — click <em>Create File &amp; Continue</em> to
        upload it automatically.
      </>
    );
  } else {
    description = (
      <>
        <strong>bed_tilt.g</strong> was not found and <code>bed.g</code> could not
        be read or contains no tilt-correction commands. Fill in the{' '}
        <code>G30</code> coordinates below (matching your <code>M671</code> leadscrew
        positions in <code>config.g</code>) and then create the file.
      </>
    );
  }

  const saveLabel = noG30Warning ? 'Save & Continue' : derived ? 'Create File & Continue' : 'Create Template & Continue';
  const savingLabel = noG30Warning ? 'Saving…' : 'Creating…';

  return (
    <Modal
      onClose={onClose}
      title={noG30Warning ? 'bed_tilt.g — No G30 Commands' : 'bed_tilt.g — Setup Required'}
      titleIcon={noG30Warning
        ? <TriangleAlert size={15} className="bc-modal-warn-icon" />
        : <FilePlus size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />}
      size="wide"
      ariaLabelledBy="hm-setup-modal-title"
      closeButtonTitle="Cancel"
    >
      <ModalBody>
        <p className="bc-modal-desc">{description}</p>

        <div className="bc-setup-code-wrap">
          <textarea
            className="bc-setup-code bc-setup-code--editable"
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            spellCheck={false}
            rows={12}
          />
          <button
            className={`bc-setup-copy-btn${copied ? ' is-copied' : ''}`}
            onClick={() => void handleCopy()}
            title="Copy to clipboard"
          >
            {copied ? <CheckCircle size={12} /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </ModalBody>

      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onClose}>Cancel</button>
        <button
          className="bc-modal-btn bc-modal-btn--confirm bc-modal-btn--level"
          onClick={() => onCreateFile(editedContent)}
          disabled={creating || !hasActiveG30}
          title={!hasActiveG30 ? 'Add at least one uncommented G30 line first' : undefined}
          autoFocus
        >
          {creating
            ? <Loader2 size={13} className="hm-spin" />
            : <FilePlus size={13} />}
          {creating ? savingLabel : saveLabel}
        </button>
      </ModalFooter>
    </Modal>
  );
}
