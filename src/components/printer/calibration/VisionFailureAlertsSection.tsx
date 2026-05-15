import { AlertTriangle } from 'lucide-react';
import { useVisionStore } from '../../../store/visionStore';
import { suggestedCalibrationForFailure } from '../../../services/calibration/failureToCalibration';
import { FailureCalibrationLink } from './FailureCalibrationLink';
import './VisionFailureAlertsSection.css';

interface VisionFailureAlertsSectionProps {
  printerId: string;
  startCalibrationTest: (testType: string) => void;
}

/**
 * Renders the most-recent actionable vision failure check for the active
 * printer, with a "Run X calibration" link to jump straight to the relevant
 * wizard. Hidden when there are no actionable checks (none / unknown only).
 */
export function VisionFailureAlertsSection({ printerId, startCalibrationTest }: VisionFailureAlertsSectionProps) {
  const recentChecks = useVisionStore((s) => s.recentChecks);
  const printerChecks = recentChecks.filter((record) => record.printerId === printerId);
  const latest = printerChecks.find((record) => suggestedCalibrationForFailure(record.result.category) !== null);

  if (!latest) return null;

  return (
    <section className="vision-failure-alerts" aria-label="Vision failure alerts">
      <div className="vision-failure-alerts__row">
        <AlertTriangle size={14} className="vision-failure-alerts__icon" aria-hidden />
        <div className="vision-failure-alerts__body">
          <div className="vision-failure-alerts__title">
            {latest.result.category.replace(/-/g, ' ')} detected on {latest.cameraLabel}
          </div>
          {latest.result.summary && (
            <div className="vision-failure-alerts__summary">{latest.result.summary}</div>
          )}
        </div>
      </div>
      <FailureCalibrationLink
        category={latest.result.category}
        onStartCalibration={startCalibrationTest}
      />
    </section>
  );
}
