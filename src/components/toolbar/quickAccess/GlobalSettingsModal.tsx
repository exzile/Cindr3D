import { Bot, Download, FileUp, FolderOpen, Moon, Save, Settings, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { SUPPORTED_LANGUAGES, translate, type LanguageCode } from '../../../i18n';
import { useLanguageStore } from '../../../store/languageStore';
import { useThemeStore } from '../../../store/themeStore';
import { PROVIDER_MODELS, useAiAssistantStore, type AiProvider } from '../../../store/aiAssistantStore';
import { useProfileSyncStore } from '../../../store/profileSyncStore';
import { normalizeProfileSyncUrl } from '../../../utils/profileSpoolSync';

type Tab = 'general' | 'sync' | 'ai';

export function GlobalSettingsModal({
  initialTab = 'general',
  isDesign,
  autoSaveInterval,
  onAutoSaveIntervalChange,
  offlineBundleAvailable,
  onLoadSettings,
  onRestoreOfflineSettings,
  onSaveSettingsAs,
  onPullProfileSync,
  onPushProfileSync,
  onExportProfileSync,
  onClose,
}: {
  initialTab?: Tab;
  isDesign: boolean;
  autoSaveInterval: number;
  onAutoSaveIntervalChange: (next: number) => void;
  offlineBundleAvailable: boolean;
  onLoadSettings: () => void;
  onRestoreOfflineSettings: () => void;
  onSaveSettingsAs: () => void;
  onPullProfileSync: () => void;
  onPushProfileSync: () => void;
  onExportProfileSync: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const reducedMotion = useThemeStore((s) => s.reducedMotion);
  const setReducedMotion = useThemeStore((s) => s.setReducedMotion);
  const highContrast = useThemeStore((s) => s.highContrast);
  const setHighContrast = useThemeStore((s) => s.setHighContrast);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);

  const aiProvider = useAiAssistantStore((s) => s.provider);
  const aiModel = useAiAssistantStore((s) => s.model);
  const aiApiKey = useAiAssistantStore((s) => s.apiKey);
  const aiUseClaudeCode = useAiAssistantStore((s) => s.useClaudeCode);
  const aiConfirmDestructive = useAiAssistantStore((s) => s.confirmDestructive);
  const setAiProvider = useAiAssistantStore((s) => s.setProvider);
  const setAiModel = useAiAssistantStore((s) => s.setModel);
  const setAiApiKey = useAiAssistantStore((s) => s.setApiKey);
  const setAiUseClaudeCode = useAiAssistantStore((s) => s.setUseClaudeCode);
  const setAiConfirmDestructive = useAiAssistantStore((s) => s.setConfirmDestructive);

  const profileSync = useProfileSyncStore();

  const profileSyncResolvedUrl = (() => {
    try {
      return profileSync.repoUrl.trim()
        ? normalizeProfileSyncUrl(profileSync.repoUrl, profileSync.branch, profileSync.syncPath)
        : '';
    } catch {
      return '';
    }
  })();

  return (
    <div className="global-settings-overlay" onClick={onClose}>
      <div className="global-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="global-settings-header">
          <div className="global-settings-icon">
            <Settings size={16} />
          </div>
          <div>
            <div className="global-settings-title">{translate(language, 'settings.globalTitle')}</div>
            <div className="global-settings-subtitle">{translate(language, 'settings.globalSubtitle')}</div>
          </div>
          <button
            type="button"
            className="global-settings-close"
            onClick={onClose}
            title={`${translate(language, 'app.action.close')} settings`}
            aria-label={`${translate(language, 'app.action.close')} settings`}
          >
            <X size={15} />
          </button>
        </div>

        <div className="global-settings-body">
          <nav className="global-settings-nav" aria-label="Global settings sections">
            <button
              type="button"
              className={`global-settings-nav-item ${tab === 'general' ? 'active' : ''}`}
              onClick={() => setTab('general')}
              aria-current={tab === 'general' ? 'page' : undefined}
            >
              <Settings size={15} />
              <span>{translate(language, 'settings.general')}</span>
            </button>
            <button
              type="button"
              className={`global-settings-nav-item ${tab === 'ai' ? 'active' : ''}`}
              onClick={() => setTab('ai')}
              aria-current={tab === 'ai' ? 'page' : undefined}
            >
              <Bot size={15} />
              <span>{translate(language, 'settings.aiAssistant')}</span>
            </button>
            <button
              type="button"
              className={`global-settings-nav-item ${tab === 'sync' ? 'active' : ''}`}
              onClick={() => setTab('sync')}
              aria-current={tab === 'sync' ? 'page' : undefined}
            >
              <Download size={15} />
              <span>{translate(language, 'settings.sync')}</span>
            </button>
          </nav>

          <div className="global-settings-content">
            {tab === 'general' && (
              <section className="global-settings-section">
                <div className="global-settings-section-title">{translate(language, 'settings.general')}</div>
                <div className="global-settings-section-copy">{translate(language, 'settings.generalDescription')}</div>
                <div className="global-settings-grid">
                  <button className="global-settings-action" onClick={toggleTheme}>
                    {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
                    <span>{theme === 'light' ? 'Dark theme' : 'Light theme'}</span>
                  </button>
                  <button className="global-settings-action" onClick={onLoadSettings}>
                    <FolderOpen size={15} />
                    <span>Load settings</span>
                  </button>
                  {offlineBundleAvailable && (
                    <button className="global-settings-action" onClick={onRestoreOfflineSettings}>
                      <FolderOpen size={15} />
                      <span>Load offline settings</span>
                    </button>
                  )}
                  <button className="global-settings-action" onClick={onSaveSettingsAs}>
                    <Save size={15} />
                    <span>Save settings as</span>
                  </button>
                  {isDesign && (
                    <label className="global-settings-field inline">
                      <span>Auto-save interval</span>
                      <select
                        className="settings-interval-select"
                        value={autoSaveInterval}
                        onChange={(e) => onAutoSaveIntervalChange(Number(e.target.value))}
                      >
                        <option value={15}>15s</option>
                        <option value={30}>30s</option>
                        <option value={60}>1 min</option>
                        <option value={120}>2 min</option>
                        <option value={300}>5 min</option>
                      </select>
                    </label>
                  )}
                  <div className="global-settings-field inline full">
                    <span>{translate(language, 'settings.language')}</span>
                    <select
                      className="settings-wide-select"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                      title={translate(language, 'settings.languageDescription')}
                    >
                      {SUPPORTED_LANGUAGES.map((option) => (
                        <option key={option.code} value={option.code}>
                          {translate(language, option.labelKey)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="global-settings-field inline full">
                    <span>Reduced motion</span>
                    <label className="tp-toggle">
                      <input
                        type="checkbox"
                        checked={reducedMotion}
                        onChange={(e) => setReducedMotion(e.target.checked)}
                      />
                      <span className="tp-toggle-track" />
                    </label>
                  </div>
                  <div className="global-settings-field inline full">
                    <span>High contrast</span>
                    <label className="tp-toggle">
                      <input
                        type="checkbox"
                        checked={highContrast}
                        onChange={(e) => setHighContrast(e.target.checked)}
                      />
                      <span className="tp-toggle-track" />
                    </label>
                  </div>
                </div>
              </section>
            )}

            {tab === 'sync' && (
              <section className="global-settings-section">
                <div className="global-settings-section-title">{translate(language, 'settings.profileSync')}</div>
                <div className="global-settings-section-copy">{translate(language, 'settings.profileSyncDescription')}</div>
                <div className="global-settings-grid">
                  <div className="global-settings-field inline full">
                    <span>Enable profile sync</span>
                    <label className="tp-toggle">
                      <input
                        type="checkbox"
                        checked={profileSync.enabled}
                        onChange={(e) => profileSync.setEnabled(e.target.checked)}
                      />
                      <span className="tp-toggle-track" />
                    </label>
                  </div>
                  <label className="global-settings-field full">
                    <span>Repository or raw JSON URL</span>
                    <input
                      type="url"
                      className="settings-api-key"
                      value={profileSync.repoUrl}
                      onChange={(e) => profileSync.setRepoUrl(e.target.value)}
                      placeholder="https://github.com/user/repo or raw JSON URL"
                    />
                  </label>
                  <label className="global-settings-field">
                    <span>Branch</span>
                    <input
                      type="text"
                      className="settings-api-key"
                      value={profileSync.branch}
                      onChange={(e) => profileSync.setBranch(e.target.value)}
                      placeholder="main"
                    />
                  </label>
                  <label className="global-settings-field">
                    <span>Sync path</span>
                    <input
                      type="text"
                      className="settings-api-key"
                      value={profileSync.syncPath}
                      onChange={(e) => profileSync.setSyncPath(e.target.value)}
                      placeholder="cindr3d-profile-sync.json"
                    />
                  </label>
                  <label className="global-settings-field full">
                    <span>GitHub token</span>
                    <input
                      type="password"
                      className="settings-api-key"
                      value={profileSync.githubToken}
                      onChange={(e) => profileSync.setGithubToken(e.target.value)}
                      placeholder="Fine-grained token with Contents read/write"
                      autoComplete="off"
                    />
                  </label>
                  <div className="global-settings-field inline full">
                    <span>Pull on app start</span>
                    <label className="tp-toggle">
                      <input
                        type="checkbox"
                        checked={profileSync.autoPullOnStart}
                        onChange={(e) => profileSync.setAutoPullOnStart(e.target.checked)}
                      />
                      <span className="tp-toggle-track" />
                    </label>
                  </div>
                  <div className="global-settings-field inline full">
                    <span>Push on profile or spool save</span>
                    <label className="tp-toggle">
                      <input
                        type="checkbox"
                        checked={profileSync.autoPushOnSave}
                        onChange={(e) => profileSync.setAutoPushOnSave(e.target.checked)}
                      />
                      <span className="tp-toggle-track" />
                    </label>
                  </div>
                  <button className="global-settings-action" onClick={onPushProfileSync} disabled={!profileSync.repoUrl.trim() || !profileSync.githubToken.trim()}>
                    <FileUp size={15} />
                    <span>Push now</span>
                  </button>
                  <button className="global-settings-action" onClick={onPullProfileSync} disabled={!profileSync.repoUrl.trim()}>
                    <Download size={15} />
                    <span>Pull now</span>
                  </button>
                  <button className="global-settings-action" onClick={onExportProfileSync}>
                    <Save size={15} />
                    <span>Export sync file</span>
                  </button>
                  <div className="global-settings-field full">
                    <span>Resolved URL</span>
                    <code className="profile-sync-resolved-url">{profileSyncResolvedUrl || 'Not configured'}</code>
                  </div>
                  <div className="global-settings-field full">
                    <span>Status</span>
                    <div className="profile-sync-status">
                      {profileSync.lastSyncStatus}
                      {profileSync.lastSyncAt ? ` at ${new Date(profileSync.lastSyncAt).toLocaleString()}` : ''}
                      {profileSync.lastSyncError ? ` - ${profileSync.lastSyncError}` : ''}
                      {profileSync.hasPendingChanges ? ` - pending push from ${profileSync.pendingUpdatedAt ? new Date(profileSync.pendingUpdatedAt).toLocaleString() : 'local edits'}` : ''}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {tab === 'ai' && (
              <section className="global-settings-section">
                <div className="global-settings-section-title">{translate(language, 'settings.aiAssistant')}</div>
                <div className="global-settings-section-copy">{translate(language, 'settings.aiDescription')}</div>
                <div className="global-settings-grid">
                  <div className="global-settings-field inline full">
                    <span>Use Claude Code MCP</span>
                    <label className="tp-toggle">
                      <input
                        type="checkbox"
                        checked={aiUseClaudeCode}
                        onChange={(e) => setAiUseClaudeCode(e.target.checked)}
                      />
                      <span className="tp-toggle-track" />
                    </label>
                  </div>
                  {!aiUseClaudeCode && (
                    <>
                      <label className="global-settings-field">
                        <span>Provider</span>
                        <select
                          className="settings-wide-select"
                          value={aiProvider}
                          onChange={(e) => setAiProvider(e.target.value as AiProvider)}
                        >
                          <option value="anthropic">Anthropic</option>
                          <option value="openai">OpenAI</option>
                          <option value="openrouter">OpenRouter</option>
                        </select>
                      </label>
                      <label className="global-settings-field">
                        <span>Model</span>
                        <select
                          className="settings-wide-select"
                          value={aiModel}
                          onChange={(e) => setAiModel(e.target.value)}
                        >
                          {PROVIDER_MODELS[aiProvider].map((modelName) => (
                            <option key={modelName} value={modelName}>{modelName}</option>
                          ))}
                        </select>
                      </label>
                      <label className="global-settings-field full">
                        <span>API key</span>
                        <input
                          type="password"
                          className="settings-api-key"
                          value={aiApiKey}
                          onChange={(e) => setAiApiKey(e.target.value)}
                          placeholder="Stored locally"
                          autoComplete="off"
                        />
                      </label>
                    </>
                  )}
                  <div className="global-settings-field inline full">
                    <span>Confirm destructive ops</span>
                    <label className="tp-toggle">
                      <input
                        type="checkbox"
                        checked={aiConfirmDestructive}
                        onChange={(e) => setAiConfirmDestructive(e.target.checked)}
                      />
                      <span className="tp-toggle-track" />
                    </label>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
