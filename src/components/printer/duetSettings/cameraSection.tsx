import { useMemo, useState } from 'react';
import { AlertCircle, Camera, CheckCircle, Info, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import type {
  CameraPathPreset,
  CameraPtzProvider,
  CameraSourceType,
  CameraStreamConfig,
  CameraStreamRole,
  DuetPrefs,
} from '../../../utils/duetPrefs';
import { cameraToLegacyPrefs, legacyCameraFromPrefs } from '../../../utils/duetPrefs';
import { cameraDisplayUrl } from '../../../utils/cameraStreamUrl';
import { SettingRow, ToggleRow } from './common';
import {
  amcrestMainStreamUrl,
  amcrestSubStreamUrl,
  cameraAddressFromStreamUrl,
  cameraBaseUrl,
  cameraStreamCandidates,
  cameraTestDisplayUrl,
  probeCameraStreamUrl,
  withCacheBuster,
  type CameraTestState,
} from './cameraSectionHelpers';

// ── CameraSection ─────────────────────────────────────────────────────────────

export function CameraSection({
  hostname,
  patchPrefs,
  prefs,
}: {
  hostname: string;
  patchPrefs: (patch: Partial<DuetPrefs>) => void;
  prefs: DuetPrefs;
}) {
  const cameras = prefs.cameras.length > 0 ? prefs.cameras : [legacyCameraFromPrefs(prefs)];
  const activeCamera = cameras.find((c) => c.id === prefs.activeCameraId) ?? cameras[0];
  const savedCameraAddress = activeCamera.host || cameraAddressFromStreamUrl(activeCamera.url);

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [draftCameraId, setDraftCameraId] = useState(activeCamera.id);
  const [draftLabel, setDraftLabel] = useState(activeCamera.label);
  const [draftRole, setDraftRole] = useState<CameraStreamRole>(activeCamera.role);
  const [draftEnabled, setDraftEnabled] = useState(activeCamera.enabled);
  const [draftResolution, setDraftResolution] = useState(activeCamera.resolution);
  const [draftAddress, setDraftAddress] = useState(savedCameraAddress);
  const [draftSourceType, setDraftSourceType] = useState<CameraSourceType>(activeCamera.sourceType);
  const [draftStreamUrl, setDraftStreamUrl] = useState(activeCamera.url);
  const [draftMainStreamUrl, setDraftMainStreamUrl] = useState(activeCamera.mainStreamUrl);
  const [draftUsbDeviceId, setDraftUsbDeviceId] = useState(activeCamera.usbDeviceId);
  const [draftUsbDeviceLabel, setDraftUsbDeviceLabel] = useState(activeCamera.usbDeviceLabel);
  const [draftServerUsbDevice, setDraftServerUsbDevice] = useState(activeCamera.serverUsbDevice);
  const [draftStreamPreference, setDraftStreamPreference] = useState(activeCamera.streamPreference);
  const [draftMainStreamProtocol, setDraftMainStreamProtocol] = useState(activeCamera.mainStreamProtocol);
  const [draftRtspTransport, setDraftRtspTransport] = useState(activeCamera.rtspTransport);
  const [draftPathPreset, setDraftPathPreset] = useState<CameraPathPreset>(activeCamera.pathPreset);
  const [draftUsername, setDraftUsername] = useState(activeCamera.username);
  const [draftPassword, setDraftPassword] = useState(activeCamera.password);
  const [draftPtzEnabled, setDraftPtzEnabled] = useState(activeCamera.ptzEnabled);
  const [draftPtzProvider, setDraftPtzProvider] = useState<CameraPtzProvider>(activeCamera.ptzProvider);
  const [draftPtzMoveUrlTemplate, setDraftPtzMoveUrlTemplate] = useState(activeCamera.ptzMoveUrlTemplate);
  const [draftPtzPresetUrlTemplate, setDraftPtzPresetUrlTemplate] = useState(activeCamera.ptzPresetUrlTemplate);
  const [draftWebRtcEnabled, setDraftWebRtcEnabled] = useState(activeCamera.webRtcEnabled);
  const [draftWebRtcUrl, setDraftWebRtcUrl] = useState(activeCamera.webRtcUrl);
  const [draftWebRtcIceServers, setDraftWebRtcIceServers] = useState(activeCamera.webRtcIceServers);
  const [testState, setTestState] = useState<CameraTestState>({ status: 'idle' });
  const [saved, setSaved] = useState(false);

  const resolvedUrl = useMemo(() => normalizeCameraStreamUrl(draftStreamUrl), [draftStreamUrl]);
  const authenticatedUrl = useMemo(
    () => cameraDisplayUrl(resolvedUrl, draftUsername, draftPassword),
    [draftPassword, draftUsername, resolvedUrl],
  );

  const hasUnsavedChanges =
    draftCameraId !== prefs.activeCameraId ||
    draftLabel !== activeCamera.label ||
    draftRole !== activeCamera.role ||
    draftEnabled !== activeCamera.enabled ||
    draftResolution !== activeCamera.resolution ||
    draftSourceType !== (prefs.webcamSourceType ?? 'network') ||
    draftAddress !== savedCameraAddress ||
    draftStreamUrl !== prefs.webcamUrl ||
    draftMainStreamUrl !== prefs.webcamMainStreamUrl ||
    draftUsbDeviceId !== (prefs.webcamUsbDeviceId ?? '') ||
    draftUsbDeviceLabel !== (prefs.webcamUsbDeviceLabel ?? '') ||
    draftServerUsbDevice !== (prefs.webcamServerUsbDevice ?? '') ||
    draftStreamPreference !== prefs.webcamStreamPreference ||
    draftMainStreamProtocol !== prefs.webcamMainStreamProtocol ||
    draftRtspTransport !== prefs.webcamRtspTransport ||
    draftPathPreset !== (prefs.webcamPathPreset ?? 'generic') ||
    draftUsername !== prefs.webcamUsername ||
    draftPassword !== prefs.webcamPassword ||
    draftPtzEnabled !== activeCamera.ptzEnabled ||
    draftPtzProvider !== activeCamera.ptzProvider ||
    draftPtzMoveUrlTemplate !== activeCamera.ptzMoveUrlTemplate ||
    draftPtzPresetUrlTemplate !== activeCamera.ptzPresetUrlTemplate ||
    draftWebRtcEnabled !== activeCamera.webRtcEnabled ||
    draftWebRtcUrl !== activeCamera.webRtcUrl ||
    draftWebRtcIceServers !== activeCamera.webRtcIceServers;

  const cameraFromDraft = (id = draftCameraId): CameraStreamConfig => ({
    id,
    label: draftLabel.trim() || 'Camera',
    role: draftRole,
    enabled: draftEnabled,
    resolution: draftResolution.trim() || '1080p',
    sourceType: draftSourceType,
    host: draftAddress.trim(),
    url: draftStreamUrl.trim() ? resolvedUrl : '',
    mainStreamUrl: draftMainStreamUrl.trim(),
    usbDeviceId: draftUsbDeviceId,
    usbDeviceLabel: draftUsbDeviceLabel,
    serverUsbDevice: draftServerUsbDevice.trim(),
    streamPreference: draftStreamPreference,
    mainStreamProtocol: draftMainStreamProtocol,
    rtspTransport: draftRtspTransport,
    pathPreset: draftPathPreset,
    username: draftUsername.trim(),
    password: draftPassword,
    ptzEnabled: draftPtzEnabled,
    ptzProvider: draftPtzProvider,
    ptzMoveUrlTemplate: draftPtzMoveUrlTemplate.trim(),
    ptzPresetUrlTemplate: draftPtzPresetUrlTemplate.trim(),
    ptzPresets: activeCamera.ptzPresets,
    ptzStartPresetId: activeCamera.ptzStartPresetId,
    webRtcEnabled: draftWebRtcEnabled,
    webRtcUrl: draftWebRtcUrl.trim(),
    webRtcIceServers: draftWebRtcIceServers.trim(),
  });

  const loadCameraDraft = (camera: CameraStreamConfig) => {
    setDraftCameraId(camera.id);
    setDraftLabel(camera.label);
    setDraftRole(camera.role);
    setDraftEnabled(camera.enabled);
    setDraftResolution(camera.resolution);
    setDraftAddress(camera.host || cameraAddressFromStreamUrl(camera.url));
    setDraftSourceType(camera.sourceType);
    setDraftStreamUrl(camera.url);
    setDraftMainStreamUrl(camera.mainStreamUrl);
    setDraftUsbDeviceId(camera.usbDeviceId);
    setDraftUsbDeviceLabel(camera.usbDeviceLabel);
    setDraftServerUsbDevice(camera.serverUsbDevice);
    setDraftStreamPreference(camera.streamPreference);
    setDraftMainStreamProtocol(camera.mainStreamProtocol);
    setDraftRtspTransport(camera.rtspTransport);
    setDraftPathPreset(camera.pathPreset);
    setDraftUsername(camera.username);
    setDraftPassword(camera.password);
    setDraftPtzEnabled(camera.ptzEnabled);
    setDraftPtzProvider(camera.ptzProvider);
    setDraftPtzMoveUrlTemplate(camera.ptzMoveUrlTemplate);
    setDraftPtzPresetUrlTemplate(camera.ptzPresetUrlTemplate);
    setDraftWebRtcEnabled(camera.webRtcEnabled);
    setDraftWebRtcUrl(camera.webRtcUrl);
    setDraftWebRtcIceServers(camera.webRtcIceServers);
    setSaved(false);
    setTestState({ status: 'idle' });
  };

  const selectCamera = (cameraId: string) => {
    const nextCamera = cameras.find((c) => c.id === cameraId);
    if (!nextCamera) return;
    loadCameraDraft(nextCamera);
    patchPrefs({ activeCameraId: nextCamera.id, ...cameraToLegacyPrefs(nextCamera) });
  };

  const addCamera = () => {
    const nextCamera = {
      ...legacyCameraFromPrefs({}, `camera-${Date.now()}`),
      label: `Camera ${cameras.length + 1}`,
      role: 'custom' as CameraStreamRole,
    };
    patchPrefs({
      cameras: [...cameras.map((c) => (c.id === draftCameraId ? cameraFromDraft(c.id) : c)), nextCamera],
      activeCameraId: nextCamera.id,
      ...cameraToLegacyPrefs(nextCamera),
    });
    loadCameraDraft(nextCamera);
  };

  const removeCamera = () => {
    if (cameras.length <= 1) return;
    const remaining = cameras.filter((c) => c.id !== draftCameraId);
    const nextCamera = remaining[0];
    patchPrefs({
      cameras: remaining,
      activeCameraId: nextCamera.id,
      dashboardCameraId: prefs.dashboardCameraId === draftCameraId ? nextCamera.id : prefs.dashboardCameraId,
      ...cameraToLegacyPrefs(nextCamera),
    });
    loadCameraDraft(nextCamera);
  };

  const fillAmcrestDefaults = () => {
    const subUrl = amcrestSubStreamUrl(draftAddress, hostname);
    const mainUrl = amcrestMainStreamUrl(draftAddress, hostname);
    if (subUrl) setDraftStreamUrl(subUrl);
    if (mainUrl) setDraftMainStreamUrl(mainUrl);
    setDraftMainStreamProtocol('rtsp');
    setDraftRtspTransport('tcp');
    setDraftPathPreset('amcrest');
    setDraftPtzEnabled(true);
    setDraftPtzProvider('amcrest');
    setSaved(false);
    setTestState({ status: 'idle' });
  };

  const loadBrowserUsbDevices = () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setTestState({ status: 'error', url: '', message: 'This browser cannot list USB cameras.' });
      return;
    }
    void navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        return navigator.mediaDevices.enumerateDevices();
      })
      .then((devices) => {
        const cams = devices.filter((d) => d.kind === 'videoinput');
        setVideoDevices(cams);
        if (!draftUsbDeviceId && cams[0]) {
          setDraftUsbDeviceId(cams[0].deviceId);
          setDraftUsbDeviceLabel(cams[0].label);
          setSaved(false);
        }
        setTestState(cams.length
          ? { status: 'idle' }
          : { status: 'error', url: '', message: 'No USB cameras were found by this browser.' });
      })
      .catch(() => {
        setTestState({ status: 'error', url: '', message: 'Browser camera permission is required to list USB cameras.' });
      });
  };

  const handleTestCamera = () => {
    const candidateUrls = cameraStreamCandidates(draftAddress, draftStreamUrl, hostname, draftPathPreset);
    if (candidateUrls.length === 0) {
      setTestState({ status: 'error', url: '', message: 'Enter a camera IP/address or a stream URL.' });
      return;
    }
    setTestState({ status: 'testing' });

    const attempts = candidateUrls.flatMap((sourceUrl) => {
      const displayUrl = cameraDisplayUrl(sourceUrl, draftUsername, draftPassword);
      const prefersProxy = displayUrl !== sourceUrl;
      return prefersProxy
        ? [
          { sourceUrl, testUrl: displayUrl },
          { sourceUrl, testUrl: withCacheBuster(displayUrl) },
          { sourceUrl, testUrl: sourceUrl },
          { sourceUrl, testUrl: withCacheBuster(sourceUrl) },
        ]
        : [
          { sourceUrl, testUrl: sourceUrl },
          { sourceUrl, testUrl: withCacheBuster(sourceUrl) },
        ];
    }).filter((attempt, index, all) => (
      attempt.testUrl && all.findIndex((item) => item.testUrl === attempt.testUrl) === index
    ));

    if (attempts.length === 0) {
      setTestState({ status: 'error', url: '', message: 'Enter a camera IP/address or a stream URL.' });
      return;
    }

    let index = 0;
    let lastError = 'The camera URL did not return a loadable image or MJPEG stream.';

    const tryCandidate = async () => {
      const candidate = attempts[index];
      try {
        await probeCameraStreamUrl(candidate.testUrl);
        setDraftStreamUrl(candidate.sourceUrl);
        setSaved(false);
        setTestState({ status: 'success', url: candidate.testUrl });
      } catch (error) {
        lastError = error instanceof Error && error.name === 'AbortError'
          ? 'Camera did not respond before the test timed out.'
          : 'The camera URL did not return a loadable image or MJPEG stream.';
        index += 1;
        if (index < attempts.length) { void tryCandidate(); return; }
        setTestState({ status: 'error', url: candidateUrls[0], message: lastError });
      }
    };

    void tryCandidate();
  };

  const handleSaveCamera = () => {
    const savedCamera = cameraFromDraft();
    setDraftStreamUrl(savedCamera.url);
    const nextCameras = cameras.map((c) => (c.id === savedCamera.id ? savedCamera : c));
    patchPrefs({
      ...cameraToLegacyPrefs(savedCamera),
      cameras: nextCameras,
      activeCameraId: savedCamera.id,
      dashboardCameraId: prefs.dashboardCameraId || savedCamera.id,
    });
    setSaved(true);
  };

  return (
    <>
      <div className="duet-settings__page-title">Camera</div>
      <div className="duet-settings__banner duet-settings__banner--info">
        <Camera size={16} /> Configure a network camera, browser USB camera, or server USB camera for this printer.
      </div>

      <div className="duet-settings__section">
        <div className="duet-settings__section-title">Camera Streams</div>
        <div className="duet-settings__btn-row" style={{ flexWrap: 'wrap' }}>
          {cameras.map((camera) => (
            <button
              key={camera.id}
              type="button"
              className={`duet-settings__btn duet-settings__btn--secondary${camera.id === draftCameraId ? ' is-active' : ''}`}
              onClick={() => selectCamera(camera.id)}
              title={camera.enabled ? `${camera.role} camera` : 'Disabled camera'}
            >
              <Camera size={14} /> {camera.label}
            </button>
          ))}
          <button type="button" className="duet-settings__btn duet-settings__btn--secondary" onClick={addCamera}>
            <Plus size={14} /> Add Camera
          </button>
          <button
            type="button"
            className={`duet-settings__btn duet-settings__btn--danger${cameras.length <= 1 ? ' duet-settings__btn--disabled' : ''}`}
            onClick={removeCamera}
            disabled={cameras.length <= 1}
          >
            <Trash2 size={14} /> Remove
          </button>
        </div>
      </div>

      <SettingRow
        label="Camera Label"
        hint="Name shown in camera tabs and dashboard selectors."
        control={
          <input className="duet-settings__input" type="text" value={draftLabel} onChange={(e) => { setDraftLabel(e.target.value); setSaved(false); }} placeholder="Top, side, nozzle, custom" />
        }
      />

      <SettingRow
        label="Camera Role"
        hint="Use roles to organize common farm camera positions."
        control={
          <select className="duet-settings__select" value={draftRole} onChange={(e) => { setDraftRole(e.target.value as CameraStreamRole); setSaved(false); }}>
            <option value="top">Top</option>
            <option value="side">Side</option>
            <option value="nozzle">Nozzle</option>
            <option value="custom">Custom</option>
          </select>
        }
      />

      <SettingRow
        label="Resolution"
        hint="Informational resolution label used by dashboard cards."
        control={
          <select className="duet-settings__select" value={draftResolution} onChange={(e) => { setDraftResolution(e.target.value); setSaved(false); }}>
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="1440p">1440p</option>
            <option value="4K">4K</option>
          </select>
        }
      />

      <ToggleRow
        id={`camera-enabled-${draftCameraId}`}
        checked={draftEnabled}
        onChange={(value) => { setDraftEnabled(value); setSaved(false); }}
        label="Enable this camera"
        hint="Disabled cameras stay saved but are hidden from monitoring views."
      />

      <SettingRow
        label="Camera Source"
        hint="Network cameras use URLs. Browser USB uses a camera attached to the computer viewing the app. Server USB uses a camera attached to the Orange Pi/server."
        control={
          <select className="duet-settings__select" value={draftSourceType} onChange={(e) => { setDraftSourceType(e.target.value as CameraSourceType); setSaved(false); setTestState({ status: 'idle' }); }}>
            <option value="network">Network camera</option>
            <option value="browser-usb">Browser USB camera</option>
            <option value="server-usb">Server USB camera</option>
          </select>
        }
      />

      {draftSourceType === 'browser-usb' && (
        <>
          <SettingRow
            label="Browser USB Camera"
            hint="This uses the USB camera available to the browser. The browser may ask for camera permission."
            control={
              <select className="duet-settings__select" value={draftUsbDeviceId} onChange={(e) => { const device = videoDevices.find((d) => d.deviceId === e.target.value); setDraftUsbDeviceId(e.target.value); setDraftUsbDeviceLabel(device?.label ?? ''); setSaved(false); }}>
                <option value="">Default browser camera</option>
                {videoDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label || `USB camera ${index + 1}`}</option>
                ))}
              </select>
            }
          />
          <div className="duet-settings__btn-row">
            <button className="duet-settings__btn duet-settings__btn--secondary" onClick={loadBrowserUsbDevices}>
              <Camera size={14} /> Find Browser Cameras
            </button>
          </div>
        </>
      )}

      {draftSourceType === 'server-usb' && (
        <SettingRow
          label="Server USB Device"
          hint="For Orange Pi/Linux use paths like /dev/video0. On Windows dev, use a DirectShow camera name such as Integrated Camera."
          control={
            <input className="duet-settings__input" type="text" value={draftServerUsbDevice} onChange={(e) => { setDraftServerUsbDevice(e.target.value); setSaved(false); }} placeholder="/dev/video0" />
          }
        />
      )}

      <SettingRow
        label="Camera Address / IP"
        hint="Enter the camera IP, hostname, or base URL. Generic cameras use the URLs you enter; presets can fill vendor-specific paths."
        control={
          <input className="duet-settings__input" type="text" value={draftAddress} onChange={(e) => { setDraftAddress(e.target.value); setSaved(false); setTestState({ status: 'idle' }); }} placeholder="e.g. 192.168.1.55" />
        }
      />

      <div className="duet-settings__btn-row">
        <button className="duet-settings__btn duet-settings__btn--secondary" onClick={fillAmcrestDefaults}>
          <Camera size={14} /> Fill Amcrest Defaults
        </button>
      </div>

      <SettingRow
        label="Camera Path Preset"
        hint="Generic keeps the app camera-brand neutral. Pick Amcrest only when you want its default stream paths and PTZ endpoint."
        control={
          <select className="duet-settings__select" value={draftPathPreset} onChange={(e) => { const nextPreset = e.target.value as CameraPathPreset; setDraftPathPreset(nextPreset); if (draftPtzEnabled) setDraftPtzProvider(nextPreset === 'generic' ? 'generic-http' : nextPreset); setSaved(false); setTestState({ status: 'idle' }); }}>
            <option value="generic">Generic / custom URLs</option>
            <option value="amcrest">Amcrest / Dahua-compatible paths</option>
            <option value="reolink">Reolink paths</option>
            <option value="tapo">Tapo paths</option>
            <option value="hikvision">Hikvision paths</option>
            <option value="onvif">ONVIF bridge</option>
          </select>
        }
      />

      <ToggleRow
        id={`camera-ptz-${draftCameraId}`}
        checked={draftPtzEnabled}
        onChange={(value) => { setDraftPtzEnabled(value); if (value && draftPtzProvider === 'off') setDraftPtzProvider(draftPathPreset === 'generic' ? 'generic-http' : draftPathPreset); setSaved(false); }}
        label="Enable PTZ for this camera"
        hint="Camera page controls use this provider and optional URL templates for pan, tilt, zoom, and preset jumps."
      />

      {draftPtzEnabled && (
        <>
          <SettingRow
            label="PTZ Provider"
            hint="Amcrest and Reolink have built-in HTTP commands. ONVIF, Tapo, Hikvision, and generic cameras can use local bridge/template URLs."
            control={
              <select className="duet-settings__select" value={draftPtzProvider} onChange={(e) => { setDraftPtzProvider(e.target.value as CameraPtzProvider); setSaved(false); }}>
                <option value="generic-http">Generic HTTP template</option>
                <option value="amcrest">Amcrest / Dahua</option>
                <option value="reolink">Reolink</option>
                <option value="tapo">Tapo bridge/template</option>
                <option value="hikvision">Hikvision bridge/template</option>
                <option value="onvif">ONVIF bridge/template</option>
              </select>
            }
          />
          <SettingRow
            label="PTZ Move Template"
            hint="Optional URL template. Tokens: {base}, {direction}, {speed}, {action}, {username}, {password}. Leave blank for built-in Amcrest/Reolink."
            control={
              <input className="duet-settings__input" type="text" value={draftPtzMoveUrlTemplate} onChange={(e) => { setDraftPtzMoveUrlTemplate(e.target.value); setSaved(false); }} placeholder="{base}/ptz?move={direction}&speed={speed}&action={action}" />
            }
          />
          <SettingRow
            label="PTZ Preset Template"
            hint="Optional URL template for saved preset slots. Tokens: {base}, {preset}, {presetName}, {username}, {password}."
            control={
              <input className="duet-settings__input" type="text" value={draftPtzPresetUrlTemplate} onChange={(e) => { setDraftPtzPresetUrlTemplate(e.target.value); setSaved(false); }} placeholder="{base}/ptz?preset={preset}" />
            }
          />
        </>
      )}

      <SettingRow
        label="Preferred Stream"
        hint="Use the MJPEG sub stream for dashboard previews. Select main stream when you also configure an H.264 viewer/bridge."
        control={
          <select className="duet-settings__select" value={draftStreamPreference} onChange={(e) => { setDraftStreamPreference(e.target.value as DuetPrefs['webcamStreamPreference']); setSaved(false); }}>
            <option value="sub">Sub stream - MJPEG preview</option>
            <option value="main">Main stream - H.264 high quality</option>
          </select>
        }
      />

      <SettingRow
        label="Sub Stream URL"
        hint="The exact MJPEG/snapshot stream. Leave blank and Test Connection will fill this when it finds a working path."
        control={
          <input className="duet-settings__input" type="text" value={draftStreamUrl} onChange={(e) => { setDraftStreamUrl(e.target.value); setSaved(false); setTestState({ status: 'idle' }); }} placeholder="e.g. http://192.168.1.55/cgi-bin/mjpg/video.cgi?channel=1&subtype=1" />
        }
      />

      <SettingRow
        label="Main Stream Protocol"
        hint="Use RTSP for camera main streams, or HLS/HTTP when a camera or bridge provides browser-compatible video."
        control={
          <select className="duet-settings__select" value={draftMainStreamProtocol} onChange={(e) => { setDraftMainStreamProtocol(e.target.value as DuetPrefs['webcamMainStreamProtocol']); setSaved(false); }}>
            <option value="rtsp">RTSP / H.264</option>
            <option value="hls">HLS / browser video</option>
            <option value="http">HTTP stream</option>
          </select>
        }
      />

      <SettingRow
        label="Main Stream URL"
        hint="High-quality stream URL for this camera. RTSP can be bridged to HLS by the app for the Camera page."
        control={
          <input className="duet-settings__input" type="text" value={draftMainStreamUrl} onChange={(e) => { setDraftMainStreamUrl(e.target.value); setSaved(false); }} placeholder="e.g. rtsp://192.168.1.55:554/cam/realmonitor?channel=1&subtype=0" />
        }
      />

      {draftMainStreamProtocol === 'rtsp' && (
        <SettingRow
          label="RTSP Transport"
          hint="TCP is usually more reliable on Wi-Fi. UDP can be lower latency on stable wired networks."
          control={
            <select className="duet-settings__select" value={draftRtspTransport} onChange={(e) => { setDraftRtspTransport(e.target.value as DuetPrefs['webcamRtspTransport']); setSaved(false); }}>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          }
        />
      )}

      {draftStreamPreference === 'main' && draftMainStreamProtocol === 'rtsp' && (
        <div className="duet-settings__banner duet-settings__banner--info">
          <Info size={16} /> Browsers cannot play RTSP/H.264 directly. The MJPEG sub stream remains the dashboard preview until an RTSP bridge is configured.
        </div>
      )}

      <ToggleRow
        id={`camera-webrtc-${draftCameraId}`}
        checked={draftWebRtcEnabled}
        onChange={(value) => { setDraftWebRtcEnabled(value); setSaved(false); }}
        label="Use WebRTC when available"
        hint="The Camera page tries this low-latency WHEP/WebRTC endpoint first, then falls back to MJPEG or HLS if it cannot connect."
      />

      {draftWebRtcEnabled && (
        <>
          <SettingRow
            label="WebRTC / WHEP URL"
            hint="Use a self-hosted camera bridge URL such as go2rtc, MediaMTX, or another WHEP-compatible endpoint."
            control={
              <input className="duet-settings__input" type="text" value={draftWebRtcUrl} onChange={(e) => { setDraftWebRtcUrl(e.target.value); setSaved(false); }} placeholder="https://camera-bridge.local/api/whep?src=printer" />
            }
          />
          <SettingRow
            label="ICE / TURN Servers"
            hint="Optional. Enter one STUN/TURN URL per line, or a JSON RTCIceServer array when remote-network access needs TURN credentials."
            control={
              <textarea className="duet-settings__input" value={draftWebRtcIceServers} onChange={(e) => { setDraftWebRtcIceServers(e.target.value); setSaved(false); }} placeholder="stun:stun.l.google.com:19302" rows={3} />
            }
          />
        </>
      )}

      <SettingRow
        label="Camera Username"
        hint="Optional. Use this for cameras that require HTTP basic authentication."
        control={
          <input className="duet-settings__input" type="text" value={draftUsername} onChange={(e) => { setDraftUsername(e.target.value); setSaved(false); setTestState({ status: 'idle' }); }} placeholder="Camera username" autoComplete="off" />
        }
      />

      <SettingRow
        label="Camera Password"
        hint="Optional. Stored with this printer's local preferences."
        control={
          <input className="duet-settings__input" type="password" value={draftPassword} onChange={(e) => { setDraftPassword(e.target.value); setSaved(false); setTestState({ status: 'idle' }); }} placeholder="Camera password" autoComplete="new-password" />
        }
      />

      {resolvedUrl && (
        <div className="duet-settings__camera-preview" aria-label="Camera preview">
          <img src={authenticatedUrl} alt="Camera stream preview" />
        </div>
      )}

      <div className="duet-settings__btn-row">
        <button
          className={`duet-settings__btn duet-settings__btn--secondary${testState.status === 'testing' ? ' duet-settings__btn--disabled' : ''}`}
          onClick={handleTestCamera}
          disabled={testState.status === 'testing'}
        >
          {testState.status === 'testing'
            ? <><Loader2 size={14} className="spin" /> Testing...</>
            : <><Camera size={14} /> Test Connection</>
          }
        </button>
        <button
          className={`duet-settings__btn duet-settings__btn--primary${!hasUnsavedChanges ? ' duet-settings__btn--disabled' : ''}`}
          onClick={handleSaveCamera}
          disabled={!hasUnsavedChanges}
        >
          <Save size={14} /> Save Camera Settings
        </button>
      </div>

      {testState.status === 'success' && (
        <div className="duet-settings__banner duet-settings__banner--success">
          <CheckCircle size={16} />
          <div>
            <div className="duet-settings__banner-heading">Camera connected</div>
            <div className="duet-settings__banner-detail">{cameraTestDisplayUrl(testState.url)}</div>
          </div>
        </div>
      )}
      {testState.status === 'error' && (
        <div className="duet-settings__banner duet-settings__banner--error">
          <AlertCircle size={16} />
          <div>
            <div className="duet-settings__banner-heading">Camera test failed</div>
            <div className="duet-settings__banner-detail">{testState.message}</div>
          </div>
        </div>
      )}
      {saved && !hasUnsavedChanges && (
        <div className="duet-settings__banner duet-settings__banner--success">
          <CheckCircle size={16} /> Camera settings saved for this printer.
        </div>
      )}
    </>
  );
}
