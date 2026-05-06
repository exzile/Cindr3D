import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { AlertTriangle, Pause, Wind } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import {
  AIR_QUALITY_SENSOR_LABELS,
  useAirQualityStore,
  type AirQualitySensorKey,
} from '../../../store/airQualityStore';
import { evaluateAirQuality } from '../../../services/integrations/airQuality';

const SENSOR_ORDER: AirQualitySensorKey[] = ['voc', 'pm25', 'co2'];
const SENSOR_UNITS: Record<AirQualitySensorKey, string> = {
  voc: 'ppb',
  pm25: 'ug/m3',
  co2: 'ppm',
};

function levelColor(level: string) {
  if (level === 'critical') return '#ef4444';
  if (level === 'warn') return '#f59e0b';
  return '#22c55e';
}

export default function AirQualityPanel() {
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const config = useAirQualityStore((s) => s.getPrinterAirQuality(activePrinterId));
  const updateConfig = useAirQualityStore((s) => s.updateAirQualityConfig);
  const updateSensor = useAirQualityStore((s) => s.updateAirQualitySensor);
  const status = useMemo(() => evaluateAirQuality(config), [config]);

  if (!activePrinterId) {
    return <div className="aq-empty">Connect a printer before configuring air-quality sensors.</div>;
  }

  return (
    <div className="aq-panel">
      <div className="aq-header">
        <div className="aq-status" style={{ '--aq-level': levelColor(status.level) } as CSSProperties}>
          {status.level === 'critical' ? <AlertTriangle size={14} /> : <Wind size={14} />}
          <span>{status.message}</span>
        </div>
        <label className="aq-toggle">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => updateConfig(activePrinterId, { enabled: event.target.checked })}
          />
          <span>Monitor</span>
        </label>
      </div>

      <div className="aq-grid">
        {SENSOR_ORDER.map((sensor) => {
          const sensorConfig = config.sensors[sensor];
          const reading = config.readings[sensor];
          const exceeded = status.exceeded.find((item) => item.sensor === sensor);
          const level = exceeded?.level ?? 'ok';
          return (
            <div
              key={sensor}
              className={`aq-sensor aq-sensor--${level}`}
              style={{ '--aq-sensor': levelColor(level) } as CSSProperties}
            >
              <div className="aq-sensor__top">
                <span>{AIR_QUALITY_SENSOR_LABELS[sensor]}</span>
                <strong>{reading.value === null ? '--' : reading.value.toFixed(0)} <small>{SENSOR_UNITS[sensor]}</small></strong>
              </div>
              <label>
                <span>Topic</span>
                <input
                  value={sensorConfig.topic}
                  placeholder={`shop/printer/${sensor}`}
                  onChange={(event) => updateSensor(activePrinterId, sensor, { topic: event.target.value })}
                />
              </label>
              <div className="aq-limits">
                <label>
                  <span>Warn</span>
                  <input
                    type="number"
                    value={sensorConfig.warnAt}
                    onChange={(event) => updateSensor(activePrinterId, sensor, { warnAt: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>Pause</span>
                  <input
                    type="number"
                    value={sensorConfig.pauseAt}
                    onChange={(event) => updateSensor(activePrinterId, sensor, { pauseAt: Number(event.target.value) })}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <label className="aq-pause">
        <input
          type="checkbox"
          checked={config.pauseOnCritical}
          onChange={(event) => updateConfig(activePrinterId, { pauseOnCritical: event.target.checked })}
        />
        <Pause size={13} />
        <span>Pause active print at critical threshold</span>
      </label>
    </div>
  );
}
