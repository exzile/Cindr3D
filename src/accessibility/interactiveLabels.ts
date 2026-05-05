const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="checkbox"]',
  '[role="radio"]',
].join(',');

function visibleText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function labelledByText(element: Element): string {
  const ids = element.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? [];
  return ids
    .map((id) => element.ownerDocument.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

function textContent(element: Element | null | undefined): string | null {
  const text = element?.textContent?.replace(/\s+/g, ' ').trim();
  return text || null;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

function associatedLabelText(element: Element): string | null {
  const id = element.getAttribute('id');
  if (id) {
    const explicitLabel = element.ownerDocument.querySelector(`label[for="${cssEscape(id)}"]`);
    const labelText = textContent(explicitLabel);
    if (labelText) return labelText;
  }

  const wrappingLabel = element.closest('label');
  const wrappingText = textContent(wrappingLabel);
  if (wrappingText) return wrappingText;

  const field = element.closest('.dialog-field, .global-settings-field, .drive-joints-track-col, .sketch-sidebar-row');
  const fieldLabel = field?.querySelector('.dialog-label, .global-settings-label, .drive-joints-track-col__label, .sketch-sidebar-row__label');
  return textContent(fieldLabel);
}

function nearestDialogTitle(element: Element): string | null {
  const container = element.closest('.dialog-panel, .tp-panel, .global-settings-modal, .ai-panel');
  const title = container?.querySelector('.dialog-title, .tp-title, .global-settings-title, .ai-panel-title');
  return textContent(title);
}

function fallbackLabel(element: Element): string | null {
  const associated = associatedLabelText(element);
  if (associated) return associated;

  const explicit = element.getAttribute('title')
    || element.getAttribute('placeholder')
    || element.getAttribute('name')
    || element.getAttribute('value');
  if (explicit?.trim()) return explicit.trim();

  if (element.classList.contains('dialog-close') || element.classList.contains('tp-close')) {
    const title = nearestDialogTitle(element);
    return title ? `Close ${title}` : 'Close dialog';
  }

  const role = element.getAttribute('role');
  if (role === 'tab') return visibleText(element) || null;
  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    return associatedLabelText(element);
  }
  return null;
}

export function hasAccessibleName(element: Element): boolean {
  return Boolean(
    element.getAttribute('aria-label')?.trim()
    || labelledByText(element)
    || visibleText(element)
    || fallbackLabel(element),
  );
}

export function ensureInteractiveAccessibleNames(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR).forEach((element) => {
    if (hasAccessibleName(element)) {
      if (!element.getAttribute('aria-label')) {
        const fallback = fallbackLabel(element);
        if (fallback && !visibleText(element)) element.setAttribute('aria-label', fallback);
      }
      return;
    }

    const fallback = fallbackLabel(element);
    if (fallback) element.setAttribute('aria-label', fallback);
  });
}

export function collectUnlabeledInteractiveElements(root: ParentNode = document): Element[] {
  ensureInteractiveAccessibleNames(root);
  return Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR)).filter((element) => !hasAccessibleName(element));
}

export function installInteractiveLabelGuard(root: ParentNode = document): MutationObserver | null {
  ensureInteractiveAccessibleNames(root);
  if (typeof MutationObserver === 'undefined') return null;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        ensureInteractiveAccessibleNames(mutation.target.parentElement ?? root);
      } else {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) ensureInteractiveAccessibleNames(node.parentElement ?? root);
        });
      }
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'role', 'title', 'placeholder', 'aria-label', 'aria-labelledby'],
  });
  return observer;
}
