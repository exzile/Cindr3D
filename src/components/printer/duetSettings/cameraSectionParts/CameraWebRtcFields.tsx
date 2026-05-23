import { SettingRow, ToggleRow } from "../common";
import type { SetSaved } from "./types";

interface CameraWebRtcFieldsProps {
  draftCameraId: string;
  draftWebRtcEnabled: boolean;
  draftWebRtcIceServers: string;
  draftWebRtcUrl: string;
  setDraftWebRtcEnabled: (value: boolean) => void;
  setDraftWebRtcIceServers: (value: string) => void;
  setDraftWebRtcUrl: (value: string) => void;
  setSaved: SetSaved;
}

export function CameraWebRtcFields({
  draftCameraId,
  draftWebRtcEnabled,
  draftWebRtcIceServers,
  draftWebRtcUrl,
  setDraftWebRtcEnabled,
  setDraftWebRtcIceServers,
  setDraftWebRtcUrl,
  setSaved,
}: CameraWebRtcFieldsProps) {
  return (
    <>
      <ToggleRow
        id={`camera-webrtc-${draftCameraId}`}
        checked={draftWebRtcEnabled}
        onChange={(value) => {
          setDraftWebRtcEnabled(value);
          setSaved(false);
        }}
        label="Use WebRTC when available"
        hint="The Camera page tries this low-latency WHEP/WebRTC endpoint first, then falls back to MJPEG or HLS if it cannot connect."
      />

      {draftWebRtcEnabled && (
        <>
          <SettingRow
            label="WebRTC / WHEP URL"
            hint="Use a self-hosted camera bridge URL such as go2rtc, MediaMTX, or another WHEP-compatible endpoint."
            control={
              <input
                className="duet-settings__input"
                type="text"
                value={draftWebRtcUrl}
                onChange={(event) => {
                  setDraftWebRtcUrl(event.target.value);
                  setSaved(false);
                }}
                placeholder="https://camera-bridge.local/api/whep?src=printer"
              />
            }
          />
          <SettingRow
            label="ICE / TURN Servers"
            hint="Optional. Enter one STUN/TURN URL per line, or a JSON RTCIceServer array when remote-network access needs TURN credentials."
            control={
              <textarea
                className="duet-settings__input"
                value={draftWebRtcIceServers}
                onChange={(event) => {
                  setDraftWebRtcIceServers(event.target.value);
                  setSaved(false);
                }}
                placeholder="stun:stun.l.google.com:19302"
                rows={3}
              />
            }
          />
        </>
      )}
    </>
  );
}
