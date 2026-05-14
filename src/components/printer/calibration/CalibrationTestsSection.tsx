/**
 * CalibrationTestsSection — collapsible list of saved wizard test runs
 * for the active printer. Each row offers:
 *   • Inline step-picker edit form
 *   • Resume / Complete / Delete (with two-step confirm)
 *
 * Owns the editing + delete-confirm local state since neither value is
 * read outside this section. The host still owns the wizard session
 * data + the wizard mount; this component just lists, edits, and routes
 * actions back via callbacks.
 */
import { useState } from 'react';
import { CheckCircle2, ChevronDown, Trash2, Wrench } from 'lucide-react';
import type { WizardSession } from '../../../store/calibrationStore';
import { WIZARD_STEP_LABELS } from './calibrationContent';
import { formatDate, titleForTestType } from './calibrationHelpers';

export interface CalibrationTestsSectionProps {
  printerWizardSessions: WizardSession[];
  isOpen: boolean;
  setIsOpen: (updater: (open: boolean) => boolean) => void;
  updateWizardSessionById: (id: string, changes: Partial<WizardSession>) => void;
  openWizardSession: (session: WizardSession) => void;
  completeCalibrationTest: (session: WizardSession) => void;
  removeCalibrationTest: (session: WizardSession) => void;
}

export function CalibrationTestsSection(props: CalibrationTestsSectionProps) {
  const {
    printerWizardSessions, isOpen, setIsOpen,
    updateWizardSessionById, openWizardSession,
    completeCalibrationTest, removeCalibrationTest,
  } = props;

  const [editSessionId, setEditSessionId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  return (
    <div className="printer-calibration-panel__section printer-calibration-panel__section--tests">
      <div className="printer-calibration-panel__section-head">
        <button
          type="button"
          className="printer-calibration-panel__section-toggle"
          aria-expanded={isOpen}
          aria-controls="calibration-tests-section"
          onClick={() => setIsOpen((open) => !open)}
        >
          <ChevronDown size={14} className={isOpen ? 'is-open' : ''} />
          <span className="printer-calibration-panel__section-title"><CheckCircle2 size={15} /> Calibration tests</span>
        </button>
      </div>
      {isOpen && (
        <div id="calibration-tests-section" className="printer-calibration-panel__section-body">
          {printerWizardSessions.length === 0 ? (
            <div className="printer-calibration-panel__empty">Start a calibration card above to save a test run here.</div>
          ) : (
            <div className="printer-calibration-panel__rows">
              {printerWizardSessions.map((session) => {
                const isEditing = editSessionId === session.id;
                const isConfirmingDelete = deleteConfirmId === session.id;
                return (
                  <div key={session.id} className={`printer-calibration-panel__test-row is-${session.status}`}>
                    <div>
                      <strong>{titleForTestType(session.testType)}</strong>
                      <span>
                        Started {formatDate(session.startedAt)}
                        {' · '}
                        Updated {formatDate(session.updatedAt)}
                      </span>
                    </div>

                    <span className="printer-calibration-panel__pill">
                      {session.status === 'completed' ? 'Completed' : `Step ${session.step} of ${WIZARD_STEP_LABELS.length}`}
                    </span>

                    {isEditing && (
                      <div className="printer-calibration-panel__test-edit">
                        <label>
                          <span>Step</span>
                          <select
                            value={session.step}
                            onChange={(event) => updateWizardSessionById(session.id, { step: Number(event.target.value) })}
                          >
                            {WIZARD_STEP_LABELS.map((label, index) => (
                              <option key={label} value={index + 1}>
                                {index + 1}. {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="button" onClick={() => setEditSessionId(null)}>
                          Done
                        </button>
                      </div>
                    )}

                    {isConfirmingDelete && (
                      <div className="printer-calibration-panel__test-confirm">
                        <span>Delete this test run? This cannot be undone.</span>
                        <button
                          type="button"
                          className="printer-calibration-panel__test-confirm-yes"
                          onClick={() => {
                            removeCalibrationTest(session);
                            setDeleteConfirmId(null);
                          }}
                        >
                          Yes, delete
                        </button>
                        <button type="button" onClick={() => setDeleteConfirmId(null)}>
                          Cancel
                        </button>
                      </div>
                    )}

                    <div className="printer-calibration-panel__test-actions">
                      <button
                        type="button"
                        title="Edit step"
                        onClick={() => setEditSessionId(isEditing ? null : session.id)}
                      >
                        <Wrench size={13} /> {isEditing ? 'Close' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openWizardSession(session)}
                        disabled={session.status === 'completed'}
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => completeCalibrationTest(session)}
                        disabled={session.status === 'completed'}
                      >
                        <CheckCircle2 size={13} /> Complete
                      </button>
                      <button
                        type="button"
                        title="Delete test"
                        className="printer-calibration-panel__test-delete"
                        onClick={() => setDeleteConfirmId(isConfirmingDelete ? null : session.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
