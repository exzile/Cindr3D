import React from 'react';
import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle,
  Download,
  ExternalLink,
  Info,
  Loader2,
  Monitor,
  RefreshCw,
  Sparkles,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react';
import type {
  GitHubAsset,
  GitHubRelease,
  PanelDueConfig,
} from './helpers';
import { formatBytes, panelDueVariantLabel } from './helpers';
import type { PanelDueFlashed, PanelDueUpdateState } from '../../../types/panel-due.types';

export function PanelDueSection({
  bins,
  busy,
  connected,
  handleCheckPanelDueUpdate,
  handlePanelDueInstall,
  latestTag,
  loadPanelDueInfo,
  panelDueAsset,
  panelDueCheckError,
  panelDueCheckLoading,
  panelDueFlashed,
  panelDueInfo,
  panelDueLogRef,
  panelDueUpdate,
  publishedDate,
  release,
  setPanelDueAsset,
  setPanelDueUpdate,
  setShowPanelDueNotes,
  showPanelDueNotes,
}: {
  bins: GitHubAsset[];
  busy: boolean;
  connected: boolean;
  handleCheckPanelDueUpdate: () => void;
  handlePanelDueInstall: (asset: GitHubAsset) => void;
  latestTag: string;
  loadPanelDueInfo: () => void;
  panelDueAsset: GitHubAsset | null;
  panelDueCheckError?: string;
  panelDueCheckLoading: boolean;
  panelDueFlashed: { loaded: boolean; data?: PanelDueFlashed };
  panelDueInfo: { loading: boolean; loaded: boolean; configs: PanelDueConfig[]; error?: string };
  panelDueLogRef: React.MutableRefObject<HTMLPreElement | null>;
  panelDueUpdate: PanelDueUpdateState;
  publishedDate: string;
  release?: GitHubRelease;
  setPanelDueAsset: React.Dispatch<React.SetStateAction<GitHubAsset | null>>;
  setPanelDueUpdate: React.Dispatch<React.SetStateAction<PanelDueUpdateState>>;
  setShowPanelDueNotes: React.Dispatch<React.SetStateAction<boolean>>;
  showPanelDueNotes: boolean;
}) {
  const primaryCfg = panelDueInfo.configs.find((config) => config.checksum === 2 || config.checksum === 3) ?? panelDueInfo.configs[0];
  const checksumLabel =
    primaryCfg?.checksum === 2 ? 'CRC (PanelDue)' :
    primaryCfg?.checksum === 3 ? 'CRC + checksum' :
    primaryCfg?.checksum === 1 ? 'Checksum only' :
    primaryCfg?.checksum === 0 ? 'None' : undefined;
  const step = panelDueUpdate.step;

  return (
    <>
      <div className="duet-settings__page-title">PanelDue</div>

      {!connected && (
        <div className="duet-settings__banner duet-settings__banner--info">
          <Info size={16} /> Connect to a Duet board to detect and update a PanelDue.
        </div>
      )}

      <div className="ds-fw-hero">
        <div className="ds-fw-hero-head">
          <div className="ds-fw-hero-icon"><Monitor size={22} /></div>
          <div className="ds-fw-hero-title">
            <div className="ds-fw-hero-label">Detected PanelDue</div>
            <div className="ds-fw-hero-version">
              {!connected ? (
                <span className="duet-settings__dim-text">Not connected</span>
              ) : panelDueInfo.loading ? (
                <span className="duet-settings__dim-text"><Loader2 size={12} className="spin" /> Reading config.g...</span>
              ) : primaryCfg ? (
                <>
                  UART <strong>{primaryCfg.channel ?? '?'}</strong>
                  {primaryCfg.baud ? <> @ <strong>{primaryCfg.baud.toLocaleString()}</strong> bps</> : null}
                </>
              ) : panelDueInfo.loaded ? (
                <span className="duet-settings__dim-text">No M575 in config.g</span>
              ) : (
                <span className="duet-settings__dim-text">—</span>
              )}
            </div>
            {primaryCfg && checksumLabel && (
              <div className="ds-fw-hero-date">
                <Info size={10} /> {checksumLabel}
              </div>
            )}
            {panelDueFlashed.data && (
              <div className="ds-fw-hero-date" title={`Flashed ${panelDueFlashed.data.assetName}`}>
                <Zap size={10} /> Last flashed
                {panelDueFlashed.data.tag ? <> v<strong>{panelDueFlashed.data.tag}</strong></> : null}
                {panelDueFlashed.data.variant ? <> ({panelDueFlashed.data.variant})</> : null}
                {panelDueFlashed.data.flashedAt ? <> on {new Date(panelDueFlashed.data.flashedAt).toLocaleDateString()}</> : null}
              </div>
            )}
            {connected && (
              <button className="ds-fw-hero-rescan" onClick={loadPanelDueInfo} disabled={panelDueInfo.loading} title="Re-read 0:/sys/config.g">
                {panelDueInfo.loading ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
                {panelDueInfo.loading ? 'Re-scanning...' : 'Re-scan config.g'}
              </button>
            )}
          </div>
          <button
            className={`ds-check-btn${panelDueCheckLoading ? ' is-loading' : ''}`}
            onClick={handleCheckPanelDueUpdate}
            disabled={!connected || panelDueCheckLoading}
            title="Check GitHub for the latest PanelDue firmware"
          >
            <RefreshCw size={13} className={panelDueCheckLoading ? 'spin' : undefined} />
            {panelDueCheckLoading ? 'Checking...' : 'Check for updates'}
          </button>
        </div>

        {panelDueInfo.error && (
          <div className="ds-fw-update-card ds-fw-update-card--error">
            <AlertCircle size={16} />
            <div>
              <div className="ds-fw-update-title">Could not read config.g</div>
              <div className="ds-fw-update-detail">{panelDueInfo.error}</div>
            </div>
          </div>
        )}

        {panelDueCheckError && (
          <div className="ds-fw-update-card ds-fw-update-card--error">
            <AlertCircle size={16} />
            <div>
              <div className="ds-fw-update-title">Update check failed</div>
              <div className="ds-fw-update-detail">{panelDueCheckError}</div>
            </div>
          </div>
        )}

        {release && !panelDueCheckError && (
          <div className="ds-fw-update-card ds-fw-update-card--unknown">
            <div className="ds-fw-update-head">
              <div className="ds-fw-update-icon"><Sparkles size={18} /></div>
              <div className="ds-fw-update-info">
                <div className="ds-fw-update-title">Latest release: v{latestTag}</div>
                <div className="ds-fw-update-detail">
                  {release.name || `v${latestTag}`}
                  {publishedDate && <span className="ds-fw-update-date"> · Published {publishedDate}</span>}
                </div>
              </div>
              <a href={release.html_url} target="_blank" rel="noopener noreferrer" className="ds-fw-external-btn" title="View release on GitHub">
                <ExternalLink size={12} /> GitHub
              </a>
            </div>

            {bins.length === 0 ? (
              <div className="ds-fw-auto-update-row ds-fw-auto-update-row--warn">
                <div className="ds-fw-auto-update-hint">
                  <AlertCircle size={11} /> This release doesn't include a PanelDue <code>.bin</code> - visit the release page directly.
                </div>
              </div>
            ) : (
              <div className="ds-fw-assets">
                <div className="ds-fw-assets-label">
                  <Info size={10} /> Pick the variant that matches your PanelDue's screen size
                </div>

                <div className="ds-fw-auto-update-row">
                  <button className="ds-fw-update-action-btn" onClick={() => panelDueAsset && handlePanelDueInstall(panelDueAsset)} disabled={!connected || !panelDueAsset || busy}>
                    {step === 'downloading' ? (
                      <><Loader2 size={14} className="spin" /> Downloading {panelDueUpdate.progress}%</>
                    ) : step === 'uploading' ? (
                      <><Loader2 size={14} className="spin" /> Uploading {panelDueUpdate.progress}%</>
                    ) : step === 'installing' ? (
                      <><Loader2 size={14} className="spin" /> Flashing PanelDue...</>
                    ) : (
                      <><ArrowUpCircle size={14} /> Flash PanelDue{latestTag ? ` v${latestTag}` : ''}</>
                    )}
                  </button>
                  <div className="ds-fw-auto-update-hint">
                    Will upload{panelDueAsset ? <> <span className="duet-settings__mono">{panelDueAsset.name}</span> ({formatBytes(panelDueAsset.size)})</> : ' the selected variant'}
                    {' '}as <span className="duet-settings__mono">0:/firmware/PanelDueFirmware.bin</span> and run <span className="duet-settings__mono">M997 S4</span> · The Duet stays running; flashing takes ~30-60s and the PanelDue restarts on its own.
                  </div>
                </div>

                {step !== 'idle' && (
                  <div className={`ds-fw-auto-status ds-fw-auto-status--${step === 'done' ? 'reconnected' : step}`}>
                    <div className="ds-fw-auto-status-head">
                      <div className="ds-fw-auto-status-msg">
                        {step === 'downloading' && <><Download size={13} /> Downloading <span className="duet-settings__mono">{panelDueUpdate.assetName}</span></>}
                        {step === 'uploading' && <><UploadCloud size={13} /> Uploading to board</>}
                        {step === 'installing' && <><Zap size={13} /> Flashing PanelDue - waiting for the board to confirm</>}
                        {step === 'done' && !panelDueUpdate.timedOut && <><CheckCircle size={13} /> PanelDue firmware flashed successfully</>}
                        {step === 'done' && panelDueUpdate.timedOut && <><AlertCircle size={13} /> Flash finished without a confirmation - check the display</>}
                        {step === 'error' && <><AlertCircle size={13} /> Update failed</>}
                      </div>
                      {(step === 'done' || step === 'error') && (
                        <button className="ds-fw-auto-status-dismiss" onClick={() => setPanelDueUpdate({ step: 'idle', progress: 0 })} title="Dismiss">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    {step === 'downloading' && (
                      <div className="ds-fw-auto-progress-bar">
                        <div className="ds-fw-auto-progress-fill" style={{ width: `${panelDueUpdate.progress}%` }} />
                      </div>
                    )}
                    {step === 'uploading' && (
                      <div className="ds-fw-auto-progress-bar">
                        <div className="ds-fw-auto-progress-fill" style={{ width: `${panelDueUpdate.progress}%` }} />
                      </div>
                    )}
                    {step === 'error' && panelDueUpdate.error && <div className="ds-fw-auto-error">{panelDueUpdate.error}</div>}
                    {(step === 'installing' || step === 'done' || step === 'error') && panelDueUpdate.messages && panelDueUpdate.messages.length > 0 && (
                      <pre
                        ref={(node) => {
                          panelDueLogRef.current = node;
                          if (node) node.scrollTop = node.scrollHeight;
                        }}
                        className="ds-pd-reply-log"
                      >
                        {panelDueUpdate.messages.join('\n')}
                      </pre>
                    )}
                  </div>
                )}

                <div className="ds-pd-table" role="table" aria-label="PanelDue firmware variants">
                  <div className="ds-pd-table-head" role="row">
                    <span role="columnheader">Variant</span>
                    <span role="columnheader">File</span>
                    <span role="columnheader" className="ds-pd-col-size">Size</span>
                  </div>
                  {bins.map((asset) => {
                    const isPick = asset === panelDueAsset;
                    return (
                      <button key={asset.name} type="button" role="row" className={`ds-pd-row${isPick ? ' is-pick' : ''}`} onClick={() => setPanelDueAsset(asset)} disabled={busy} title={asset.name}>
                        <span role="cell" className="ds-pd-cell-variant">
                          {isPick ? <CheckCircle size={11} className="ds-pd-row-check" /> : <span className="ds-pd-row-bullet" aria-hidden />}
                          <span className="ds-pd-variant-label">{panelDueVariantLabel(asset.name)}</span>
                        </span>
                        <span role="cell" className="ds-pd-cell-name">{asset.name}</span>
                        <span role="cell" className="ds-pd-cell-size">{formatBytes(asset.size)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="ds-fw-asset-hint">
                  Click a row to select it, then press <strong>Flash PanelDue</strong>.
                </div>
              </div>
            )}

            {release.body && (
              <div className="ds-fw-notes-wrap">
                <button className="ds-fw-notes-toggle" onClick={() => setShowPanelDueNotes((value) => !value)}>
                  {showPanelDueNotes ? 'Hide' : 'Show'} release notes
                </button>
                {showPanelDueNotes && <pre className="ds-fw-notes">{release.body}</pre>}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
