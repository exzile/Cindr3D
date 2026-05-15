import { useState } from 'react';

interface HealthChecklistProps {
  onCheck: (key: string, checked: boolean) => void;
}

const HEALTH_CHECKS = [
  { key: 'motion',     label: 'Motion quality',          detail: 'No visible ringing or ghosting on vertical walls' },
  { key: 'thermal',    label: 'Thermal stability',       detail: 'Consistent layer colour, no delamination or under-extrusion bands' },
  { key: 'extrusion',  label: 'Extrusion consistency',   detail: 'Uniform line width, no gaps or blobs on perimeters' },
  { key: 'firstLayer', label: 'First layer adhesion',    detail: 'Flat and well-squished, no corner lifting' },
  { key: 'dims',       label: 'Dimensional accuracy',    detail: '≈ 20 mm on all three axes when measured with calipers' },
];

/**
 * Firmware-health visual inspection checklist. Each criterion is reported back
 * to the host as a 0/1 measurement so the wizard can record acknowledgement.
 */
export function HealthChecklist({ onCheck }: HealthChecklistProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const toggle = (key: string, value: boolean) => {
    setChecked((prev) => ({ ...prev, [key]: value }));
    onCheck(key, value);
  };

  return (
    <section className="calib-step__panel">
      <strong className="calib-inspect__section-title">Health checklist</strong>
      <p className="calib-step__muted">
        Print the firmware-health reference cube, then inspect it against each criterion below.
      </p>
      <div className="calib-inspect__checks">
        {HEALTH_CHECKS.map(({ key, label, detail }) => (
          <label key={key} className="calib-inspect__check-row">
            <input
              type="checkbox"
              className="calib-inspect__check-input"
              checked={checked[key] ?? false}
              onChange={(e) => toggle(key, e.target.checked)}
            />
            <div className="calib-inspect__check-text">
              <span className="calib-inspect__check-label">{label}</span>
              <span className="calib-step__muted">{detail}</span>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}
