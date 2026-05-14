/**
 * CalibrationPresetsGrid — the bottom grid of preset cards (cube, retraction
 * tower, flow ring, etc.). Each card shows a STL thumbnail and two
 * actions: open the model in the Prepare workspace, or download
 * generated g-code with the active printer/material/print profile.
 */
import { Download } from 'lucide-react';
import { CATEGORY_ACCENT, PRESETS, type CalibrationPreset } from './calibrationContent';

export interface CalibrationPresetsGridProps {
  ready: boolean;
  stlThumbnails: Map<string, string>;
  runPreset: (preset: CalibrationPreset) => void;
  openInPrepare: (preset: CalibrationPreset) => Promise<void> | void;
}

export function CalibrationPresetsGrid({ ready, stlThumbnails, runPreset, openInPrepare }: CalibrationPresetsGridProps) {
  return (
    <div className="printer-calibration-panel__grid">
      {PRESETS.map((preset) => {
        const PresetIcon = preset.Icon;
        const accent = CATEGORY_ACCENT[preset.category] ?? '#6366f1';
        const thumbnail = stlThumbnails.get(preset.stlUrl);
        return (
          <div
            key={preset.id}
            className={`calib-preset-card calib-preset-card--${preset.category.toLowerCase()}`}
          >
            <div className="calib-preset-card__preview">
              {thumbnail ? (
                <img src={thumbnail} alt={preset.title} />
              ) : (
                <div className="calib-preset-card__preview-placeholder">
                  <PresetIcon size={28} style={{ color: accent, opacity: 0.5 }} />
                </div>
              )}
            </div>
            <div className="calib-preset-card__meta">
              <span className="calib-preset-card__category">
                <PresetIcon size={11} /> {preset.category}
              </span>
              <strong className="calib-preset-card__title">{preset.title}</strong>
              <p className="calib-preset-card__desc">{preset.summary}</p>
            </div>
            <div className="calib-preset-card__footer">
              <button
                type="button"
                className="calib-preset-card__action calib-preset-card__action--secondary"
                onClick={() => openInPrepare(preset)}
                title="Open this calibration model in the Prepare workspace"
              >
                Open in Prepare
              </button>
              <button
                type="button"
                className="calib-preset-card__action calib-preset-card__action--primary"
                disabled={!ready}
                onClick={() => runPreset(preset)}
                title={ready ? `Download ${preset.title} G-code` : 'Choose printer, material, and print profiles in Prepare first'}
              >
                <Download size={12} /> G-code
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
