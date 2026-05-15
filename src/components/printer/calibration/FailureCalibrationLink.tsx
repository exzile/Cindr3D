import { Wrench } from 'lucide-react';
import type { VisionFailureCategory } from '../../../services/vision/failureDetector';
import { suggestedCalibrationForFailure } from '../../../services/calibration/failureToCalibration';
import './FailureCalibrationLink.css';

interface FailureCalibrationLinkProps {
  category: VisionFailureCategory;
  onStartCalibration: (testType: string) => void;
}

/**
 * Compact accent-coloured row shown alongside an in-flight vision failure
 * alert. When the failure category has a matching calibration test, it
 * surfaces a "We can help: <label>" button that jumps the user straight to
 * the relevant calibration wizard.
 */
export function FailureCalibrationLink({ category, onStartCalibration }: FailureCalibrationLinkProps) {
  const suggestion = suggestedCalibrationForFailure(category);
  if (!suggestion) return null;

  return (
    <div className="failure-calibration-link" role="group" aria-label="Suggested calibration">
      <Wrench size={14} className="failure-calibration-link__icon" aria-hidden />
      <span className="failure-calibration-link__text">We can help:</span>
      <button
        type="button"
        className="failure-calibration-link__button"
        onClick={() => onStartCalibration(suggestion.testType)}
      >
        Run {suggestion.label} →
      </button>
    </div>
  );
}
