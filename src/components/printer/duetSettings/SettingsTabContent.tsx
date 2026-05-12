import React from 'react';
import { compareVersions, findDwcAsset, panelDueBinAssets, pickFirmwareAssets, sortPanelDueAssets, type FirmwareMatch, type GitHubAsset, type GitHubRelease, type PanelDueConfig } from './helpers';
import { BehaviourSection, CameraSection, ConnectionSection, GeneralSection, NotificationsSection } from './basicSections';
import DuetObjectModelBrowser from '../DuetObjectModelBrowser';
import { AboutSection, BackupSection, MachineSection } from './infoSections';
import { FilamentsSection } from './filamentsSection';
import { FirmwareSection, type AutoUpdateState, type PanelDueFlashed, type PanelDueUpdateState } from './firmwareSections';
import { PanelDueSection } from './firmwareSections';
import type { DuetPrefs } from '../../../utils/duetPrefs';
import type { ImportResult } from '../../../utils/settingsExport';
import type { DuetAxis, DuetBoard, DuetTransport, PrinterBoardType } from '../../../types/duet';

export type DuetSettingsTabKey =
  | 'connection'
  | 'general'
  | 'camera'
  | 'behaviour'
  | 'notifications'
  | 'machine'
  | 'filaments'
  | 'printer-model'
  | 'firmware'
  | 'paneldue'
  | 'backup'
  | 'about';

export function SettingsTabContent(props: {
  activePrinterId: string | null;
  autoUpdate: { step: AutoUpdateState['step']; progress: number; assetName?: string; error?: string };
  axes: DuetAxis[];
  boardType: PrinterBoardType;
  board: DuetBoard | undefined;
  canConnect: boolean;
  config: {
    hostname: string;
    password?: string;
    mode?: 'standalone' | 'sbc';
    transport?: DuetTransport;
    serialBaudRate?: number;
    serialPortLabel?: string;
    serialVendorId?: number;
    serialProductId?: number;
  };
  connected: boolean;
  connecting: boolean;
  downloadSettings: typeof import('../../../utils/settingsExport').downloadSettings;
  error: string | null;
  firmwareFile: File | null;
  firmwareInputRef: React.RefObject<HTMLInputElement | null>;
  firmwareStatus: { type: 'success' | 'error'; message: string } | null;
  firmwareUpdatePending: boolean;
  handleAutoUpdate: (fwAsset: GitHubAsset, dwcAsset?: GitHubAsset) => Promise<void>;
  handleCheckForUpdate: () => Promise<void>;
  handleCheckPanelDueUpdate: () => Promise<void>;
  handleConnect: () => Promise<void>;
  handleDisconnect: () => Promise<void>;
  handleFirmwareInstall: () => Promise<void>;
  handleFirmwareSelect: (files: FileList | null) => void;
  handleFirmwareUpload: () => Promise<void>;
  handleIapSelect: (files: FileList | null) => void;
  handleIapUpload: () => Promise<void>;
  handleImport: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handlePanelDueInstall: (asset: GitHubAsset) => Promise<void>;
  handleTest: () => Promise<void>;
  handleUpdateDwcOnly: (dwcAsset: GitHubAsset) => Promise<void>;
  hostname: string;
  iapFile: File | null;
  iapInputRef: React.RefObject<HTMLInputElement | null>;
  iapStatus: { type: 'success' | 'error'; message: string } | null;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  importResult: ImportResult | null;
  importing: boolean;
  loadPanelDueInfo: () => Promise<void>;
  mode: 'standalone' | 'sbc';
  panelDueAsset: GitHubAsset | null;
  panelDueCheck: { loading: boolean; release?: GitHubRelease; error?: string };
  panelDueFlashed: { loaded: boolean; data?: PanelDueFlashed };
  panelDueInfo: { loading: boolean; loaded: boolean; configs: PanelDueConfig[]; error?: string };
  panelDueLogRef: React.RefObject<HTMLPreElement | null>;
  panelDueUpdate: { step: PanelDueUpdateState['step']; progress: number; assetName?: string; error?: string; messages?: string[]; timedOut?: boolean };
  password: string;
  patchPrefs: (patch: Partial<DuetPrefs>) => void;
  prefs: DuetPrefs;
  setAutoUpdate: React.Dispatch<React.SetStateAction<{ step: AutoUpdateState['step']; progress: number; assetName?: string; error?: string }>>;
  setBoardType: (value: PrinterBoardType) => void;
  setConfigPatch: (patch: {
    transport?: DuetTransport;
    serialBaudRate?: number;
    serialPortLabel?: string;
    serialVendorId?: number;
    serialProductId?: number;
  }) => void;
  setHostname: React.Dispatch<React.SetStateAction<string>>;
  setMode: React.Dispatch<React.SetStateAction<'standalone' | 'sbc'>>;
  setPanelDueAsset: React.Dispatch<React.SetStateAction<GitHubAsset | null>>;
  setPanelDueUpdate: React.Dispatch<React.SetStateAction<{ step: PanelDueUpdateState['step']; progress: number; assetName?: string; error?: string; messages?: string[]; timedOut?: boolean }>>;
  setPassword: React.Dispatch<React.SetStateAction<string>>;
  setShowPanelDueNotes: React.Dispatch<React.SetStateAction<boolean>>;
  setShowReleaseNotes: React.Dispatch<React.SetStateAction<boolean>>;
  showPanelDueNotes: boolean;
  showReleaseNotes: boolean;
  tab: DuetSettingsTabKey;
  testResult: { success: boolean; firmwareVersion?: string; error?: string } | null;
  testing: boolean;
  updateCheck: { loading: boolean; release?: GitHubRelease; dwcRelease?: GitHubRelease; error?: string };
  uploadProgress: number;
  uploading: boolean;
}) {
  const {
    activePrinterId, autoUpdate, axes, board, boardType, canConnect, config, connected, connecting, downloadSettings, error,
    firmwareFile, firmwareInputRef, firmwareStatus, firmwareUpdatePending, handleAutoUpdate,
    handleCheckForUpdate, handleCheckPanelDueUpdate, handleConnect, handleDisconnect, handleFirmwareInstall,
    handleFirmwareSelect, handleFirmwareUpload, handleIapSelect, handleIapUpload, handleImport, handlePanelDueInstall,
    handleTest, handleUpdateDwcOnly, hostname, iapFile, iapInputRef,
    iapStatus, importInputRef, importResult, importing, loadPanelDueInfo, mode, panelDueAsset, panelDueCheck,
    panelDueFlashed, panelDueInfo, panelDueLogRef, panelDueUpdate, password, patchPrefs, prefs,
    setAutoUpdate, setBoardType, setConfigPatch, setHostname, setMode, setPanelDueAsset, setPanelDueUpdate, setPassword,
    setShowPanelDueNotes, setShowReleaseNotes, showPanelDueNotes, showReleaseNotes, tab, testResult,
    testing, updateCheck, uploadProgress, uploading,
  } = props;

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
      <FirmwareSection
        autoUpdate={autoUpdate}
        board={board}
        canAutoUpdate={canAutoUpdate}
        connected={connected}
        currentVer={currentVer}
        dwcTag={dwcTag}
        firmwareFile={firmwareFile}
        firmwareInputRef={firmwareInputRef}
        firmwareStatus={firmwareStatus}
        firmwareUpdatePending={firmwareUpdatePending}
        fwMatch={fwMatch}
        handleAutoUpdate={handleAutoUpdate}
        handleCheckForUpdate={handleCheckForUpdate}
        handleFirmwareInstall={handleFirmwareInstall}
        handleFirmwareSelect={handleFirmwareSelect}
        handleFirmwareUpload={handleFirmwareUpload}
        handleUpdateDwcOnly={handleUpdateDwcOnly}
        latestTag={latestTag}
        publishedDate={publishedDate}
        release={release}
        setAutoUpdate={setAutoUpdate}
        setShowReleaseNotes={setShowReleaseNotes}
        showReleaseNotes={showReleaseNotes}
        updateCheckError={updateCheck.error}
        updateLoading={updateCheck.loading}
        updateStatus={updateStatus}
        uploadProgress={uploadProgress}
        uploading={uploading}
        iapFile={iapFile}
        iapInputRef={iapInputRef}
        iapStatus={iapStatus}
        handleIapSelect={handleIapSelect}
        handleIapUpload={handleIapUpload}
      />
    );
  };

  const renderPanelDue = () => {
    const release = panelDueCheck.release;
    const bins = release ? sortPanelDueAssets(panelDueBinAssets(release.assets ?? [])) : [];
    const latestTag = release?.tag_name?.replace(/^v/i, '') ?? '';
    const busy = panelDueUpdate.step === 'downloading' || panelDueUpdate.step === 'uploading' || panelDueUpdate.step === 'installing';
    const publishedDate = release ? new Date(release.published_at).toLocaleDateString() : '';

    return (
      <PanelDueSection
        bins={bins}
        busy={busy}
        connected={connected}
        handleCheckPanelDueUpdate={handleCheckPanelDueUpdate}
        handlePanelDueInstall={handlePanelDueInstall}
        latestTag={latestTag}
        loadPanelDueInfo={loadPanelDueInfo}
        panelDueAsset={panelDueAsset}
        panelDueCheckError={panelDueCheck.error}
        panelDueCheckLoading={panelDueCheck.loading}
        panelDueFlashed={panelDueFlashed}
        panelDueInfo={panelDueInfo}
        panelDueLogRef={panelDueLogRef}
        panelDueUpdate={panelDueUpdate}
        publishedDate={publishedDate}
        release={release}
        setPanelDueAsset={setPanelDueAsset}
        setPanelDueUpdate={setPanelDueUpdate}
        setShowPanelDueNotes={setShowPanelDueNotes}
        showPanelDueNotes={showPanelDueNotes}
      />
    );
  };

  switch (tab) {
    case 'connection':
      return (
        <ConnectionSection
          boardType={boardType}
          canConnect={canConnect}
          config={config}
          connected={connected}
          connecting={connecting}
          error={error}
          handleConnect={handleConnect}
          handleDisconnect={handleDisconnect}
          handleTest={handleTest}
          hostname={hostname}
          mode={mode}
          password={password}
          prefs={prefs}
          patchPrefs={patchPrefs}
          setBoardType={setBoardType}
          setConfig={setConfigPatch}
          setHostname={setHostname}
          setMode={setMode}
          setPassword={setPassword}
          testResult={testResult}
          testing={testing}
        />
      );
    case 'general':
      return <GeneralSection prefs={prefs} patchPrefs={patchPrefs} />;
    case 'camera':
      return <CameraSection key={activePrinterId ?? 'camera'} hostname={hostname} prefs={prefs} patchPrefs={patchPrefs} />;
    case 'behaviour':
      return <BehaviourSection prefs={prefs} patchPrefs={patchPrefs} />;
    case 'notifications':
      return <NotificationsSection activePrinterId={activePrinterId} prefs={prefs} patchPrefs={patchPrefs} />;
    case 'machine':
      return <MachineSection axes={axes} board={board} boardType={boardType} connected={connected} prefs={prefs} patchPrefs={patchPrefs} />;
    case 'filaments':
      return <FilamentsSection prefs={prefs} patchPrefs={patchPrefs} />;
    case 'printer-model':
      return (
        <>
          <div className="duet-settings__page-title">Printer Model</div>
          <DuetObjectModelBrowser />
        </>
      );
    case 'firmware':
      return renderFirmware();
    case 'paneldue':
      return renderPanelDue();
    case 'backup':
      return (
        <BackupSection
          downloadSettings={downloadSettings}
          handleImport={handleImport}
          importInputRef={importInputRef}
          importResult={importResult}
          importing={importing}
        />
      );
    case 'about':
      return <AboutSection board={board} />;
    default:
      return null;
  }
}
