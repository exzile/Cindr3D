import { describe, expect, it } from 'vitest';
import { collectUnlabeledInteractiveElements, ensureInteractiveAccessibleNames } from './interactiveLabels';

describe('interactiveLabels', () => {
  it('adds dialog close labels from the nearest dialog title', () => {
    document.body.innerHTML = `
      <div class="dialog-panel">
        <div class="dialog-title">Thread Settings</div>
        <button class="dialog-close"><svg /></button>
      </div>
    `;

    ensureInteractiveAccessibleNames(document);

    expect(document.querySelector('button')?.getAttribute('aria-label')).toBe('Close Thread Settings');
    expect(collectUnlabeledInteractiveElements(document)).toHaveLength(0);
  });

  it('uses title text for icon-only controls', () => {
    document.body.innerHTML = '<button title="Fit to plate"><svg /></button>';

    ensureInteractiveAccessibleNames(document);

    expect(document.querySelector('button')?.getAttribute('aria-label')).toBe('Fit to plate');
  });
});
