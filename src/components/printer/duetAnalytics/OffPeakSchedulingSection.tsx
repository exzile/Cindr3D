/**
 * OffPeakSchedulingSection — three-panel grid below the analytics tables:
 *
 *   • TOU windows editor (label / tier / rate / time / days + list + delete)
 *   • Cheapest-window planner (file path + duration → cheapest start
 *     proposal + utility-API rate-feed config)
 *   • Solar-aware gate (provider config, current vs. minimum surplus,
 *     allowed/blocked status pill)
 *
 * Owns its own form-draft state (touTier / touLabel / touRate / touStart /
 * touEnd / touDays / plannerFilePath / plannerDurationHours) since none of
 * it is read outside this section.
 */
import { useMemo, useState } from 'react';
import { CalendarPlus, Leaf, Trash2 } from 'lucide-react';
import type {
  CheapestPrintWindow, DayOfWeek, ScheduledPrint, SolarGateResult,
  SolarIntegrationConfig, SolarProvider, TOUTier, TOUWindow,
  UtilityRateConfig,
} from '../../../store/schedulingStore';
import {
  ALL_DAYS, DAY_LABELS, SOLAR_PROVIDER_LABELS, TIER_LABELS,
  fileNameFromPath, fmtLocalDateTime, fmtMoney, parseTimeParts,
} from './helpers';

export interface OffPeakSchedulingSectionProps {
  planningPrinterId: string | null;
  planningPrinterName: string;
  printerTouWindows: TOUWindow[];
  utilityConfig: UtilityRateConfig | null;
  solarConfig: SolarIntegrationConfig | null;
  printerWatts: number;
  nowMs: number;
  addTOUWindow: (window: Omit<TOUWindow, 'id'>) => string;
  removeTOUWindow: (id: string) => void;
  upsertUtilityRateConfig: (printerId: string, changes: Partial<UtilityRateConfig>) => void;
  upsertSolarIntegrationConfig: (printerId: string, changes: Partial<SolarIntegrationConfig>) => void;
  schedulePrintAtCheapestWindow: (entry: Omit<ScheduledPrint, 'id' | 'createdAt' | 'scheduledStart'> & {
    earliestStart: number;
    printerWatts?: number;
    horizonHours?: number;
  }) => string | null;
  findCheapestStart: (
    printerId: string | null,
    earliestStart: number,
    estimatedDurationMs: number,
    printerWatts?: number,
    horizonHours?: number,
  ) => CheapestPrintWindow | null;
  canStartWithSolarSurplus: (printerId: string, requiredWatts?: number) => SolarGateResult;
}

export function OffPeakSchedulingSection(props: OffPeakSchedulingSectionProps) {
  const {
    planningPrinterId, planningPrinterName,
    printerTouWindows, utilityConfig, solarConfig,
    printerWatts, nowMs,
    addTOUWindow, removeTOUWindow,
    upsertUtilityRateConfig, upsertSolarIntegrationConfig,
    schedulePrintAtCheapestWindow,
    findCheapestStart, canStartWithSolarSurplus,
  } = props;

  const [touTier, setTouTier] = useState<TOUTier>('off-peak');
  const [touLabel, setTouLabel] = useState('Off-peak');
  const [touRate, setTouRate] = useState(0.08);
  const [touStart, setTouStart] = useState('22:00');
  const [touEnd, setTouEnd] = useState('06:00');
  const [touDays, setTouDays] = useState<DayOfWeek[]>(ALL_DAYS);
  const [plannerFilePath, setPlannerFilePath] = useState('0:/gcodes/next-print.gcode');
  const [plannerDurationHours, setPlannerDurationHours] = useState(4);

  const cheapestWindow = useMemo(
    () => findCheapestStart(
      planningPrinterId,
      nowMs,
      Math.max(0, plannerDurationHours) * 3_600_000,
      printerWatts,
      168,
    ),
    [findCheapestStart, planningPrinterId, nowMs, plannerDurationHours, printerWatts],
  );
  const solarGate = useMemo(
    () => planningPrinterId ? canStartWithSolarSurplus(planningPrinterId, printerWatts) : null,
    [canStartWithSolarSurplus, planningPrinterId, printerWatts],
  );

  const toggleTouDay = (day: DayOfWeek) => {
    setTouDays((prev) => (
      prev.includes(day)
        ? prev.filter((candidate) => candidate !== day)
        : [...prev, day].sort()
    ));
  };

  const addTouRateWindow = () => {
    if (touDays.length === 0) return;
    const [startHour, startMinute] = parseTimeParts(touStart);
    const [endHour, endMinute] = parseTimeParts(touEnd);
    addTOUWindow({
      printerId: planningPrinterId,
      label: touLabel.trim() || TIER_LABELS[touTier],
      tier: touTier,
      ratePerKwh: Math.max(0, touRate),
      days: touDays,
      startHour, startMinute, endHour, endMinute,
    });
  };

  const scheduleCheapestPrint = () => {
    const filePath = plannerFilePath.trim();
    if (!filePath || !cheapestWindow) return;
    schedulePrintAtCheapestWindow({
      jobId: null,
      filePath,
      fileName: fileNameFromPath(filePath),
      printerId: planningPrinterId,
      earliestStart: nowMs,
      estimatedDurationMs: Math.max(0, plannerDurationHours) * 3_600_000,
      note: `Auto-scheduled for ${cheapestWindow.label} at ${fmtMoney(cheapestWindow.ratePerKwh)}/kWh.`,
      status: 'scheduled',
      printerWatts,
      horizonHours: 168,
    });
  };

  return (
    <div className="duet-analytics__tou">
      <div className="duet-analytics__section-title">
        <CalendarPlus size={11} /> Off-peak scheduling
      </div>

      <div className="duet-analytics__tou-grid">
        <div className="duet-analytics__tou-panel">
          <div className="duet-analytics__tou-heading">{planningPrinterName} TOU windows</div>
          <div className="duet-analytics__tou-form">
            <input
              type="text"
              value={touLabel}
              onChange={(e) => setTouLabel(e.target.value)}
              placeholder="Window label"
            />
            <select value={touTier} onChange={(e) => setTouTier(e.target.value as TOUTier)}>
              {Object.entries(TIER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              step={0.01}
              value={touRate}
              onChange={(e) => setTouRate(Math.max(0, Number(e.target.value) || 0))}
              aria-label="Rate per kWh"
            />
            <span>$/kWh</span>
            <input type="time" value={touStart} onChange={(e) => setTouStart(e.target.value)} />
            <input type="time" value={touEnd} onChange={(e) => setTouEnd(e.target.value)} />
          </div>
          <div className="duet-analytics__day-chips">
            {DAY_LABELS.map((day, index) => (
              <button
                key={day}
                type="button"
                className={touDays.includes(index as DayOfWeek) ? 'active' : ''}
                onClick={() => toggleTouDay(index as DayOfWeek)}
              >
                {day.slice(0, 2)}
              </button>
            ))}
            <button type="button" className="duet-analytics__tou-add" onClick={addTouRateWindow}>
              Add
            </button>
          </div>

          <div className="duet-analytics__tou-list">
            {printerTouWindows.length === 0 && (
              <div className="duet-analytics__empty-row">No TOU windows configured for this printer.</div>
            )}
            {printerTouWindows.map((window) => (
              <div key={window.id} className={`duet-analytics__tou-row duet-analytics__tou-row--${window.tier}`}>
                <span>{window.label}</span>
                <span>{TIER_LABELS[window.tier]}</span>
                <span>{fmtMoney(window.ratePerKwh)}/kWh</span>
                <span>{String(window.startHour).padStart(2, '0')}:{String(window.startMinute).padStart(2, '0')} - {String(window.endHour).padStart(2, '0')}:{String(window.endMinute).padStart(2, '0')}</span>
                <button type="button" onClick={() => removeTOUWindow(window.id)} title="Remove TOU window">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="duet-analytics__tou-panel">
          <div className="duet-analytics__tou-heading">Cheapest-window planner</div>
          <div className="duet-analytics__planner">
            <input
              type="text"
              value={plannerFilePath}
              onChange={(e) => setPlannerFilePath(e.target.value)}
              placeholder="0:/gcodes/file.gcode"
            />
            <label>
              Duration
              <input
                type="number"
                min={0}
                step={0.25}
                value={plannerDurationHours}
                onChange={(e) => setPlannerDurationHours(Math.max(0, Number(e.target.value) || 0))}
              />
              h
            </label>
          </div>
          <div className="duet-analytics__planner-result">
            {cheapestWindow ? (
              <>
                <strong>{fmtLocalDateTime(cheapestWindow.start)}</strong>
                <span>{cheapestWindow.label} · {fmtMoney(cheapestWindow.ratePerKwh)}/kWh · est. {fmtMoney(cheapestWindow.estimatedEnergyCost)}</span>
              </>
            ) : (
              <span>No valid start window found.</span>
            )}
          </div>
          <button
            type="button"
            className="duet-analytics__schedule-btn"
            onClick={scheduleCheapestPrint}
            disabled={!plannerFilePath.trim() || !cheapestWindow}
          >
            <CalendarPlus size={12} /> Schedule cheapest start
          </button>

          <div className="duet-analytics__utility-config">
            <label>
              <input
                type="checkbox"
                checked={utilityConfig?.enabled ?? false}
                onChange={(e) => planningPrinterId && upsertUtilityRateConfig(planningPrinterId, { enabled: e.target.checked })}
                disabled={!planningPrinterId}
              />
              Utility API
            </label>
            <input
              type="url"
              value={utilityConfig?.url ?? ''}
              onChange={(e) => planningPrinterId && upsertUtilityRateConfig(planningPrinterId, { url: e.target.value })}
              placeholder="https://utility.example/rates"
              disabled={!planningPrinterId}
            />
            <select
              value={utilityConfig?.format ?? 'json'}
              onChange={(e) => planningPrinterId && upsertUtilityRateConfig(planningPrinterId, { format: e.target.value as 'json' | 'csv' })}
              disabled={!planningPrinterId}
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
            <input
              type="text"
              value={utilityConfig?.ratePath ?? 'rates'}
              onChange={(e) => planningPrinterId && upsertUtilityRateConfig(planningPrinterId, { ratePath: e.target.value })}
              placeholder="rate path"
              disabled={!planningPrinterId}
            />
          </div>
        </div>

        <div className="duet-analytics__tou-panel">
          <div className="duet-analytics__tou-heading">Solar-aware gate</div>
          <div className={`duet-analytics__solar-gate${solarGate?.allowed ? ' allowed' : ' blocked'}`}>
            <Leaf size={14} />
            <div>
              <strong>{solarGate?.allowed ? 'Ready on surplus' : 'Waiting for surplus'}</strong>
              <span>{solarGate?.reason ?? 'Select a printer to configure solar gating.'}</span>
            </div>
          </div>
          <div className="duet-analytics__utility-config">
            <label>
              <input
                type="checkbox"
                checked={solarConfig?.enabled ?? false}
                onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, { enabled: e.target.checked })}
                disabled={!planningPrinterId}
              />
              Solar gate
            </label>
            <select
              value={solarConfig?.provider ?? 'custom'}
              onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, { provider: e.target.value as SolarProvider })}
              disabled={!planningPrinterId}
            >
              {Object.entries(SOLAR_PROVIDER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input
              type="url"
              value={solarConfig?.endpointUrl ?? ''}
              onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, { endpointUrl: e.target.value })}
              placeholder="Solar API URL"
              disabled={!planningPrinterId}
            />
            <input
              type="password"
              value={solarConfig?.apiKey ?? ''}
              onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, { apiKey: e.target.value })}
              placeholder="API key"
              disabled={!planningPrinterId}
            />
          </div>
          <div className="duet-analytics__planner">
            <label>
              Current surplus
              <input
                type="number"
                min={0}
                step={50}
                value={solarConfig?.currentSurplusW ?? 0}
                onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, {
                  currentSurplusW: Math.max(0, Number(e.target.value) || 0),
                  lastReadAt: Date.now(),
                })}
                disabled={!planningPrinterId}
              />
              W
            </label>
            <label>
              Minimum
              <input
                type="number"
                min={0}
                step={50}
                value={solarConfig?.minSurplusW ?? 500}
                onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, {
                  minSurplusW: Math.max(0, Number(e.target.value) || 0),
                })}
                disabled={!planningPrinterId}
              />
              W
            </label>
          </div>
          <div className="duet-analytics__planner-result">
            <strong>{solarGate ? `${solarGate.surplusW.toFixed(0)} W / ${solarGate.requiredW.toFixed(0)} W` : '--'}</strong>
            <span>{solarConfig?.lastReadAt ? `Last surplus read ${fmtLocalDateTime(solarConfig.lastReadAt)}` : 'No live surplus reading yet.'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
