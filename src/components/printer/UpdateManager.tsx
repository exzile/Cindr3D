/**
 * UpdateManager — cross-firmware update checker.
 * All printers → checks a configured GitHub repo for new releases.
 * Klipper      → also delegates to KlipperUpdateManager (Moonraker component updates).
 */
import { useState, useCallback, useEffect } from 'react';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { ArrowUpCircle, RefreshCw, ExternalLink, Tag, GitBranch, Info, AlertCircle } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import KlipperUpdateManager from './KlipperUpdateManager';
import './KlipperTabs.css';

interface GithubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
  body: string;
  prerelease: boolean;
  draft: boolean;
}

// Repos to check — can be extended as more firmware integrations are added
const FIRMWARE_REPOS: Record<string, { owner: string; repo: string; label: string } | null> = {
  klipper: { owner: 'Klipper3d', repo: 'klipper', label: 'Klipper Firmware' },
  marlin: { owner: 'MarlinFirmware', repo: 'Marlin', label: 'Marlin Firmware' },
  duet: { owner: 'Duet3D', repo: 'RepRapFirmware', label: 'RepRapFirmware' },
  smoothie: { owner: 'Smoothieware', repo: 'Smoothieware', label: 'Smoothieware' },
  repetier: { owner: 'repetier', repo: 'Repetier-Firmware', label: 'Repetier Firmware' },
};

// Cindr3D's own release repo
const CINDR3D_REPO = { owner: 'exzile', repo: 'Cindr3D', label: 'Cindr3D' };

async function fetchLatestRelease(owner: string, repo: string): Promise<GithubRelease | null> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    // Use /github-proxy if it exists in the dev proxy config, otherwise go direct (CORS allowed by GitHub API)
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<GithubRelease>;
  } catch { return null; }
}

function ReleaseBanner({ release, label }: { release: GithubRelease; label: string }) {
  const date = new Date(release.published_at).toLocaleDateString();
  return (
    <div className="klipper-card">
      <div className="klipper-card-header">
        <Tag size={12} style={{ marginRight: 4 }} />{label}
        {release.prerelease && <span className="klipper-badge warn" style={{ marginLeft: 6 }}>Pre-release</span>}
      </div>
      <div className="klipper-card-body" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{release.tag_name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{release.name} · {date}</div>
        </div>
        <a
          href={release.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="klipper-btn"
          style={{ textDecoration: 'none', flexShrink: 0 }}
        >
          <ExternalLink size={13} /> View Release
        </a>
      </div>
    </div>
  );
}

function GithubReleaseChecker() {
  const boardType = usePrinterStore((s) => s.config.boardType ?? 'other');
  const firmwareRepo = FIRMWARE_REPOS[boardType] ?? null;

  const [firmwareRelease, setFirmwareRelease] = useState<GithubRelease | null>(null);
  const [cindr3dRelease, setCindr3dRelease] = useState<GithubRelease | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const run = useAsyncAction(setLoading, setError, 'Failed to reach GitHub API. Check your network connection.');
  const check = useCallback(async () => {
    await run(async () => {
      const [fw, dc] = await Promise.all([
        firmwareRepo ? fetchLatestRelease(firmwareRepo.owner, firmwareRepo.repo) : Promise.resolve(null),
        fetchLatestRelease(CINDR3D_REPO.owner, CINDR3D_REPO.repo),
      ]);
      setFirmwareRelease(fw);
      setCindr3dRelease(dc);
      setLastChecked(new Date());
    });
  }, [firmwareRepo, run]);

  useEffect(() => { void check(); }, [check]);

  return (
    <>
      <div className="klipper-tab-bar" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none', marginTop: 4 }}>
        <GitBranch size={14} />
        <h3 style={{ fontSize: 12 }}>GitHub Release Check</h3>
        <div className="spacer" />
        {lastChecked && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Last checked: {lastChecked.toLocaleTimeString()}
          </span>
        )}
        <button className="klipper-btn" onClick={check} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> Check Now
        </button>
      </div>

      {error && (
        <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
          <div className="klipper-card-body" style={{ flexDirection: 'row', gap: 8, color: '#ef4444', fontSize: 12 }}>
            <AlertCircle size={14} /> {error}
          </div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
          <RefreshCw size={16} className="spin" style={{ display: 'inline', marginRight: 8 }} />
          Checking GitHub releases…
        </div>
      )}

      {!loading && firmwareRelease && firmwareRepo && (
        <ReleaseBanner release={firmwareRelease} label={firmwareRepo.label} />
      )}
      {!loading && cindr3dRelease && (
        <ReleaseBanner release={cindr3dRelease} label={CINDR3D_REPO.label} />
      )}
      {!loading && !firmwareRelease && !cindr3dRelease && !error && (
        <div className="klipper-card">
          <div className="klipper-card-body" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 16 }}>
            No release information available.
          </div>
        </div>
      )}

      <div className="klipper-card">
        <div className="klipper-card-header"><Info size={13} style={{ display: 'inline', marginRight: 4 }} />About Updates</div>
        <div className="klipper-card-body">
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Release information is fetched directly from GitHub. Cindr3D does not auto-update firmware — it only
            shows you the latest available version. Always read release notes before updating firmware.
            For Klipper printers connected via Moonraker, the section above also shows component-level update status.
          </p>
        </div>
      </div>
    </>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function UpdateManager() {
  const boardType = usePrinterStore((s) => s.config.boardType);

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <ArrowUpCircle size={15} />
        <h3>Update Manager</h3>
        <span className="klipper-badge info" style={{ marginLeft: 4, textTransform: 'capitalize' }}>{boardType}</span>
        <div className="spacer" />
      </div>

      <div className="klipper-tab-body">
        {/* Klipper printers: show Moonraker component updates first */}
        {boardType === 'klipper' && <KlipperUpdateManager embedded />}

        {/* All printers: GitHub release checker */}
        <GithubReleaseChecker />
      </div>
    </div>
  );
}
