/**
 * StartChecklist.tsx — Phase 12.3
 *
 * Exports two things:
 *   1. `StartChecklistModal`  — pre-flight modal shown before starting a print
 *   2. `ChecklistSettingsPanel` — standalone settings page (wired as a printer tab)
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ClipboardList, X } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { useSchedulingStore } from '../../../store/schedulingStore';
import './StartChecklist.css';

// ─── Toggle (reuse locally) ────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="bc-toggle" style={{ marginLeft: 'auto' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="bc-toggle__track" />
      <span className="bc-toggle__thumb" />
    </label>
  );
}

// ─── Pre-flight modal ─────────────────────────────────────────────────────────

interface StartChecklistModalProps {
  printerId: string;
  fileName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function StartChecklistModal({
  printerId,
  fileName,
  onConfirm,
  onCancel,
}: StartChecklistModalProps) {
  const getChecklistForPrinter = useSchedulingStore((s) => s.getChecklistForPrinter);
  const items = getChecklistForPrinter(printerId);
  const visibleItems = items.filter((i) => i.enabled);

  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allChecked = visibleItems.every((i) => checked.has(i.id));

  useEffect(() => {
    if (visibleItems.length === 0) {
      onConfirm();
    }
  }, [onConfirm, visibleItems.length]);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div className="start-checklist-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="start-checklist-modal">
        <div className="start-checklist-modal__header">
          <ClipboardList size={16} />
          <span className="start-checklist-modal__title">Pre-flight checklist</span>
          <span className="start-checklist-modal__subtitle" title={fileName}>{fileName}</span>
          <button className="start-checklist-modal__close" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>

        <div className="start-checklist-modal__body">
          {visibleItems.map((item) => {
            const isChecked = checked.has(item.id);
            return (
              <button
                type="button"
                key={item.id}
                className={`sc-item${isChecked ? ' checked' : ''}`}
                onClick={() => toggle(item.id)}
                role="checkbox"
                aria-checked={isChecked}
              >
                <div className="sc-item__checkbox">
                  {isChecked && <Check size={11} />}
                </div>
                <div className="sc-item__content">
                  <div className="sc-item__label">{item.label}</div>
                  {item.description && (
                    <div className="sc-item__desc">{item.description}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="start-checklist-modal__footer">
          <span className="sc-footer-progress">
            {checked.size} / {visibleItems.length} checked
          </span>
          <button className="sc-btn" onClick={onCancel}>Cancel</button>
          <button
            className="sc-btn primary"
            onClick={onConfirm}
            disabled={!allChecked}
          >
            Start print
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Per-printer accordion ────────────────────────────────────────────────────

interface PrinterOverrideCardProps {
  printerId: string;
  printerName: string;
}

function PrinterOverrideCard({ printerId, printerName }: PrinterOverrideCardProps) {
  const [open, setOpen] = useState(false);
  const checklistItems = useSchedulingStore((s) => s.checklistItems);
  const getChecklistForPrinter = useSchedulingStore((s) => s.getChecklistForPrinter);
  const setChecklistOverride = useSchedulingStore((s) => s.setChecklistOverride);
  const setChecklistVisible = useSchedulingStore((s) => s.setChecklistVisible);
  const checklistOverrides = useSchedulingStore((s) => s.checklistOverrides);

  const override = checklistOverrides.find((o) => o.printerId === printerId);
  const showChecklist = override?.showChecklist !== false;
  const resolved = getChecklistForPrinter(printerId);

  return (
    <div className="checklist-settings__printer-card">
      <div
        className={`checklist-settings__printer-head${open ? ' open' : ''}`}
        onClick={() => setOpen((s) => !s)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="checklist-settings__printer-head__name">{printerName}</span>
      </div>

      {open && (
        <div className="checklist-settings__printer-body">
          <div className="checklist-settings__show-toggle">
            <span>Show pre-flight checklist before starting a print</span>
            <Toggle checked={showChecklist} onChange={(v) => setChecklistVisible(printerId, v)} />
          </div>

          {checklistItems.map((item) => {
            const resolvedItem = resolved.find((r) => r.id === item.id);
            const enabled = resolvedItem?.enabled ?? item.defaultEnabled;
            return (
              <div key={item.id} className="checklist-settings__override-row">
                <span className="checklist-settings__override-row__label">{item.label}</span>
                <Toggle
                  checked={enabled}
                  onChange={(v) => setChecklistOverride(printerId, item.id, v)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Checklist Settings Panel ─────────────────────────────────────────────────

export default function ChecklistSettingsPanel() {
  const printers = usePrinterStore((s) => s.printers);
  const checklistItems = useSchedulingStore((s) => s.checklistItems);

  return (
    <div className="checklist-settings">
      <div className="checklist-settings__header">
        <ClipboardList size={16} />
        <h2>Pre-flight Checklist</h2>
      </div>

      <div className="checklist-settings__body">
        {/* Global items (read-only labels showing defaults) */}
        <div>
          <div className="checklist-settings__section-title">Global checklist items</div>
          <div className="checklist-settings__global-list">
            {checklistItems.map((item) => (
              <div key={item.id} className="checklist-settings__global-item">
                <div className="checklist-settings__global-item__content">
                  <div className="checklist-settings__global-item__label">{item.label}</div>
                  <div className="checklist-settings__global-item__desc">{item.description}</div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, alignSelf: 'center' }}>
                  {item.defaultEnabled ? 'On by default' : 'Off by default'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Per-printer overrides */}
        {printers.length > 0 && (
          <div>
            <div className="checklist-settings__section-title">Per-printer overrides</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {printers.map((p) => (
                <PrinterOverrideCard key={p.id} printerId={p.id} printerName={p.name} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
