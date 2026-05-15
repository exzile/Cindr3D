/**
 * FilamentMoistureSection — collapsible moisture profile for the loaded
 * spool (opened-at date, ambient RH%, sensor label) plus the printer-
 * level service log entry form and recent log entries.
 *
 * Owns the service-summary draft. The shared servicePerson + serviceCost
 * fields come in from the host since they're also used by the wear
 * section's record-replacement flow.
 */
import { useState } from 'react';
import { ChevronDown, Droplets, Plus } from 'lucide-react';
import type {
  ServiceLogEntry, SpoolMoistureProfile, MoistureStatus,
} from '../../../store/calibrationStore';
import { formatDate, parseNonNegativeNumber, parseOptionalNonNegativeNumber, statusLabel } from './calibrationHelpers';

interface LoadedSpool { id: string; brand: string; material: string }

export interface FilamentMoistureSectionProps {
  isOpen: boolean;
  setIsOpen: (updater: (open: boolean) => boolean) => void;

  loadedSpool: LoadedSpool | null;
  moistureProfile: SpoolMoistureProfile | null;
  moistureStatus: MoistureStatus | null;
  upsertMoistureProfile: (spoolId: string, changes: Partial<SpoolMoistureProfile>) => void;

  activePrinterId: string;
  serviceLog: ServiceLogEntry[];
  servicePerson: string;
  setServicePerson: (next: string) => void;
  serviceCost: string;
  setServiceCost: (next: string) => void;
  logService: (entry: {
    printerId: string;
    componentId: string | null;
    summary: string;
    performedBy: string;
    cost: number | null;
  }) => void;
}

export function FilamentMoistureSection(props: FilamentMoistureSectionProps) {
  const {
    isOpen, setIsOpen,
    loadedSpool, moistureProfile, moistureStatus, upsertMoistureProfile,
    activePrinterId, serviceLog, logService,
    servicePerson, setServicePerson, serviceCost, setServiceCost,
  } = props;

  const [serviceSummary, setServiceSummary] = useState('');

  const addServiceLogEntry = () => {
    const summaryText = serviceSummary.trim();
    if (!summaryText) return;
    const cost = parseOptionalNonNegativeNumber(serviceCost);
    if (cost === undefined) return;
    logService({
      printerId: activePrinterId,
      componentId: null,
      summary: summaryText,
      performedBy: servicePerson.trim() || 'Local user',
      cost: cost ?? null,
    });
    setServiceSummary('');
    setServiceCost('');
  };

  return (
    <div className="printer-calibration-panel__section printer-calibration-panel__section--moisture">
      <div className="printer-calibration-panel__section-head">
        <button
          type="button"
          className="printer-calibration-panel__section-toggle"
          aria-expanded={isOpen}
          aria-controls="filament-moisture-section"
          onClick={() => setIsOpen((open) => !open)}
        >
          <ChevronDown size={14} className={isOpen ? 'is-open' : ''} />
          <span className="printer-calibration-panel__section-title"><Droplets size={15} /> Filament moisture</span>
        </button>
      </div>
      {isOpen && (
        <div id="filament-moisture-section" className="printer-calibration-panel__section-body">
          {loadedSpool ? (
            <div className={`printer-calibration-panel__moisture is-${moistureStatus?.status ?? 'never'}`}>
              <strong>{loadedSpool.brand} {loadedSpool.material}</strong>
              <span>{moistureStatus ? statusLabel(moistureStatus.status) : 'Not opened'}</span>
              <div className="printer-calibration-panel__component-inputs">
                <label>
                  <span>Opened</span>
                  <input
                    type="date"
                    value={moistureProfile?.openedAt ? new Date(moistureProfile.openedAt).toISOString().slice(0, 10) : ''}
                    onChange={(event) => upsertMoistureProfile(loadedSpool.id, { openedAt: event.target.value ? new Date(`${event.target.value}T12:00:00`).getTime() : null })}
                  />
                </label>
                <label>
                  <span>RH%</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={moistureProfile?.ambientHumidityPct ?? 50}
                    onChange={(event) => {
                      const ambientHumidityPct = parseNonNegativeNumber(event.target.value);
                      if (ambientHumidityPct !== null) {
                        upsertMoistureProfile(loadedSpool.id, { ambientHumidityPct: Math.min(100, ambientHumidityPct) });
                      }
                    }}
                  />
                </label>
                <label>
                  <span>Sensor</span>
                  <input
                    value={moistureProfile?.sensorLabel ?? ''}
                    placeholder="Manual"
                    onChange={(event) => upsertMoistureProfile(loadedSpool.id, { sensorLabel: event.target.value })}
                  />
                </label>
              </div>
              {moistureStatus && (
                <p>{moistureStatus.exposureDays?.toFixed(1)} days exposed at {moistureStatus.profile.ambientHumidityPct}% RH.</p>
              )}
            </div>
          ) : (
            <div className="printer-calibration-panel__empty">Load or select a spool to model moisture exposure.</div>
          )}

          <div className="printer-calibration-panel__service-log">
            <h4>Service log</h4>
            <div className="printer-calibration-panel__service-form">
              <input value={serviceSummary} placeholder="Service note" onChange={(event) => setServiceSummary(event.target.value)} />
              <input value={servicePerson} placeholder="Performed by" onChange={(event) => setServicePerson(event.target.value)} />
              <input value={serviceCost} placeholder="Cost" type="number" min={0} step={0.01} onChange={(event) => setServiceCost(event.target.value)} />
              <button type="button" onClick={addServiceLogEntry}><Plus size={13} /> Log</button>
            </div>
            {serviceLog.filter((entry) => entry.printerId === activePrinterId).slice(0, 4).map((entry) => (
              <div key={entry.id}>
                <strong>{entry.summary}</strong>
                <span>{formatDate(entry.performedAt)} - {entry.performedBy}{entry.cost !== null ? ` - $${entry.cost.toFixed(2)}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
