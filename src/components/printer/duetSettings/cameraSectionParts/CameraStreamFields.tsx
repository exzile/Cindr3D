import { Info } from "lucide-react";
import type { DuetPrefs } from "../../../../utils/duetPrefs";
import { SettingRow } from "../common";
import type { SetSaved, SetTestState } from "./types";

interface CameraStreamFieldsProps {
  draftMainStreamProtocol: DuetPrefs["webcamMainStreamProtocol"];
  draftMainStreamUrl: string;
  draftRtspTransport: DuetPrefs["webcamRtspTransport"];
  draftStreamPreference: DuetPrefs["webcamStreamPreference"];
  draftStreamUrl: string;
  setDraftMainStreamProtocol: (
    value: DuetPrefs["webcamMainStreamProtocol"],
  ) => void;
  setDraftMainStreamUrl: (value: string) => void;
  setDraftRtspTransport: (value: DuetPrefs["webcamRtspTransport"]) => void;
  setDraftStreamPreference: (
    value: DuetPrefs["webcamStreamPreference"],
  ) => void;
  setDraftStreamUrl: (value: string) => void;
  setSaved: SetSaved;
  setTestState: SetTestState;
}

export function CameraStreamFields({
  draftMainStreamProtocol,
  draftMainStreamUrl,
  draftRtspTransport,
  draftStreamPreference,
  draftStreamUrl,
  setDraftMainStreamProtocol,
  setDraftMainStreamUrl,
  setDraftRtspTransport,
  setDraftStreamPreference,
  setDraftStreamUrl,
  setSaved,
  setTestState,
}: CameraStreamFieldsProps) {
  return (
    <>
      <SettingRow
        label="Preferred Stream"
        hint="Use the MJPEG sub stream for dashboard previews. Select main stream when you also configure an H.264 viewer/bridge."
        control={
          <select
            className="duet-settings__select"
            value={draftStreamPreference}
            onChange={(event) => {
              setDraftStreamPreference(
                event.target.value as DuetPrefs["webcamStreamPreference"],
              );
              setSaved(false);
            }}
          >
            <option value="sub">Sub stream - MJPEG preview</option>
            <option value="main">Main stream - H.264 high quality</option>
          </select>
        }
      />

      <SettingRow
        label="Sub Stream URL"
        hint="The exact MJPEG/snapshot stream. Leave blank and Test Connection will fill this when it finds a working path."
        control={
          <input
            className="duet-settings__input"
            type="text"
            value={draftStreamUrl}
            onChange={(event) => {
              setDraftStreamUrl(event.target.value);
              setSaved(false);
              setTestState({ status: "idle" });
            }}
            placeholder="e.g. http://192.168.1.55/cgi-bin/mjpg/video.cgi?channel=1&subtype=1"
          />
        }
      />

      <SettingRow
        label="Main Stream Protocol"
        hint="Use RTSP for camera main streams, or HLS/HTTP when a camera or bridge provides browser-compatible video."
        control={
          <select
            className="duet-settings__select"
            value={draftMainStreamProtocol}
            onChange={(event) => {
              setDraftMainStreamProtocol(
                event.target.value as DuetPrefs["webcamMainStreamProtocol"],
              );
              setSaved(false);
            }}
          >
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
          <input
            className="duet-settings__input"
            type="text"
            value={draftMainStreamUrl}
            onChange={(event) => {
              setDraftMainStreamUrl(event.target.value);
              setSaved(false);
            }}
            placeholder="e.g. rtsp://192.168.1.55:554/cam/realmonitor?channel=1&subtype=0"
          />
        }
      />

      {draftMainStreamProtocol === "rtsp" && (
        <SettingRow
          label="RTSP Transport"
          hint="TCP is usually more reliable on Wi-Fi. UDP can be lower latency on stable wired networks."
          control={
            <select
              className="duet-settings__select"
              value={draftRtspTransport}
              onChange={(event) => {
                setDraftRtspTransport(
                  event.target.value as DuetPrefs["webcamRtspTransport"],
                );
                setSaved(false);
              }}
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          }
        />
      )}

      {draftStreamPreference === "main" &&
        draftMainStreamProtocol === "rtsp" && (
          <div className="duet-settings__banner duet-settings__banner--info">
            <Info size={16} /> Browsers cannot play RTSP/H.264 directly. The
            MJPEG sub stream remains the dashboard preview until an RTSP bridge
            is configured.
          </div>
        )}
    </>
  );
}
