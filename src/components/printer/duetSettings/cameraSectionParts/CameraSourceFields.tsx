import { Camera } from "lucide-react";
import type {
  CameraPathPreset,
  CameraPtzProvider,
  CameraSourceType,
} from "../../../../utils/duetPrefs";
import { SettingRow, ToggleRow } from "../common";
import type { SetSaved, SetTestState } from "./types";

interface CameraSourceFieldsProps {
  draftAddress: string;
  draftCameraId: string;
  draftPathPreset: CameraPathPreset;
  draftPtzEnabled: boolean;
  draftPtzProvider: CameraPtzProvider;
  draftServerUsbDevice: string;
  draftSourceType: CameraSourceType;
  draftUsbDeviceId: string;
  loadBrowserUsbDevices: () => void;
  fillAmcrestDefaults: () => void;
  setDraftAddress: (value: string) => void;
  setDraftPathPreset: (value: CameraPathPreset) => void;
  setDraftPtzEnabled: (value: boolean) => void;
  setDraftPtzProvider: (value: CameraPtzProvider) => void;
  setDraftServerUsbDevice: (value: string) => void;
  setDraftSourceType: (value: CameraSourceType) => void;
  setDraftUsbDeviceId: (value: string) => void;
  setDraftUsbDeviceLabel: (value: string) => void;
  setSaved: SetSaved;
  setTestState: SetTestState;
  videoDevices: MediaDeviceInfo[];
}

export function CameraSourceFields({
  draftAddress,
  draftCameraId,
  draftPathPreset,
  draftPtzEnabled,
  draftPtzProvider,
  draftServerUsbDevice,
  draftSourceType,
  draftUsbDeviceId,
  loadBrowserUsbDevices,
  fillAmcrestDefaults,
  setDraftAddress,
  setDraftPathPreset,
  setDraftPtzEnabled,
  setDraftPtzProvider,
  setDraftServerUsbDevice,
  setDraftSourceType,
  setDraftUsbDeviceId,
  setDraftUsbDeviceLabel,
  setSaved,
  setTestState,
  videoDevices,
}: CameraSourceFieldsProps) {
  return (
    <>
      <SettingRow
        label="Camera Source"
        hint="Network cameras use URLs. Browser USB uses a camera attached to the computer viewing the app. Server USB uses a camera attached to the Orange Pi/server."
        control={
          <select
            className="duet-settings__select"
            value={draftSourceType}
            onChange={(event) => {
              setDraftSourceType(event.target.value as CameraSourceType);
              setSaved(false);
              setTestState({ status: "idle" });
            }}
          >
            <option value="network">Network camera</option>
            <option value="browser-usb">Browser USB camera</option>
            <option value="server-usb">Server USB camera</option>
          </select>
        }
      />

      {draftSourceType === "browser-usb" && (
        <>
          <SettingRow
            label="Browser USB Camera"
            hint="This uses the USB camera available to the browser. The browser may ask for camera permission."
            control={
              <select
                className="duet-settings__select"
                value={draftUsbDeviceId}
                onChange={(event) => {
                  const device = videoDevices.find(
                    (item) => item.deviceId === event.target.value,
                  );
                  setDraftUsbDeviceId(event.target.value);
                  setDraftUsbDeviceLabel(device?.label ?? "");
                  setSaved(false);
                }}
              >
                <option value="">Default browser camera</option>
                {videoDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `USB camera ${index + 1}`}
                  </option>
                ))}
              </select>
            }
          />
          <div className="duet-settings__btn-row">
            <button
              className="duet-settings__btn duet-settings__btn--secondary"
              onClick={loadBrowserUsbDevices}
            >
              <Camera size={14} /> Find Browser Cameras
            </button>
          </div>
        </>
      )}

      {draftSourceType === "server-usb" && (
        <SettingRow
          label="Server USB Device"
          hint="For Orange Pi/Linux use paths like /dev/video0. On Windows dev, use a DirectShow camera name such as Integrated Camera."
          control={
            <input
              className="duet-settings__input"
              type="text"
              value={draftServerUsbDevice}
              onChange={(event) => {
                setDraftServerUsbDevice(event.target.value);
                setSaved(false);
              }}
              placeholder="/dev/video0"
            />
          }
        />
      )}

      <SettingRow
        label="Camera Address / IP"
        hint="Enter the camera IP, hostname, or base URL. Generic cameras use the URLs you enter; presets can fill vendor-specific paths."
        control={
          <input
            className="duet-settings__input"
            type="text"
            value={draftAddress}
            onChange={(event) => {
              setDraftAddress(event.target.value);
              setSaved(false);
              setTestState({ status: "idle" });
            }}
            placeholder="e.g. 192.168.1.55"
          />
        }
      />

      <div className="duet-settings__btn-row">
        <button
          className="duet-settings__btn duet-settings__btn--secondary"
          onClick={fillAmcrestDefaults}
        >
          <Camera size={14} /> Fill Amcrest Defaults
        </button>
      </div>

      <SettingRow
        label="Camera Path Preset"
        hint="Generic keeps the app camera-brand neutral. Pick Amcrest only when you want its default stream paths and PTZ endpoint."
        control={
          <select
            className="duet-settings__select"
            value={draftPathPreset}
            onChange={(event) => {
              const nextPreset = event.target.value as CameraPathPreset;
              setDraftPathPreset(nextPreset);
              if (draftPtzEnabled)
                setDraftPtzProvider(
                  nextPreset === "generic" ? "generic-http" : nextPreset,
                );
              setSaved(false);
              setTestState({ status: "idle" });
            }}
          >
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
        onChange={(value) => {
          setDraftPtzEnabled(value);
          setSaved(false);
          if (value && draftPtzProvider === "off")
            setDraftPtzProvider(
              draftPathPreset === "generic" ? "generic-http" : draftPathPreset,
            );
        }}
        label="Enable PTZ for this camera"
        hint="Camera page controls use this provider and optional URL templates for pan, tilt, zoom, and preset jumps."
      />
    </>
  );
}
