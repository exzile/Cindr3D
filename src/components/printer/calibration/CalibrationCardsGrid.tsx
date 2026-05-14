/**
 * CalibrationCardsGrid — the color-coded grid of calibration test cards
 * that drives the wizard. Each card shows category / title / blurb,
 * linked-item status pills, and either a "Start →" or "Resume →"
 * button depending on whether an active wizard session exists.
 */
import type { CalibrationItemId } from '../../../store/calibrationStore';
import type { WizardSession } from '../../../store/calibrationStore';
import { CALIBRATION_CARDS } from './calibrationContent';
import { statusLabel } from './calibrationHelpers';

interface CalibrationStatusEntry {
  status: 'ok' | 'upcoming' | 'overdue' | 'never';
  daysUntilDue: number;
}

export interface CalibrationCardsGridProps {
  activeWizardSessionsByTest: Map<string, WizardSession>;
  calibrationStatusById: Partial<Record<CalibrationItemId, CalibrationStatusEntry>>;
  getCardStatusClass: (linkedItemIds: CalibrationItemId[]) => string;
  startCalibrationTest: (testType: string) => void;
  openWizardSession: (session: WizardSession) => void;
}

export function CalibrationCardsGrid(props: CalibrationCardsGridProps) {
  const {
    activeWizardSessionsByTest, calibrationStatusById,
    getCardStatusClass, startCalibrationTest, openWizardSession,
  } = props;

  return (
    <section className="calib-center" aria-label="Calibration Center">
      <div className="calib-center__grid">
        {CALIBRATION_CARDS.map((card) => {
          const CardIcon = card.Icon;
          const sessionInProgress = activeWizardSessionsByTest.get(card.testType) ?? null;
          const isInProgress = sessionInProgress !== null;
          const inProgressStep = sessionInProgress?.step ?? null;
          return (
            <div
              key={card.id}
              className={`calib-center__card calib-center__card--${card.categoryClass} ${isInProgress ? 'is-in-progress' : getCardStatusClass(card.linkedItemIds)}`}
            >
              <div className="calib-center__card-body">
                <span className="calib-center__category"><CardIcon size={12} /> {card.category}</span>
                <strong className="calib-center__title">{card.title}</strong>
                <p className="calib-center__desc">{card.description}</p>
                <div className="calib-center__badges">
                  {isInProgress && (
                    <span className="printer-calibration-panel__pill calib-center__in-progress-pill">
                      In progress — step {inProgressStep} of 8
                    </span>
                  )}
                  {!isInProgress && card.linkedItemIds.map((itemId) => {
                    const linkedStatus = calibrationStatusById[itemId];
                    return (
                      <span key={itemId} className="printer-calibration-panel__pill">
                        {linkedStatus ? statusLabel(linkedStatus.status, linkedStatus.daysUntilDue) : 'Current'}
                      </span>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                className="calib-center__start"
                onClick={() => {
                  if (sessionInProgress) openWizardSession(sessionInProgress);
                  else startCalibrationTest(card.testType);
                }}
              >
                {isInProgress ? 'Resume →' : 'Start →'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
