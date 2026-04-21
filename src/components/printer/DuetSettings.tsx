import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Wifi, WifiOff, Loader2, CheckCircle, AlertCircle, Info,
  Plug, Settings as SettingsIcon, Palette, ToggleLeft, Bell, Cpu, BadgeInfo,
  Sun, Moon, UploadCloud, Zap, Download, FolderOpen, X,
  Thermometer, Activity, Ruler, Home, Gauge,
  RefreshCw, Sparkles, ArrowUpCircle, Package, ExternalLink, Calendar,
  Monitor, Plus, Trash2, Pencil,
} from 'lucide-react';
import { downloadSettings, importSettingsFromFile, type ImportResult } from '../../utils/settingsExport';
import { usePrinterStore } from '../../store/printerStore';
import { useThemeStore, type ThemeMode } from '../../store/themeStore';
import type { DuetBoard } from '../../types/duet';
import {
  getDuetPrefs, updateDuetPrefs,
  type DuetPrefs, type Units, type NotifSeverity,
  type TemperatureUnit, type DateFormat,
} from '../../utils/duetPrefs';
import './DuetSettings.css';

// ---------------------------------------------------------------------------
// Firmware update check (GitHub releases)
// ---------------------------------------------------------------------------
interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  assets: GitHubAsset[];
}

const RRF_RELEASES_URL = 'https://api.github.com/repos/Duet3D/RepRapFirmware/releases/latest';
const DWC_RELEASES_URL = 'https://api.github.com/repos/Duet3D/DuetWebControl/releases/latest';
const PANELDUE_RELEASES_URL = 'https://api.github.com/repos/Duet3D/PanelDueFirmware/releases/latest';

// GitHub's release asset CDN (objects.githubusercontent.com) does NOT send
// CORS headers, so a direct browser fetch of browser_download_url fails with
// "Failed to fetch". In dev we route through the Vite /github-proxy plugin,
// which follows redirects and re-emits bytes with ACAO:*.
function proxiedGithubUrl(url: string): string {
  if (import.meta.env.DEV) {
    return `/github-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

async function fetchLatestFirmware(): Promise<GitHubRelease> {
  const res = await fetch(proxiedGithubUrl(RRF_RELEASES_URL), {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status}`);
  }
  return res.json();
}

async function fetchLatestDwc(): Promise<GitHubRelease> {
  const res = await fetch(proxiedGithubUrl(DWC_RELEASES_URL), {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`DWC GitHub API responded ${res.status}`);
  }
  return res.json();
}

async function fetchLatestPanelDue(): Promise<GitHubRelease> {
  const res = await fetch(proxiedGithubUrl(PANELDUE_RELEASES_URL), {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`PanelDue GitHub API responded ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// PanelDue detection & firmware helpers
// ---------------------------------------------------------------------------

interface PanelDueConfig {
  /** M575 line as it appears in config.g */
  raw: string;
  /** Pnn — aux UART channel (typically 1 for PanelDue). */
  channel?: number;
  /** Bnnnn — baud rate (typically 57600). */
  baud?: number;
  /** Snn — checksum/CRC mode (2 = CRC required by PanelDue). */
  checksum?: number;
}

/** Parse M575 lines from a config.g text blob. Returns every match so the user
 *  can see all UART config, but only the CRC-enabled ones are real PanelDue
 *  candidates (M575 ... S2 or S3). Case-insensitive; ignores comments. */
function parseM575(configText: string): PanelDueConfig[] {
  const out: PanelDueConfig[] = [];
  const lines = configText.split(/\r?\n/);
  for (const rawLine of lines) {
    // Strip inline comments (; and comments after the command).
    const line = rawLine.replace(/[;(].*$/, '').trim();
    if (!/^m575\b/i.test(line)) continue;
    const pMatch = line.match(/\bP(\d+)/i);
    const bMatch = line.match(/\bB(\d+)/i);
    const sMatch = line.match(/\bS(\d+)/i);
    out.push({
      raw: rawLine.trim(),
      channel:  pMatch ? Number(pMatch[1]) : undefined,
      baud:     bMatch ? Number(bMatch[1]) : undefined,
      checksum: sMatch ? Number(sMatch[1]) : undefined,
    });
  }
  return out;
}

/** Filter the PanelDue release's assets down to flashable firmware .bin files. */
function panelDueBinAssets(assets: GitHubAsset[]): GitHubAsset[] {
  return assets.filter((a) => /^PanelDueFirmware.*\.bin$/i.test(a.name));
}

/** Extract a human-friendly variant label from a PanelDue asset filename.
 *  e.g. "PanelDueFirmware_v3.6.0_5.0i.bin" → "5.0i" */
function panelDueVariantLabel(name: string): string {
  const stripped = name.replace(/\.bin$/i, '').replace(/^PanelDueFirmware[_-]*/i, '');
  // Strip leading "v1.2.3" version if present.
  const withoutVer = stripped.replace(/^v?\d+(?:[._-]\d+){0,3}[._-]?/i, '');
  return withoutVer || stripped || 'firmware';
}

/** Sort PanelDue .bin assets into a predictable order:
 *  1. Ascending by screen size (4.3 → 5.0 → 7.0)
 *  2. Standalone variants before 'i' (integrated) variants of the same size
 *  3. Stable alphabetic fallback when we can't parse a size
 *  so users see "4.3, 5.0, 5.0i, 7.0, 7.0i" instead of GitHub's release order. */
function sortPanelDueAssets(assets: GitHubAsset[]): GitHubAsset[] {
  return [...assets].sort((a, b) => {
    const la = panelDueVariantLabel(a.name);
    const lb = panelDueVariantLabel(b.name);
    const sizeA = parseFloat(la.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 'NaN');
    const sizeB = parseFloat(lb.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 'NaN');
    const aHasSize = !Number.isNaN(sizeA);
    const bHasSize = !Number.isNaN(sizeB);
    if (aHasSize && bHasSize && sizeA !== sizeB) return sizeA - sizeB;
    if (aHasSize !== bHasSize) return aHasSize ? -1 : 1; // sized variants first
    const aIntegrated = /i\b/i.test(la) ? 1 : 0;
    const bIntegrated = /i\b/i.test(lb) ? 1 : 0;
    if (aIntegrated !== bIntegrated) return aIntegrated - bIntegrated;
    return la.localeCompare(lb);
  });
}

/** Compare semver-ish strings. Returns -1 if a<b, 0 if equal, 1 if a>b. */
function compareVersions(a: string, b: string): number {
  const toNums = (v: string) =>
    v.replace(/^v/i, '').split(/[.+-]/).map((p) => parseInt(p, 10) || 0);
  const va = toNums(a);
  const vb = toNums(b);
  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i++) {
    const x = va[i] ?? 0;
    const y = vb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Map board families → firmware / IAP filename patterns on the RRF release.
// Order matters: more-specific patterns (e.g. "Mini 5+ Ethernet") must come
// before looser ones ("Mini 5+").
interface BoardFamily {
  name: string;
  test: RegExp;
  firmware: RegExp;
  iap?: RegExp;
}

const BOARD_FAMILIES: BoardFamily[] = [
  { name: 'Duet 3 Mini 5+ Ethernet', test: /mini\s*5\+?\s*ethernet/i,           firmware: /^Duet3Firmware_Mini5plusEthernet\.(bin|uf2)$/i, iap: /^Duet3_(SBC|SD)iap.*Mini5plusEthernet\.bin$/i },
  { name: 'Duet 3 Mini 5+',          test: /mini\s*5\+?(?!.*ethernet)/i,        firmware: /^Duet3Firmware_Mini5plus\.(bin|uf2)$/i,         iap: /^Duet3_(SBC|SD)iap.*Mini5plus\.bin$/i },
  { name: 'Duet 3 MB6HC',            test: /mb\s*6\s*hc/i,                      firmware: /^Duet3Firmware_MB6HC\.bin$/i,                   iap: /^Duet3_(SBC|SD)iap32_MB6HC\.bin$/i },
  { name: 'Duet 3 MB6XD',            test: /mb\s*6\s*xd/i,                      firmware: /^Duet3Firmware_MB6XD\.bin$/i,                   iap: /^Duet3_(SBC|SD)iap32_MB6XD\.bin$/i },
  { name: 'Duet 3 Toolboard 1LC',    test: /tool\s*1\s*lc/i,                    firmware: /^Duet3Firmware_TOOL1LC\.bin$/i },
  { name: 'Duet 3 EXP3HC',           test: /exp\s*3\s*hc/i,                     firmware: /^Duet3Firmware_EXP3HC\.bin$/i },
  { name: 'Duet 3 EXP1XD',           test: /exp\s*1\s*xd/i,                     firmware: /^Duet3Firmware_EXP1XD\.bin$/i },
  { name: 'Duet 3 EXP1HCL',          test: /exp\s*1\s*hcl/i,                    firmware: /^Duet3Firmware_EXP1HCL\.bin$/i },
  { name: 'Duet 2 Maestro',          test: /maestro/i,                          firmware: /^DuetMaestroFirmware\.bin$/i,                   iap: /^DuetMaestroIAP\.bin$/i },
  { name: 'Duet 2 WiFi/Ethernet',    test: /duet\s*2|combined|wifi|ethernet/i,  firmware: /^Duet2CombinedFirmware\.bin$/i,                 iap: /^Duet2CombinedIAP\.bin$/i },
];

function identifyFamily(board: DuetBoard | undefined): BoardFamily | null {
  if (!board) return null;
  const hay = [board.shortName, board.name, board.firmwareName].filter(Boolean).join(' ');
  if (!hay) return null;
  for (const fam of BOARD_FAMILIES) {
    if (fam.test.test(hay)) return fam;
  }
  return null;
}

const IAP_REGEX = /(iap|IAP)/;

type MatchLevel = 'exact' | 'family' | 'guess' | 'none';

interface FirmwareMatch {
  firmware?: GitHubAsset;
  iapSbc?: GitHubAsset;
  iapSd?: GitHubAsset;
  dwc?: GitHubAsset;          // DuetWebControl zip (SD or SBC depending on mode)
  candidates: GitHubAsset[];   // binary assets worth showing in the UI
  matchLevel: MatchLevel;
  familyName?: string;
  expectedFilename?: string;   // the filename we believe matches this board
}

function findDwcAsset(assets: GitHubAsset[], mode: 'standalone' | 'sbc'): GitHubAsset | undefined {
  const target = mode === 'sbc' ? /^DuetWebControl-SBC\.zip$/i : /^DuetWebControl-SD\.zip$/i;
  return assets.find((a) => target.test(a.name))
      ?? assets.find((a) => /^DuetWebControl.*\.zip$/i.test(a.name));
}

/** Pick the firmware/IAP/DWC assets that target *this* board. */
function pickFirmwareAssets(
  assets: GitHubAsset[],
  board: DuetBoard | undefined,
  mode: 'standalone' | 'sbc' = 'standalone',
): FirmwareMatch {
  const bins = assets.filter((a) => /\.(bin|uf2)$/i.test(a.name));
  const nonIapBins = bins.filter((a) => !IAP_REGEX.test(a.name));
  const findByName = (name?: string) =>
    name ? bins.find((a) => a.name.toLowerCase() === name.toLowerCase()) : undefined;
  const dwc = findDwcAsset(assets, mode);

  // 1. The board itself told us the exact firmware filename it runs (RRF ≥ 3.5).
  const wanted = board?.firmwareFileName;
  if (wanted) {
    const exact = findByName(wanted);
    if (exact) {
      return {
        firmware: exact,
        iapSbc: findByName(board?.iapFileNameSBC),
        iapSd:  findByName(board?.iapFileNameSD),
        dwc,
        candidates: [exact, ...bins.filter((a) => a !== exact)].slice(0, 8),
        matchLevel: 'exact',
        expectedFilename: exact.name,
      };
    }
  }

  // 2. Match against the known board-family regex table.
  const fam = identifyFamily(board);
  if (fam) {
    const firmware = nonIapBins.find((a) => fam.firmware.test(a.name));
    const iapAll = fam.iap ? bins.filter((a) => fam.iap!.test(a.name)) : [];
    const iapSbc = findByName(board?.iapFileNameSBC) ?? iapAll.find((a) => /sbc/i.test(a.name));
    const iapSd  = findByName(board?.iapFileNameSD)  ?? iapAll.find((a) => !/sbc/i.test(a.name));
    if (firmware) {
      return {
        firmware,
        iapSbc,
        iapSd,
        dwc,
        candidates: [firmware, ...bins.filter((a) => a !== firmware)].slice(0, 8),
        matchLevel: 'family',
        familyName: fam.name,
        expectedFilename: firmware.name,
      };
    }
  }

  // 3. Legacy token-scoring fallback (non-IAP only).
  const hay = [board?.shortName, board?.name].filter(Boolean).join(' ');
  const tokens = hay
    .toLowerCase()
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length > 0) {
    const scored = nonIapBins.map((a) => {
      const lower = a.name.toLowerCase();
      let score = 0;
      for (const t of tokens) if (lower.includes(t)) score += t.length;
      return { asset: a, score };
    }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    if (scored.length > 0) {
      const firmware = scored[0].asset;
      return {
        firmware,
        dwc,
        candidates: [firmware, ...bins.filter((a) => a !== firmware)].slice(0, 8),
        matchLevel: 'guess',
        expectedFilename: firmware.name,
      };
    }
  }

  // 4. No match — return all binaries for manual selection.
  return { candidates: bins.slice(0, 8), matchLevel: 'none', dwc };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const TABS = [
  { key: 'connection'    as const, label: 'Connection',    Icon: Plug },
  { key: 'general'       as const, label: 'General',       Icon: SettingsIcon },
  { key: 'appearance'    as const, label: 'Appearance',    Icon: Palette },
  { key: 'behaviour'     as const, label: 'Behaviour',     Icon: ToggleLeft },
  { key: 'notifications' as const, label: 'Notifications', Icon: Bell },
  { key: 'machine'       as const, label: 'Machine',       Icon: Cpu },
  { key: 'firmware'      as const, label: 'Firmware',      Icon: Zap },
  { key: 'paneldue'      as const, label: 'PanelDue',      Icon: Monitor },
  { key: 'backup'        as const, label: 'Backup',        Icon: Download },
  { key: 'about'         as const, label: 'About',         Icon: BadgeInfo },
];
type TabKey = (typeof TABS)[number]['key'];

// ---------------------------------------------------------------------------
// Row-based setting helper
// ---------------------------------------------------------------------------
function SettingRow({
  label, hint, control,
}: { label: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="duet-settings__form-group">
      <label className="duet-settings__label">{label}</label>
      {control}
      {hint && <span className="duet-settings__hint">{hint}</span>}
    </div>
  );
}

function ToggleRow({
  id, checked, onChange, label, hint,
}: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="duet-settings__form-group">
      <div className="duet-settings__checkbox-row">
        <input
          type="checkbox"
          id={id}
          className="duet-settings__checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <label htmlFor={id} className="duet-settings__checkbox-label">{label}</label>
      </div>
      {hint && <span className="duet-settings__hint duet-settings__hint--indented">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DuetSettings() {
  const connected = usePrinterStore((s) => s.connected);
  const connecting = usePrinterStore((s) => s.connecting);
  const config = usePrinterStore((s) => s.config);
  const setConfig = usePrinterStore((s) => s.setConfig);
  const connect = usePrinterStore((s) => s.connect);
  const disconnect = usePrinterStore((s) => s.disconnect);
  const testConnection = usePrinterStore((s) => s.testConnection);
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const addPrinter = usePrinterStore((s) => s.addPrinter);
  const removePrinter = usePrinterStore((s) => s.removePrinter);
  const renamePrinter = usePrinterStore((s) => s.renamePrinter);
  const selectPrinter = usePrinterStore((s) => s.selectPrinter);
  const error = usePrinterStore((s) => s.error);
  const model = usePrinterStore((s) => s.model);
  const uploading = usePrinterStore((s) => s.uploading);
  const uploadProgress = usePrinterStore((s) => s.uploadProgress);
  const uploadFirmware = usePrinterStore((s) => s.uploadFirmware);
  const installFirmware = usePrinterStore((s) => s.installFirmware);
  const firmwareUpdatePending = usePrinterStore((s) => s.firmwareUpdatePending);

  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  // Load persisted prefs once per open
  const [prefs, setPrefs] = useState<DuetPrefs>(() => getDuetPrefs());
  const patchPrefs = useCallback((patch: Partial<DuetPrefs>) => {
    setPrefs(updateDuetPrefs(patch));
  }, []);

  const [tab, setTab] = useState<TabKey>('connection');

  // Firmware form state
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  const [firmwareStatus, setFirmwareStatus] = useState<
    { type: 'success' | 'error'; message: string } | null
  >(null);
  const firmwareInputRef = React.useRef<HTMLInputElement | null>(null);

  // IAP file state
  const [iapFile, setIapFile] = useState<File | null>(null);
  const [iapStatus, setIapStatus] = useState<
    { type: 'success' | 'error'; message: string } | null
  >(null);
  const iapInputRef = React.useRef<HTMLInputElement | null>(null);

  // Backup / restore state
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Firmware update-check state
  const [updateCheck, setUpdateCheck] = useState<{
    loading: boolean;
    release?: GitHubRelease;
    dwcRelease?: GitHubRelease;
    error?: string;
    checkedAt?: number;
  }>({ loading: false });
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [showPanelDueNotes, setShowPanelDueNotes] = useState(false);

  // Auto-update (download + upload + install) state
  type AutoStep = 'idle' | 'downloading' | 'uploading' | 'installing' | 'done' | 'reconnected' | 'error';
  const [autoUpdate, setAutoUpdate] = useState<{
    step: AutoStep;
    progress: number;
    assetName?: string;
    error?: string;
  }>({ step: 'idle', progress: 0 });

  // When the board finishes reflashing, actively poll it to detect when it
  // comes back online. The store's own auto-reconnect depends on the service
  // emitting 'disconnected' *and* the user having autoReconnect enabled — if
  // either condition isn't met, the UI would sit forever on "waiting for the
  // board to come back online" even though the board is already running.
  useEffect(() => {
    if (autoUpdate.step !== 'done') return;

    // If we happen to already be connected on a fresh firmware version, short-
    // circuit immediately.
    if (connected && !firmwareUpdatePending) {
      setAutoUpdate((s) => ({ ...s, step: 'reconnected' }));
      return;
    }

    const host = config.hostname.replace(/\/+$/, '').replace(/^https?:\/\//, '');
    if (!host) return;
    const base = import.meta.env.DEV ? `/duet-proxy/${host}` : `http://${host}`;
    const pingUrl = config.mode === 'sbc'
      ? `${base}/machine/status`
      : `${base}/rr_connect?password=${encodeURIComponent(config.password ?? '')}&time=${encodeURIComponent(new Date().toISOString())}`;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const MAX_WAIT_MS = 5 * 60 * 1000; // give up after 5 minutes

    const ping = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > MAX_WAIT_MS) return;

      const ac = new AbortController();
      const abortTimer = setTimeout(() => ac.abort(), 4000);
      let ok = false;
      try {
        const res = await fetch(pingUrl, { signal: ac.signal, cache: 'no-store' });
        ok = res.ok;
      } catch {
        ok = false;
      } finally {
        clearTimeout(abortTimer);
      }

      if (cancelled) return;
      if (ok) {
        // Board is serving HTTP again. Make sure the store is connected so the
        // rest of the app picks up the new firmware version, then flip UI.
        if (!usePrinterStore.getState().connected) {
          try { await usePrinterStore.getState().connect(); } catch { /* ignore */ }
        }
        if (!cancelled) {
          setAutoUpdate((s) => ({ ...s, step: 'reconnected' }));
        }
        return;
      }
      timer = setTimeout(ping, 3000);
    };

    // Boards take ~10–20s to finish reflashing; give IAP a head start before
    // our first probe so we don't spam the proxy with immediate failures.
    timer = setTimeout(ping, 8000);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [autoUpdate.step, connected, firmwareUpdatePending, config.hostname, config.mode, config.password]);

  // ---------------------------------------------------------------------------
  // PanelDue state
  // ---------------------------------------------------------------------------
  const [panelDueInfo, setPanelDueInfo] = useState<{
    loading: boolean;
    loaded: boolean;
    configs: PanelDueConfig[];
    error?: string;
  }>({ loading: false, loaded: false, configs: [] });

  const [panelDueCheck, setPanelDueCheck] = useState<{
    loading: boolean;
    release?: GitHubRelease;
    error?: string;
    checkedAt?: number;
  }>({ loading: false });

  // Keep a live ref so handlePanelDueInstall (useCallback with [] deps) can
  // read the currently-checked release to stamp the marker file.
  const panelDueCheckRef = useRef(panelDueCheck);
  useEffect(() => { panelDueCheckRef.current = panelDueCheck; }, [panelDueCheck]);

  // Auto-scroll the PanelDue reply log to the bottom every time a new line
  // arrives so the user always sees the latest firmware output.
  const panelDueLogRef = useRef<HTMLPreElement | null>(null);

  type PanelDueStep = 'idle' | 'downloading' | 'uploading' | 'installing' | 'done' | 'error';
  const [panelDueUpdate, setPanelDueUpdate] = useState<{
    step: PanelDueStep;
    progress: number;
    assetName?: string;
    error?: string;
    /** Firmware reply lines captured during M997 S4 — empty until install runs. */
    messages?: string[];
    /** True when we gave up waiting for a success/error line before it appeared. */
    timedOut?: boolean;
  }>({ step: 'idle', progress: 0 });

  // Selected asset (user picks their screen variant — we can't auto-detect it).
  const [panelDueAsset, setPanelDueAsset] = useState<GitHubAsset | null>(null);

  // PanelDue's own firmware version is not exposed in the RRF object model, so
  // we record what DesignCAD flashed to a marker file on the board's SD card.
  // It's advisory only (user may flash via DWC / USB without updating us), but
  // it lets us show "Last flashed v3.6.0 on DATE" when they did use us.
  interface PanelDueFlashed {
    tag: string;
    assetName: string;
    variant: string;
    flashedAt: string; // ISO-8601
  }
  const PANELDUE_MARKER_PATH = '0:/sys/paneldue-flashed.json';
  const [panelDueFlashed, setPanelDueFlashed] = useState<{
    loaded: boolean;
    data?: PanelDueFlashed;
  }>({ loaded: false });

  // Load config.g once when the PanelDue tab opens (or the connection changes).
  // Also reads the DesignCAD-written marker file that records what we last
  // flashed (missing is the common case — simply means "never flashed via us").
  const loadPanelDueInfo = useCallback(async () => {
    const service = usePrinterStore.getState().service;
    if (!service) {
      setPanelDueInfo({ loading: false, loaded: true, configs: [], error: 'Not connected.' });
      setPanelDueFlashed({ loaded: true });
      return;
    }
    setPanelDueInfo((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const blob = await service.downloadFile('0:/sys/config.g');
      const text = await blob.text();
      const configs = parseM575(text);
      setPanelDueInfo({ loading: false, loaded: true, configs });
    } catch (err) {
      setPanelDueInfo({
        loading: false,
        loaded: true,
        configs: [],
        error: `Couldn't read 0:/sys/config.g — ${(err as Error).message}`,
      });
    }

    try {
      const markerBlob = await service.downloadFile(PANELDUE_MARKER_PATH);
      const parsed = JSON.parse(await markerBlob.text()) as Partial<PanelDueFlashed>;
      if (parsed && typeof parsed.tag === 'string' && typeof parsed.assetName === 'string') {
        setPanelDueFlashed({
          loaded: true,
          data: {
            tag: parsed.tag,
            assetName: parsed.assetName,
            variant: parsed.variant ?? '',
            flashedAt: parsed.flashedAt ?? '',
          },
        });
      } else {
        setPanelDueFlashed({ loaded: true });
      }
    } catch {
      // Missing marker is normal — swallow silently.
      setPanelDueFlashed({ loaded: true });
    }
  }, []);

  const handleCheckPanelDueUpdate = useCallback(async () => {
    setPanelDueCheck({ loading: true });
    try {
      const release = await fetchLatestPanelDue();
      setPanelDueCheck({ loading: false, release, checkedAt: Date.now() });
      // Auto-pick a sensible default: smallest screen-size variant — user can
      // override. Sorting here matches what the table below will display.
      const bins = sortPanelDueAssets(panelDueBinAssets(release.assets));
      if (bins.length > 0) setPanelDueAsset(bins[0]);
    } catch (err) {
      setPanelDueCheck({
        loading: false,
        error: (err as Error).message,
        checkedAt: Date.now(),
      });
    }
  }, []);

  // Download + upload + M997 S4. Board does NOT reboot — it stays connected
  // while flashing the PanelDue over UART (~30–60s).
  const handlePanelDueInstall = useCallback(async (asset: GitHubAsset) => {
    const ok = confirm(
      `Flash ${asset.name} to the connected PanelDue? The Duet will stream the firmware to the display over UART — this takes about a minute. Don't power off during install.`,
    );
    if (!ok) return;

    setPanelDueUpdate({ step: 'downloading', progress: 0, assetName: asset.name });
    let binFile: Blob;
    try {
      const res = await fetch(proxiedGithubUrl(asset.browser_download_url), { mode: 'cors' });
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
      const total = Number(res.headers.get('content-length') || asset.size || 0);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Streaming not supported in this browser.');
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          if (total > 0) {
            setPanelDueUpdate((s) => ({ ...s, progress: Math.round((received / total) * 100) }));
          }
        }
      }
      binFile = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
    } catch (err) {
      setPanelDueUpdate({ step: 'error', progress: 0, assetName: asset.name, error: `Download failed: ${(err as Error).message}` });
      return;
    }

    // M997 S4 expects the file at exactly 0:/firmware/PanelDueFirmware.bin.
    const canonicalName = 'PanelDueFirmware.bin';
    const canonicalFile = new File([binFile], canonicalName, { type: 'application/octet-stream' });

    setPanelDueUpdate({ step: 'uploading', progress: 0, assetName: canonicalName });
    try {
      const service = usePrinterStore.getState().service;
      if (!service) throw new Error('Not connected to a printer.');
      await service.uploadFile(`0:/firmware/${canonicalName}`, canonicalFile, (p) => {
        setPanelDueUpdate((s) => ({ ...s, progress: p }));
      });
    } catch (err) {
      setPanelDueUpdate({ step: 'error', progress: 0, assetName: canonicalName, error: `Upload failed: ${(err as Error).message}` });
      return;
    }

    setPanelDueUpdate({ step: 'installing', progress: 100, assetName: canonicalName, messages: [] });

    // RRF (PanelDueUpdater.cpp) emits messages like "Flashing PanelDue...",
    // "Panel update successful", "Panel update failed: <reason>", etc.
    // M997 S4 does NOT reboot the Duet, so we can tail rr_reply for output.
    const SUCCESS_RE = /(?:success(?:ful)?|completed?\b|flashed\b|update\s+ok)/i;
    const ERROR_RE   = /(?:failed\b|failure\b|error[:\s]|unable to|cannot\s+(?:open|read|write|flash)|aborted)/i;
    const POLL_INTERVAL_MS = 1500;
    const MAX_WAIT_MS = 150_000;

    const collected: string[] = [];
    const pushLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      collected.push(trimmed);
      setPanelDueUpdate((s) => ({ ...s, messages: [...collected] }));
    };

    let outcome: 'success' | 'error' | 'timeout' = 'timeout';
    let errorMessage = '';

    try {
      const service = usePrinterStore.getState().service;
      if (!service) throw new Error('Not connected to a printer.');
      // M997 S4 — flash the PanelDue from 0:/firmware/PanelDueFirmware.bin.
      // In SBC mode sendGCode blocks until the command completes and returns
      // the full reply; in standalone mode it returns the first line only.
      const firstReply = await service.sendGCode('M997 S4');
      if (firstReply) pushLine(firstReply);

      // Fast path for SBC (one atomic reply) — skip polling if we can already
      // classify the result.
      const firstClass =
        ERROR_RE.test(firstReply) ? 'error' :
        SUCCESS_RE.test(firstReply) ? 'success' : null;
      if (firstClass) {
        outcome = firstClass;
      } else {
        const started = Date.now();
        while (Date.now() - started < MAX_WAIT_MS) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          const line = await service.pollReply();
          if (!line) continue;
          pushLine(line);
          if (ERROR_RE.test(line))   { outcome = 'error';   errorMessage = line.trim(); break; }
          if (SUCCESS_RE.test(line)) { outcome = 'success'; break; }
        }
      }
    } catch (err) {
      setPanelDueUpdate({
        step: 'error',
        progress: 100,
        assetName: canonicalName,
        error: `Install command (M997 S4) failed: ${(err as Error).message}`,
        messages: collected,
      });
      return;
    }

    if (outcome === 'error') {
      setPanelDueUpdate({
        step: 'error',
        progress: 100,
        assetName: canonicalName,
        error: errorMessage || 'PanelDue reported a flash failure — see messages below.',
        messages: collected,
      });
      return;
    }

    setPanelDueUpdate({
      step: 'done',
      progress: 100,
      assetName: canonicalName,
      messages: collected,
      timedOut: outcome === 'timeout',
    });

    // Record what we just flashed so we can show it on the next load. The
    // PanelDue doesn't report its version anywhere in the RRF object model.
    // Skip the marker on timeout — we can't be certain the flash succeeded.
    if (outcome === 'success') {
      const release = panelDueCheckRef.current.release;
      const marker: PanelDueFlashed = {
        tag: release?.tag_name?.replace(/^v/i, '') ?? '',
        assetName: asset.name,
        variant: panelDueVariantLabel(asset.name),
        flashedAt: new Date().toISOString(),
      };
      try {
        const service = usePrinterStore.getState().service;
        if (!service) return;
        const markerFile = new File(
          [JSON.stringify(marker, null, 2)],
          'paneldue-flashed.json',
          { type: 'application/json' },
        );
        await service.uploadFile(PANELDUE_MARKER_PATH, markerFile);
        setPanelDueFlashed({ loaded: true, data: marker });
      } catch {
        // Marker write is advisory — swallow failures.
      }
    }
  }, []);

  // Lazy-load config.g the first time the user opens the PanelDue tab (and
  // refresh whenever the connection state changes — a new board can have a
  // completely different config.g).
  useEffect(() => {
    if (tab !== 'paneldue') return;
    if (!connected) return;
    if (panelDueInfo.loading) return;
    if (panelDueInfo.loaded && !panelDueInfo.error) return;
    loadPanelDueInfo();
  }, [tab, connected, panelDueInfo.loading, panelDueInfo.loaded, panelDueInfo.error, loadPanelDueInfo]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    const result = await importSettingsFromFile(file);
    setImportResult(result);
    setImporting(false);
    if (importInputRef.current) importInputRef.current.value = '';
  };

  const handleFirmwareSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.bin') && !lower.endsWith('.uf2')) {
      setFirmwareStatus({ type: 'error', message: 'Firmware must be a .bin or .uf2 file.' });
      return;
    }
    setFirmwareStatus(null);
    setFirmwareFile(file);
  }, []);

  const handleFirmwareUpload = useCallback(async () => {
    if (!firmwareFile) return;
    setFirmwareStatus(null);
    try {
      await uploadFirmware(firmwareFile);
      setFirmwareStatus({
        type: 'success',
        message: `${firmwareFile.name} uploaded to 0:/firmware/`,
      });
    } catch (err) {
      setFirmwareStatus({
        type: 'error',
        message: (err as Error).message,
      });
    }
  }, [firmwareFile, uploadFirmware]);

  const handleIapSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.bin')) {
      setIapStatus({ type: 'error', message: 'IAP file must be a .bin file.' });
      return;
    }
    setIapStatus(null);
    setIapFile(file);
  }, []);

  const handleIapUpload = useCallback(async () => {
    if (!iapFile) return;
    setIapStatus(null);
    try {
      await uploadFirmware(iapFile);
      setIapStatus({
        type: 'success',
        message: `${iapFile.name} uploaded to 0:/firmware/`,
      });
    } catch (err) {
      setIapStatus({
        type: 'error',
        message: (err as Error).message,
      });
    }
  }, [iapFile, uploadFirmware]);

  const handleFirmwareInstall = useCallback(async () => {
    const ok = confirm(
      'Send M997 to start the firmware update? The board will reboot during install — do not power off until it comes back online.',
    );
    if (!ok) return;
    await installFirmware();
  }, [installFirmware]);

  const handleCheckForUpdate = useCallback(async () => {
    setUpdateCheck({ loading: true });
    setShowReleaseNotes(false);
    try {
      // Fetch RRF + DWC releases in parallel so we always have a DWC source,
      // even when the RRF release doesn't bundle a DuetWebControl zip.
      const [release, dwcSettled] = await Promise.all([
        fetchLatestFirmware(),
        fetchLatestDwc().catch(() => undefined),
      ]);
      setUpdateCheck({
        loading: false,
        release,
        dwcRelease: dwcSettled,
        checkedAt: Date.now(),
      });
    } catch (err) {
      setUpdateCheck({
        loading: false,
        error: (err as Error).message,
        checkedAt: Date.now(),
      });
    }
  }, []);

  // Stream a GitHub release asset with progress reporting.
  const downloadAsset = useCallback(async (asset: GitHubAsset): Promise<File> => {
    const res = await fetch(proxiedGithubUrl(asset.browser_download_url), { mode: 'cors' });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    const total = Number(res.headers.get('content-length') || asset.size || 0);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Streaming not supported in this browser.');
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        if (total > 0) {
          setAutoUpdate((s) => ({ ...s, progress: Math.round((received / total) * 100) }));
        }
      }
    }
    return new File(chunks as BlobPart[], asset.name, { type: 'application/octet-stream' });
  }, []);

  // Upload a DuetWebControl zip to 0:/www/ — RRF auto-extracts it in place.
  const uploadDwcZip = useCallback(async (file: File): Promise<void> => {
    const service = usePrinterStore.getState().service;
    if (!service) throw new Error('Not connected to a printer.');
    await service.uploadFile(`0:/www/${file.name}`, file, (p) => {
      usePrinterStore.setState({ uploadProgress: p });
    });
  }, []);

  const buildDownloadError = (err: unknown): string => {
    const msg = (err as Error).message;
    const corsHint = import.meta.env.DEV
      ? 'The dev-server GitHub proxy may be misconfigured — check the Vite logs.'
      : 'GitHub release assets do not send CORS headers, so the browser cannot fetch them directly. Run the app via the Vite dev server (which proxies GitHub), or click the filename link below to download manually and use the Upload button.';
    return `Could not download from GitHub (${msg}). ${corsHint}`;
  };

  const handleAutoUpdate = useCallback(async (fwAsset: GitHubAsset, dwcAsset?: GitHubAsset) => {
    const parts = [`• ${fwAsset.name}`, dwcAsset && `• ${dwcAsset.name}`].filter(Boolean).join('\n');
    const ok = confirm(
      `Download and install these updates? The board will reboot during install — do not power off until it comes back online.\n\n${parts}`,
    );
    if (!ok) return;

    // ── Step 1: download firmware ───────────────────────────────────────
    setAutoUpdate({ step: 'downloading', progress: 0, assetName: fwAsset.name });
    let fwFile: File;
    try {
      fwFile = await downloadAsset(fwAsset);
    } catch (err) {
      setAutoUpdate({ step: 'error', progress: 0, assetName: fwAsset.name, error: buildDownloadError(err) });
      return;
    }

    // ── Step 2: download DWC (optional) ─────────────────────────────────
    let dwcFile: File | null = null;
    if (dwcAsset) {
      setAutoUpdate({ step: 'downloading', progress: 0, assetName: dwcAsset.name });
      try {
        dwcFile = await downloadAsset(dwcAsset);
      } catch (err) {
        setAutoUpdate({ step: 'error', progress: 0, assetName: dwcAsset.name, error: buildDownloadError(err) });
        return;
      }
    }

    // ── Step 3: upload DWC first so RRF extracts the new web UI ─────────
    if (dwcFile) {
      setAutoUpdate({ step: 'uploading', progress: 0, assetName: dwcFile.name });
      try {
        await uploadDwcZip(dwcFile);
      } catch (err) {
        setAutoUpdate({ step: 'error', progress: 0, assetName: dwcFile.name, error: `DWC upload failed: ${(err as Error).message}` });
        return;
      }
    }

    // ── Step 4: upload firmware ─────────────────────────────────────────
    setAutoUpdate({ step: 'uploading', progress: 0, assetName: fwFile.name });
    try {
      await usePrinterStore.getState().uploadFirmware(fwFile);
    } catch (err) {
      setAutoUpdate({ step: 'error', progress: 0, assetName: fwFile.name, error: `Firmware upload failed: ${(err as Error).message}` });
      return;
    }

    // ── Step 5: trigger install ─────────────────────────────────────────
    setAutoUpdate({ step: 'installing', progress: 100, assetName: fwFile.name });
    try {
      await installFirmware();
      setAutoUpdate({ step: 'done', progress: 100, assetName: fwFile.name });
    } catch (err) {
      setAutoUpdate({ step: 'error', progress: 100, assetName: fwFile.name, error: `Install command (M997) failed: ${(err as Error).message}` });
    }
  }, [installFirmware, downloadAsset, uploadDwcZip]);

  // DWC-only update — for when the firmware is already current but the web UI
  // is stale (e.g. previous auto-update ran before we shipped DWC support).
  const handleUpdateDwcOnly = useCallback(async (dwcAsset: GitHubAsset) => {
    const ok = confirm(
      `Download ${dwcAsset.name} and install the updated DuetWebControl UI? No reboot is required.`,
    );
    if (!ok) return;

    setAutoUpdate({ step: 'downloading', progress: 0, assetName: dwcAsset.name });
    let dwcFile: File;
    try {
      dwcFile = await downloadAsset(dwcAsset);
    } catch (err) {
      setAutoUpdate({ step: 'error', progress: 0, assetName: dwcAsset.name, error: buildDownloadError(err) });
      return;
    }

    setAutoUpdate({ step: 'uploading', progress: 0, assetName: dwcFile.name });
    try {
      await uploadDwcZip(dwcFile);
    } catch (err) {
      setAutoUpdate({ step: 'error', progress: 0, assetName: dwcFile.name, error: `DWC upload failed: ${(err as Error).message}` });
      return;
    }

    // DWC upload doesn't trigger a board reboot — go straight to reconnected
    // so the UI shows a clean success state.
    setAutoUpdate({ step: 'reconnected', progress: 100, assetName: dwcFile.name });
  }, [downloadAsset, uploadDwcZip]);

  // Connection form state
  const [hostname, setHostname] = useState(config.hostname || '');
  const [password, setPassword] = useState(config.password || '');
  const [mode, setMode] = useState<'standalone' | 'sbc'>(
    (config as { mode?: 'standalone' | 'sbc' }).mode ?? 'standalone',
  );
  // When the user switches active printer, reload the form fields from the
  // newly-active config. Without this, hostname/password/mode would still
  // show the previous printer's values even though `config` has updated.
  useEffect(() => {
    setHostname(config.hostname || '');
    setPassword(config.password || '');
    setMode(config.mode ?? 'standalone');
  }, [activePrinterId, config.hostname, config.password, config.mode]);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    firmwareVersion?: string;
    error?: string;
  } | null>(null);

  const handleTest = useCallback(async () => {
    setConfig({ hostname: hostname.trim(), password });
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection();
      setTestResult({
        success: result.success,
        firmwareVersion: result.firmwareVersion,
        error: result.error,
      });
    } catch (err) {
      setTestResult({ success: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }, [hostname, password, setConfig, testConnection]);

  const handleConnect = useCallback(async () => {
    setConfig({ hostname: hostname.trim(), password });
    setTestResult(null);
    await connect();
  }, [hostname, password, setConfig, connect]);

  const handleDisconnect = useCallback(async () => {
    setTestResult(null);
    await disconnect();
  }, [disconnect]);

  const axes = model.move?.axes ?? [];
  const board = model.boards?.[0];
  const canConnect = hostname.trim().length > 0 && !connecting;

  const handleAddPrinter = useCallback(() => {
    const name = window.prompt('Name for new printer:', `Printer ${printers.length + 1}`);
    if (!name) return;
    const id = addPrinter(name);
    selectPrinter(id).catch(() => {});
  }, [addPrinter, selectPrinter, printers.length]);

  const handleRenamePrinter = useCallback(() => {
    const current = printers.find((p) => p.id === activePrinterId);
    if (!current) return;
    const name = window.prompt('Rename printer:', current.name);
    if (!name || name === current.name) return;
    renamePrinter(activePrinterId, name);
  }, [activePrinterId, printers, renamePrinter]);

  const handleRemovePrinter = useCallback(() => {
    const current = printers.find((p) => p.id === activePrinterId);
    if (!current) return;
    if (printers.length <= 1) {
      window.alert('At least one printer must remain.');
      return;
    }
    if (!window.confirm(`Remove "${current.name}"? Its saved connection and preferences will be deleted.`)) return;
    removePrinter(activePrinterId);
  }, [activePrinterId, printers, removePrinter]);

  const renderConnection = () => (
    <>
      <div className="duet-settings__page-title">Connection</div>

      <SettingRow
        label="Printer"
        hint="Select which printer this workspace connects to. Each printer keeps its own connection info and preferences."
        control={
          <div className="duet-settings__btn-row" style={{ gap: 6, marginTop: 0 }}>
            <select
              className="duet-settings__input"
              style={{ minWidth: 180 }}
              value={activePrinterId}
              onChange={(e) => { selectPrinter(e.target.value).catch(() => {}); }}
              disabled={connecting}
            >
              {printers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              className="duet-settings__btn duet-settings__btn--secondary"
              onClick={handleAddPrinter}
              title="Add printer"
              disabled={connecting}
            >
              <Plus size={14} /> Add
            </button>
            <button
              className="duet-settings__btn duet-settings__btn--secondary"
              onClick={handleRenamePrinter}
              title="Rename printer"
              disabled={connecting}
            >
              <Pencil size={14} /> Rename
            </button>
            <button
              className="duet-settings__btn duet-settings__btn--danger"
              onClick={handleRemovePrinter}
              title="Remove printer"
              disabled={connecting || printers.length <= 1}
            >
              <Trash2 size={14} /> Remove
            </button>
          </div>
        }
      />

      {connected ? (
        <div className="duet-settings__banner duet-settings__banner--success">
          <Wifi size={16} /> Connected to Duet3D board at {config.hostname}
        </div>
      ) : (
        <div className="duet-settings__banner duet-settings__banner--info">
          <Info size={16} /> Connect to your Duet3D board via its REST API
        </div>
      )}

      <SettingRow
        label="Hostname / IP Address"
        hint="Enter the IP address or hostname of your Duet3D board (without http://)"
        control={
          <input
            className="duet-settings__input"
            type="text"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="192.168.1.100 or myprinter.local"
            disabled={connected}
          />
        }
      />

      <SettingRow
        label="Board Password (optional)"
        hint="Only required if your board has a password set in config.g (M551)"
        control={
          <input
            className="duet-settings__input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank if no password is set"
            disabled={connected}
          />
        }
      />

      <SettingRow
        label="Connection Mode"
        hint={
          mode === 'standalone'
            ? 'Connect directly to the Duet board via its built-in WiFi/Ethernet.'
            : 'Connect via a Single Board Computer running DuetSoftwareFramework.'
        }
        control={
          <div className="duet-settings__mode-selector">
            <button
              className={`duet-settings__mode-btn${mode === 'standalone' ? ' is-active' : ''}`}
              onClick={() => setMode('standalone')}
              disabled={connected}
            >
              Standalone
            </button>
            <button
              className={`duet-settings__mode-btn${mode === 'sbc' ? ' is-active' : ''}`}
              onClick={() => setMode('sbc')}
              disabled={connected}
            >
              SBC (Raspberry Pi)
            </button>
          </div>
        }
      />

      <div className="duet-settings__btn-row">
        <button
          className={`duet-settings__btn duet-settings__btn--secondary${testing || connected ? ' duet-settings__btn--disabled' : ''}`}
          onClick={handleTest}
          disabled={testing || connected || !hostname.trim()}
        >
          {testing ? (<><Loader2 size={14} className="spin" /> Testing...</>) : 'Test Connection'}
        </button>

        {connected ? (
          <button className="duet-settings__btn duet-settings__btn--danger" onClick={handleDisconnect}>
            <WifiOff size={14} /> Disconnect
          </button>
        ) : (
          <button
            className={`duet-settings__btn duet-settings__btn--primary${!canConnect ? ' duet-settings__btn--disabled' : ''}`}
            onClick={handleConnect}
            disabled={!canConnect}
          >
            {connecting ? (<><Loader2 size={14} className="spin" /> Connecting...</>) : (<><Wifi size={14} /> Connect</>)}
          </button>
        )}
      </div>

      {testResult && (
        <div className={`duet-settings__banner ${testResult.success ? 'duet-settings__banner--success' : 'duet-settings__banner--error'}`}>
          {testResult.success ? (
            <>
              <CheckCircle size={16} />
              <div>
                <div className="duet-settings__banner-heading">Connection successful</div>
                {testResult.firmwareVersion && (
                  <div className="duet-settings__banner-detail">Firmware: {testResult.firmwareVersion}</div>
                )}
              </div>
            </>
          ) : (
            <>
              <AlertCircle size={16} />
              <div>
                <div className="duet-settings__banner-heading">Connection failed</div>
                {testResult.error && <div className="duet-settings__banner-detail">{testResult.error}</div>}
              </div>
            </>
          )}
        </div>
      )}

      {error && !testResult && (
        <div className="duet-settings__banner duet-settings__banner--error">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Auto-reconnect settings */}
      <div className="duet-settings__section" style={{ marginTop: 16 }}>
        <div className="duet-settings__section-title">Auto-Reconnect</div>
        <ToggleRow
          id="auto-reconnect-conn"
          checked={prefs.autoReconnect}
          onChange={(v) => patchPrefs({ autoReconnect: v })}
          label="Enable auto-reconnect"
          hint="Automatically attempt to reconnect when the connection drops."
        />
        {prefs.autoReconnect && (
          <>
            <SettingRow
              label="Reconnect Interval"
              hint="Time between reconnect attempts."
              control={
                <select
                  className="duet-settings__select"
                  value={prefs.reconnectInterval}
                  onChange={(e) => patchPrefs({ reconnectInterval: Number(e.target.value) })}
                >
                  <option value={2000}>2 seconds</option>
                  <option value={5000}>5 seconds</option>
                  <option value={10000}>10 seconds</option>
                  <option value={30000}>30 seconds</option>
                  <option value={60000}>60 seconds</option>
                </select>
              }
            />
            <SettingRow
              label="Max Retries"
              hint="Maximum number of reconnect attempts before giving up."
              control={
                <select
                  className="duet-settings__select"
                  value={prefs.maxRetries}
                  onChange={(e) => patchPrefs({ maxRetries: Number(e.target.value) })}
                >
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={0}>Unlimited</option>
                </select>
              }
            />
          </>
        )}
      </div>
    </>
  );

  const renderGeneral = () => (
    <>
      <div className="duet-settings__page-title">General</div>
      <SettingRow
        label="Units"
        hint="Preferred unit system for display. Individual panels may override."
        control={
          <select
            className="duet-settings__select"
            value={prefs.units}
            onChange={(e) => patchPrefs({ units: e.target.value as Units })}
          >
            <option value="metric">Metric (mm)</option>
            <option value="imperial">Imperial (in)</option>
          </select>
        }
      />
      <SettingRow
        label="Webcam URL"
        hint="URL for the printer webcam stream. Leave blank to use the default (hostname/webcam/?action=stream)."
        control={
          <input
            className="duet-settings__input"
            type="text"
            value={prefs.webcamUrl}
            onChange={(e) => patchPrefs({ webcamUrl: e.target.value })}
            placeholder="e.g. http://192.168.1.100:8080/?action=stream"
          />
        }
      />
      <SettingRow
        label="Temperature Unit"
        hint="Display temperatures in Celsius or Fahrenheit."
        control={
          <select
            className="duet-settings__select"
            value={prefs.temperatureUnit}
            onChange={(e) => patchPrefs({ temperatureUnit: e.target.value as TemperatureUnit })}
          >
            <option value="C">Celsius (°C)</option>
            <option value="F">Fahrenheit (°F)</option>
          </select>
        }
      />
      <SettingRow
        label="Date Format"
        hint="Show dates as relative (e.g. '2 hours ago') or absolute (e.g. '2026-04-18 14:30')."
        control={
          <select
            className="duet-settings__select"
            value={prefs.dateFormat}
            onChange={(e) => patchPrefs({ dateFormat: e.target.value as DateFormat })}
          >
            <option value="relative">Relative</option>
            <option value="absolute">Absolute</option>
          </select>
        }
      />
      <SettingRow
        label="Language"
        hint="Additional languages are planned — English only today."
        control={
          <select className="duet-settings__select" value="en" disabled>
            <option value="en">English</option>
          </select>
        }
      />
    </>
  );

  const renderAppearance = () => (
    <>
      <div className="duet-settings__page-title">Appearance</div>
      <SettingRow
        label="Theme"
        hint="Switch between light and dark themes. Applies immediately."
        control={
          <div className="duet-settings__mode-selector">
            {(['light', 'dark'] as ThemeMode[]).map((t) => (
              <button
                key={t}
                className={`duet-settings__mode-btn${theme === t ? ' is-active' : ''}`}
                onClick={() => setTheme(t)}
              >
                {t === 'light' ? <Sun size={14} /> : <Moon size={14} />}
                {t}
              </button>
            ))}
          </div>
        }
      />
    </>
  );

  const renderBehaviour = () => (
    <>
      <div className="duet-settings__page-title">Behaviour</div>
      <ToggleRow
        id="confirm-tool-change"
        checked={prefs.confirmToolChange}
        onChange={(v) => patchPrefs({ confirmToolChange: v })}
        label="Confirm tool changes"
        hint="Ask for confirmation before switching the active tool (T command)."
      />
      <ToggleRow
        id="silent-prompts"
        checked={prefs.silentPrompts}
        onChange={(v) => patchPrefs({ silentPrompts: v })}
        label="Silent prompts"
        hint="Suppress beeps for routine M291 message box dialogs."
      />
      <ToggleRow
        id="auto-reconnect"
        checked={prefs.autoReconnect}
        onChange={(v) => patchPrefs({ autoReconnect: v })}
        label="Auto-reconnect"
        hint="Automatically reconnect on startup and when the connection drops. Configure interval and retries in the Connection tab."
      />
    </>
  );

  const renderNotifications = () => (
    <>
      <div className="duet-settings__page-title">Notifications</div>
      <SettingRow
        label="Toast Duration"
        hint="How long notification toasts stay visible before auto-dismissing."
        control={
          <select
            className="duet-settings__select"
            value={prefs.toastDurationMs}
            onChange={(e) => patchPrefs({ toastDurationMs: Number(e.target.value) })}
          >
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
        onChange={(v) => patchPrefs({ notificationsSound: v })}
        label="Play sound on beep events"
        hint="Trigger a short tone when the firmware emits an M300 beep."
      />
      <ToggleRow
        id="sound-alert-complete"
        checked={prefs.soundAlertOnComplete}
        onChange={(v) => patchPrefs({ soundAlertOnComplete: v })}
        label="Sound alert on print complete/error"
        hint="Play a notification sound when a print finishes or encounters an error."
      />
      <SettingRow
        label="Minimum Severity"
        hint="Only show toasts at or above this severity level."
        control={
          <select
            className="duet-settings__select"
            value={prefs.notifMinSeverity}
            onChange={(e) => patchPrefs({ notifMinSeverity: e.target.value as NotifSeverity })}
          >
            <option value="info">Info and above</option>
            <option value="warning">Warning and above</option>
            <option value="error">Errors only</option>
          </select>
        }
      />
    </>
  );

  const renderMachine = () => {
    const mcuOk = board?.mcuTemp?.current !== undefined && board.mcuTemp.current < 70;
    const vinOk = board?.vIn?.current !== undefined && board.vIn.current >= 22 && board.vIn.current <= 26;
    return (
      <>
        <div className="duet-settings__page-title">Machine</div>
        {!connected && (
          <div className="duet-settings__banner duet-settings__banner--info">
            <Info size={16} /> Connect to a Duet board to see live machine details.
          </div>
        )}

        {/* ── Board hero ─────────────────────────────────────────────────── */}
        <div className="ds-machine-hero">
          <div className="ds-machine-hero-head">
            <div className="ds-machine-hero-icon"><Cpu size={22} /></div>
            <div className="ds-machine-hero-title">
              <div className="ds-machine-hero-name">
                {board?.name ?? board?.shortName ?? (connected ? 'Unknown board' : 'Not connected')}
              </div>
              <div className="ds-machine-hero-fw">
                {board ? (
                  <>
                    <span>{board.firmwareName} <strong>{board.firmwareVersion}</strong></span>
                    {board.firmwareDate && (
                      <span className="ds-machine-hero-date"> · {board.firmwareDate}</span>
                    )}
                  </>
                ) : (
                  <span className="duet-settings__dim-text">No firmware information</span>
                )}
              </div>
            </div>
            <span className={`ds-status-pill ds-status-pill--${connected ? 'ok' : 'off'}`}>
              <span className="ds-status-dot" />
              {connected ? 'online' : 'offline'}
            </span>
          </div>

          <div className="ds-metric-grid">
            {board?.mcuTemp?.current !== undefined && (
              <div className={`ds-metric${mcuOk ? '' : ' ds-metric--warn'}`}>
                <div className="ds-metric-icon"><Thermometer size={14} /></div>
                <div className="ds-metric-body">
                  <div className="ds-metric-label">MCU Temp</div>
                  <div className="ds-metric-value">
                    {board.mcuTemp.current.toFixed(1)}<small>°C</small>
                  </div>
                </div>
              </div>
            )}
            {board?.vIn?.current !== undefined && (
              <div className={`ds-metric${vinOk ? '' : ' ds-metric--warn'}`}>
                <div className="ds-metric-icon"><Zap size={14} /></div>
                <div className="ds-metric-body">
                  <div className="ds-metric-label">VIN</div>
                  <div className="ds-metric-value">
                    {board.vIn.current.toFixed(1)}<small>V</small>
                  </div>
                </div>
              </div>
            )}
            {board?.v12?.current !== undefined && (
              <div className="ds-metric">
                <div className="ds-metric-icon"><Zap size={14} /></div>
                <div className="ds-metric-body">
                  <div className="ds-metric-label">12V Rail</div>
                  <div className="ds-metric-value">
                    {board.v12.current.toFixed(1)}<small>V</small>
                  </div>
                </div>
              </div>
            )}
            {board?.maxMotors !== undefined && (
              <div className="ds-metric">
                <div className="ds-metric-icon"><Activity size={14} /></div>
                <div className="ds-metric-body">
                  <div className="ds-metric-label">Max Motors</div>
                  <div className="ds-metric-value">{board.maxMotors}</div>
                </div>
              </div>
            )}
            {board?.maxHeaters !== undefined && (
              <div className="ds-metric">
                <div className="ds-metric-icon"><Thermometer size={14} /></div>
                <div className="ds-metric-body">
                  <div className="ds-metric-label">Max Heaters</div>
                  <div className="ds-metric-value">{board.maxHeaters}</div>
                </div>
              </div>
            )}
            {board?.canAddress !== undefined && (
              <div className="ds-metric">
                <div className="ds-metric-icon"><Activity size={14} /></div>
                <div className="ds-metric-body">
                  <div className="ds-metric-label">CAN Address</div>
                  <div className="ds-metric-value">{board.canAddress}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Axes & motion ──────────────────────────────────────────────── */}
        <div className="duet-settings__section">
          <div className="duet-settings__section-title ds-section-title-row">
            <Ruler size={14} /> Axes &amp; Motion
            {axes.length > 0 && <span className="ds-section-count">{axes.length}</span>}
          </div>
          {axes.length === 0 ? (
            <div className="ds-empty-hint">No axes reported.</div>
          ) : (
            <div className="ds-axes-grid">
              {axes.map((a, i) => {
                const minV = a.min ?? 0;
                const maxV = a.max ?? 0;
                const range = maxV - minV;
                const pos = a.machinePosition ?? minV;
                const pct = range > 0
                  ? Math.max(0, Math.min(100, ((pos - minV) / range) * 100))
                  : 0;
                return (
                  <div key={i} className="ds-axis-card">
                    <div className="ds-axis-head">
                      <span className="ds-axis-letter">{a.letter ?? `#${i}`}</span>
                      <span className={`ds-status-pill ds-status-pill--${a.homed ? 'ok' : 'warn'} ds-status-pill--sm`}>
                        <Home size={9} /> {a.homed ? 'homed' : 'not homed'}
                      </span>
                    </div>

                    <div className="ds-axis-range">
                      <div className="ds-axis-range-bar">
                        <div className="ds-axis-range-fill" style={{ width: `${pct}%` }} />
                        <div className="ds-axis-range-marker" style={{ left: `${pct}%` }} />
                      </div>
                      <div className="ds-axis-range-labels">
                        <span>{minV.toFixed(0)}</span>
                        <span className="ds-axis-range-current">{pos.toFixed(1)} mm</span>
                        <span>{maxV.toFixed(0)}</span>
                      </div>
                    </div>

                    <div className="ds-axis-stats">
                      <div className="ds-axis-stat">
                        <Gauge size={10} />
                        <span className="ds-axis-stat-label">Speed</span>
                        <span className="ds-axis-stat-value">{a.speed?.toFixed(0) ?? '—'}<small> mm/s</small></span>
                      </div>
                      <div className="ds-axis-stat">
                        <Activity size={10} />
                        <span className="ds-axis-stat-label">Accel</span>
                        <span className="ds-axis-stat-value">{a.acceleration?.toFixed(0) ?? '—'}<small> mm/s²</small></span>
                      </div>
                      <div className="ds-axis-stat">
                        <Zap size={10} />
                        <span className="ds-axis-stat-label">Jerk</span>
                        <span className="ds-axis-stat-value">{a.jerk?.toFixed(0) ?? '—'}<small> mm/s</small></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </>
    );
  };

  const renderFirmware = () => {
    const release = updateCheck.release;
    const latestTag = release?.tag_name?.replace(/^v/i, '') ?? '';
    const currentVer = board?.firmwareVersion ?? '';
    const cmp = release && currentVer ? compareVersions(currentVer, latestTag) : null;
    const updateStatus: 'up-to-date' | 'update-available' | 'ahead' | 'unknown' =
      cmp === null ? 'unknown' : cmp < 0 ? 'update-available' : cmp > 0 ? 'ahead' : 'up-to-date';
    const fwMatch: FirmwareMatch = release
      ? pickFirmwareAssets(release.assets, board, mode)
      : { candidates: [], matchLevel: 'none' };
    // RRF release doesn't always bundle the DWC zip. Fall back to the DWC repo's
    // own release so the "Update DuetWebControl" affordance is still reachable.
    let dwcFromDwcRepo = false;
    if (!fwMatch.dwc && updateCheck.dwcRelease) {
      fwMatch.dwc = findDwcAsset(updateCheck.dwcRelease.assets, mode);
      dwcFromDwcRepo = !!fwMatch.dwc;
    }
    const dwcTag = dwcFromDwcRepo
      ? (updateCheck.dwcRelease?.tag_name?.replace(/^v/i, '') ?? '')
      : latestTag;
    const publishedDate = release ? new Date(release.published_at).toLocaleDateString() : '';
    const canAutoUpdate = !!fwMatch.firmware && fwMatch.matchLevel !== 'none';

    return (
      <>
        <div className="duet-settings__page-title">Firmware</div>

        {!connected && (
          <div className="duet-settings__banner duet-settings__banner--info">
            <Info size={16} /> Connect to a Duet board to upload firmware.
          </div>
        )}

        {/* ── Current firmware hero ───────────────────────────────────── */}
        <div className="ds-fw-hero">
          <div className="ds-fw-hero-head">
            <div className="ds-fw-hero-icon"><Zap size={22} /></div>
            <div className="ds-fw-hero-title">
              <div className="ds-fw-hero-label">Current Firmware</div>
              <div className="ds-fw-hero-version">
                {board ? (
                  <>
                    {board.firmwareName} <strong>{board.firmwareVersion}</strong>
                  </>
                ) : (
                  <span className="duet-settings__dim-text">Not connected</span>
                )}
              </div>
              {board?.firmwareDate && (
                <div className="ds-fw-hero-date">
                  <Calendar size={10} /> Built {board.firmwareDate}
                </div>
              )}
            </div>
            <button
              className={`ds-check-btn${updateCheck.loading ? ' is-loading' : ''}`}
              onClick={handleCheckForUpdate}
              disabled={updateCheck.loading}
              title="Check for updates on GitHub"
            >
              <RefreshCw size={13} className={updateCheck.loading ? 'spin' : undefined} />
              {updateCheck.loading ? 'Checking...' : 'Check for updates'}
            </button>
          </div>

          {updateCheck.error && (
            <div className="ds-fw-update-card ds-fw-update-card--error">
              <AlertCircle size={16} />
              <div>
                <div className="ds-fw-update-title">Update check failed</div>
                <div className="ds-fw-update-detail">{updateCheck.error}</div>
              </div>
            </div>
          )}

          {release && !updateCheck.error && (
            <div className={`ds-fw-update-card ds-fw-update-card--${updateStatus}`}>
              <div className="ds-fw-update-head">
                <div className="ds-fw-update-icon">
                  {updateStatus === 'update-available' ? <ArrowUpCircle size={18} />
                    : updateStatus === 'ahead' ? <Info size={18} />
                    : <Sparkles size={18} />}
                </div>
                <div className="ds-fw-update-info">
                  <div className="ds-fw-update-title">
                    {updateStatus === 'update-available' && `Update available: v${latestTag}`}
                    {updateStatus === 'up-to-date' && 'You are running the latest firmware'}
                    {updateStatus === 'ahead' && `You're ahead of GitHub (latest: v${latestTag})`}
                    {updateStatus === 'unknown' && `Latest release: v${latestTag}`}
                  </div>
                  <div className="ds-fw-update-detail">
                    {updateStatus === 'update-available' && currentVer
                      ? <>Installed: <span className="duet-settings__mono">v{currentVer}</span> → Latest: <span className="duet-settings__mono">v{latestTag}</span></>
                      : release.name || `v${latestTag}`}
                    {publishedDate && <span className="ds-fw-update-date"> · Published {publishedDate}</span>}
                  </div>
                </div>
                <a
                  href={release.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ds-fw-external-btn"
                  title="View release on GitHub"
                >
                  <ExternalLink size={12} /> GitHub
                </a>
              </div>

              {fwMatch.candidates.length > 0 && (
                <div className="ds-fw-assets">
                  <div className="ds-fw-assets-label">
                    {fwMatch.matchLevel === 'exact' && (
                      <>
                        <CheckCircle size={10} /> Exact match for{' '}
                        <span className="duet-settings__mono">{board?.firmwareFileName}</span>
                      </>
                    )}
                    {fwMatch.matchLevel === 'family' && (
                      <>
                        <CheckCircle size={10} /> Matched to {fwMatch.familyName ?? board?.shortName}
                      </>
                    )}
                    {fwMatch.matchLevel === 'guess' && (
                      <>
                        <Info size={10} /> Best guess for {board?.shortName ?? board?.name ?? 'this board'}
                      </>
                    )}
                    {fwMatch.matchLevel === 'none' && (
                      <>
                        <AlertCircle size={10} /> No asset matched — select manually
                      </>
                    )}
                  </div>

                  {updateStatus === 'update-available' && canAutoUpdate && fwMatch.firmware && (
                    <div className="ds-fw-auto-update-row">
                      <button
                        className="ds-fw-update-action-btn"
                        onClick={() => handleAutoUpdate(fwMatch.firmware!, fwMatch.dwc)}
                        disabled={
                          !connected ||
                          autoUpdate.step === 'downloading' ||
                          autoUpdate.step === 'uploading' ||
                          autoUpdate.step === 'installing'
                        }
                      >
                        {autoUpdate.step === 'downloading' ? (
                          <><Loader2 size={14} className="spin" /> Downloading {autoUpdate.progress}%</>
                        ) : autoUpdate.step === 'uploading' ? (
                          <><Loader2 size={14} className="spin" /> Uploading {uploadProgress}%</>
                        ) : autoUpdate.step === 'installing' ? (
                          <><Loader2 size={14} className="spin" /> Installing…</>
                        ) : (
                          <><ArrowUpCircle size={14} /> Update to v{latestTag}</>
                        )}
                      </button>
                      <div className="ds-fw-auto-update-hint">
                        Will install{' '}
                        <span className="duet-settings__mono">{fwMatch.firmware.name}</span>
                        {' '}({formatBytes(fwMatch.firmware.size)})
                        {fwMatch.dwc && (
                          <> and update <span className="duet-settings__mono">{fwMatch.dwc.name}</span> ({formatBytes(fwMatch.dwc.size)})</>
                        )}
                        {' '}· The board will reboot during install.
                        {fwMatch.matchLevel === 'guess' && (
                          <> <strong>Heuristic match — verify this is the correct firmware before installing.</strong></>
                        )}
                      </div>
                    </div>
                  )}

                  {updateStatus !== 'update-available' && fwMatch.dwc && (
                    <div className="ds-fw-auto-update-row ds-fw-auto-update-row--dwc">
                      <button
                        className="ds-fw-update-action-btn ds-fw-update-action-btn--secondary"
                        onClick={() => handleUpdateDwcOnly(fwMatch.dwc!)}
                        disabled={
                          !connected ||
                          autoUpdate.step === 'downloading' ||
                          autoUpdate.step === 'uploading' ||
                          autoUpdate.step === 'installing'
                        }
                      >
                        {autoUpdate.step === 'downloading' ? (
                          <><Loader2 size={14} className="spin" /> Downloading {autoUpdate.progress}%</>
                        ) : autoUpdate.step === 'uploading' ? (
                          <><Loader2 size={14} className="spin" /> Uploading {uploadProgress}%</>
                        ) : (
                          <><RefreshCw size={14} /> Update DuetWebControl to v{dwcTag}</>
                        )}
                      </button>
                      <div className="ds-fw-auto-update-hint">
                        Fixes <em>"Incompatible software versions"</em> warnings when RRF is current but the DWC bundle on the board is stale.
                        Will upload <span className="duet-settings__mono">{fwMatch.dwc.name}</span> ({formatBytes(fwMatch.dwc.size)}) to <span className="duet-settings__mono">0:/www/</span> — no reboot required.
                      </div>
                    </div>
                  )}

                  {updateStatus === 'update-available' && !canAutoUpdate && (
                    <div className="ds-fw-auto-update-row ds-fw-auto-update-row--warn">
                      <div className="ds-fw-auto-update-hint">
                        <AlertCircle size={11} /> Could not identify firmware for{' '}
                        <span className="duet-settings__mono">{board?.shortName ?? board?.name ?? 'this board'}</span>.
                        Choose the right file from the list below and use the <strong>Upload</strong> section.
                      </div>
                    </div>
                  )}

                  {autoUpdate.step !== 'idle' && (
                    <div className={`ds-fw-auto-status ds-fw-auto-status--${autoUpdate.step}`}>
                      <div className="ds-fw-auto-status-head">
                        <div className="ds-fw-auto-status-msg">
                          {autoUpdate.step === 'downloading' && (
                            <><Download size={13} /> Downloading <span className="duet-settings__mono">{autoUpdate.assetName}</span></>
                          )}
                          {autoUpdate.step === 'uploading' && (
                            <><UploadCloud size={13} /> Uploading to board</>
                          )}
                          {autoUpdate.step === 'installing' && (
                            <><Zap size={13} /> Sending M997 — board is rebooting</>
                          )}
                          {autoUpdate.step === 'done' && (
                            <><Loader2 size={13} className="spin" /> Update sent — waiting for the board to come back online</>
                          )}
                          {autoUpdate.step === 'reconnected' && (
                            <><CheckCircle size={13} /> Update complete — board reconnected{board?.firmwareVersion ? ` on v${board.firmwareVersion}` : ''}</>
                          )}
                          {autoUpdate.step === 'error' && (
                            <><AlertCircle size={13} /> Update failed</>
                          )}
                        </div>
                        {(autoUpdate.step === 'reconnected' || autoUpdate.step === 'error') && (
                          <button
                            className="ds-fw-auto-status-dismiss"
                            onClick={() => {
                              setAutoUpdate({ step: 'idle', progress: 0 });
                              if (autoUpdate.step === 'reconnected') handleCheckForUpdate();
                            }}
                            title="Dismiss"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      {autoUpdate.step === 'downloading' && (
                        <div className="ds-fw-auto-progress-bar">
                          <div className="ds-fw-auto-progress-fill" style={{ width: `${autoUpdate.progress}%` }} />
                        </div>
                      )}
                      {autoUpdate.step === 'uploading' && (
                        <div className="ds-fw-auto-progress-bar">
                          <div className="ds-fw-auto-progress-fill" style={{ width: `${uploadProgress}%` }} />
                        </div>
                      )}
                      {autoUpdate.step === 'error' && autoUpdate.error && (
                        <div className="ds-fw-auto-error">{autoUpdate.error}</div>
                      )}
                    </div>
                  )}

                  <div className="ds-fw-assets-list">
                    {fwMatch.candidates.slice(0, 6).map((asset) => {
                      const isPick = asset === fwMatch.firmware;
                      const isIap = asset === fwMatch.iapSbc || asset === fwMatch.iapSd;
                      return (
                        <a
                          key={asset.name}
                          className={`ds-fw-asset${isPick ? ' is-pick' : ''}${isIap ? ' is-iap' : ''}`}
                          href={asset.browser_download_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Download ${asset.name}`}
                        >
                          <Package size={12} />
                          <span className="ds-fw-asset-name">{asset.name}</span>
                          {isPick && <span className="ds-fw-asset-tag ds-fw-asset-tag--pick">firmware</span>}
                          {asset === fwMatch.iapSbc && <span className="ds-fw-asset-tag">IAP (SBC)</span>}
                          {asset === fwMatch.iapSd  && <span className="ds-fw-asset-tag">IAP (SD)</span>}
                          <span className="ds-fw-asset-size">{formatBytes(asset.size)}</span>
                          <Download size={11} />
                        </a>
                      );
                    })}
                  </div>
                  <div className="ds-fw-asset-hint">
                    {updateStatus === 'update-available' && canAutoUpdate
                      ? <>Or download manually and use <strong>Upload</strong> below.</>
                      : <>Download the matching file, then use <strong>Upload</strong> below to send it to the board.</>}
                  </div>
                </div>
              )}

              {release.body && (
                <div className="ds-fw-notes-wrap">
                  <button
                    className="ds-fw-notes-toggle"
                    onClick={() => setShowReleaseNotes((v) => !v)}
                  >
                    {showReleaseNotes ? 'Hide' : 'Show'} release notes
                  </button>
                  {showReleaseNotes && (
                    <pre className="ds-fw-notes">{release.body}</pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Upload Firmware ────────────────────────────────────────── */}
        <div className="duet-settings__section">
          <div className="duet-settings__section-title ds-section-title-row">
            <UploadCloud size={14} /> Upload Firmware
          </div>
          <p className="duet-settings__about-text duet-settings__about-text--mb">
            Select a RepRapFirmware <code className="duet-settings__code-accent">.bin</code> or{' '}
            <code className="duet-settings__code-accent">.uf2</code> file. It will be uploaded to{' '}
            <code className="duet-settings__code-accent">0:/firmware/</code> on the board.
          </p>

          <input
            ref={firmwareInputRef}
            type="file"
            accept=".bin,.uf2"
            className="duet-settings__file-input-hidden"
            onChange={(e) => handleFirmwareSelect(e.target.files)}
          />

          <div className="duet-settings__btn-row">
            <button
              className={`duet-settings__btn duet-settings__btn--secondary${!connected || uploading ? ' duet-settings__btn--disabled' : ''}`}
              onClick={() => firmwareInputRef.current?.click()}
              disabled={!connected || uploading}
            >
              <UploadCloud size={14} /> Choose File
            </button>
            <button
              className={`duet-settings__btn duet-settings__btn--primary${!firmwareFile || uploading || !connected ? ' duet-settings__btn--disabled' : ''}`}
              onClick={handleFirmwareUpload}
              disabled={!firmwareFile || uploading || !connected}
            >
              {uploading ? (
                <><Loader2 size={14} className="spin" /> Uploading {uploadProgress}%</>
              ) : (
                'Upload'
              )}
            </button>
            <button
              className={`duet-settings__btn duet-settings__btn--danger${!connected ? ' duet-settings__btn--disabled' : ''}`}
              onClick={handleFirmwareInstall}
              disabled={!connected}
            >
              <Zap size={14} /> Install (M997)
            </button>
          </div>

          {firmwareFile && !uploading && (
            <div className="ds-fw-file-chip">
              <Package size={12} />
              <span className="duet-settings__mono">{firmwareFile.name}</span>
              <span className="ds-fw-file-chip-size">{formatBytes(firmwareFile.size)}</span>
            </div>
          )}

          {uploading && (
            <div className="duet-settings__progress-wrapper">
              <div className="duet-settings__progress-track">
                <div
                  className="duet-settings__progress-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {firmwareStatus && (
            <div className={`duet-settings__banner duet-settings__banner--mt ${firmwareStatus.type === 'success' ? 'duet-settings__banner--success' : 'duet-settings__banner--error'}`}>
              {firmwareStatus.type === 'success' ? (
                <CheckCircle size={16} />
              ) : (
                <AlertCircle size={16} />
              )}
              <span>{firmwareStatus.message}</span>
            </div>
          )}

          {firmwareUpdatePending && (
            <div className="duet-settings__banner duet-settings__banner--mt duet-settings__banner--warning">
              <Loader2 size={16} className="spin" />
              <span>Board is rebooting — waiting for reconnect...</span>
            </div>
          )}
        </div>

        {/* ── IAP ─────────────────────────────────────────────────────── */}
        <div className="duet-settings__section">
          <div className="duet-settings__section-title ds-section-title-row">
            <Package size={14} /> IAP File
            <span className="ds-section-tag">standalone boards</span>
          </div>
          <p className="duet-settings__about-text duet-settings__about-text--mb">
            Select an IAP <code className="duet-settings__code-accent">.bin</code> file (e.g.{' '}
            <code className="duet-settings__code-accent">IAP4E.bin</code> or{' '}
            <code className="duet-settings__code-accent">Duet3_SBC.bin</code>). It will be uploaded to{' '}
            <code className="duet-settings__code-accent">0:/firmware/</code> on the board.
          </p>
          <p className="duet-settings__hint">
            Required for standalone (non-SBC) boards before firmware install.
          </p>

          <input
            ref={iapInputRef}
            type="file"
            accept=".bin"
            className="duet-settings__file-input-hidden"
            onChange={(e) => handleIapSelect(e.target.files)}
          />

          <div className="duet-settings__btn-row">
            <button
              className={`duet-settings__btn duet-settings__btn--secondary${!connected || uploading ? ' duet-settings__btn--disabled' : ''}`}
              onClick={() => iapInputRef.current?.click()}
              disabled={!connected || uploading}
            >
              <UploadCloud size={14} /> Choose IAP File
            </button>
            <button
              className={`duet-settings__btn duet-settings__btn--primary${!iapFile || uploading || !connected ? ' duet-settings__btn--disabled' : ''}`}
              onClick={handleIapUpload}
              disabled={!iapFile || uploading || !connected}
            >
              {uploading ? (
                <><Loader2 size={14} className="spin" /> Uploading {uploadProgress}%</>
              ) : (
                'Upload IAP'
              )}
            </button>
          </div>

          {iapFile && !uploading && (
            <div className="ds-fw-file-chip">
              <Package size={12} />
              <span className="duet-settings__mono">{iapFile.name}</span>
              <span className="ds-fw-file-chip-size">{formatBytes(iapFile.size)}</span>
            </div>
          )}

          {iapStatus && (
            <div className={`duet-settings__banner duet-settings__banner--mt ${iapStatus.type === 'success' ? 'duet-settings__banner--success' : 'duet-settings__banner--error'}`}>
              {iapStatus.type === 'success' ? (
                <CheckCircle size={16} />
              ) : (
                <AlertCircle size={16} />
              )}
              <span>{iapStatus.message}</span>
            </div>
          )}
        </div>
      </>
    );
  };

  const renderPanelDue = () => {
    const release = panelDueCheck.release;
    const bins = release ? sortPanelDueAssets(panelDueBinAssets(release.assets)) : [];
    const latestTag = release?.tag_name?.replace(/^v/i, '') ?? '';
    const pdStep = panelDueUpdate.step;
    const busy = pdStep === 'downloading' || pdStep === 'uploading' || pdStep === 'installing';
    const primaryCfg = panelDueInfo.configs.find(
      (c) => c.checksum === 2 || c.checksum === 3,
    ) ?? panelDueInfo.configs[0];
    const publishedDate = release ? new Date(release.published_at).toLocaleDateString() : '';
    const checksumLabel =
      primaryCfg?.checksum === 2 ? 'CRC (PanelDue)' :
      primaryCfg?.checksum === 3 ? 'CRC + checksum' :
      primaryCfg?.checksum === 1 ? 'Checksum only' :
      primaryCfg?.checksum === 0 ? 'None' : undefined;

    return (
      <>
        <div className="duet-settings__page-title">PanelDue</div>

        {!connected && (
          <div className="duet-settings__banner duet-settings__banner--info">
            <Info size={16} /> Connect to a Duet board to detect and update a PanelDue.
          </div>
        )}

        {/* ── Detected PanelDue hero ─────────────────────────────────── */}
        <div className="ds-fw-hero">
          <div className="ds-fw-hero-head">
            <div className="ds-fw-hero-icon"><Monitor size={22} /></div>
            <div className="ds-fw-hero-title">
              <div className="ds-fw-hero-label">Detected PanelDue</div>
              <div className="ds-fw-hero-version">
                {!connected ? (
                  <span className="duet-settings__dim-text">Not connected</span>
                ) : panelDueInfo.loading ? (
                  <span className="duet-settings__dim-text">
                    <Loader2 size={12} className="spin" /> Reading config.g…
                  </span>
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
                  {panelDueFlashed.data.flashedAt
                    ? <> on {new Date(panelDueFlashed.data.flashedAt).toLocaleDateString()}</>
                    : null}
                </div>
              )}
              {connected && (
                <button
                  className="ds-fw-hero-rescan"
                  onClick={loadPanelDueInfo}
                  disabled={panelDueInfo.loading}
                  title="Re-read 0:/sys/config.g"
                >
                  {panelDueInfo.loading ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
                  {panelDueInfo.loading ? 'Re-scanning…' : 'Re-scan config.g'}
                </button>
              )}
            </div>
            <button
              className={`ds-check-btn${panelDueCheck.loading ? ' is-loading' : ''}`}
              onClick={handleCheckPanelDueUpdate}
              disabled={!connected || panelDueCheck.loading}
              title="Check GitHub for the latest PanelDue firmware"
            >
              <RefreshCw size={13} className={panelDueCheck.loading ? 'spin' : undefined} />
              {panelDueCheck.loading ? 'Checking...' : 'Check for updates'}
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

          {panelDueCheck.error && (
            <div className="ds-fw-update-card ds-fw-update-card--error">
              <AlertCircle size={16} />
              <div>
                <div className="ds-fw-update-title">Update check failed</div>
                <div className="ds-fw-update-detail">{panelDueCheck.error}</div>
              </div>
            </div>
          )}

          {release && !panelDueCheck.error && (
            <div className="ds-fw-update-card ds-fw-update-card--unknown">
              <div className="ds-fw-update-head">
                <div className="ds-fw-update-icon"><Sparkles size={18} /></div>
                <div className="ds-fw-update-info">
                  <div className="ds-fw-update-title">
                    Latest release: v{latestTag}
                  </div>
                  <div className="ds-fw-update-detail">
                    {release.name || `v${latestTag}`}
                    {publishedDate && <span className="ds-fw-update-date"> · Published {publishedDate}</span>}
                  </div>
                </div>
                <a
                  href={release.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ds-fw-external-btn"
                  title="View release on GitHub"
                >
                  <ExternalLink size={12} /> GitHub
                </a>
              </div>

              {bins.length === 0 ? (
                <div className="ds-fw-auto-update-row ds-fw-auto-update-row--warn">
                  <div className="ds-fw-auto-update-hint">
                    <AlertCircle size={11} /> This release doesn't include a PanelDue <code>.bin</code> — visit the release page directly.
                  </div>
                </div>
              ) : (
                <div className="ds-fw-assets">
                  <div className="ds-fw-assets-label">
                    <Info size={10} /> Pick the variant that matches your PanelDue's screen size
                  </div>

                  <div className="ds-fw-auto-update-row">
                    <button
                      className="ds-fw-update-action-btn"
                      onClick={() => panelDueAsset && handlePanelDueInstall(panelDueAsset)}
                      disabled={!connected || !panelDueAsset || busy}
                    >
                      {pdStep === 'downloading' ? (
                        <><Loader2 size={14} className="spin" /> Downloading {panelDueUpdate.progress}%</>
                      ) : pdStep === 'uploading' ? (
                        <><Loader2 size={14} className="spin" /> Uploading {panelDueUpdate.progress}%</>
                      ) : pdStep === 'installing' ? (
                        <><Loader2 size={14} className="spin" /> Flashing PanelDue…</>
                      ) : (
                        <><ArrowUpCircle size={14} /> Flash PanelDue{latestTag ? ` v${latestTag}` : ''}</>
                      )}
                    </button>
                    <div className="ds-fw-auto-update-hint">
                      Will upload{panelDueAsset ? <> <span className="duet-settings__mono">{panelDueAsset.name}</span> ({formatBytes(panelDueAsset.size)})</> : ' the selected variant'}
                      {' '}as <span className="duet-settings__mono">0:/firmware/PanelDueFirmware.bin</span> and run{' '}
                      <span className="duet-settings__mono">M997 S4</span> · The Duet stays running; flashing takes ~30–60s and the PanelDue restarts on its own.
                    </div>
                  </div>

                  {pdStep !== 'idle' && (
                    <div className={`ds-fw-auto-status ds-fw-auto-status--${pdStep === 'done' ? 'reconnected' : pdStep}`}>
                      <div className="ds-fw-auto-status-head">
                        <div className="ds-fw-auto-status-msg">
                          {pdStep === 'downloading' && (
                            <><Download size={13} /> Downloading <span className="duet-settings__mono">{panelDueUpdate.assetName}</span></>
                          )}
                          {pdStep === 'uploading' && (
                            <><UploadCloud size={13} /> Uploading to board</>
                          )}
                          {pdStep === 'installing' && (
                            <><Zap size={13} /> Flashing PanelDue — waiting for the board to confirm</>
                          )}
                          {pdStep === 'done' && !panelDueUpdate.timedOut && (
                            <><CheckCircle size={13} /> PanelDue firmware flashed successfully</>
                          )}
                          {pdStep === 'done' && panelDueUpdate.timedOut && (
                            <><AlertCircle size={13} /> Flash finished without a confirmation — check the display</>
                          )}
                          {pdStep === 'error' && (
                            <><AlertCircle size={13} /> Update failed</>
                          )}
                        </div>
                        {(pdStep === 'done' || pdStep === 'error') && (
                          <button
                            className="ds-fw-auto-status-dismiss"
                            onClick={() => setPanelDueUpdate({ step: 'idle', progress: 0 })}
                            title="Dismiss"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      {pdStep === 'downloading' && (
                        <div className="ds-fw-auto-progress-bar">
                          <div className="ds-fw-auto-progress-fill" style={{ width: `${panelDueUpdate.progress}%` }} />
                        </div>
                      )}
                      {pdStep === 'uploading' && (
                        <div className="ds-fw-auto-progress-bar">
                          <div className="ds-fw-auto-progress-fill" style={{ width: `${panelDueUpdate.progress}%` }} />
                        </div>
                      )}
                      {pdStep === 'error' && panelDueUpdate.error && (
                        <div className="ds-fw-auto-error">{panelDueUpdate.error}</div>
                      )}
                      {(pdStep === 'installing' || pdStep === 'done' || pdStep === 'error') &&
                       panelDueUpdate.messages && panelDueUpdate.messages.length > 0 && (
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
                        <button
                          key={asset.name}
                          type="button"
                          role="row"
                          className={`ds-pd-row${isPick ? ' is-pick' : ''}`}
                          onClick={() => setPanelDueAsset(asset)}
                          disabled={busy}
                          title={asset.name}
                        >
                          <span role="cell" className="ds-pd-cell-variant">
                            {isPick
                              ? <CheckCircle size={11} className="ds-pd-row-check" />
                              : <span className="ds-pd-row-bullet" aria-hidden />}
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
                  <button
                    className="ds-fw-notes-toggle"
                    onClick={() => setShowPanelDueNotes((v) => !v)}
                  >
                    {showPanelDueNotes ? 'Hide' : 'Show'} release notes
                  </button>
                  {showPanelDueNotes && (
                    <pre className="ds-fw-notes">{release.body}</pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

      </>
    );
  };

  const renderBackup = () => (
    <>
      <div className="duet-settings__page-title">Backup &amp; Restore</div>
      <p className="duet-settings__about-text">
        Export all your workspace preferences to a <code>.json</code> file and
        import them on any device or browser — even after clearing site data.
        Model geometry and plate objects are <strong>not</strong> included; use
        the <em>Save (.dzn)</em> button for those.
      </p>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">What is exported</div>
        <ul className="duet-settings__about-text" style={{ paddingLeft: 18, margin: 0 }}>
          <li>Design workspace — grid, units, visual style, viewport layout, tolerances</li>
          <li>Prepare workspace — all slicer profiles (printer, material, print) &amp; active selections</li>
          <li>3D Print workspace — printer connection config &amp; all UI preferences</li>
          <li>Theme (light / dark)</li>
        </ul>
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Export</div>
        <button
          className="duet-settings__btn duet-settings__btn--primary"
          onClick={downloadSettings}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <Download size={14} /> Download settings file
        </button>
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Import</div>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={handleImport}
        />
        <button
          className="duet-settings__btn duet-settings__btn--secondary"
          onClick={() => importInputRef.current?.click()}
          disabled={importing}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          {importing ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
          {importing ? 'Importing…' : 'Choose settings file…'}
        </button>

        {importResult && (
          <div
            className={`duet-settings__banner duet-settings__banner--${importResult.ok ? 'success' : 'error'}`}
            style={{ marginTop: 12 }}
          >
            {importResult.ok ? (
              <>
                <CheckCircle size={14} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Import successful</strong>
                  <div style={{ marginTop: 4, fontSize: 12 }}>
                    Applied: {importResult.appliedSections.join(', ')}
                  </div>
                  {importResult.warnings.map((w, i) => (
                    <div key={i} style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>{w}</div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <div><strong>Import failed</strong> — {importResult.error}</div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );

  const renderAbout = () => (
    <>
      <div className="duet-settings__page-title">About</div>
      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Dzign3D — Printer Panel</div>
        <p className="duet-settings__about-text">
          Communicates with Duet3D boards (Duet 2, Duet 3, and compatible) using the
          RepRapFirmware REST API. Compatible with RepRapFirmware 3.x and the DuetWebControl
          3.x protocol. Both standalone and SBC (DuetSoftwareFramework) modes are supported.
        </p>
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Firmware</div>
        {board ? (
          <div className="duet-settings__info-grid">
            <span className="duet-settings__dim-text">Board</span>
            <span className="duet-settings__mono">{board.name ?? board.shortName ?? '—'}</span>
            <span className="duet-settings__dim-text">Firmware</span>
            <span className="duet-settings__mono">{board.firmwareName} {board.firmwareVersion}</span>
            {board.firmwareDate && (
              <>
                <span className="duet-settings__dim-text">Build date</span>
                <span className="duet-settings__mono">{board.firmwareDate}</span>
              </>
            )}
          </div>
        ) : (
          <div className="duet-settings__dim-text">Not connected.</div>
        )}
      </div>
    </>
  );

  const pageContent = useMemo(() => {
    switch (tab) {
      case 'connection':    return renderConnection();
      case 'general':       return renderGeneral();
      case 'appearance':    return renderAppearance();
      case 'behaviour':     return renderBehaviour();
      case 'notifications': return renderNotifications();
      case 'machine':       return renderMachine();
      case 'firmware':      return renderFirmware();
      case 'paneldue':      return renderPanelDue();
      case 'backup':        return renderBackup();
      case 'about':         return renderAbout();
      default:              return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, prefs, theme, hostname, password, mode, testing, testResult, error, connected, connecting, axes, board, firmwareFile, firmwareStatus, uploading, uploadProgress, iapFile, iapStatus, firmwareUpdatePending, importing, importResult, updateCheck, showReleaseNotes, autoUpdate, panelDueInfo, panelDueCheck, panelDueUpdate, panelDueAsset, showPanelDueNotes]);

  return (
    <div className="duet-settings__page">
      <nav className="duet-settings__nav">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`duet-settings__nav-item${tab === key ? ' is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>
      <div className="duet-settings__body">{pageContent}</div>
    </div>
  );
}
