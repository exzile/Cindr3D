/**
 * useCameraPresets — saves/applies/deletes user-defined CameraPreset bundles
 * (grid, crosshair, flip, rotation, timelapse). The preset list itself lives
 * in host state (it's persisted to printer prefs alongside the rest of the
 * dashboard config); this hook is just the three callbacks.
 */
import { useCallback } from 'react';
import type { CameraPreset } from './types';

export interface UseCameraPresetsDeps {
  cameraPresets: CameraPreset[];
  setCameraPresets: (updater: (presets: CameraPreset[]) => CameraPreset[]) => void;
  setMessage: (msg: string) => void;
  showGrid: boolean;
  showCrosshair: boolean;
  flipImage: boolean;
  rotation: number;
  timelapseIntervalSec: number;
  timelapseFps: number;
  setShowGrid: (v: boolean) => void;
  setShowCrosshair: (v: boolean) => void;
  setFlipImage: (v: boolean) => void;
  setRotation: (v: number) => void;
  setTimelapseIntervalSec: (v: number) => void;
  setTimelapseFps: (v: number) => void;
}

export function useCameraPresets(deps: UseCameraPresetsDeps) {
  const {
    cameraPresets, setCameraPresets, setMessage,
    showGrid, showCrosshair, flipImage, rotation, timelapseIntervalSec, timelapseFps,
    setShowGrid, setShowCrosshair, setFlipImage, setRotation, setTimelapseIntervalSec, setTimelapseFps,
  } = deps;

  const saveCameraPreset = useCallback((rawName: string) => {
    const name = rawName.trim() || `Preset ${cameraPresets.length + 1}`;
    const preset: CameraPreset = {
      id: `${Date.now()}`,
      name,
      showGrid,
      showCrosshair,
      flipImage,
      rotation,
      timelapseIntervalSec,
      timelapseFps,
    };
    setCameraPresets((presets) => [preset, ...presets.filter((item) => item.name.toLowerCase() !== name.toLowerCase())].slice(0, 8));
    setMessage(`Saved camera preset "${name}".`);
  }, [cameraPresets.length, flipImage, rotation, setCameraPresets, setMessage, showCrosshair, showGrid, timelapseFps, timelapseIntervalSec]);

  const applyCameraPreset = useCallback((preset: CameraPreset) => {
    setShowGrid(preset.showGrid);
    setShowCrosshair(preset.showCrosshair);
    setFlipImage(preset.flipImage);
    setRotation(preset.rotation);
    setTimelapseIntervalSec(preset.timelapseIntervalSec);
    setTimelapseFps(preset.timelapseFps);
    setMessage(`Applied camera preset "${preset.name}".`);
  }, [setFlipImage, setMessage, setRotation, setShowCrosshair, setShowGrid, setTimelapseFps, setTimelapseIntervalSec]);

  const deleteCameraPreset = useCallback((presetId: string) => {
    setCameraPresets((presets) => presets.filter((preset) => preset.id !== presetId));
  }, [setCameraPresets]);

  return { saveCameraPreset, applyCameraPreset, deleteCameraPreset };
}
