/**
 * WearTrackingSection — collapsible per-component hour + filament
 * counter with inline reminder thresholds, plus an "add custom
 * component" form that posts both the component and a service-log
 * entry recording the addition.
 *
 * Owns the new-component draft state (name/category/hours/filament).
 * The shared service-form fields (servicePerson + serviceCost) come in
 * as props since they're also used by the moisture section's log entry.
 */
import { useState } from 'react';
import { ChevronDown, Plus, RefreshCw, Trash2, Wrench } from 'lucide-react';
import type {
  ComponentStatus, WearComponent,
} from '../../../store/calibrationStore';
import { DEFAULT_COMPONENTS } from '../../../store/calibrationStore';
import { parseNonNegativeNumber, parseOptionalNonNegativeNumber } from './calibrationHelpers';

export interface WearTrackingSectionProps {
  isOpen: boolean;
  setIsOpen: (updater: (open: boolean) => boolean) => void;

  activePrinterId: string;
  printerComponents: WearComponent[];
  componentStatuses: ComponentStatus[];
  servicePerson: string;
  serviceCost: string;

  addComponent: (component: Omit<WearComponent, 'id' | 'installedAt' | 'hoursOn' | 'filamentKm'>) => void;
  updateComponent: (id: string, changes: Partial<WearComponent>) => void;
  removeComponent: (id: string) => void;
  logService: (entry: {
    printerId: string;
    componentId: string | null;
    summary: string;
    performedBy: string;
    cost: number | null;
  }) => void;
}

export function WearTrackingSection(props: WearTrackingSectionProps) {
  const {
    isOpen, setIsOpen,
    activePrinterId, printerComponents, componentStatuses,
    servicePerson, serviceCost,
    addComponent, updateComponent, removeComponent, logService,
  } = props;

  const [newComponentName, setNewComponentName] = useState('');
  const [newComponentCategory, setNewComponentCategory] = useState<WearComponent['category']>('other');
  const [newComponentHours, setNewComponentHours] = useState('800');
  const [newComponentFilamentKm, setNewComponentFilamentKm] = useState('');

  const seedDefaultComponents = () => {
    for (const component of DEFAULT_COMPONENTS) {
      if (printerComponents.some((existing) => existing.name.toLowerCase() === component.name.toLowerCase())) continue;
      addComponent({
        printerId: activePrinterId,
        name: component.name,
        category: component.category,
        reminderHours: component.reminderHours,
        reminderFilamentKm: component.reminderFilamentKm,
        replacementCost: null,
        note: '',
      });
    }
  };

  const addCustomComponent = () => {
    const name = newComponentName.trim();
    if (!name) return;
    const reminderHours = parseOptionalNonNegativeNumber(newComponentHours);
    const reminderFilamentKm = parseOptionalNonNegativeNumber(newComponentFilamentKm);
    if (reminderHours === undefined || reminderFilamentKm === undefined) return;
    addComponent({
      printerId: activePrinterId,
      name,
      category: newComponentCategory,
      reminderHours: reminderHours ?? null,
      reminderFilamentKm: reminderFilamentKm ?? null,
      replacementCost: null,
      note: '',
    });
    logService({
      printerId: activePrinterId,
      componentId: null,
      summary: `${name} added to component register`,
      performedBy: servicePerson.trim() || 'Local user',
      cost: null,
    });
    setNewComponentName('');
  };

  const recordReplacement = (component: WearComponent) => {
    const replacementCost = parseOptionalNonNegativeNumber(serviceCost);
    if (replacementCost === undefined) return;
    updateComponent(component.id, {
      installedAt: Date.now(),
      hoursOn: 0,
      filamentKm: 0,
      replacementCost: replacementCost ?? component.replacementCost,
    });
    logService({
      printerId: activePrinterId,
      componentId: component.id,
      summary: `${component.name} replaced`,
      performedBy: servicePerson.trim() || 'Local user',
      cost: replacementCost ?? component.replacementCost,
    });
  };

  return (
    <div className="printer-calibration-panel__section printer-calibration-panel__section--wear">
      <div className="printer-calibration-panel__section-head">
        <button
          type="button"
          className="printer-calibration-panel__section-toggle"
          aria-expanded={isOpen}
          aria-controls="wear-tracking-section"
          onClick={() => setIsOpen((open) => !open)}
        >
          <ChevronDown size={14} className={isOpen ? 'is-open' : ''} />
          <span className="printer-calibration-panel__section-title"><Wrench size={15} /> Wear tracking</span>
        </button>
        <button type="button" onClick={seedDefaultComponents}>
          <Plus size={13} /> Defaults
        </button>
      </div>
      {isOpen && (
        <div id="wear-tracking-section" className="printer-calibration-panel__section-body">
          <div className="printer-calibration-panel__rows">
            {componentStatuses.map(({ component, status, hoursRemaining, filamentKmRemaining }) => (
              <div key={component.id} className={`printer-calibration-panel__component is-${status}`}>
                <div>
                  <strong>{component.name}</strong>
                  <span>
                    {hoursRemaining !== null ? `${Math.max(0, Math.round(hoursRemaining))}h left` : 'No hour reminder'}
                    {' - '}
                    {filamentKmRemaining !== null ? `${Math.max(0, filamentKmRemaining).toFixed(1)}km filament left` : 'No filament reminder'}
                  </span>
                </div>
                <div className="printer-calibration-panel__component-inputs">
                  <label><span>Hours</span><input type="number" min={0} value={component.hoursOn} onChange={(event) => {
                    const hoursOn = parseNonNegativeNumber(event.target.value);
                    if (hoursOn !== null) updateComponent(component.id, { hoursOn });
                  }} /></label>
                  <label><span>km</span><input type="number" min={0} step={0.1} value={component.filamentKm} onChange={(event) => {
                    const filamentKm = parseNonNegativeNumber(event.target.value);
                    if (filamentKm !== null) updateComponent(component.id, { filamentKm });
                  }} /></label>
                  <label><span>Due h</span><input type="number" min={0} value={component.reminderHours ?? ''} onChange={(event) => {
                    const reminderHours = parseOptionalNonNegativeNumber(event.target.value);
                    if (reminderHours !== undefined) updateComponent(component.id, { reminderHours: reminderHours ?? null });
                  }} /></label>
                  <label><span>Due km</span><input type="number" min={0} step={0.1} value={component.reminderFilamentKm ?? ''} onChange={(event) => {
                    const reminderFilamentKm = parseOptionalNonNegativeNumber(event.target.value);
                    if (reminderFilamentKm !== undefined) updateComponent(component.id, { reminderFilamentKm: reminderFilamentKm ?? null });
                  }} /></label>
                </div>
                <div className="printer-calibration-panel__component-actions">
                  <button type="button" title="Record replacement" onClick={() => recordReplacement(component)}>
                    <RefreshCw size={13} />
                  </button>
                  <button type="button" title="Remove component" onClick={() => removeComponent(component.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            {componentStatuses.length === 0 && (
              <div className="printer-calibration-panel__empty">Add the default component register to start wear reminders.</div>
            )}
          </div>
          <div className="printer-calibration-panel__add-component">
            <input value={newComponentName} placeholder="Component name" onChange={(event) => setNewComponentName(event.target.value)} />
            <select value={newComponentCategory} onChange={(event) => setNewComponentCategory(event.target.value as WearComponent['category'])}>
              <option value="nozzle">Nozzle</option>
              <option value="belt">Belt</option>
              <option value="bearing">Bearing</option>
              <option value="hotend">Hotend</option>
              <option value="build-plate">Build plate</option>
              <option value="other">Other</option>
            </select>
            <input value={newComponentHours} placeholder="Reminder h" type="number" min={0} onChange={(event) => setNewComponentHours(event.target.value)} />
            <input value={newComponentFilamentKm} placeholder="Reminder km" type="number" min={0} step={0.1} onChange={(event) => setNewComponentFilamentKm(event.target.value)} />
            <button type="button" onClick={addCustomComponent}><Plus size={13} /> Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
