/**
 * tabHelpers — shared filter + keyboard-focus helpers for the two
 * printer-panel tab UIs (desktop tab strip + mobile bottom sheet).
 */
import React from 'react';
import type { PrinterBoardType } from '../../../types/duet';
import { TABS, KLIPPER_ONLY_TABS, DUET_ONLY_TABS, type TabKey } from './config';

export function visiblePrinterTabs(boardType: PrinterBoardType) {
  return TABS.filter(({ key }) => {
    if (KLIPPER_ONLY_TABS.has(key) && boardType !== 'klipper') return false;
    if (DUET_ONLY_TABS.has(key) && boardType === 'klipper') return false;
    return true;
  });
}

export function movePrinterTabFocus(
  event: React.KeyboardEvent<HTMLButtonElement>,
  visibleTabs: ReturnType<typeof visiblePrinterTabs>,
  activeKey: TabKey,
  onTabChange: (tab: TabKey) => void,
): void {
  const index = visibleTabs.findIndex(({ key }) => key === activeKey);
  if (index < 0) return;
  let nextIndex = index;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % visibleTabs.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + visibleTabs.length) % visibleTabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = visibleTabs.length - 1;
  else return;

  event.preventDefault();
  const nextTab = visibleTabs[nextIndex];
  onTabChange(nextTab.key);
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>(`[data-printer-tab="${nextTab.key}"]`)?.focus();
  });
}
