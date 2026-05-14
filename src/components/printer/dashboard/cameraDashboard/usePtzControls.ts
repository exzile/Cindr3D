/**
 * usePtzControls — PTZ helpers for the camera dashboard:
 *   • runPtzCommand(direction)       — start/stop pan/tilt/zoom move
 *   • runPtzPreset(preset, quiet?)    — jump to a saved preset
 *   • savePtzPreset()                 — capture current slot/token as a preset
 *   • deletePtzPreset(id)             — remove a preset
 *
 * Also wires the "on print start, snap to the configured start preset" effect.
 *
 * The host owns the active camera + its setter (via `updateActiveCamera`); the
 * hook just composes the PTZ command requests and routes status messages back
 * through `setMessage`.
 */
import { useCallback, useEffect, useRef } from 'react';
import { buildPtzMoveRequest, buildPtzPresetRequest, type PtzDirection } from '../../../../services/camera/ptzControl';
import { sendCameraCommand } from './cameraUrls';
import type { CameraPtzPreset } from '../../../../utils/duetPrefs';

type ActiveCameraLike = {
  ptzPresets: CameraPtzPreset[];
  ptzStartPresetId?: string;
} & Record<string, unknown>;

export interface UsePtzControlsDeps {
  activeCamera: ActiveCameraLike | null | undefined;
  hostname: string;
  canUsePtz: boolean;
  ptzEnabled: boolean;
  ptzSpeed: number;
  isPrintActive: boolean;
  printStatus: string | undefined;
  activePtzStartPreset: CameraPtzPreset | undefined;
  setMessage: (msg: string) => void;
  updateActiveCamera: (patch: Partial<ActiveCameraLike>) => void;
}

export function usePtzControls(deps: UsePtzControlsDeps) {
  const {
    activeCamera, hostname, canUsePtz, ptzEnabled, ptzSpeed,
    isPrintActive, printStatus,
    activePtzStartPreset, setMessage, updateActiveCamera,
  } = deps;

  const runPtzCommand = useCallback((direction: PtzDirection) => {
    if (!ptzEnabled) {
      setMessage('Enable PTZ controls before moving the camera.');
      return;
    }
    if (!activeCamera || !canUsePtz) {
      setMessage('Enable PTZ for this camera in Camera Settings before moving it.');
      return;
    }

    const request = buildPtzMoveRequest(activeCamera, hostname, direction, ptzSpeed);
    if (!request?.startUrl) {
      setMessage('Configure this camera PTZ provider or command template before using PTZ controls.');
      return;
    }

    void sendCameraCommand(request.startUrl, request.username, request.password, 250);
    if (request.stopUrl) {
      window.setTimeout(() => {
        void sendCameraCommand(request.stopUrl ?? '', request.username, request.password, 250);
      }, 260);
    }
    setMessage(`Sent PTZ ${direction.replace(/([A-Z])/g, ' $1').toLowerCase()} command.`);
  }, [activeCamera, canUsePtz, hostname, ptzEnabled, ptzSpeed, setMessage]);

  const runPtzPreset = useCallback(async (preset: CameraPtzPreset, quiet = false) => {
    if (!activeCamera) return;
    const request = buildPtzPresetRequest(activeCamera, hostname, preset);
    if (!request?.startUrl) {
      if (!quiet) setMessage('Configure this camera preset command before jumping to a preset.');
      return;
    }
    try {
      await sendCameraCommand(request.startUrl, request.username, request.password);
      if (!quiet) setMessage(`Moved camera to PTZ preset "${preset.name}".`);
    } catch {
      if (!quiet) setMessage('Unable to send PTZ preset command.');
    }
  }, [activeCamera, hostname, setMessage]);

  const savePtzPreset = useCallback((rawName: string, rawToken: string) => {
    if (!activeCamera) return;
    const token = rawToken.trim();
    if (!token) {
      setMessage('Enter the camera preset slot/token to save.');
      return;
    }
    const name = rawName.trim() || `PTZ ${token}`;
    const preset: CameraPtzPreset = {
      id: `ptz-${Date.now()}`,
      name,
      token,
      createdAt: Date.now(),
    };
    updateActiveCamera({
      ptzPresets: [preset, ...activeCamera.ptzPresets.filter((item) => item.token !== token && item.name.toLowerCase() !== name.toLowerCase())].slice(0, 12),
    });
    setMessage(`Saved PTZ preset "${name}".`);
  }, [activeCamera, setMessage, updateActiveCamera]);

  const deletePtzPreset = useCallback((presetId: string) => {
    if (!activeCamera) return;
    updateActiveCamera({
      ptzPresets: activeCamera.ptzPresets.filter((preset) => preset.id !== presetId),
      ptzStartPresetId: activeCamera.ptzStartPresetId === presetId ? '' : activeCamera.ptzStartPresetId,
    });
  }, [activeCamera, updateActiveCamera]);

  // Auto-jump to the start preset when a print transitions from idle → active.
  const previousPtzPrintStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = previousPtzPrintStatusRef.current;
    previousPtzPrintStatusRef.current = printStatus;
    const becameActive = !previous || (previous !== 'processing' && previous !== 'simulating');
    if (isPrintActive && becameActive && activePtzStartPreset) {
      void runPtzPreset(activePtzStartPreset, true);
    }
  }, [activePtzStartPreset, isPrintActive, printStatus, runPtzPreset]);

  return { runPtzCommand, runPtzPreset, savePtzPreset, deletePtzPreset };
}
