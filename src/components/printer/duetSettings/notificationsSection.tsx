import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DuetPrefs, NotifSeverity } from '../../../utils/duetPrefs';
import {
  INTEGRATION_EVENTS,
  useIntegrationStore,
  type IntegrationEventType,
  type IntegrationTargetType,
} from '../../../store/integrationStore';
import { SettingRow, ToggleRow } from './common';

const INTEGRATION_EVENT_LABELS: Record<IntegrationEventType, string> = {
  PRINT_START: 'Print start',
  LAYER_CHANGE: 'Layer change',
  PAUSED: 'Paused',
  FAILED: 'Failed',
  DONE: 'Done',
};

export function NotificationsSection({
  activePrinterId,
  patchPrefs,
  prefs,
}: {
  activePrinterId: string | null;
  patchPrefs: (patch: Partial<DuetPrefs>) => void;
  prefs: DuetPrefs;
}) {
  const targets = useIntegrationStore((s) => s.targets);
  const rules = useIntegrationStore((s) => s.rules);
  const mqtt = useIntegrationStore((s) => s.mqtt);
  const addTarget = useIntegrationStore((s) => s.addTarget);
  const updateTarget = useIntegrationStore((s) => s.updateTarget);
  const removeTarget = useIntegrationStore((s) => s.removeTarget);
  const addRule = useIntegrationStore((s) => s.addRule);
  const updateRule = useIntegrationStore((s) => s.updateRule);
  const removeRule = useIntegrationStore((s) => s.removeRule);
  const updateMqtt = useIntegrationStore((s) => s.updateMqtt);

  const [targetDraft, setTargetDraft] = useState({
    name: '',
    type: 'webhook' as IntegrationTargetType,
    url: '',
    token: '',
    chatId: '',
  });
  const [ruleDraft, setRuleDraft] = useState({
    name: '',
    printerId: null as string | null,
    targetIds: [] as string[],
    events: [...INTEGRATION_EVENTS] as IntegrationEventType[],
  });

  const toggleDraftEvent = (eventType: IntegrationEventType) => {
    setRuleDraft((draft) => {
      const events = draft.events.includes(eventType)
        ? draft.events.filter((item) => item !== eventType)
        : [...draft.events, eventType];
      return { ...draft, events };
    });
  };

  const toggleDraftTarget = (targetId: string) => {
    setRuleDraft((draft) => {
      const targetIds = draft.targetIds.includes(targetId)
        ? draft.targetIds.filter((item) => item !== targetId)
        : [...draft.targetIds, targetId];
      return { ...draft, targetIds };
    });
  };

  const handleAddTarget = () => {
    if (targetDraft.type !== 'telegram' && !targetDraft.url.trim()) return;
    if (targetDraft.type === 'telegram' && (!targetDraft.token.trim() || !targetDraft.chatId.trim())) return;
    addTarget(targetDraft);
    setTargetDraft({ name: '', type: 'webhook', url: '', token: '', chatId: '' });
  };

  const handleAddRule = () => {
    if (ruleDraft.targetIds.length === 0 || ruleDraft.events.length === 0) return;
    addRule({
      name: ruleDraft.name,
      printerId: ruleDraft.printerId,
      targetIds: ruleDraft.targetIds,
      events: ruleDraft.events,
      includeTemperatures: true,
      includePosition: true,
    });
    setRuleDraft({ name: '', printerId: null, targetIds: [], events: [...INTEGRATION_EVENTS] });
  };

  const canAddTarget = targetDraft.type === 'telegram'
    ? targetDraft.token.trim().length > 0 && targetDraft.chatId.trim().length > 0
    : targetDraft.url.trim().length > 0;
  const canAddRule = ruleDraft.targetIds.length > 0 && ruleDraft.events.length > 0;

  return (
    <>
      <div className="duet-settings__page-title">Notifications</div>
      <SettingRow
        label="Toast Duration"
        hint="How long notification toasts stay visible before auto-dismissing."
        control={
          <select className="duet-settings__select" value={prefs.toastDurationMs} onChange={(e) => patchPrefs({ toastDurationMs: Number(e.target.value) })}>
            <option value={3000}>3 seconds</option>
            <option value={5000}>5 seconds</option>
            <option value={8000}>8 seconds</option>
            <option value={12000}>12 seconds</option>
          </select>
        }
      />
      <ToggleRow
        id="notif-sound"
        checked={prefs.notificationsSound}
        onChange={(value) => patchPrefs({ notificationsSound: value })}
        label="Play sound on beep events"
        hint="Trigger a short tone when the firmware emits a beep command."
      />
      <ToggleRow
        id="sound-alert-complete"
        checked={prefs.soundAlertOnComplete}
        onChange={(value) => patchPrefs({ soundAlertOnComplete: value })}
        label="Sound alert on print complete/error"
        hint="Play a notification sound when a print finishes or encounters an error."
      />
      <SettingRow
        label="Minimum Severity"
        hint="Only show toasts at or above this severity level."
        control={
          <select className="duet-settings__select" value={prefs.notifMinSeverity} onChange={(e) => patchPrefs({ notifMinSeverity: e.target.value as NotifSeverity })}>
            <option value="info">Info and above</option>
            <option value="warning">Warning and above</option>
            <option value="error">Errors only</option>
          </select>
        }
      />

      <div className="duet-settings__section duet-settings__section--mt">
        <div className="duet-settings__section-title">Integration Targets</div>
        <div className="duet-settings__integration-form">
          <input
            className="duet-settings__input"
            type="text"
            value={targetDraft.name}
            onChange={(e) => setTargetDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Target name"
          />
          <select
            className="duet-settings__select"
            value={targetDraft.type}
            onChange={(e) => setTargetDraft((d) => ({ ...d, type: e.target.value as IntegrationTargetType }))}
          >
            <option value="webhook">Generic webhook</option>
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
            <option value="telegram">Telegram</option>
          </select>
          {targetDraft.type === 'telegram' ? (
            <>
              <input
                className="duet-settings__input"
                type="password"
                value={targetDraft.token}
                onChange={(e) => setTargetDraft((d) => ({ ...d, token: e.target.value }))}
                placeholder="Bot token"
              />
              <input
                className="duet-settings__input"
                type="text"
                value={targetDraft.chatId}
                onChange={(e) => setTargetDraft((d) => ({ ...d, chatId: e.target.value }))}
                placeholder="Chat ID"
              />
            </>
          ) : (
            <input
              className="duet-settings__input duet-settings__integration-url"
              type="url"
              value={targetDraft.url}
              onChange={(e) => setTargetDraft((d) => ({ ...d, url: e.target.value }))}
              placeholder={targetDraft.type === 'webhook' ? 'POST URL' : 'Incoming webhook URL'}
            />
          )}
          <button
            className={`duet-settings__btn duet-settings__btn--primary${canAddTarget ? '' : ' duet-settings__btn--disabled'}`}
            onClick={handleAddTarget}
            disabled={!canAddTarget}
          >
            <Plus size={14} /> Add Target
          </button>
        </div>

        {targets.length === 0 ? (
          <div className="duet-settings__empty">No integration targets configured.</div>
        ) : (
          <div className="duet-settings__integration-list">
            {targets.map((target) => (
              <div key={target.id} className="duet-settings__integration-item">
                <label className="duet-settings__integration-toggle">
                  <input
                    className="duet-settings__checkbox"
                    type="checkbox"
                    checked={target.enabled}
                    onChange={(e) => updateTarget(target.id, { enabled: e.target.checked })}
                  />
                  <span>
                    <strong>{target.name}</strong>
                    <small>{target.type}{target.url ? ` - ${target.url.replace(/^https?:\/\//, '')}` : target.chatId ? ` - ${target.chatId}` : ''}</small>
                  </span>
                </label>
                <button className="duet-settings__icon-btn duet-settings__icon-btn--danger" onClick={() => removeTarget(target.id)} title="Remove target">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="duet-settings__section duet-settings__section--mt">
        <div className="duet-settings__section-title">Notification Rules</div>
        <div className="duet-settings__integration-form duet-settings__integration-form--rule">
          <input
            className="duet-settings__input"
            type="text"
            value={ruleDraft.name}
            onChange={(e) => setRuleDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Rule name"
          />
          <select
            className="duet-settings__select"
            value={ruleDraft.printerId ? 'current' : 'global'}
            onChange={(e) => setRuleDraft((d) => ({
              ...d,
              printerId: e.target.value === 'current' ? activePrinterId : null,
            }))}
          >
            <option value="global">All printers</option>
            <option value="current" disabled={!activePrinterId}>Current printer only</option>
          </select>
        </div>

        <div className="duet-settings__integration-pick-group">
          <div className="duet-settings__hint">Events</div>
          <div className="duet-settings__integration-chip-row">
            {INTEGRATION_EVENTS.map((eventType) => (
              <label key={eventType} className="duet-settings__integration-chip">
                <input type="checkbox" checked={ruleDraft.events.includes(eventType)} onChange={() => toggleDraftEvent(eventType)} />
                <span>{INTEGRATION_EVENT_LABELS[eventType]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="duet-settings__integration-pick-group">
          <div className="duet-settings__hint">Targets</div>
          {targets.length === 0 ? (
            <div className="duet-settings__empty">Add at least one target before creating a rule.</div>
          ) : (
            <div className="duet-settings__integration-chip-row">
              {targets.map((target) => (
                <label key={target.id} className="duet-settings__integration-chip">
                  <input type="checkbox" checked={ruleDraft.targetIds.includes(target.id)} onChange={() => toggleDraftTarget(target.id)} />
                  <span>{target.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="duet-settings__btn-row">
          <button
            className={`duet-settings__btn duet-settings__btn--primary${canAddRule ? '' : ' duet-settings__btn--disabled'}`}
            onClick={handleAddRule}
            disabled={!canAddRule}
          >
            <Plus size={14} /> Add Rule
          </button>
        </div>

        {rules.length > 0 && (
          <div className="duet-settings__integration-list">
            {rules.map((rule) => (
              <div key={rule.id} className="duet-settings__integration-item">
                <label className="duet-settings__integration-toggle">
                  <input
                    className="duet-settings__checkbox"
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                  />
                  <span>
                    <strong>{rule.name}</strong>
                    <small>{rule.printerId ? 'Current printer scope' : 'All printers'} - {rule.events.map((eventType) => INTEGRATION_EVENT_LABELS[eventType]).join(', ')}</small>
                  </span>
                </label>
                <button className="duet-settings__icon-btn duet-settings__icon-btn--danger" onClick={() => removeRule(rule.id)} title="Remove rule">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="duet-settings__section duet-settings__section--mt">
        <div className="duet-settings__section-title">MQTT Publisher</div>
        <ToggleRow
          id="mqtt-enabled"
          checked={mqtt.enabled}
          onChange={(value) => updateMqtt({ enabled: value })}
          label="Enable MQTT publishing"
          hint="Publishes print events and live telemetry to an MQTT broker over WebSocket."
        />
        <div className="duet-settings__integration-form duet-settings__integration-form--mqtt">
          <input className="duet-settings__input" type="url" value={mqtt.brokerUrl} onChange={(e) => updateMqtt({ brokerUrl: e.target.value })} placeholder="ws://broker.local:9001/mqtt" />
          <input className="duet-settings__input" type="text" value={mqtt.topicPrefix} onChange={(e) => updateMqtt({ topicPrefix: e.target.value })} placeholder="Topic prefix" />
          <input className="duet-settings__input" type="text" value={mqtt.clientId} onChange={(e) => updateMqtt({ clientId: e.target.value })} placeholder="Client ID (optional)" />
        </div>
        <div className="duet-settings__integration-form duet-settings__integration-form--mqtt">
          <input className="duet-settings__input" type="text" value={mqtt.username} onChange={(e) => updateMqtt({ username: e.target.value })} placeholder="Username" />
          <input className="duet-settings__input" type="password" value={mqtt.password} onChange={(e) => updateMqtt({ password: e.target.value })} placeholder="Password" />
          <select className="duet-settings__select" value={mqtt.publishRateMs} onChange={(e) => updateMqtt({ publishRateMs: Number(e.target.value) })}>
            <option value={1000}>Telemetry every 1 second</option>
            <option value={2500}>Telemetry every 2.5 seconds</option>
            <option value={5000}>Telemetry every 5 seconds</option>
            <option value={10000}>Telemetry every 10 seconds</option>
            <option value={30000}>Telemetry every 30 seconds</option>
          </select>
        </div>
        <div className="duet-settings__integration-chip-row">
          <label className="duet-settings__integration-chip">
            <input type="checkbox" checked={mqtt.includeEvents} onChange={(e) => updateMqtt({ includeEvents: e.target.checked })} />
            <span>Print events</span>
          </label>
          <label className="duet-settings__integration-chip">
            <input type="checkbox" checked={mqtt.includeTelemetry} onChange={(e) => updateMqtt({ includeTelemetry: e.target.checked })} />
            <span>Temperatures and position</span>
          </label>
        </div>
        <div className="duet-settings__hint">
          Topics publish under {mqtt.topicPrefix || 'cindr3d'}/printers/&lt;printer&gt;/events/* and telemetry.
        </div>
      </div>
    </>
  );
}
