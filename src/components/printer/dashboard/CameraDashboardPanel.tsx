import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { strToU8, zipSync } from 'fflate';
import {
  Archive,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  ChevronDown,
  ChevronUp,
  Copy,
  Crosshair,
  Crop,
  Download,
  Eraser,
  Flag,
  FlipHorizontal,
  FolderOpen,
  Gauge,
  Grid2X2,
  HardDrive,
  Home,
  Image,
  Maximize2,
  Play,
  RefreshCcw,
  RotateCw,
  Ruler,
  Save,
  Scissors,
  Search,
  Settings,
  Square,
  Star,
  Tags,
  Timer,
  Trash2,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import {
  DEFAULT_CAMERA_DASHBOARD_PREFS,
  DEFAULT_PREFS,
  getDuetPrefs,
  type CameraDashboardCalibration,
  type CameraDashboardPrefs,
  type CameraDashboardPreset,
  type CameraHdBridgeQuality,
  type CameraPtzPreset,
  type DuetPrefs,
} from '../../../utils/duetPrefs';
import { cameraDisplayUrl, cameraUrlWithCredentials, enabledCamerasFromPrefs, normalizeCameraStreamUrl, preferredCameraStreamUrl, prefsWithCamera } from '../../../utils/cameraStreamUrl';
import { buildPtzMoveRequest, buildPtzPresetRequest, ptzProviderLabel, type PtzDirection } from '../../../services/camera/ptzControl';
import { connectWhepVideoStream } from '../../../services/camera/webrtcStream';
import {
  distanceBetweenImagePointsMm,
  hasCompleteBedCorners,
  solveCameraHomography,
  type BedCorners,
  type ImagePoint,
} from '../../../services/vision/cameraMeasurement';
import {
  assessPoseCalibration,
  poseFrameSignature,
  solveCameraPoseCalibration,
  type CameraPoseCalibration,
} from '../../../services/vision/cameraPose';
import { formatBytes } from './helpers';
import CameraOverlayPanel, { type CameraOverlayMode } from './CameraOverlayPanel';
import './CameraDashboardPanel.css';

const CLIP_DB_NAME = 'cindr3d-camera-clips';
const CLIP_DB_VERSION = 1;
const CLIP_STORE = 'clips';
const RECORDING_FPS = 12;
const AUTO_RECORD_KEY = 'cindr3d-camera-auto-record';
const AUTO_TIMELAPSE_KEY = 'cindr3d-camera-auto-timelapse';
const TIMELAPSE_INTERVAL_KEY = 'cindr3d-camera-timelapse-interval';
const TIMELAPSE_FPS_KEY = 'cindr3d-camera-timelapse-fps';
const AUTO_SNAPSHOT_FIRST_LAYER_KEY = 'cindr3d-camera-auto-snapshot-first-layer';
const AUTO_SNAPSHOT_LAYER_KEY = 'cindr3d-camera-auto-snapshot-layer';
const AUTO_SNAPSHOT_FINISH_KEY = 'cindr3d-camera-auto-snapshot-finish';
const AUTO_SNAPSHOT_ERROR_KEY = 'cindr3d-camera-auto-snapshot-error';
const VIEW_GRID_KEY = 'cindr3d-camera-view-grid';
const VIEW_CROSSHAIR_KEY = 'cindr3d-camera-view-crosshair';
const VIEW_FLIP_KEY = 'cindr3d-camera-view-flip';
const VIEW_ROTATION_KEY = 'cindr3d-camera-view-rotation';
const HEALTH_OPEN_KEY = 'cindr3d-camera-health-open';
const CONTROL_SECTION_KEY = 'cindr3d-camera-control-section';
const EDITOR_COLLAPSED_KEY = 'cindr3d-camera-editor-collapsed';
const CAMERA_PRESETS_KEY = 'cindr3d-camera-presets';
const SCHEDULED_SNAPSHOT_KEY = 'cindr3d-camera-scheduled-snapshot';
const SCHEDULED_SNAPSHOT_INTERVAL_KEY = 'cindr3d-camera-scheduled-snapshot-interval';
const ANOMALY_CAPTURE_KEY = 'cindr3d-camera-anomaly-capture';
const CALIBRATION_OVERLAY_KEY = 'cindr3d-camera-calibration-overlay';
const BACKEND_RECORDING_KEY_PREFIX = 'cindr3d-camera-backend-recording';
const ISSUE_TAGS = ['Warping', 'Stringing', 'Layer shift', 'Blob', 'Adhesion', 'Under extrusion'] as const;
const CLIP_RATINGS = ['Unrated', 'Good', 'Needs review', 'Failure evidence'] as const;
const INSPECTION_ITEMS = ['First layer', 'Adhesion', 'Corners', 'Nozzle', 'Surface', 'Artifacts'] as const;

type CameraClipKind = 'clip' | 'timelapse' | 'snapshot' | 'auto';
type ClipFilter = 'all' | CameraClipKind | 'job' | 'favorite' | 'album' | 'issue';
type ClipSort = 'newest' | 'oldest' | 'largest';
type ControlSection = CameraDashboardPrefs['activeControlSection'];
type IssueTag = typeof ISSUE_TAGS[number];
type ClipRating = typeof CLIP_RATINGS[number];
type BedCornerKey = keyof Required<BedCorners>;
type MeasurementMode = 'off' | 'bed' | 'ruler';

interface CameraMeasurementCalibration extends CameraDashboardCalibration {
  bedWidthMm?: number;
  bedDepthMm?: number;
  bedCorners?: BedCorners;
  measureA?: ImagePoint;
  measureB?: ImagePoint;
  pose?: CameraPoseCalibration;
}

const BED_CORNER_SEQUENCE: Array<{ key: BedCornerKey; label: string }> = [
  { key: 'frontLeft', label: 'Front left' },
  { key: 'frontRight', label: 'Front right' },
  { key: 'backRight', label: 'Back right' },
  { key: 'backLeft', label: 'Back left' },
];
const HD_BRIDGE_QUALITIES: Array<{ value: CameraHdBridgeQuality; label: string }> = [
  { value: 'native', label: 'Native' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
];

interface CameraMarker {
  id: string;
  atMs: number;
  label: string;
}

interface CameraClip {
  id: string;
  printerId: string;
  printerName: string;
  name?: string;
  notes?: string;
  tags?: string[];
  favorite?: boolean;
  album?: string;
  kind?: CameraClipKind;
  jobName?: string;
  markers?: CameraMarker[];
  trimStartMs?: number;
  trimEndMs?: number;
  snapshotAdjustments?: {
    brightness: number;
    contrast: number;
    sharpen: number;
    crop: SnapshotCrop;
    annotation: string;
  };
  editedAt?: number;
  rating?: ClipRating;
  checklist?: string[];
  thumbnailBlob?: Blob;
  createdAt: number;
  durationMs: number;
  mimeType: string;
  size: number;
  blob: Blob;
}

interface BackendRecordingSession {
  id: string;
  kind: Exclude<CameraClipKind, 'snapshot'>;
  jobName?: string;
  markers: CameraMarker[];
  startedAt: number;
  thumbnailBlob?: Blob;
}

interface SnapshotCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

type CameraPreset = CameraDashboardPreset;

interface CameraDashboardPanelProps {
  compact?: boolean;
}

interface MediaViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function openClipDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CLIP_DB_NAME, CLIP_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLIP_STORE)) {
        const store = db.createObjectStore(CLIP_STORE, { keyPath: 'id' });
        store.createIndex('printerId', 'printerId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open clip database.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Clip database transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Clip database transaction aborted.'));
  });
}

async function saveClip(clip: CameraClip): Promise<void> {
  const db = await openClipDb();
  try {
    const transaction = db.transaction(CLIP_STORE, 'readwrite');
    transaction.objectStore(CLIP_STORE).put(clip);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

async function deleteClip(id: string): Promise<void> {
  const db = await openClipDb();
  try {
    const transaction = db.transaction(CLIP_STORE, 'readwrite');
    transaction.objectStore(CLIP_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

async function loadClips(printerId: string): Promise<CameraClip[]> {
  const db = await openClipDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(CLIP_STORE, 'readonly').objectStore(CLIP_STORE).getAll();
      request.onsuccess = () => {
        const clips = (request.result as CameraClip[])
          .filter((clip) => clip.printerId === printerId)
          .sort((a, b) => b.createdAt - a.createdAt);
        resolve(clips);
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to load camera clips.'));
    });
  } finally {
    db.close();
  }
}

function normalizedHost(hostname: string): string {
  const value = hostname.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value.replace(/\/$/, '');
  return `http://${value.replace(/\/$/, '')}`;
}

function formatClipDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function clipDurationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function parseClipDuration(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 1) return Math.round(parts[0] * 1000);
  const seconds = parts.pop() ?? 0;
  const minutes = parts.pop() ?? 0;
  const hours = parts.pop() ?? 0;
  return Math.round(((hours * 60 * 60) + (minutes * 60) + seconds) * 1000);
}

function clipKind(clip: CameraClip): CameraClipKind {
  return clip.kind ?? 'clip';
}

function clipLabel(clip: CameraClip): string {
  if (clip.name?.trim()) return clip.name.trim();
  const kind = clipKind(clip);
  if (kind === 'snapshot') return 'Snapshot';
  if (kind === 'timelapse') return `${formatClipDuration(clip.durationMs)} timelapse`;
  if (kind === 'auto') return `${formatClipDuration(clip.durationMs)} auto recording`;
  return `${formatClipDuration(clip.durationMs)} camera clip`;
}

function savedRecordingMessage(kind: CameraClipKind, durationMs: number): string {
  if (kind === 'timelapse') return `Saved ${formatClipDuration(durationMs)} timelapse.`;
  if (kind === 'auto') return `Saved ${formatClipDuration(durationMs)} auto recording.`;
  return `Saved ${formatClipDuration(durationMs)} clip.`;
}

function clipFileExtension(clip: CameraClip): string {
  if (clipKind(clip) === 'snapshot') return 'png';
  if (clip.mimeType.includes('mp4')) return 'mp4';
  return 'webm';
}

function pickRecordingMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function backendRecordingStorageKey(printerId: string): string {
  return `${BACKEND_RECORDING_KEY_PREFIX}:${printerId}`;
}

function loadBooleanSetting(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function loadNumberSetting(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function loadControlSectionSetting(): ControlSection {
  try {
    const value = localStorage.getItem(CONTROL_SECTION_KEY);
    return value === 'settings' || value === 'library' || value === 'timeline' || value === 'health' || value === 'record'
      ? value
      : 'record';
  } catch {
    return 'record';
  }
}

function loadCameraPresets(): CameraPreset[] {
  try {
    const value = localStorage.getItem(CAMERA_PRESETS_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as CameraPreset[];
    return Array.isArray(parsed) ? parsed.filter((preset) => preset.id && preset.name) : [];
  } catch {
    return [];
  }
}

function loadCameraDashboardPrefs(): CameraDashboardPrefs {
  return {
    ...DEFAULT_CAMERA_DASHBOARD_PREFS,
    autoRecord: loadBooleanSetting(AUTO_RECORD_KEY),
    autoTimelapse: loadBooleanSetting(AUTO_TIMELAPSE_KEY),
    autoSnapshotFirstLayer: loadBooleanSetting(AUTO_SNAPSHOT_FIRST_LAYER_KEY),
    autoSnapshotLayer: loadBooleanSetting(AUTO_SNAPSHOT_LAYER_KEY),
    autoSnapshotFinish: loadBooleanSetting(AUTO_SNAPSHOT_FINISH_KEY),
    autoSnapshotError: loadBooleanSetting(AUTO_SNAPSHOT_ERROR_KEY),
    scheduledSnapshots: loadBooleanSetting(SCHEDULED_SNAPSHOT_KEY),
    scheduledSnapshotIntervalMin: loadNumberSetting(SCHEDULED_SNAPSHOT_INTERVAL_KEY, DEFAULT_CAMERA_DASHBOARD_PREFS.scheduledSnapshotIntervalMin),
    anomalyCapture: loadBooleanSetting(ANOMALY_CAPTURE_KEY),
    timelapseIntervalSec: loadNumberSetting(TIMELAPSE_INTERVAL_KEY, DEFAULT_CAMERA_DASHBOARD_PREFS.timelapseIntervalSec),
    timelapseFps: loadNumberSetting(TIMELAPSE_FPS_KEY, DEFAULT_CAMERA_DASHBOARD_PREFS.timelapseFps),
    showGrid: loadBooleanSetting(VIEW_GRID_KEY),
    showCrosshair: loadBooleanSetting(VIEW_CROSSHAIR_KEY),
    flipImage: loadBooleanSetting(VIEW_FLIP_KEY),
    rotation: loadNumberSetting(VIEW_ROTATION_KEY, 360) % 360,
    healthPanelOpen: (() => {
      try {
        const value = localStorage.getItem(HEALTH_OPEN_KEY);
        return value === null ? true : value === 'true';
      } catch {
        return true;
      }
    })(),
    activeControlSection: loadControlSectionSetting(),
    editorCollapsed: loadBooleanSetting(EDITOR_COLLAPSED_KEY),
    cameraPresets: loadCameraPresets(),
    calibration: loadCalibrationOverlay(),
  };
}

function isIssueTag(value: string): value is IssueTag {
  return (ISSUE_TAGS as readonly string[]).includes(value);
}

function clipIssueTags(clip: CameraClip): IssueTag[] {
  return (clip.tags ?? [])
    .map((tag) => tag.startsWith('issue:') ? tag.slice(6) : '')
    .filter(isIssueTag);
}

function clipExportName(clip: CameraClip, index: number): string {
  const label = clipLabel(clip).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || `camera-${index + 1}`;
  return `${String(index + 1).padStart(2, '0')}-${label}.${clipFileExtension(clip)}`;
}

function loadCalibrationOverlay(): CameraDashboardCalibration {
  try {
    const value = localStorage.getItem(CALIBRATION_OVERLAY_KEY);
    if (!value) return { enabled: false, x: 12, y: 12, width: 76, height: 76 };
    const parsed = JSON.parse(value) as CameraMeasurementCalibration;
    return {
      ...parsed,
      enabled: Boolean(parsed.enabled),
      x: Number.isFinite(parsed.x) ? Number(parsed.x) : 12,
      y: Number.isFinite(parsed.y) ? Number(parsed.y) : 12,
      width: Number.isFinite(parsed.width) ? Number(parsed.width) : 76,
      height: Number.isFinite(parsed.height) ? Number(parsed.height) : 76,
    };
  } catch {
    return { enabled: false, x: 12, y: 12, width: 76, height: 76 };
  }
}

function formatLastFrame(lastFrameAt: number | null, now: number): string {
  if (!lastFrameAt) return 'Waiting for frame';
  const seconds = Math.max(0, Math.round((now - lastFrameAt) / 1000));
  if (seconds < 2) return 'Frame just now';
  if (seconds < 60) return `Last frame ${seconds}s ago`;
  return `Last frame ${Math.round(seconds / 60)}m ago`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatMeasurementDistance(distanceMm: number | null): string {
  if (distanceMm === null) return 'Calibrate bed corners to measure';
  if (distanceMm >= 1000) return `${(distanceMm / 1000).toFixed(2)} m`;
  return `${distanceMm.toFixed(distanceMm >= 100 ? 1 : 2)} mm`;
}

function defaultCrop(): SnapshotCrop {
  return { x: 0, y: 0, width: 1, height: 1 };
}

function measureContainedMedia(frame: HTMLElement, media: HTMLImageElement | HTMLVideoElement | null): MediaViewportRect {
  const frameRect = frame.getBoundingClientRect();
  if (!frameRect.width || !frameRect.height) return { left: 0, top: 0, width: 100, height: 100 };
  const intrinsicWidth = media instanceof HTMLVideoElement
    ? media.videoWidth
    : media?.naturalWidth;
  const intrinsicHeight = media instanceof HTMLVideoElement
    ? media.videoHeight
    : media?.naturalHeight;
  if (!intrinsicWidth || !intrinsicHeight) return { left: 0, top: 0, width: 100, height: 100 };

  const frameRatio = frameRect.width / frameRect.height;
  const mediaRatio = intrinsicWidth / intrinsicHeight;
  if (!Number.isFinite(mediaRatio) || mediaRatio <= 0) return { left: 0, top: 0, width: 100, height: 100 };

  if (mediaRatio > frameRatio) {
    const height = (frameRect.width / mediaRatio / frameRect.height) * 100;
    return { left: 0, top: (100 - height) / 2, width: 100, height };
  }

  const width = (frameRect.height * mediaRatio / frameRect.width) * 100;
  return { left: (100 - width) / 2, top: 0, width, height: 100 };
}

function sameMediaViewport(a: MediaViewportRect, b: MediaViewportRect): boolean {
  return Math.abs(a.left - b.left) < 0.02
    && Math.abs(a.top - b.top) < 0.02
    && Math.abs(a.width - b.width) < 0.02
    && Math.abs(a.height - b.height) < 0.02;
}

function cameraPtzBaseUrl(prefs: DuetPrefs, fallbackHostname: string): string {
  const cameraHost = prefs.webcamHost.trim();
  if (cameraHost) {
    return /^https?:\/\//i.test(cameraHost) ? cameraHost : `http://${cameraHost}`;
  }
  const streamUrl = prefs.webcamUrl.trim() || prefs.webcamMainStreamUrl.trim();
  if (streamUrl) {
    try {
      return new URL(streamUrl).origin;
    } catch {
      // Fall through to the printer host if the stream URL is a relative path.
    }
  }
  return normalizedHost(fallbackHostname);
}

function cameraRtspBridgeUrl(prefs: DuetPrefs, fallbackHostname: string, quality: CameraHdBridgeQuality): string {
  const rtspUrl = cameraRtspSourceUrl(prefs, fallbackHostname);
  if (!rtspUrl) return '';
  const withCredentials = cameraUrlWithCredentials(rtspUrl, prefs.webcamUsername, prefs.webcamPassword);
  const params = new URLSearchParams({ url: withCredentials, quality });
  return `/camera-rtsp-hls?${params.toString()}`;
}

function cameraServerUsbBridgeUrl(prefs: DuetPrefs, quality: CameraHdBridgeQuality): string {
  const device = prefs.webcamServerUsbDevice.trim();
  if (!device) return '';
  const params = new URLSearchParams({ source: 'usb', device, quality });
  return `/camera-rtsp-hls?${params.toString()}`;
}

function cameraRtspSourceUrl(prefs: DuetPrefs, fallbackHostname: string): string {
  const configured = normalizeCameraStreamUrl(prefs.webcamMainStreamUrl);
  let rtspUrl = /^rtsp:\/\//i.test(configured) ? configured : '';
  if (!rtspUrl) {
    if (prefs.webcamPathPreset !== 'amcrest') return '';
    const base = cameraPtzBaseUrl(prefs, fallbackHostname);
    if (!base) return '';
    try {
      const parsed = new URL(base);
      rtspUrl = `rtsp://${parsed.hostname}:554/cam/realmonitor?channel=1&subtype=0`;
    } catch {
      return '';
    }
  }
  return rtspUrl;
}

function sendCameraCommand(url: string, username: string, password: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new window.Image();
    const timeout = window.setTimeout(() => resolve(), 1500);
    const finish = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    image.onload = finish;
    image.onerror = finish;
    image.src = cameraDisplayUrl(url, username, password);
  });
}

async function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new window.Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function transformSnapshotBlob(
  blob: Blob,
  rotation: number,
  flipHorizontal: boolean,
  crop: SnapshotCrop,
  brightness: number,
  contrast: number,
  sharpen: number,
  annotation: string,
): Promise<Blob> {
  const image = await imageFromBlob(blob);
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const swapsAxes = normalizedRotation === 90 || normalizedRotation === 270;
  const cropX = Math.round(clamp01(crop.x) * image.naturalWidth);
  const cropY = Math.round(clamp01(crop.y) * image.naturalHeight);
  const cropWidth = Math.max(1, Math.round(clamp01(crop.width) * image.naturalWidth));
  const cropHeight = Math.max(1, Math.round(clamp01(crop.height) * image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = swapsAxes ? cropHeight : cropWidth;
  canvas.height = swapsAxes ? cropWidth : cropHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Snapshot editor is not available in this browser.');

  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((normalizedRotation * Math.PI) / 180);
  context.scale(flipHorizontal ? -1 : 1, 1);
  context.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
  context.drawImage(image, cropX, cropY, cropWidth, cropHeight, -cropWidth / 2, -cropHeight / 2, cropWidth, cropHeight);
  context.filter = 'none';

  if (sharpen > 0) {
    context.globalAlpha = Math.min(0.28, sharpen / 250);
    context.drawImage(canvas, -1, 0);
    context.drawImage(canvas, 1, 0);
    context.drawImage(canvas, 0, -1);
    context.drawImage(canvas, 0, 1);
    context.globalAlpha = 1;
  }

  if (annotation.trim()) {
    const text = annotation.trim();
    const pad = Math.max(10, Math.round(canvas.width * 0.018));
    context.font = `700 ${Math.max(16, Math.round(canvas.width * 0.032))}px system-ui, sans-serif`;
    const textWidth = context.measureText(text).width;
    const boxHeight = Math.max(32, Math.round(canvas.height * 0.075));
    context.fillStyle = 'rgba(2, 6, 23, 0.72)';
    context.fillRect(pad, pad, Math.min(canvas.width - pad * 2, textWidth + pad * 2), boxHeight);
    context.fillStyle = '#ffffff';
    context.fillText(text, pad * 1.7, pad + boxHeight * 0.65);

    context.strokeStyle = '#f59e0b';
    context.lineWidth = Math.max(3, Math.round(canvas.width * 0.006));
    context.beginPath();
    context.moveTo(canvas.width * 0.72, canvas.height * 0.22);
    context.lineTo(canvas.width * 0.86, canvas.height * 0.36);
    context.lineTo(canvas.width * 0.8, canvas.height * 0.36);
    context.moveTo(canvas.width * 0.86, canvas.height * 0.36);
    context.lineTo(canvas.width * 0.86, canvas.height * 0.3);
    context.stroke();
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Unable to save edited snapshot.'));
    }, 'image/png');
  });
}

function clipManifest(clip: CameraClip) {
  return {
    id: clip.id,
    name: clipLabel(clip),
    kind: clipKind(clip),
    favorite: Boolean(clip.favorite),
    album: clip.album,
    printerName: clip.printerName,
    jobName: clip.jobName,
    notes: clip.notes,
    tags: clip.tags,
    markers: clip.markers,
    rating: clip.rating,
    checklist: clip.checklist,
    trimStartMs: clip.trimStartMs,
    trimEndMs: clip.trimEndMs,
    snapshotAdjustments: clip.snapshotAdjustments,
    createdAt: new Date(clip.createdAt).toISOString(),
    editedAt: clip.editedAt ? new Date(clip.editedAt).toISOString() : undefined,
    durationMs: clip.durationMs,
    mimeType: clip.mimeType,
    size: clip.size,
  };
}

export default function CameraDashboardPanel({ compact = false }: CameraDashboardPanelProps = {}) {
  const service = usePrinterStore((s) => s.service);
  const config = usePrinterStore((s) => s.config);
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const updatePrinterPrefs = usePrinterStore((s) => s.updatePrinterPrefs);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const printStatus = usePrinterStore((s) => s.model.state?.status);
  const jobFileName = usePrinterStore((s) => s.model.job?.file?.fileName);
  const currentLayer = usePrinterStore((s) => {
    const model = s.model as Record<string, unknown>;
    const job = model.job as Record<string, unknown> | undefined;
    const layer = job?.layer ?? job?.currentLayer ?? model.currentLayer;
    return typeof layer === 'number' ? layer : undefined;
  });

  const activePrinter = printers.find((printer) => printer.id === activePrinterId);
  const basePrefs = useMemo<DuetPrefs>(() => ({
    ...DEFAULT_PREFS,
    ...getDuetPrefs(),
    ...(activePrinter?.prefs as Partial<DuetPrefs> | undefined),
  }), [activePrinter]);
  const cameras = useMemo(() => enabledCamerasFromPrefs(basePrefs), [basePrefs]);
  const prefs = useMemo<DuetPrefs>(() => prefsWithCamera(basePrefs, basePrefs.activeCameraId), [basePrefs]);
  const activeCamera = useMemo(() => (
    prefs.cameras.find((camera) => camera.id === prefs.activeCameraId)
    ?? cameras[0]
    ?? prefs.cameras[0]
  ), [cameras, prefs.activeCameraId, prefs.cameras]);
  const dashboardPrefs = useMemo<CameraDashboardPrefs>(() => {
    const printerPrefs = activePrinter?.prefs as Partial<DuetPrefs> | undefined;
    const storedDashboardPrefs = printerPrefs?.cameraDashboard;
    return {
      ...DEFAULT_CAMERA_DASHBOARD_PREFS,
      ...(storedDashboardPrefs ? {} : loadCameraDashboardPrefs()),
      ...storedDashboardPrefs,
      calibration: {
        ...DEFAULT_CAMERA_DASHBOARD_PREFS.calibration,
        ...(storedDashboardPrefs?.calibration ?? {}),
      },
      cameraPresets: storedDashboardPrefs?.cameraPresets ?? (storedDashboardPrefs ? [] : loadCameraPresets()),
    };
  }, [activePrinter]);

  const hdMainIsRtsp = prefs.webcamMainStreamProtocol === 'rtsp' || /^rtsp:\/\//i.test(prefs.webcamMainStreamUrl.trim());
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const browserUsbStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const selectedClipUrlRef = useRef<string | null>(null);
  const recordingKindRef = useRef<CameraClipKind | null>(null);
  const recordingJobRef = useRef<string | undefined>(undefined);
  const recordingMarkersRef = useRef<CameraMarker[]>([]);
  const recordingThumbnailRef = useRef<Blob | undefined>(undefined);
  const backendRecordingRef = useRef<BackendRecordingSession | null>(null);
  const previousPrintStatusRef = useRef<string | undefined>(undefined);
  const previousPtzPrintStatusRef = useRef<string | undefined>(undefined);
  const seenPrintLayersRef = useRef<Set<number>>(new Set());
  const reconnectHistoryRef = useRef<number[]>([]);
  const scheduledSnapshotTimerRef = useRef<number | null>(null);
  const staleAnomalyCapturedRef = useRef(false);
  const hydratedPrinterIdRef = useRef(activePrinterId);
  const skipNextPrefsSaveRef = useRef(false);

  const [imageFailed, setImageFailed] = useState(false);
  const [webRtcFailed, setWebRtcFailed] = useState(false);
  const [clips, setClips] = useState<CameraClip[]>([]);
  const [selectedClip, setSelectedClip] = useState<CameraClip | null>(null);
  const [selectedClipUrl, setSelectedClipUrl] = useState<string>('');
  const [recordingKind, setRecordingKind] = useState<CameraClipKind | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [autoRecord, setAutoRecord] = useState(() => dashboardPrefs.autoRecord);
  const [autoTimelapse, setAutoTimelapse] = useState(() => dashboardPrefs.autoTimelapse);
  const [autoSnapshotFirstLayer, setAutoSnapshotFirstLayer] = useState(() => dashboardPrefs.autoSnapshotFirstLayer);
  const [autoSnapshotLayer, setAutoSnapshotLayer] = useState(() => dashboardPrefs.autoSnapshotLayer);
  const [autoSnapshotFinish, setAutoSnapshotFinish] = useState(() => dashboardPrefs.autoSnapshotFinish);
  const [autoSnapshotError, setAutoSnapshotError] = useState(() => dashboardPrefs.autoSnapshotError);
  const [scheduledSnapshots, setScheduledSnapshots] = useState(() => dashboardPrefs.scheduledSnapshots);
  const [scheduledSnapshotIntervalMin, setScheduledSnapshotIntervalMin] = useState(() => dashboardPrefs.scheduledSnapshotIntervalMin);
  const [anomalyCapture, setAnomalyCapture] = useState(() => dashboardPrefs.anomalyCapture);
  const [timelapseIntervalSec, setTimelapseIntervalSec] = useState(() => dashboardPrefs.timelapseIntervalSec);
  const [timelapseFps, setTimelapseFps] = useState(() => dashboardPrefs.timelapseFps);
  const [streamRevision, setStreamRevision] = useState(0);
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const [showGrid, setShowGrid] = useState(() => dashboardPrefs.showGrid);
  const [showCrosshair, setShowCrosshair] = useState(() => dashboardPrefs.showCrosshair);
  const [flipImage, setFlipImage] = useState(() => dashboardPrefs.flipImage);
  const [rotation, setRotation] = useState(() => dashboardPrefs.rotation % 360);
  const [clipFilter, setClipFilter] = useState<ClipFilter>('all');
  const [clipSort, setClipSort] = useState<ClipSort>('newest');
  const [clipQuery, setClipQuery] = useState('');
  const [clipDraftName, setClipDraftName] = useState('');
  const [clipDraftNotes, setClipDraftNotes] = useState('');
  const [clipDraftTags, setClipDraftTags] = useState('');
  const [clipDraftJobName, setClipDraftJobName] = useState('');
  const [clipDraftAlbum, setClipDraftAlbum] = useState('');
  const [clipDraftKind, setClipDraftKind] = useState<CameraClipKind>('clip');
  const [clipDraftRating, setClipDraftRating] = useState<ClipRating>('Unrated');
  const [clipDraftChecklist, setClipDraftChecklist] = useState<string[]>([]);
  const [issueDraft, setIssueDraft] = useState<IssueTag>('Warping');
  const [markerDraftLabel, setMarkerDraftLabel] = useState('');
  const [markerDraftTime, setMarkerDraftTime] = useState('0:00');
  const [snapshotEditFlip, setSnapshotEditFlip] = useState(false);
  const [snapshotEditRotation, setSnapshotEditRotation] = useState(0);
  const [snapshotCrop, setSnapshotCrop] = useState<SnapshotCrop>(() => defaultCrop());
  const [snapshotBrightness, setSnapshotBrightness] = useState(100);
  const [snapshotContrast, setSnapshotContrast] = useState(100);
  const [snapshotSharpen, setSnapshotSharpen] = useState(0);
  const [snapshotAnnotation, setSnapshotAnnotation] = useState('');
  const [saveSnapshotAsCopy, setSaveSnapshotAsCopy] = useState(true);
  const [trimStart, setTrimStart] = useState('0:00');
  const [trimEnd, setTrimEnd] = useState('');
  const [bulkTags, setBulkTags] = useState('');
  const [bulkAlbum, setBulkAlbum] = useState('');
  const [cleanupDays, setCleanupDays] = useState(30);
  const [compareClipId, setCompareClipId] = useState('');
  const [healthPanelOpen, setHealthPanelOpen] = useState(() => dashboardPrefs.healthPanelOpen);
  const [activeControlSection, setActiveControlSection] = useState<ControlSection>(() => dashboardPrefs.activeControlSection);
  const [editorCollapsed, setEditorCollapsed] = useState(() => dashboardPrefs.editorCollapsed);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [cameraPresets, setCameraPresets] = useState<CameraPreset[]>(() => dashboardPrefs.cameraPresets);
  const [presetName, setPresetName] = useState('');
  const [ptzPresetName, setPtzPresetName] = useState('');
  const [ptzPresetToken, setPtzPresetToken] = useState('1');
  const [compareBlend, setCompareBlend] = useState(50);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [calibration, setCalibration] = useState<CameraMeasurementCalibration>(() => dashboardPrefs.calibration as CameraMeasurementCalibration);
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>('off');
  const [nextBedCornerIndex, setNextBedCornerIndex] = useState(0);
  const [draggingBedCorner, setDraggingBedCorner] = useState<BedCornerKey | null>(null);
  const [poseStillUrl, setPoseStillUrl] = useState('');
  const [finalComparisonUrl, setFinalComparisonUrl] = useState('');
  const [cameraOverlayMode, setCameraOverlayMode] = useState<CameraOverlayMode>('camera');
  const [ptzEnabled, setPtzEnabled] = useState(() => dashboardPrefs.ptzEnabled);
  const [ptzSpeed, setPtzSpeed] = useState(() => dashboardPrefs.ptzSpeed);
  const [hdBridgeQuality, setHdBridgeQuality] = useState<CameraHdBridgeQuality>(() => dashboardPrefs.hdBridgeQuality);
  const [mediaViewport, setMediaViewport] = useState<MediaViewportRect>({ left: 0, top: 0, width: 100, height: 100 });
  const [lastFrameIntervalMs, setLastFrameIntervalMs] = useState<number | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const streamUrl = useMemo(() => {
    if (prefs.webcamSourceType === 'browser-usb') return 'browser-usb://camera';
    if (prefs.webcamSourceType === 'server-usb') return cameraServerUsbBridgeUrl(prefs, hdBridgeQuality);
    const host = normalizedHost(config.hostname);
    const fallbackUrl = service?.getWebcamUrl() ?? (host ? `${host}/webcam/?action=stream` : '');
    if (prefs.webcamStreamPreference === 'main' && hdMainIsRtsp) {
      return cameraRtspBridgeUrl(prefs, config.hostname, hdBridgeQuality);
    }
    return preferredCameraStreamUrl(prefs, fallbackUrl);
  }, [config.hostname, hdBridgeQuality, hdMainIsRtsp, prefs, service]);

  const displayUrl = useMemo(
    () => streamUrl.startsWith('browser-usb://') ? '' : cameraDisplayUrl(streamUrl, prefs.webcamUsername, prefs.webcamPassword),
    [prefs.webcamPassword, prefs.webcamUsername, streamUrl],
  );
  const videoUrl = useMemo(
    () => streamUrl.startsWith('browser-usb://')
      ? ''
      : streamUrl.startsWith('/camera-rtsp-hls')
      ? streamUrl
      : cameraUrlWithCredentials(normalizeCameraStreamUrl(streamUrl), prefs.webcamUsername, prefs.webcamPassword),
    [prefs.webcamPassword, prefs.webcamUsername, streamUrl],
  );
  const backendRecordingUrl = useMemo(() => {
    if (prefs.webcamSourceType === 'server-usb') return prefs.webcamServerUsbDevice.trim();
    const rtspUrl = cameraRtspSourceUrl(prefs, config.hostname);
    return rtspUrl ? cameraUrlWithCredentials(rtspUrl, prefs.webcamUsername, prefs.webcamPassword) : '';
  }, [config.hostname, prefs]);

  const printerId = activePrinter?.id ?? 'default-printer';
  const printerName = activePrinter?.name ?? 'Printer';
  const isBrowserUsbCamera = prefs.webcamSourceType === 'browser-usb';
  const isServerUsbCamera = prefs.webcamSourceType === 'server-usb';
  const webRtcUrl = activeCamera?.webRtcEnabled ? activeCamera.webRtcUrl.trim() : '';
  const useWebRtcStream = Boolean(webRtcUrl && !webRtcFailed);
  const isVideoStream = useWebRtcStream || isBrowserUsbCamera || isServerUsbCamera || (prefs.webcamStreamPreference === 'main' && (hdMainIsRtsp || prefs.webcamMainStreamProtocol === 'hls' || prefs.webcamMainStreamProtocol === 'http'));
  const cameraSourceUrl = useWebRtcStream ? webRtcUrl : isBrowserUsbCamera ? 'browser-usb' : isVideoStream ? videoUrl : displayUrl;
  const hasCamera = Boolean(cameraSourceUrl) && !imageFailed;
  const recording = recordingKind !== null;
  const isTimelapseRecording = recordingKind === 'timelapse';
  const isAutoRecording = recordingKind === 'auto';
  const isPrintActive = printStatus === 'processing' || printStatus === 'simulating';
  const hdLiveNeedsBridge = hdMainIsRtsp || isServerUsbCamera;
  const canUseBackendRecording = ((prefs.webcamStreamPreference === 'main' && hdMainIsRtsp) || isServerUsbCamera) && Boolean(backendRecordingUrl);
  const canUsePtz = Boolean(activeCamera?.ptzEnabled && activeCamera.ptzProvider !== 'off');
  const activePtzStartPreset = activeCamera?.ptzPresets.find((preset) => preset.id === activeCamera.ptzStartPresetId);
  const streamSrc = useMemo(() => {
    if (!cameraSourceUrl) return '';
    if (useWebRtcStream) return cameraSourceUrl;
    if (isBrowserUsbCamera) return 'browser-usb';
    const separator = cameraSourceUrl.includes('?') ? '&' : '?';
    return `${cameraSourceUrl}${separator}_cameraReload=${streamRevision}`;
  }, [cameraSourceUrl, isBrowserUsbCamera, streamRevision, useWebRtcStream]);
  const totalStorageBytes = useMemo(() => clips.reduce((sum, clip) => sum + clip.size + (clip.thumbnailBlob?.size ?? 0), 0), [clips]);
  const storageByKind = useMemo(() => {
    return clips.reduce<Record<CameraClipKind, { count: number; size: number }>>((acc, clip) => {
      const kind = clipKind(clip);
      acc[kind].count += 1;
      acc[kind].size += clip.size + (clip.thumbnailBlob?.size ?? 0);
      return acc;
    }, {
      auto: { count: 0, size: 0 },
      clip: { count: 0, size: 0 },
      snapshot: { count: 0, size: 0 },
      timelapse: { count: 0, size: 0 },
    });
  }, [clips]);

  useEffect(() => {
    const key = backendRecordingStorageKey(printerId);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      if (backendRecordingRef.current) {
        backendRecordingRef.current = null;
        setRecordingKind(null);
        setElapsedMs(0);
      }
      return;
    }

    try {
      const stored = JSON.parse(raw) as BackendRecordingSession;
      backendRecordingRef.current = { ...stored, markers: stored.markers ?? [] };
      startedAtRef.current = stored.startedAt;
      recordingKindRef.current = stored.kind;
      recordingJobRef.current = stored.jobName;
      recordingMarkersRef.current = stored.markers ?? [];
      setRecordingKind(stored.kind);
      setElapsedMs(Date.now() - stored.startedAt);
      void fetch('/camera-rtsp-record?action=status', { cache: 'no-store' })
        .then((response) => response.ok ? response.json() as Promise<{ recordings: Array<{ id: string }> }> : { recordings: [] })
        .then((status) => {
          if (!status.recordings.some((recording) => recording.id === stored.id)) {
            window.sessionStorage.removeItem(key);
            if (backendRecordingRef.current?.id === stored.id) {
              backendRecordingRef.current = null;
              recordingKindRef.current = null;
              recordingJobRef.current = undefined;
              recordingMarkersRef.current = [];
              setRecordingKind(null);
              setElapsedMs(0);
            }
          }
        })
        .catch(() => {});
    } catch {
      window.sessionStorage.removeItem(key);
    }
  }, [printerId]);
  const storageByJob = useMemo(() => {
    const grouped = new Map<string, { count: number; size: number }>();
    clips.forEach((clip) => {
      const key = clip.jobName || 'No job';
      const current = grouped.get(key) ?? { count: 0, size: 0 };
      current.count += 1;
      current.size += clip.size + (clip.thumbnailBlob?.size ?? 0);
      grouped.set(key, current);
    });
    return Array.from(grouped.entries())
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 4);
  }, [clips]);
  const albums = useMemo(() => {
    return Array.from(new Set(clips.map((clip) => clip.album?.trim()).filter(Boolean) as string[])).sort();
  }, [clips]);
  const snapshotClips = useMemo(() => {
    return clips.filter((clip) => clipKind(clip) === 'snapshot').sort((a, b) => b.createdAt - a.createdAt);
  }, [clips]);
  const compareClip = useMemo(() => {
    return snapshotClips.find((clip) => clip.id === compareClipId) ?? snapshotClips.find((clip) => clip.id !== selectedClip?.id) ?? null;
  }, [compareClipId, selectedClip?.id, snapshotClips]);
  const compareClipUrl = compareClip ? thumbUrls[compareClip.id] : '';
  const frameAgeMs = lastFrameAt ? nowTick - lastFrameAt : null;
  const estimatedFps = lastFrameIntervalMs ? Math.min(60, 1000 / lastFrameIntervalMs) : 0;
  const droppedFrameWarning = frameAgeMs !== null && frameAgeMs > 5000;
  const recordingMarkerCount = recordingMarkersRef.current.length;
  const recordingStatusLabel = recording
    ? `${isTimelapseRecording ? 'Timelapse' : isAutoRecording ? 'Auto recording' : 'Recording'} ${formatClipDuration(elapsedMs)}`
    : isPrintActive
      ? 'Print active'
      : 'Ready';
  const selectedKind = selectedClip ? clipKind(selectedClip) : null;
  const selectedBulkClips = useMemo(() => clips.filter((clip) => selectedClipIds.includes(clip.id)), [clips, selectedClipIds]);
  const visibleClips = useMemo(() => {
    const query = clipQuery.trim().toLowerCase();
    return clips
      .filter((clip) => {
        const kind = clipKind(clip);
        const matchesFilter = clipFilter === 'all'
          || kind === clipFilter
          || (clipFilter === 'job' && Boolean(clip.jobName))
          || (clipFilter === 'favorite' && Boolean(clip.favorite))
          || (clipFilter === 'album' && Boolean(clip.album))
          || (clipFilter === 'issue' && clipIssueTags(clip).length > 0);
        if (!matchesFilter) return false;
        if (!query) return true;
        const haystack = [
          clipLabel(clip),
          clip.jobName,
          clip.album,
          clip.notes,
          ...(clip.tags ?? []),
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        if (clipSort === 'oldest') return a.createdAt - b.createdAt;
        if (clipSort === 'largest') return b.size - a.size;
        return b.createdAt - a.createdAt;
      });
  }, [clipFilter, clipQuery, clipSort, clips]);
  const recentClips = useMemo(() => clips.slice(0, 6), [clips]);
  const timelineJobName = jobFileName || selectedClip?.jobName || '';
  const timelineClips = useMemo(() => {
    const source = timelineJobName ? clips.filter((clip) => clip.jobName === timelineJobName) : clips.slice(0, 12);
    return [...source].sort((a, b) => a.createdAt - b.createdAt).slice(-16);
  }, [clips, timelineJobName]);

  const refreshClips = useCallback(async () => {
    setBusy(true);
    try {
      setClips(await loadClips(printerId));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load saved clips.');
    } finally {
      setBusy(false);
    }
  }, [printerId]);

  useEffect(() => {
    void refreshClips();
  }, [refreshClips]);

  useEffect(() => {
    setImageFailed(false);
    setLastFrameAt(null);
  }, [cameraSourceUrl]);

  useEffect(() => {
    setWebRtcFailed(false);
  }, [activeCamera?.id, webRtcUrl]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!recording) return undefined;
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 500);
    return () => window.clearInterval(interval);
  }, [recording]);

  useEffect(() => {
    if (hydratedPrinterIdRef.current === activePrinterId) return;
    hydratedPrinterIdRef.current = activePrinterId;
    skipNextPrefsSaveRef.current = true;
    setAutoRecord(dashboardPrefs.autoRecord);
    setAutoTimelapse(dashboardPrefs.autoTimelapse);
    setAutoSnapshotFirstLayer(dashboardPrefs.autoSnapshotFirstLayer);
    setAutoSnapshotLayer(dashboardPrefs.autoSnapshotLayer);
    setAutoSnapshotFinish(dashboardPrefs.autoSnapshotFinish);
    setAutoSnapshotError(dashboardPrefs.autoSnapshotError);
    setScheduledSnapshots(dashboardPrefs.scheduledSnapshots);
    setScheduledSnapshotIntervalMin(dashboardPrefs.scheduledSnapshotIntervalMin);
    setAnomalyCapture(dashboardPrefs.anomalyCapture);
    setTimelapseIntervalSec(dashboardPrefs.timelapseIntervalSec);
    setTimelapseFps(dashboardPrefs.timelapseFps);
    setShowGrid(dashboardPrefs.showGrid);
    setShowCrosshair(dashboardPrefs.showCrosshair);
    setFlipImage(dashboardPrefs.flipImage);
    setRotation(dashboardPrefs.rotation % 360);
    setHealthPanelOpen(dashboardPrefs.healthPanelOpen);
    setActiveControlSection(dashboardPrefs.activeControlSection);
    setEditorCollapsed(dashboardPrefs.editorCollapsed);
    setCameraPresets(dashboardPrefs.cameraPresets);
    setCalibration(dashboardPrefs.calibration as CameraMeasurementCalibration);
    setMeasurementMode('off');
    setNextBedCornerIndex(0);
    setPoseStillUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return '';
    });
    setFinalComparisonUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return '';
    });
    setPtzEnabled(dashboardPrefs.ptzEnabled);
    setPtzSpeed(dashboardPrefs.ptzSpeed);
    setHdBridgeQuality(dashboardPrefs.hdBridgeQuality);
  }, [activePrinterId, dashboardPrefs]);

  useEffect(() => {
    if (skipNextPrefsSaveRef.current) {
      skipNextPrefsSaveRef.current = false;
      return undefined;
    }

    const nextCameraPrefs: CameraDashboardPrefs = {
      autoRecord,
      autoTimelapse,
      autoSnapshotFirstLayer,
      autoSnapshotLayer,
      autoSnapshotFinish,
      autoSnapshotError,
      scheduledSnapshots,
      scheduledSnapshotIntervalMin,
      anomalyCapture,
      timelapseIntervalSec,
      timelapseFps,
      showGrid,
      showCrosshair,
      flipImage,
      rotation,
      healthPanelOpen,
      activeControlSection,
      editorCollapsed,
      cameraPresets,
      calibration,
      ptzEnabled,
      ptzSpeed,
      hdBridgeQuality,
    };

    const timeout = window.setTimeout(() => {
      updatePrinterPrefs(activePrinterId, { cameraDashboard: nextCameraPrefs });
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [
    activeControlSection,
    activePrinterId,
    anomalyCapture,
    autoRecord,
    autoSnapshotError,
    autoSnapshotFinish,
    autoSnapshotFirstLayer,
    autoSnapshotLayer,
    autoTimelapse,
    calibration,
    cameraPresets,
    editorCollapsed,
    flipImage,
    hdBridgeQuality,
    healthPanelOpen,
    ptzEnabled,
    ptzSpeed,
    rotation,
    scheduledSnapshotIntervalMin,
    scheduledSnapshots,
    showCrosshair,
    showGrid,
    timelapseFps,
    timelapseIntervalSec,
    updatePrinterPrefs,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_RECORD_KEY, String(autoRecord));
    } catch {
      /* storage unavailable */
    }
  }, [autoRecord]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_TIMELAPSE_KEY, String(autoTimelapse));
      localStorage.setItem(TIMELAPSE_INTERVAL_KEY, String(timelapseIntervalSec));
      localStorage.setItem(TIMELAPSE_FPS_KEY, String(timelapseFps));
    } catch {
      /* storage unavailable */
    }
  }, [autoTimelapse, timelapseFps, timelapseIntervalSec]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_SNAPSHOT_FIRST_LAYER_KEY, String(autoSnapshotFirstLayer));
      localStorage.setItem(AUTO_SNAPSHOT_LAYER_KEY, String(autoSnapshotLayer));
      localStorage.setItem(AUTO_SNAPSHOT_FINISH_KEY, String(autoSnapshotFinish));
      localStorage.setItem(AUTO_SNAPSHOT_ERROR_KEY, String(autoSnapshotError));
      localStorage.setItem(SCHEDULED_SNAPSHOT_KEY, String(scheduledSnapshots));
      localStorage.setItem(SCHEDULED_SNAPSHOT_INTERVAL_KEY, String(scheduledSnapshotIntervalMin));
      localStorage.setItem(ANOMALY_CAPTURE_KEY, String(anomalyCapture));
    } catch {
      /* storage unavailable */
    }
  }, [anomalyCapture, autoSnapshotError, autoSnapshotFinish, autoSnapshotFirstLayer, autoSnapshotLayer, scheduledSnapshotIntervalMin, scheduledSnapshots]);

  useEffect(() => {
    try {
      localStorage.setItem(CAMERA_PRESETS_KEY, JSON.stringify(cameraPresets));
    } catch {
      /* storage unavailable */
    }
  }, [cameraPresets]);

  useEffect(() => {
    try {
      localStorage.setItem(CALIBRATION_OVERLAY_KEY, JSON.stringify(calibration));
    } catch {
      /* storage unavailable */
    }
  }, [calibration]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_GRID_KEY, String(showGrid));
      localStorage.setItem(VIEW_CROSSHAIR_KEY, String(showCrosshair));
      localStorage.setItem(VIEW_FLIP_KEY, String(flipImage));
      localStorage.setItem(VIEW_ROTATION_KEY, String(rotation));
      localStorage.setItem(HEALTH_OPEN_KEY, String(healthPanelOpen));
      localStorage.setItem(CONTROL_SECTION_KEY, activeControlSection);
      localStorage.setItem(EDITOR_COLLAPSED_KEY, String(editorCollapsed));
    } catch {
      /* storage unavailable */
    }
  }, [activeControlSection, editorCollapsed, flipImage, healthPanelOpen, rotation, showCrosshair, showGrid]);

  useEffect(() => () => {
    if (frameTimerRef.current !== null) {
      window.clearInterval(frameTimerRef.current);
    }
    if (scheduledSnapshotTimerRef.current !== null) {
      window.clearInterval(scheduledSnapshotTimerRef.current);
    }
    if (selectedClipUrlRef.current) {
      URL.revokeObjectURL(selectedClipUrlRef.current);
    }
    setPoseStillUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return '';
    });
    setFinalComparisonUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return '';
    });
  }, []);

  useEffect(() => {
    const urls: Record<string, string> = {};
    clips.forEach((clip) => {
      const thumbnail = clip.thumbnailBlob ?? (clipKind(clip) === 'snapshot' ? clip.blob : undefined);
      if (thumbnail) {
        urls[clip.id] = URL.createObjectURL(thumbnail);
      }
    });
    setThumbUrls(urls);
    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [clips]);

  useEffect(() => {
    if (!isBrowserUsbCamera) {
      browserUsbStreamRef.current?.getTracks().forEach((track) => track.stop());
      browserUsbStreamRef.current = null;
      return undefined;
    }

    let disposed = false;
    const video = videoRef.current;
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      setImageFailed(true);
      setMessage('This browser cannot access USB cameras.');
      return undefined;
    }

    setImageFailed(false);
    const videoConstraints: boolean | MediaTrackConstraints = prefs.webcamUsbDeviceId
      ? { deviceId: { exact: prefs.webcamUsbDeviceId } }
      : true;
    void navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints })
      .then((stream) => {
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        browserUsbStreamRef.current = stream;
        video.srcObject = stream;
        void video.play().catch(() => {});
        setLastFrameAt(Date.now());
        setMessage(prefs.webcamUsbDeviceLabel ? `Using USB camera: ${prefs.webcamUsbDeviceLabel}` : 'Using browser USB camera.');
      })
      .catch(() => {
        setImageFailed(true);
        setMessage('Unable to open USB camera. Check browser permissions and camera settings.');
      });

    return () => {
      disposed = true;
      browserUsbStreamRef.current?.getTracks().forEach((track) => track.stop());
      browserUsbStreamRef.current = null;
      if (video.srcObject) video.srcObject = null;
    };
  }, [isBrowserUsbCamera, prefs.webcamUsbDeviceId, prefs.webcamUsbDeviceLabel]);

  useEffect(() => {
    if (!selectedClip) {
      setClipDraftName('');
      setClipDraftNotes('');
      setClipDraftTags('');
      setClipDraftJobName('');
      setClipDraftAlbum('');
      setClipDraftKind('clip');
      setClipDraftRating('Unrated');
      setClipDraftChecklist([]);
      setMarkerDraftLabel('');
      setMarkerDraftTime('0:00');
      setSnapshotEditFlip(false);
      setSnapshotEditRotation(0);
      setSnapshotCrop(defaultCrop());
      setSnapshotBrightness(100);
      setSnapshotContrast(100);
      setSnapshotSharpen(0);
      setSnapshotAnnotation('');
      setTrimStart('0:00');
      setTrimEnd('');
      return;
    }
    setClipDraftName(selectedClip.name ?? '');
    setClipDraftNotes(selectedClip.notes ?? '');
    setClipDraftTags((selectedClip.tags ?? []).join(', '));
    setClipDraftJobName(selectedClip.jobName ?? '');
    setClipDraftAlbum(selectedClip.album ?? '');
    setClipDraftKind(clipKind(selectedClip));
    setClipDraftRating(selectedClip.rating ?? 'Unrated');
    setClipDraftChecklist(selectedClip.checklist ?? []);
    setMarkerDraftLabel('');
    setMarkerDraftTime('0:00');
    setSnapshotEditFlip(false);
    setSnapshotEditRotation(0);
    setSnapshotCrop(selectedClip.snapshotAdjustments?.crop ?? defaultCrop());
    setSnapshotBrightness(selectedClip.snapshotAdjustments?.brightness ?? 100);
    setSnapshotContrast(selectedClip.snapshotAdjustments?.contrast ?? 100);
    setSnapshotSharpen(selectedClip.snapshotAdjustments?.sharpen ?? 0);
    setSnapshotAnnotation(selectedClip.snapshotAdjustments?.annotation ?? '');
    setTrimStart(formatClipDuration(selectedClip.trimStartMs ?? 0));
    setTrimEnd(selectedClip.trimEndMs ? formatClipDuration(selectedClip.trimEndMs) : '');
  }, [selectedClip]);

  const drawFrame = useCallback(() => {
    const image = isVideoStream ? videoRef.current : imgRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) throw new Error('Camera preview is not ready yet.');
    const width = image instanceof HTMLVideoElement
      ? image.videoWidth || image.clientWidth || 1280
      : image.naturalWidth || image.clientWidth || 1280;
    const height = image instanceof HTMLVideoElement
      ? image.videoHeight || image.clientHeight || 720
      : image.naturalHeight || image.clientHeight || 720;
    if (width <= 0 || height <= 0) throw new Error('Camera stream has not produced a frame yet.');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas recording is not available in this browser.');
    context.drawImage(image, 0, 0, width, height);
    setLastFrameAt(Date.now());
  }, [isVideoStream]);

  const canvasBlob = useCallback(async (type: string, quality?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error('Camera frame is not ready.');
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Unable to encode camera frame.'));
      }, type, quality);
    });
  }, []);

  const captureSnapshot = useCallback(async (label?: string) => {
    if (!hasCamera) return;
    try {
      drawFrame();
      const blob = await canvasBlob('image/png');
      const now = Date.now();
      setBusy(true);
      await saveClip({
        id: `${printerId}-snapshot-${now}`,
        printerId,
        printerName,
        name: label,
        kind: 'snapshot',
        jobName: jobFileName,
        album: jobFileName ? 'Print events' : undefined,
        tags: label ? ['auto-capture'] : undefined,
        createdAt: now,
        durationMs: 0,
        mimeType: blob.type || 'image/png',
        size: blob.size,
        blob,
      });
      setMessage(label ? `Saved ${label}.` : 'Saved camera snapshot.');
      await refreshClips();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save camera snapshot.');
    } finally {
      setBusy(false);
    }
  }, [canvasBlob, drawFrame, hasCamera, jobFileName, printerId, printerName, refreshClips]);

  const capturePoseStill = useCallback(async () => {
    if (!hasCamera) return;
    try {
      drawFrame();
      const blob = await canvasBlob('image/png');
      const nextUrl = URL.createObjectURL(blob);
      setPoseStillUrl((currentUrl) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        return nextUrl;
      });
      setMeasurementMode('bed');
      setNextBedCornerIndex(0);
      setMessage('Frozen camera frame. Pick the four bed corners to calibrate AR pose.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to freeze camera frame.');
    }
  }, [canvasBlob, drawFrame, hasCamera]);

  const captureFinalComparisonFrame = useCallback(async () => {
    if (!hasCamera || !calibration.pose) return;
    try {
      drawFrame();
      const blob = await canvasBlob('image/png');
      const nextUrl = URL.createObjectURL(blob);
      setFinalComparisonUrl((currentUrl) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        return nextUrl;
      });
      setCameraOverlayMode('both');
      setMessage('Frozen final frame for AR print comparison.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to freeze final comparison frame.');
    }
  }, [calibration.pose, canvasBlob, drawFrame, hasCamera]);

  const captureAnomaly = useCallback((reason: string) => {
    if (!anomalyCapture || !hasCamera) return;
    void captureSnapshot(`Anomaly: ${reason}`);
  }, [anomalyCapture, captureSnapshot, hasCamera]);

  useEffect(() => {
    if (scheduledSnapshotTimerRef.current !== null) {
      window.clearInterval(scheduledSnapshotTimerRef.current);
      scheduledSnapshotTimerRef.current = null;
    }
    if (!scheduledSnapshots || !hasCamera || !isPrintActive) return undefined;

    scheduledSnapshotTimerRef.current = window.setInterval(() => {
      void captureSnapshot('Scheduled snapshot');
    }, Math.max(1, scheduledSnapshotIntervalMin) * 60 * 1000);

    return () => {
      if (scheduledSnapshotTimerRef.current !== null) {
        window.clearInterval(scheduledSnapshotTimerRef.current);
        scheduledSnapshotTimerRef.current = null;
      }
    };
  }, [captureSnapshot, hasCamera, isPrintActive, scheduledSnapshotIntervalMin, scheduledSnapshots]);

  useEffect(() => {
    if (!anomalyCapture || !droppedFrameWarning) {
      if (!droppedFrameWarning) staleAnomalyCapturedRef.current = false;
      return;
    }
    if (staleAnomalyCapturedRef.current) return;
    staleAnomalyCapturedRef.current = true;
    captureAnomaly('stale frame');
  }, [anomalyCapture, captureAnomaly, droppedFrameWarning]);

  const stopBackendRecording = useCallback(async () => {
    const session = backendRecordingRef.current;
    if (!session) return false;
    backendRecordingRef.current = null;
    window.sessionStorage.removeItem(backendRecordingStorageKey(printerId));
    recordingKindRef.current = null;
    recordingJobRef.current = undefined;
    recordingMarkersRef.current = [];
    recordingThumbnailRef.current = undefined;
    setRecordingKind(null);
    setElapsedMs(0);
    setBusy(true);
    try {
      const response = await fetch(`/camera-rtsp-record?action=stop&id=${encodeURIComponent(session.id)}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(await response.text() || 'Unable to stop backend camera recording.');
      }
      const blob = await response.blob();
      const durationMs = Number(response.headers.get('x-recording-duration-ms')) || (Date.now() - session.startedAt);
      if (blob.size <= 0) {
        setMessage('No video frames were captured.');
        return true;
      }
      await saveClip({
        id: `${printerId}-${Date.now()}`,
        printerId,
        printerName,
        kind: session.kind,
        jobName: session.jobName,
        markers: session.markers,
        thumbnailBlob: session.thumbnailBlob,
        createdAt: Date.now(),
        durationMs,
        mimeType: blob.type || 'video/mp4',
        size: blob.size,
        blob,
      });
      setMessage(savedRecordingMessage(session.kind, durationMs));
      await refreshClips();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save backend camera recording.');
    } finally {
      setBusy(false);
    }
    return true;
  }, [printerId, printerName, refreshClips]);

  const stopRecording = useCallback(() => {
    if (frameTimerRef.current !== null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (backendRecordingRef.current) {
      void stopBackendRecording();
      return;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, [stopBackendRecording]);

  const startRecording = useCallback(async (kind: Exclude<CameraClipKind, 'snapshot'> = 'clip', jobName?: string) => {
    if (!hasCamera || recording) return;
    if (canUseBackendRecording) {
      try {
        let thumbnailBlob: Blob | undefined;
        try {
          drawFrame();
          thumbnailBlob = await canvasBlob('image/jpeg', 0.75);
        } catch {
          thumbnailBlob = undefined;
        }
        const params = new URLSearchParams({
          action: 'start',
          kind,
          quality: hdBridgeQuality,
        });
        if (isServerUsbCamera) {
          params.set('source', 'usb');
          params.set('device', backendRecordingUrl);
        } else {
          params.set('url', backendRecordingUrl);
        }
        const response = await fetch(`/camera-rtsp-record?${params.toString()}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(await response.text() || 'Unable to start backend camera recording.');
        }
        const result = await response.json() as { id: string; createdAt?: number };
        const startedAt = result.createdAt ?? Date.now();
        backendRecordingRef.current = {
          id: result.id,
          kind,
          jobName,
          markers: [],
          startedAt,
          thumbnailBlob,
        };
        window.sessionStorage.setItem(backendRecordingStorageKey(printerId), JSON.stringify({
          id: result.id,
          kind,
          jobName,
          markers: [],
          startedAt,
        }));
        startedAtRef.current = startedAt;
        recordingKindRef.current = kind;
        recordingJobRef.current = jobName;
        recordingMarkersRef.current = [];
        recordingThumbnailRef.current = thumbnailBlob;
        setRecordingKind(kind);
        setElapsedMs(0);
        setMessage(kind === 'timelapse' ? 'Backend timelapse recording started...' : kind === 'auto' ? 'Backend auto-recording active print...' : 'Backend camera recording started...');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to start backend camera recording.');
      }
      return;
    }

    if (!('MediaRecorder' in window)) {
      setMessage('This browser does not support camera clip recording.');
      return;
    }

    try {
      drawFrame();
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Recording canvas is not ready.');
      recordingThumbnailRef.current = await canvasBlob('image/jpeg', 0.75);
      const stream = canvas.captureStream(kind === 'timelapse' ? timelapseFps : RECORDING_FPS);
      const mimeType = pickRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recordingKindRef.current = kind;
      recordingJobRef.current = jobName;
      recordingMarkersRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const type = recorder.mimeType || mimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type });
        const stoppedKind = recordingKindRef.current ?? kind;
        const stoppedJob = recordingJobRef.current;
        const stoppedMarkers = recordingMarkersRef.current;
        const stoppedThumbnail = recordingThumbnailRef.current;
        recorderRef.current = null;
        recordingKindRef.current = null;
        recordingJobRef.current = undefined;
        recordingMarkersRef.current = [];
        recordingThumbnailRef.current = undefined;
        setRecordingKind(null);
        setElapsedMs(0);
        void (async () => {
          if (blob.size <= 0) {
            setMessage('No video frames were captured.');
            return;
          }
          setBusy(true);
          try {
            await saveClip({
              id: `${printerId}-${Date.now()}`,
              printerId,
              printerName,
              kind: stoppedKind,
              jobName: stoppedJob,
              markers: stoppedMarkers,
              thumbnailBlob: stoppedThumbnail,
              createdAt: Date.now(),
              durationMs,
              mimeType: type,
              size: blob.size,
              blob,
            });
            setMessage(savedRecordingMessage(stoppedKind, durationMs));
            await refreshClips();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Unable to save camera clip.');
          } finally {
            setBusy(false);
          }
        })();
      };

      recorder.onerror = () => {
        setMessage('Recording stopped because the camera stream could not be captured.');
        stopRecording();
      };

      recorderRef.current = recorder;
      frameTimerRef.current = window.setInterval(() => {
        try {
          drawFrame();
        } catch {
          stopRecording();
          setMessage('Recording stopped because the camera frame could not be read.');
        }
      }, kind === 'timelapse' ? Math.max(1, timelapseIntervalSec) * 1000 : Math.round(1000 / RECORDING_FPS));

      recorder.start(1000);
      setRecordingKind(kind);
      setElapsedMs(0);
      setMessage(kind === 'timelapse' ? 'Recording timelapse...' : kind === 'auto' ? 'Auto-recording active print...' : 'Recording camera clip...');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start recording.');
    }
  }, [backendRecordingUrl, canUseBackendRecording, canvasBlob, drawFrame, hasCamera, hdBridgeQuality, isServerUsbCamera, printerId, printerName, recording, refreshClips, stopRecording, timelapseFps, timelapseIntervalSec]);

  useEffect(() => {
    if ((!autoRecord && !autoTimelapse) || !hasCamera) return;
    if (isPrintActive && !recordingKindRef.current) {
      void startRecording(autoTimelapse ? 'timelapse' : 'auto', jobFileName);
      return;
    }
    if (!isPrintActive && (recordingKindRef.current === 'auto' || (autoTimelapse && recordingKindRef.current === 'timelapse'))) {
      stopRecording();
    }
  }, [autoRecord, autoTimelapse, hasCamera, isPrintActive, jobFileName, startRecording, stopRecording]);

  useEffect(() => {
    const previous = previousPrintStatusRef.current;
    previousPrintStatusRef.current = printStatus;

    if (!hasCamera) return;
    const becameActive = !previous || (previous !== 'processing' && previous !== 'simulating');
    if (isPrintActive && becameActive) {
      seenPrintLayersRef.current = new Set();
      if (autoSnapshotFirstLayer) {
        void captureSnapshot('First layer snapshot');
      }
      return;
    }

    if (previous && previous !== printStatus && !isPrintActive) {
      if (autoSnapshotFinish && printStatus === 'idle') {
        void captureSnapshot('Print finish snapshot');
      }
      if (printStatus === 'idle') {
        void captureFinalComparisonFrame();
      }
      if (autoSnapshotError && (printStatus === 'halted' || printStatus === 'pausing' || printStatus === 'cancelling')) {
        void captureSnapshot('Print issue snapshot');
      }
    }
  }, [autoSnapshotError, autoSnapshotFinish, autoSnapshotFirstLayer, captureFinalComparisonFrame, captureSnapshot, hasCamera, isPrintActive, printStatus]);

  useEffect(() => {
    if (!hasCamera || !autoSnapshotLayer || !isPrintActive || currentLayer === undefined) return;
    if (seenPrintLayersRef.current.has(currentLayer)) return;
    seenPrintLayersRef.current.add(currentLayer);
    void captureSnapshot(`Layer ${currentLayer} snapshot`);
  }, [autoSnapshotLayer, captureSnapshot, currentLayer, hasCamera, isPrintActive]);

  const selectClip = useCallback((clip: CameraClip) => {
    if (selectedClipUrlRef.current) {
      URL.revokeObjectURL(selectedClipUrlRef.current);
    }
    const url = URL.createObjectURL(clip.blob);
    selectedClipUrlRef.current = url;
    setSelectedClip(clip);
    setSelectedClipUrl(url);
  }, []);

  const downloadClip = useCallback((clip: CameraClip) => {
    const url = URL.createObjectURL(clip.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${clip.printerName.replace(/\s+/g, '-')}-camera-${clipKind(clip)}-${new Date(clip.createdAt).toISOString().replace(/[:.]/g, '-')}.${clipFileExtension(clip)}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, []);

  const exportVisibleClips = useCallback(() => {
    const exportedAt = new Date().toISOString();
    const manifest = visibleClips.map(clipManifest);
    visibleClips.forEach(downloadClip);
    const manifestBlob = new Blob([JSON.stringify({ exportedAt, clips: manifest }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(manifestBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `camera-clips-manifest-${exportedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [downloadClip, visibleClips]);

  const removeClip = useCallback(async (clip: CameraClip) => {
    const ok = window.confirm('Delete this saved camera clip from local browser storage? This cannot be undone.');
    if (!ok) return;
    setBusy(true);
    try {
      await deleteClip(clip.id);
      if (selectedClip?.id === clip.id) {
        if (selectedClipUrlRef.current) {
          URL.revokeObjectURL(selectedClipUrlRef.current);
          selectedClipUrlRef.current = null;
        }
        setSelectedClip(null);
        setSelectedClipUrl('');
      }
      await refreshClips();
      setMessage('Deleted saved clip.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete saved clip.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip?.id]);

  const removeVisibleClips = useCallback(async () => {
    if (visibleClips.length === 0) return;
    const ok = window.confirm(`Delete ${visibleClips.length} visible saved camera item${visibleClips.length === 1 ? '' : 's'} from local browser storage? This cannot be undone.`);
    if (!ok) return;
    setBusy(true);
    try {
      await Promise.all(visibleClips.map((clip) => deleteClip(clip.id)));
      if (selectedClip && visibleClips.some((clip) => clip.id === selectedClip.id)) {
        if (selectedClipUrlRef.current) {
          URL.revokeObjectURL(selectedClipUrlRef.current);
          selectedClipUrlRef.current = null;
        }
        setSelectedClip(null);
        setSelectedClipUrl('');
      }
      await refreshClips();
      setMessage('Deleted visible saved clips.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete saved clips.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip, visibleClips]);

  const saveSelectedClipDetails = useCallback(async () => {
    if (!selectedClip) return;
    const updated: CameraClip = {
      ...selectedClip,
      name: clipDraftName.trim() || undefined,
      notes: clipDraftNotes.trim() || undefined,
      kind: clipDraftKind,
      jobName: clipDraftJobName.trim() || undefined,
      album: clipDraftAlbum.trim() || undefined,
      rating: clipDraftRating === 'Unrated' ? undefined : clipDraftRating,
      checklist: clipDraftChecklist.length ? clipDraftChecklist : undefined,
      tags: clipDraftTags.split(',').map((tag) => tag.trim()).filter(Boolean),
      editedAt: Date.now(),
    };
    setBusy(true);
    try {
      await saveClip(updated);
      setSelectedClip(updated);
      await refreshClips();
      setMessage('Saved clip details.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save clip details.');
    } finally {
      setBusy(false);
    }
  }, [clipDraftAlbum, clipDraftChecklist, clipDraftJobName, clipDraftKind, clipDraftName, clipDraftNotes, clipDraftRating, clipDraftTags, refreshClips, selectedClip]);

  const toggleSelectedClipFavorite = useCallback(async () => {
    if (!selectedClip) return;
    const updated: CameraClip = {
      ...selectedClip,
      favorite: !selectedClip.favorite,
      editedAt: Date.now(),
    };
    setBusy(true);
    try {
      await saveClip(updated);
      setSelectedClip(updated);
      await refreshClips();
      setMessage(updated.favorite ? 'Added saved camera item to favorites.' : 'Removed saved camera item from favorites.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update favorite.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip]);

  const saveCameraPreset = useCallback(() => {
    const name = presetName.trim() || `Preset ${cameraPresets.length + 1}`;
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
    setPresetName('');
    setMessage(`Saved camera preset "${name}".`);
  }, [cameraPresets.length, flipImage, presetName, rotation, showCrosshair, showGrid, timelapseFps, timelapseIntervalSec]);

  const applyCameraPreset = useCallback((preset: CameraPreset) => {
    setShowGrid(preset.showGrid);
    setShowCrosshair(preset.showCrosshair);
    setFlipImage(preset.flipImage);
    setRotation(preset.rotation);
    setTimelapseIntervalSec(preset.timelapseIntervalSec);
    setTimelapseFps(preset.timelapseFps);
    setMessage(`Applied camera preset "${preset.name}".`);
  }, []);

  const deleteCameraPreset = useCallback((presetId: string) => {
    setCameraPresets((presets) => presets.filter((preset) => preset.id !== presetId));
  }, []);

  const updateActiveCamera = useCallback((patch: Partial<NonNullable<typeof activeCamera>>) => {
    if (!activeCamera) return;
    const nextCamera = { ...activeCamera, ...patch };
    updatePrinterPrefs(activePrinterId, {
      cameras: prefs.cameras.map((camera) => (camera.id === activeCamera.id ? nextCamera : camera)),
    });
  }, [activeCamera, activePrinterId, prefs.cameras, updatePrinterPrefs]);

  const setCameraQuality = useCallback((quality: DuetPrefs['webcamStreamPreference']) => {
    const nextCameras = activeCamera
      ? prefs.cameras.map((camera) => (
        camera.id === activeCamera.id
          ? { ...camera, streamPreference: quality }
          : camera
      ))
      : prefs.cameras;
    updatePrinterPrefs(activePrinterId, {
      webcamStreamPreference: quality,
      cameras: nextCameras,
    });
    setStreamRevision((value) => value + 1);
    setMessage(quality === 'main' && hdMainIsRtsp ? 'Starting automatic HD bridge...' : quality === 'main' ? 'Switched camera quality to HD.' : 'Switched camera quality to SD.');
  }, [activeCamera, activePrinterId, hdMainIsRtsp, prefs.cameras, updatePrinterPrefs]);

  const runPtzCommand = useCallback(async (direction: PtzDirection) => {
    if (!ptzEnabled) {
      setMessage('Enable PTZ controls before moving the camera.');
      return;
    }
    if (!activeCamera || !canUsePtz) {
      setMessage('Enable PTZ for this camera in Camera Settings before moving it.');
      return;
    }

    const request = buildPtzMoveRequest(activeCamera, config.hostname, direction, ptzSpeed);
    if (!request?.startUrl) {
      setMessage('Configure this camera PTZ provider or command template before using PTZ controls.');
      return;
    }

    try {
      await sendCameraCommand(request.startUrl, request.username, request.password);
      if (request.stopUrl) {
        window.setTimeout(() => {
          void sendCameraCommand(request.stopUrl ?? '', request.username, request.password);
        }, 260);
      }
      setMessage(`Sent PTZ ${direction.replace(/([A-Z])/g, ' $1').toLowerCase()} command.`);
    } catch {
      setMessage('Unable to send PTZ command. Check the camera settings and credentials.');
    }
  }, [activeCamera, canUsePtz, config.hostname, ptzEnabled, ptzSpeed]);

  const runPtzPreset = useCallback(async (preset: CameraPtzPreset, quiet = false) => {
    if (!activeCamera) return;
    const request = buildPtzPresetRequest(activeCamera, config.hostname, preset);
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
  }, [activeCamera, config.hostname]);

  const savePtzPreset = useCallback(() => {
    if (!activeCamera) return;
    const token = ptzPresetToken.trim();
    if (!token) {
      setMessage('Enter the camera preset slot/token to save.');
      return;
    }
    const name = ptzPresetName.trim() || `PTZ ${token}`;
    const preset: CameraPtzPreset = {
      id: `ptz-${Date.now()}`,
      name,
      token,
      createdAt: Date.now(),
    };
    updateActiveCamera({
      ptzPresets: [preset, ...activeCamera.ptzPresets.filter((item) => item.token !== token && item.name.toLowerCase() !== name.toLowerCase())].slice(0, 12),
    });
    setPtzPresetName('');
    setMessage(`Saved PTZ preset "${name}".`);
  }, [activeCamera, ptzPresetName, ptzPresetToken, updateActiveCamera]);

  const deletePtzPreset = useCallback((presetId: string) => {
    if (!activeCamera) return;
    updateActiveCamera({
      ptzPresets: activeCamera.ptzPresets.filter((preset) => preset.id !== presetId),
      ptzStartPresetId: activeCamera.ptzStartPresetId === presetId ? '' : activeCamera.ptzStartPresetId,
    });
  }, [activeCamera, updateActiveCamera]);

  useEffect(() => {
    const previous = previousPtzPrintStatusRef.current;
    previousPtzPrintStatusRef.current = printStatus;
    const becameActive = !previous || (previous !== 'processing' && previous !== 'simulating');
    if (isPrintActive && becameActive && activePtzStartPreset) {
      void runPtzPreset(activePtzStartPreset, true);
    }
  }, [activePtzStartPreset, isPrintActive, printStatus, runPtzPreset]);

  const applySelectedIssue = useCallback(async () => {
    if (!selectedClip) return;
    const issueTag = `issue:${issueDraft}`;
    const updated: CameraClip = {
      ...selectedClip,
      tags: Array.from(new Set([...(selectedClip.tags ?? []), issueTag])),
      editedAt: Date.now(),
    };
    setBusy(true);
    try {
      await saveClip(updated);
      setSelectedClip(updated);
      await refreshClips();
      setMessage(`Bookmarked selected media as ${issueDraft}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save issue bookmark.');
    } finally {
      setBusy(false);
    }
  }, [issueDraft, refreshClips, selectedClip]);

  const toggleInspectionItem = useCallback((item: string) => {
    setClipDraftChecklist((current) => (
      current.includes(item) ? current.filter((value) => value !== item) : [...current, item]
    ));
  }, []);

  const toggleBulkSelection = useCallback((clipId: string) => {
    setSelectedClipIds((current) => (
      current.includes(clipId) ? current.filter((id) => id !== clipId) : [...current, clipId]
    ));
  }, []);

  const generateJobReport = useCallback((clipsToReport: CameraClip[]) => {
    const reportClips = clipsToReport.length ? clipsToReport : timelineClips;
    const lines = [
      `# ${printerName} camera report`,
      '',
      `Generated: ${new Date().toLocaleString()}`,
      `Job: ${timelineJobName || 'Recent media'}`,
      `Items: ${reportClips.length}`,
      `Storage: ${formatBytes(reportClips.reduce((sum, clip) => sum + clip.size, 0))}`,
      '',
      '## Findings',
      ...reportClips.map((clip) => [
        `- ${new Date(clip.createdAt).toLocaleString()} - ${clipLabel(clip)}`,
        `  - Type: ${clipKind(clip)}`,
        `  - Rating: ${clip.rating ?? 'Unrated'}`,
        `  - Issues: ${clipIssueTags(clip).join(', ') || 'None'}`,
        `  - Checklist: ${(clip.checklist ?? []).join(', ') || 'None'}`,
        clip.notes ? `  - Notes: ${clip.notes}` : '',
        (clip.markers?.length ?? 0) > 0 ? `  - Markers: ${clip.markers?.map((marker) => `${marker.label} ${formatClipDuration(marker.atMs)}`).join('; ')}` : '',
      ].filter(Boolean).join('\n')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${printerName.replace(/\s+/g, '-')}-camera-report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage('Generated camera job report.');
  }, [printerName, timelineClips, timelineJobName]);

  const generateContactSheet = useCallback(async (clipsToUse: CameraClip[]) => {
    const snapshots = clipsToUse.filter((clip) => clipKind(clip) === 'snapshot');
    if (snapshots.length === 0) {
      setMessage('Select one or more snapshots before generating a contact sheet.');
      return;
    }
    setBusy(true);
    try {
      const cellWidth = 320;
      const cellHeight = 230;
      const columns = Math.min(3, snapshots.length);
      const rows = Math.ceil(snapshots.length / columns);
      const canvas = document.createElement('canvas');
      canvas.width = columns * cellWidth;
      canvas.height = rows * cellHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Contact sheet canvas is not available.');
      context.fillStyle = '#020617';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await Promise.all(snapshots.map(async (clip, index) => {
        const image = await imageFromBlob(clip.blob);
        const x = (index % columns) * cellWidth;
        const y = Math.floor(index / columns) * cellHeight;
        context.fillStyle = '#050505';
        context.fillRect(x + 10, y + 10, cellWidth - 20, cellHeight - 48);
        context.drawImage(image, x + 10, y + 10, cellWidth - 20, cellHeight - 48);
        context.fillStyle = '#fff';
        context.font = '700 14px system-ui, sans-serif';
        context.fillText(clipLabel(clip).slice(0, 34), x + 12, y + cellHeight - 22);
      }));
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Unable to save contact sheet.')), 'image/png');
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${printerName.replace(/\s+/g, '-')}-contact-sheet-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(`Generated contact sheet with ${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to generate contact sheet.');
    } finally {
      setBusy(false);
    }
  }, [printerName]);

  const exportClipBundle = useCallback(async (clipsToExport: CameraClip[]) => {
    if (clipsToExport.length === 0) return;
    setBusy(true);
    try {
      const entries: Record<string, Uint8Array> = {};
      await Promise.all(clipsToExport.map(async (clip, index) => {
        entries[`media/${clipExportName(clip, index)}`] = new Uint8Array(await clip.blob.arrayBuffer());
      }));
      entries['manifest.json'] = strToU8(JSON.stringify({
        exportedAt: new Date().toISOString(),
        printerId,
        printerName,
        clips: clipsToExport.map(clipManifest),
      }, null, 2));
      const zipped = zipSync(entries, { level: 6 });
      const zippedBuffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([zippedBuffer], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${printerName.replace(/\s+/g, '-')}-camera-bundle-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(`Exported ${clipsToExport.length} camera item${clipsToExport.length === 1 ? '' : 's'} as a bundle.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to export camera bundle.');
    } finally {
      setBusy(false);
    }
  }, [printerId, printerName]);

  const addSelectedClipMarker = useCallback(async () => {
    if (!selectedClip || clipKind(selectedClip) === 'snapshot') return;
    const marker: CameraMarker = {
      id: `${Date.now()}`,
      atMs: Math.max(0, Math.min(selectedClip.durationMs, parseClipDuration(markerDraftTime))),
      label: markerDraftLabel.trim() || `Marker ${(selectedClip.markers?.length ?? 0) + 1}`,
    };
    const updated: CameraClip = {
      ...selectedClip,
      markers: [...(selectedClip.markers ?? []), marker].sort((a, b) => a.atMs - b.atMs),
      editedAt: Date.now(),
    };
    setBusy(true);
    try {
      await saveClip(updated);
      setSelectedClip(updated);
      setMarkerDraftLabel('');
      setMarkerDraftTime(formatClipDuration(marker.atMs));
      await refreshClips();
      setMessage('Added marker to saved video.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to add marker.');
    } finally {
      setBusy(false);
    }
  }, [markerDraftLabel, markerDraftTime, refreshClips, selectedClip]);

  const removeSelectedClipMarker = useCallback(async (markerId: string) => {
    if (!selectedClip) return;
    const updated: CameraClip = {
      ...selectedClip,
      markers: (selectedClip.markers ?? []).filter((marker) => marker.id !== markerId),
      editedAt: Date.now(),
    };
    setBusy(true);
    try {
      await saveClip(updated);
      setSelectedClip(updated);
      await refreshClips();
      setMessage('Removed saved marker.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to remove marker.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip]);

  const saveTrimmedVideoCopy = useCallback(async () => {
    if (!selectedClip || clipKind(selectedClip) === 'snapshot') return;
    const startMs = Math.max(0, parseClipDuration(trimStart));
    const endMs = trimEnd.trim() ? parseClipDuration(trimEnd) : selectedClip.durationMs;
    if (endMs <= startMs) {
      setMessage('Trim end must be after trim start.');
      return;
    }
    const updated: CameraClip = {
      ...selectedClip,
      id: `${selectedClip.id}-trim-${Date.now()}`,
      name: `${clipLabel(selectedClip)} trim`,
      trimStartMs: startMs,
      trimEndMs: Math.min(endMs, selectedClip.durationMs),
      durationMs: Math.min(endMs, selectedClip.durationMs) - startMs,
      tags: Array.from(new Set([...(selectedClip.tags ?? []), 'trimmed'])),
      editedAt: Date.now(),
    };
    setBusy(true);
    try {
      await saveClip(updated);
      await refreshClips();
      setMessage('Saved trimmed video reference. Export includes trim metadata for the selected segment.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save trimmed video.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip, trimEnd, trimStart]);

  const makeTimelapseCopy = useCallback(async () => {
    if (!selectedClip || clipKind(selectedClip) === 'snapshot') return;
    const updated: CameraClip = {
      ...selectedClip,
      id: `${selectedClip.id}-timelapse-${Date.now()}`,
      name: `${clipLabel(selectedClip)} timelapse`,
      kind: 'timelapse',
      tags: Array.from(new Set([...(selectedClip.tags ?? []), 'timelapse'])),
      editedAt: Date.now(),
    };
    setBusy(true);
    try {
      await saveClip(updated);
      await refreshClips();
      setMessage('Saved timelapse version.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save timelapse version.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip]);

  const trimBetweenFirstTwoMarkers = useCallback(async () => {
    if (!selectedClip || clipKind(selectedClip) === 'snapshot') return;
    const markers = [...(selectedClip.markers ?? [])].sort((a, b) => a.atMs - b.atMs);
    if (markers.length < 2) {
      setMessage('Add at least two markers before trimming marker-to-marker.');
      return;
    }
    setTrimStart(formatClipDuration(markers[0].atMs));
    setTrimEnd(formatClipDuration(markers[1].atMs));
    setMessage(`Prepared trim from ${markers[0].label} to ${markers[1].label}.`);
  }, [selectedClip]);

  const applyBulkTags = useCallback(async () => {
    if (visibleClips.length === 0) return;
    const tags = bulkTags.split(',').map((tag) => tag.trim()).filter(Boolean);
    setBusy(true);
    try {
      await Promise.all(visibleClips.map((clip) => saveClip({
        ...clip,
        album: bulkAlbum.trim() || clip.album,
        tags: Array.from(new Set([...(clip.tags ?? []), ...tags])),
        editedAt: Date.now(),
      })));
      await refreshClips();
      setMessage('Updated visible camera items.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update visible camera items.');
    } finally {
      setBusy(false);
    }
  }, [bulkAlbum, bulkTags, refreshClips, visibleClips]);

  const cleanupOldClips = useCallback(async () => {
    const cutoff = Date.now() - cleanupDays * 24 * 60 * 60 * 1000;
    const targets = clips.filter((clip) => !clip.favorite && clip.createdAt < cutoff);
    if (targets.length === 0) {
      setMessage('No non-favorite saved camera items match the cleanup rule.');
      return;
    }
    const ok = window.confirm(`Delete ${targets.length} non-favorite camera item${targets.length === 1 ? '' : 's'} older than ${cleanupDays} days? This cannot be undone.`);
    if (!ok) return;
    setBusy(true);
    try {
      await Promise.all(targets.map((clip) => deleteClip(clip.id)));
      await refreshClips();
      setMessage('Cleaned up old saved camera items.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to clean up saved camera items.');
    } finally {
      setBusy(false);
    }
  }, [cleanupDays, clips, refreshClips]);

  const saveSnapshotEdits = useCallback(async () => {
    if (!selectedClip || clipKind(selectedClip) !== 'snapshot') return;
    const cropChanged = snapshotCrop.x !== 0 || snapshotCrop.y !== 0 || snapshotCrop.width !== 1 || snapshotCrop.height !== 1;
    const hasAdjustments = snapshotBrightness !== 100 || snapshotContrast !== 100 || snapshotSharpen > 0 || Boolean(snapshotAnnotation.trim());
    if (!snapshotEditFlip && snapshotEditRotation === 0 && !cropChanged && !hasAdjustments) {
      setMessage('No snapshot edits to save.');
      return;
    }
    setBusy(true);
    try {
      const blob = await transformSnapshotBlob(
        selectedClip.blob,
        snapshotEditRotation,
        snapshotEditFlip,
        snapshotCrop,
        snapshotBrightness,
        snapshotContrast,
        snapshotSharpen,
        snapshotAnnotation,
      );
      const now = Date.now();
      const updated: CameraClip = {
        ...selectedClip,
        id: saveSnapshotAsCopy ? `${selectedClip.id}-edit-${now}` : selectedClip.id,
        name: saveSnapshotAsCopy ? `${clipLabel(selectedClip)} edit` : selectedClip.name,
        blob,
        thumbnailBlob: blob,
        mimeType: blob.type || 'image/png',
        size: blob.size,
        snapshotAdjustments: {
          brightness: snapshotBrightness,
          contrast: snapshotContrast,
          sharpen: snapshotSharpen,
          crop: snapshotCrop,
          annotation: snapshotAnnotation.trim(),
        },
        editedAt: now,
      };
      await saveClip(updated);
      if (selectedClipUrlRef.current) {
        URL.revokeObjectURL(selectedClipUrlRef.current);
      }
      const url = URL.createObjectURL(updated.blob);
      selectedClipUrlRef.current = url;
      setSelectedClip(updated);
      setSelectedClipUrl(url);
      setSnapshotEditFlip(false);
      setSnapshotEditRotation(0);
      setSnapshotCrop(defaultCrop());
      setSnapshotBrightness(100);
      setSnapshotContrast(100);
      setSnapshotSharpen(0);
      setSnapshotAnnotation('');
      await refreshClips();
      setMessage(saveSnapshotAsCopy ? 'Saved edited snapshot as a copy.' : 'Saved edited snapshot.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save edited snapshot.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, saveSnapshotAsCopy, selectedClip, snapshotAnnotation, snapshotBrightness, snapshotContrast, snapshotCrop, snapshotEditFlip, snapshotEditRotation, snapshotSharpen]);

  const addMarker = useCallback(() => {
    if (!recording) return;
    const atMs = Date.now() - startedAtRef.current;
    const marker: CameraMarker = {
      id: `${Date.now()}`,
      atMs,
      label: `Marker ${recordingMarkersRef.current.length + 1}`,
    };
    recordingMarkersRef.current = [...recordingMarkersRef.current, marker];
    if (backendRecordingRef.current) {
      backendRecordingRef.current = {
        ...backendRecordingRef.current,
        markers: recordingMarkersRef.current,
      };
      window.sessionStorage.setItem(backendRecordingStorageKey(printerId), JSON.stringify({
        id: backendRecordingRef.current.id,
        kind: backendRecordingRef.current.kind,
        jobName: backendRecordingRef.current.jobName,
        markers: backendRecordingRef.current.markers,
        startedAt: backendRecordingRef.current.startedAt,
      }));
    }
    setMessage(`Added marker at ${formatClipDuration(atMs)}.`);
    captureAnomaly(`manual marker ${formatClipDuration(atMs)}`);
  }, [captureAnomaly, printerId, recording]);

  const reconnectCamera = useCallback(() => {
    setImageFailed(false);
    setWebRtcFailed(false);
    setLastFrameAt(null);
    reconnectHistoryRef.current = [...reconnectHistoryRef.current, Date.now()].slice(-10);
    setReconnectCount((value) => value + 1);
    setStreamRevision((value) => value + 1);
    setMessage('Reconnecting camera stream...');
    captureAnomaly('camera reconnect');
  }, [captureAnomaly]);

  const handleCameraError = useCallback(() => {
    if (prefs.webcamStreamPreference === 'main') {
      updatePrinterPrefs(activePrinterId, { webcamStreamPreference: 'sub' });
      setStreamRevision((value) => value + 1);
      setMessage('HD stream unavailable, falling back to SD.');
      return;
    }
    setImageFailed(true);
  }, [activePrinterId, prefs.webcamStreamPreference, updatePrinterPrefs]);

  useEffect(() => {
    if (!isVideoStream || !videoRef.current || !streamSrc) return undefined;
    const video = videoRef.current;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    if (isBrowserUsbCamera) return undefined;
    if (useWebRtcStream) {
      void connectWhepVideoStream(video, {
        url: streamSrc,
        iceServersText: activeCamera?.webRtcIceServers ?? '',
        onConnected: () => setLastFrameAt(Date.now()),
      }).then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        cleanup = dispose;
      }).catch(() => {
        if (!disposed) {
          setWebRtcFailed(true);
          setMessage('WebRTC camera connection failed; falling back to MJPEG/HLS.');
        }
      });
      return () => {
        disposed = true;
        cleanup?.();
        video.srcObject = null;
      };
    }
    if (prefs.webcamMainStreamProtocol === 'hls' || streamSrc.startsWith('/camera-rtsp-hls')) {
      void import('hls.js').then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          video.src = streamSrc;
          cleanup = () => {
            video.removeAttribute('src');
            video.load();
          };
          return;
        }
        const hls = new Hls({ lowLatencyMode: true });
        hls.loadSource(streamSrc);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) handleCameraError();
        });
        cleanup = () => hls.destroy();
      }).catch(handleCameraError);
      return () => {
        disposed = true;
        cleanup?.();
      };
    }

    video.src = streamSrc;
    return () => {
      disposed = true;
      cleanup?.();
      if (!cleanup) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [activeCamera?.webRtcIceServers, handleCameraError, isBrowserUsbCamera, isVideoStream, prefs.webcamMainStreamProtocol, streamSrc, useWebRtcStream]);

  const handleFrameLoad = useCallback(() => {
    const frame = frameRef.current;
    if (frame) {
      const media = isVideoStream ? videoRef.current : imgRef.current;
      const nextViewport = measureContainedMedia(frame, media);
      setMediaViewport((current) => sameMediaViewport(current, nextViewport) ? current : nextViewport);
    }
    const now = Date.now();
    setLastFrameAt((previous) => {
      if (previous) setLastFrameIntervalMs(now - previous);
      return now;
    });
    setFrameCount((value) => value + 1);
  }, [isVideoStream]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const update = () => {
      const media = isVideoStream ? videoRef.current : imgRef.current;
      const nextViewport = measureContainedMedia(frame, media);
      setMediaViewport((current) => sameMediaViewport(current, nextViewport) ? current : nextViewport);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    const media = isVideoStream ? videoRef.current : imgRef.current;
    if (media) observer.observe(media);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [isVideoStream, streamSrc]);

  const bedWidthMm = calibration.bedWidthMm ?? 220;
  const bedDepthMm = calibration.bedDepthMm ?? 220;
  const currentPoseSignature = poseFrameSignature(activeCamera?.id ?? prefs.activeCameraId, rotation, flipImage);
  const homography = useMemo(
    () => solveCameraHomography(calibration.bedCorners, bedWidthMm, bedDepthMm),
    [bedDepthMm, bedWidthMm, calibration.bedCorners],
  );
  const measuredDistanceMm = useMemo(
    () => distanceBetweenImagePointsMm(calibration.measureA, calibration.measureB, homography),
    [calibration.measureA, calibration.measureB, homography],
  );
  const completeBedCorners = hasCompleteBedCorners(calibration.bedCorners) ? calibration.bedCorners : null;
  const bedCornersComplete = completeBedCorners !== null;
  const poseStatus = useMemo(
    () => assessPoseCalibration(calibration.pose, calibration.bedCorners, currentPoseSignature),
    [calibration.bedCorners, calibration.pose, currentPoseSignature],
  );
  const nextBedCorner = BED_CORNER_SEQUENCE[nextBedCornerIndex] ?? BED_CORNER_SEQUENCE[0];
  const measurementStatus = measurementMode === 'bed'
    ? `Pick ${nextBedCorner.label.toLowerCase()} corner`
    : measurementMode === 'ruler'
      ? calibration.measureA && !calibration.measureB
        ? 'Pick endpoint B'
        : 'Pick endpoint A'
      : bedCornersComplete
        ? 'Homography ready'
        : 'Bed corners not calibrated';

  const pointFromFramePointer = useCallback((event: PointerEvent<HTMLElement>) => {
    const frame = frameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const mediaLeft = rect.left + (mediaViewport.left / 100) * rect.width;
    const mediaTop = rect.top + (mediaViewport.top / 100) * rect.height;
    const mediaWidth = (mediaViewport.width / 100) * rect.width;
    const mediaHeight = (mediaViewport.height / 100) * rect.height;
    if (!mediaWidth || !mediaHeight) return null;
    return {
      x: clampPercent(((event.clientX - mediaLeft) / mediaWidth) * 100),
      y: clampPercent(((event.clientY - mediaTop) / mediaHeight) * 100),
    };
  }, [mediaViewport]);

  const handleMeasurementPoint = useCallback((point: ImagePoint) => {
    if (measurementMode === 'off') return;

    if (measurementMode === 'bed') {
      const corner = BED_CORNER_SEQUENCE[nextBedCornerIndex] ?? BED_CORNER_SEQUENCE[0];
      setCalibration((value) => ({
        ...value,
        bedCorners: {
          ...(value.bedCorners ?? {}),
          [corner.key]: point,
        },
      }));
      setNextBedCornerIndex((index) => {
        const nextIndex = (index + 1) % BED_CORNER_SEQUENCE.length;
        if (nextIndex === 0) {
          setMeasurementMode('off');
          setMessage('Bed corners picked. Save pose when the overlay matches the frozen frame.');
        }
        return nextIndex;
      });
      return;
    }

    setCalibration((value) => {
      if (!value.measureA || value.measureB) {
        return { ...value, measureA: point, measureB: undefined };
      }
      return { ...value, measureB: point };
    });
  }, [measurementMode, nextBedCornerIndex]);

  const handleMeasurementPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (measurementMode === 'off') return;
    if (event.target !== event.currentTarget) return;
    const point = pointFromFramePointer(event);
    if (!point) return;
    event.preventDefault();
    handleMeasurementPoint(point);
  }, [handleMeasurementPoint, measurementMode, pointFromFramePointer]);

  const updateBedCornerPoint = useCallback((corner: BedCornerKey, point: ImagePoint) => {
    setCalibration((value) => ({
      ...value,
      bedCorners: {
        ...(value.bedCorners ?? {}),
        [corner]: point,
      },
      pose: undefined,
    }));
  }, []);

  const handleCornerPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>, corner: BedCornerKey) => {
    const point = pointFromFramePointer(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingBedCorner(corner);
    updateBedCornerPoint(corner, point);
  }, [pointFromFramePointer, updateBedCornerPoint]);

  const handleCornerPointerMove = useCallback((event: PointerEvent<HTMLButtonElement>, corner: BedCornerKey) => {
    if (draggingBedCorner !== corner) return;
    const point = pointFromFramePointer(event);
    if (!point) return;
    event.preventDefault();
    updateBedCornerPoint(corner, point);
  }, [draggingBedCorner, pointFromFramePointer, updateBedCornerPoint]);

  const handleCornerPointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (draggingBedCorner === null) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingBedCorner(null);
    setMessage('Adjusted bed corner. Save pose when the overlay matches the camera frame.');
  }, [draggingBedCorner]);

  const savePoseCalibration = useCallback(() => {
    const pose = solveCameraPoseCalibration(calibration.bedCorners, bedWidthMm, bedDepthMm, currentPoseSignature);
    if (!pose) {
      setMessage('Pick all four bed corners before saving AR pose.');
      return;
    }
    setCalibration((value) => ({ ...value, pose }));
    setPoseStillUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return '';
    });
    setMeasurementMode('off');
    setMessage(`Saved AR camera pose (${Math.round(pose.qualityScore * 100)}% quality).`);
  }, [bedDepthMm, bedWidthMm, calibration.bedCorners, currentPoseSignature]);

  const clearPoseStill = useCallback(() => {
    setPoseStillUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return '';
    });
    setMeasurementMode('off');
  }, []);

  const frameClassName = [
    'cam-panel__frame',
    showGrid ? 'cam-panel__frame--grid' : '',
    showCrosshair ? 'cam-panel__frame--crosshair' : '',
    measurementMode !== 'off' ? 'cam-panel__frame--measuring' : '',
    cameraOverlayMode === 'print' ? 'cam-panel__frame--ar-print-only' : '',
  ].filter(Boolean).join(' ');
  const imageStyle = {
    transform: `scaleX(${flipImage ? -1 : 1}) rotate(${rotation}deg)`,
  };
  const calibrationStyle = {
    '--cal-x': `${calibration.x}%`,
    '--cal-y': `${calibration.y}%`,
    '--cal-w': `${calibration.width}%`,
    '--cal-h': `${calibration.height}%`,
  } as CSSProperties;
  const mediaViewportStyle = {
    '--media-left': `${mediaViewport.left}%`,
    '--media-top': `${mediaViewport.top}%`,
    '--media-width': `${mediaViewport.width}%`,
    '--media-height': `${mediaViewport.height}%`,
  } as CSSProperties;
  const overlayModeOptions: Array<{ mode: CameraOverlayMode; label: string; hint: string }> = [
    { mode: 'camera', label: 'Camera', hint: 'Live camera only' },
    { mode: 'both', label: 'AR', hint: 'Camera with aligned print preview' },
    { mode: 'print', label: 'Preview', hint: 'Print preview overlay with camera dimmed' },
  ];
  const showViewTools = !compact && (
    measurementMode !== 'off' || calibration.enabled || bedCornersComplete || calibration.measureA || cameraOverlayMode !== 'camera'
  );

  return (
    <div className={`cam-panel${compact ? ' cam-panel--compact' : ''}`}>
      <div className="cam-panel__layout">
        <div className="cam-panel__workspace">
          <div className="cam-panel__topbar">
            <div className="cam-panel__status-block">
              <span className={`cam-panel__status-dot${hasCamera && !imageFailed ? ' is-online' : ''}`} />
              <div>
                <strong>{hasCamera ? printerName : 'Camera not configured'}</strong>
                <span>{message || (hasCamera ? 'MJPEG dashboard stream ready.' : 'Add a camera stream in settings to enable capture.')}</span>
              </div>
            </div>
            <div className="cam-panel__top-actions">
              <button className="cam-panel__button" type="button" disabled={!hasCamera} onClick={reconnectCamera}>
                <RefreshCcw size={13} /> Reconnect
              </button>
              {compact ? (
                <button className="cam-panel__button" type="button" onClick={() => setActiveTab('camera')}>
                  <Camera size={13} /> Open Camera
                </button>
              ) : (
                <>
                  <button className="cam-panel__button" type="button" disabled={!hasCamera} onClick={() => setFullscreen(true)}>
                    <Maximize2 size={13} /> Fullscreen
                  </button>
                  <button className="cam-panel__button" type="button" onClick={() => setActiveTab('settings')}>
                    <Settings size={13} /> Camera Settings
                  </button>
                </>
              )}
            </div>
          </div>

          {cameras.length > 1 && (
            <div className="cam-panel__camera-tabs" aria-label="Camera streams">
              {cameras.map((camera) => (
                <button
                  key={camera.id}
                  className={`cam-panel__button${camera.id === prefs.activeCameraId ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => {
                    updatePrinterPrefs(activePrinterId, { activeCameraId: camera.id });
                    setStreamRevision((value) => value + 1);
                    setImageFailed(false);
                    setWebRtcFailed(false);
                    setMessage(`Switched to ${camera.label}.`);
                  }}
                >
                  <Camera size={13} /> {camera.label}
                  <small>{camera.resolution}</small>
                </button>
              ))}
            </div>
          )}

          <div className="cam-panel__viewer">
            <div ref={frameRef} className={frameClassName}>
              {hasCamera ? (
                <>
                  {poseStillUrl || finalComparisonUrl ? (
                    <img src={poseStillUrl || finalComparisonUrl} alt={`${printerName} frozen camera frame`} style={imageStyle} />
                  ) : isVideoStream ? (
                    <video
                      ref={videoRef}
                      className="cam-panel__video"
                      muted
                      playsInline
                      autoPlay
                      controls={!isBrowserUsbCamera}
                      style={imageStyle}
                      onLoadedData={handleFrameLoad}
                      onPlaying={handleFrameLoad}
                      onError={handleCameraError}
                    />
                  ) : (
                    <img
                      ref={imgRef}
                      src={streamSrc}
                      alt={`${printerName} camera stream`}
                      style={imageStyle}
                      onLoad={handleFrameLoad}
                      onError={handleCameraError}
                    />
                  )}
                  {recording && (
                    <div className="cam-panel__recording">
                      <span className="cam-panel__recording-dot" />
                      {isTimelapseRecording ? 'TIMELAPSE' : isAutoRecording ? 'AUTO REC' : 'REC'} {formatClipDuration(elapsedMs)}
                    </div>
                  )}
                  <div className="cam-panel__health">{formatLastFrame(lastFrameAt, nowTick)}</div>
                  <div className="cam-panel__media-viewport" style={mediaViewportStyle}>
                    {calibration.enabled && <div className="cam-panel__calibration" style={calibrationStyle} />}
                    <CameraOverlayPanel pose={calibration.pose} mode={cameraOverlayMode} frameTick={frameCount} comparison={Boolean(finalComparisonUrl)} />
                    <div
                      className={`cam-panel__measurement-layer${measurementMode !== 'off' ? ' is-picking' : ''}`}
                      onPointerDown={handleMeasurementPointerDown}
                    >
                      {bedCornersComplete && (
                        <svg className="cam-panel__measurement-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                          <polygon
                            points={[
                              completeBedCorners.frontLeft,
                              completeBedCorners.frontRight,
                              completeBedCorners.backRight,
                              completeBedCorners.backLeft,
                            ].map((point) => `${point.x},${point.y}`).join(' ')}
                            className="cam-panel__bed-polygon"
                          />
                        </svg>
                      )}
                      {calibration.bedCorners && BED_CORNER_SEQUENCE.map(({ key, label }) => {
                        const point = calibration.bedCorners?.[key];
                        if (!point) return null;
                        return (
                          <button
                            type="button"
                            key={key}
                            className={`cam-panel__measure-point cam-panel__measure-point--corner${draggingBedCorner === key ? ' is-dragging' : ''}`}
                            style={{ left: `${point.x}%`, top: `${point.y}%` }}
                            onPointerDown={(event) => handleCornerPointerDown(event, key)}
                            onPointerMove={(event) => handleCornerPointerMove(event, key)}
                            onPointerUp={handleCornerPointerUp}
                            onPointerCancel={handleCornerPointerUp}
                            aria-label={`Drag ${label.toLowerCase()} bed corner`}
                          >
                            {label.slice(0, 1)}
                          </button>
                        );
                      })}
                      {calibration.measureA && calibration.measureB && (
                        <svg className="cam-panel__measurement-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                          <line
                            x1={calibration.measureA.x}
                            y1={calibration.measureA.y}
                            x2={calibration.measureB.x}
                            y2={calibration.measureB.y}
                            className="cam-panel__ruler-line"
                          />
                        </svg>
                      )}
                      {calibration.measureA && (
                        <span className="cam-panel__measure-point" style={{ left: `${calibration.measureA.x}%`, top: `${calibration.measureA.y}%` }}>
                          A
                        </span>
                      )}
                      {calibration.measureB && (
                        <span className="cam-panel__measure-point" style={{ left: `${calibration.measureB.x}%`, top: `${calibration.measureB.y}%` }}>
                          B
                        </span>
                      )}
                      {(measurementMode !== 'off' || calibration.measureA || bedCornersComplete) && (
                        <span className="cam-panel__measure-distance">
                          {calibration.measureA && calibration.measureB ? formatMeasurementDistance(measuredDistanceMm) : measurementStatus}
                        </span>
                      )}
                    </div>
                    {poseStillUrl && (
                      <span className="cam-panel__pose-freeze">Frozen pose frame</span>
                    )}
                    {finalComparisonUrl && (
                      <span className="cam-panel__pose-freeze">Post-print comparison</span>
                    )}
                  </div>
                </>
              ) : (
                <div className="cam-panel__empty">
                  <Camera size={28} />
                  <strong>{displayUrl ? 'Camera stream unavailable' : 'No camera stream configured'}</strong>
                  <span>Open camera settings to add an MJPEG sub stream for live dashboard preview and recording.</span>
                </div>
              )}
            </div>

            {(showViewTools || compact) && (
              <section className={`cam-panel__view-tools${compact ? ' cam-panel__view-tools--compact' : ''}`} aria-label="Camera view and calibration tools">
                <div className="cam-panel__view-mode" role="group" aria-label="Camera overlay mode">
                  {overlayModeOptions.map(({ mode, label, hint }) => (
                    <button
                      key={mode}
                      className={`cam-panel__button ${cameraOverlayMode === mode ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setCameraOverlayMode(mode)}
                      title={hint}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {!compact && measurementMode !== 'off' && (
                  <div className="cam-panel__view-status">
                    <Crosshair size={13} />
                    <span>{measurementStatus}</span>
                  </div>
                )}
                {!compact && (measurementMode !== 'off' || bedCornersComplete || calibration.measureA) && (
                  <div className="cam-panel__view-actions">
                    <button
                      className={`cam-panel__button ${measurementMode === 'bed' ? 'is-active' : ''}`}
                      type="button"
                      disabled={!hasCamera}
                      onClick={() => {
                        setMeasurementMode((mode) => mode === 'bed' ? 'off' : 'bed');
                        setNextBedCornerIndex(0);
                      }}
                    >
                      <Crosshair size={13} /> Pick corners
                    </button>
                    <button className="cam-panel__button" type="button" disabled={!bedCornersComplete || !homography} onClick={savePoseCalibration}>
                      <Save size={13} /> Save pose
                    </button>
                    <button
                      className={`cam-panel__button ${measurementMode === 'ruler' ? 'is-active' : ''}`}
                      type="button"
                      disabled={!hasCamera || !bedCornersComplete}
                      onClick={() => setMeasurementMode((mode) => mode === 'ruler' ? 'off' : 'ruler')}
                    >
                      <Ruler size={13} /> Ruler
                    </button>
                    <button
                      className="cam-panel__button cam-panel__button--danger"
                      type="button"
                      onClick={() => {
                        setCalibration((value) => ({ ...value, bedCorners: undefined, measureA: undefined, measureB: undefined, pose: undefined }));
                        setMeasurementMode('off');
                        setNextBedCornerIndex(0);
                      }}
                    >
                      <Trash2 size={13} /> Clear bed
                    </button>
                  </div>
                )}
                {!compact && calibration.enabled && (
                  <div className="cam-panel__view-calibration">
                    <label>X<input type="range" min={0} max={80} value={calibration.x} onChange={(event) => setCalibration((value) => ({ ...value, x: Number(event.target.value) }))} /></label>
                    <label>Y<input type="range" min={0} max={80} value={calibration.y} onChange={(event) => setCalibration((value) => ({ ...value, y: Number(event.target.value) }))} /></label>
                    <label>W<input type="range" min={10} max={100} value={calibration.width} onChange={(event) => setCalibration((value) => ({ ...value, width: Number(event.target.value) }))} /></label>
                    <label>H<input type="range" min={10} max={100} value={calibration.height} onChange={(event) => setCalibration((value) => ({ ...value, height: Number(event.target.value) }))} /></label>
                  </div>
                )}
              </section>
            )}

            <canvas ref={canvasRef} className="cam-panel__hidden-canvas" />
          </div>

          <div className="cam-panel__record-strip" aria-label="Current camera capture status">
            <span className={`cam-panel__record-chip${recording ? ' is-recording' : ''}`}>
              {recordingStatusLabel}
            </span>
            <span>{jobFileName || 'No active job'}</span>
            <span>{recordingMarkerCount} marker{recordingMarkerCount === 1 ? '' : 's'}</span>
            <span>{formatBytes(totalStorageBytes)} saved locally</span>
          </div>

          {!compact && <div className="cam-panel__recent-strip" aria-label="Recent camera captures">
            <div className="cam-panel__recent-title">
              <FolderOpen size={13} />
              <span>Recent Captures</span>
            </div>
            {recentClips.length === 0 ? (
              <span className="cam-panel__recent-empty">No captures yet</span>
            ) : recentClips.map((clip) => (
              <button
                key={clip.id}
                className={`cam-panel__recent-item${selectedClip?.id === clip.id ? ' is-selected' : ''}`}
                type="button"
                onClick={() => {
                  selectClip(clip);
                  setEditorCollapsed(false);
                }}
              >
                <span className="cam-panel__recent-thumb">
                  {thumbUrls[clip.id] ? <img src={thumbUrls[clip.id]} alt="" /> : clipKind(clip) === 'snapshot' ? <Image size={13} /> : <Video size={13} />}
                </span>
                <span>{clipLabel(clip)}</span>
              </button>
            ))}
          </div>}

          {!compact && <div className={`cam-panel__bottom-panel${editorCollapsed ? ' is-collapsed' : ''}`} aria-label="Selected saved camera media">
            <div className="cam-panel__bottom-head">
              <div>
                <strong>{selectedClip ? clipLabel(selectedClip) : 'Media Editor'}</strong>
                <span>{selectedClip ? `${new Date(selectedClip.createdAt).toLocaleString()} - ${formatBytes(selectedClip.size)}` : 'Select a saved item or create a new recording.'}</span>
              </div>
              <button className="cam-panel__button cam-panel__button--compact" type="button" onClick={() => setEditorCollapsed((value) => !value)}>
                {editorCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {editorCollapsed ? 'Expand' : 'Collapse'}
              </button>
            </div>
            {!editorCollapsed && (
            <>
            {selectedClip && selectedClipUrl ? (
              <>
                <div className="cam-panel__selected-meta">
                  {selectedKind && <span>{selectedKind}</span>}
                  {selectedClip.favorite && <span>Favorite</span>}
                  {selectedClip.album && <span>{selectedClip.album}</span>}
                  {selectedClip.jobName && <span>{selectedClip.jobName}</span>}
                </div>
                <div className="cam-panel__bottom-preview">
                  {clipKind(selectedClip) === 'snapshot' ? (
                    <img
                      className="cam-panel__clip-player"
                      src={selectedClipUrl}
                      alt="Saved camera snapshot"
                      style={{
                        filter: `brightness(${snapshotBrightness}%) contrast(${snapshotContrast}%)`,
                        transform: `scaleX(${snapshotEditFlip ? -1 : 1}) rotate(${snapshotEditRotation}deg)`,
                      }}
                    />
                  ) : (
                    <video className="cam-panel__clip-player" src={selectedClipUrl} controls />
                  )}
                  {clipKind(selectedClip) === 'snapshot' && compareClip && compareClipUrl && (
                    <div className="cam-panel__compare">
                      <div>
                        <span>Selected</span>
                        <img src={selectedClipUrl} alt="Selected snapshot comparison" />
                      </div>
                      <div>
                        <span>Compare</span>
                        <img src={compareClipUrl} alt="Comparison snapshot" />
                      </div>
                      <select className="cam-panel__input" value={compareClip?.id ?? ''} onChange={(event) => setCompareClipId(event.target.value)}>
                        {snapshotClips.filter((clip) => clip.id !== selectedClip.id).map((clip) => (
                          <option key={clip.id} value={clip.id}>{clipLabel(clip)} - {new Date(clip.createdAt).toLocaleDateString()}</option>
                        ))}
                      </select>
                      <div className="cam-panel__compare-scrub" style={{ '--compare-blend': `${compareBlend}%` } as CSSProperties}>
                        <img src={compareClipUrl} alt="Comparison base" />
                        <img src={selectedClipUrl} alt="Selected overlay" />
                      </div>
                      <label className="cam-panel__compare-slider">
                        Swipe compare
                        <input type="range" min={0} max={100} value={compareBlend} onChange={(event) => setCompareBlend(Number(event.target.value))} />
                      </label>
                    </div>
                  )}
                </div>

                <div className="cam-panel__bottom-edit">
                  <div className="cam-panel__section-head">
                    <span><Crop size={14} /> Edit Selected</span>
                    <small>{clipKind(selectedClip)} - {formatBytes(selectedClip.size)}</small>
                  </div>
                  <div className="cam-panel__clip-actions">
                    <button className="cam-panel__button" type="button" onClick={() => downloadClip(selectedClip)}>
                      <Download size={13} /> Download
                    </button>
                    <button className={`cam-panel__button ${selectedClip.favorite ? 'is-active' : ''}`} type="button" onClick={() => { void toggleSelectedClipFavorite(); }}>
                      <Star size={13} /> {selectedClip.favorite ? 'Favorited' : 'Favorite'}
                    </button>
                    <button className="cam-panel__button" type="button" onClick={() => selectClip(selectedClip)}>
                      <Play size={13} /> Reload
                    </button>
                    <button className="cam-panel__button" type="button" onClick={() => { void saveSelectedClipDetails(); }}>
                      <Save size={13} /> Save Details
                    </button>
                    <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void exportClipBundle([selectedClip]); }}>
                      <Archive size={13} /> Bundle
                    </button>
                    <button className="cam-panel__button cam-panel__button--danger" type="button" onClick={() => { void removeClip(selectedClip); }}>
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                  <div className="cam-panel__detail">
                    <input className="cam-panel__input" value={clipDraftName} placeholder="Clip name" onChange={(event) => setClipDraftName(event.target.value)} />
                    <select className="cam-panel__input" value={clipDraftKind} onChange={(event) => setClipDraftKind(event.target.value as CameraClipKind)}>
                      <option value="clip">Video clip</option>
                      <option value="snapshot">Snapshot</option>
                      <option value="timelapse">Timelapse</option>
                      <option value="auto">Auto recording</option>
                    </select>
                    <input className="cam-panel__input" value={clipDraftJobName} placeholder="Job name" onChange={(event) => setClipDraftJobName(event.target.value)} />
                    <input className="cam-panel__input" value={clipDraftAlbum} placeholder="Album" list="camera-albums" onChange={(event) => setClipDraftAlbum(event.target.value)} />
                    <input className="cam-panel__input" value={clipDraftTags} placeholder="Tags, comma separated" onChange={(event) => setClipDraftTags(event.target.value)} />
                    <select className="cam-panel__input" value={clipDraftRating} onChange={(event) => setClipDraftRating(event.target.value as ClipRating)}>
                      {CLIP_RATINGS.map((rating) => <option key={rating} value={rating}>{rating}</option>)}
                    </select>
                    <textarea className="cam-panel__input" value={clipDraftNotes} placeholder="Notes" onChange={(event) => setClipDraftNotes(event.target.value)} />
                  </div>
                  <div className="cam-panel__checklist">
                    {INSPECTION_ITEMS.map((item) => (
                      <label key={item} className="cam-panel__toggle">
                        <input
                          type="checkbox"
                          checked={clipDraftChecklist.includes(item)}
                          onChange={() => toggleInspectionItem(item)}
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>
                  <div className="cam-panel__issue-tools">
                    <select className="cam-panel__input" value={issueDraft} onChange={(event) => setIssueDraft(event.target.value as IssueTag)}>
                      {ISSUE_TAGS.map((issue) => <option key={issue} value={issue}>{issue}</option>)}
                    </select>
                    <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void applySelectedIssue(); }}>
                      <Flag size={13} /> Bookmark Issue
                    </button>
                    {clipIssueTags(selectedClip).map((issue) => <span key={issue}>{issue}</span>)}
                  </div>
                  {clipKind(selectedClip) === 'snapshot' ? (
                    <div className="cam-panel__snapshot-editor">
                      <div className="cam-panel__edit-tools">
                        <button className={`cam-panel__button ${snapshotEditFlip ? 'is-active' : ''}`} type="button" onClick={() => setSnapshotEditFlip((value) => !value)}>
                          <FlipHorizontal size={13} /> Flip
                        </button>
                        <button className="cam-panel__button" type="button" onClick={() => setSnapshotEditRotation((value) => (value + 90) % 360)}>
                          <RotateCw size={13} /> Rotate
                        </button>
                        <label className="cam-panel__toggle">
                          <input type="checkbox" checked={saveSnapshotAsCopy} onChange={(event) => setSaveSnapshotAsCopy(event.target.checked)} />
                          <span>Save as copy</span>
                        </label>
                      </div>
                      <div className="cam-panel__slider-grid">
                        <label>Crop X<input type="range" min={0} max={80} value={Math.round(snapshotCrop.x * 100)} onChange={(event) => setSnapshotCrop((crop) => ({ ...crop, x: Number(event.target.value) / 100 }))} /></label>
                        <label>Crop Y<input type="range" min={0} max={80} value={Math.round(snapshotCrop.y * 100)} onChange={(event) => setSnapshotCrop((crop) => ({ ...crop, y: Number(event.target.value) / 100 }))} /></label>
                        <label>Crop W<input type="range" min={20} max={100} value={Math.round(snapshotCrop.width * 100)} onChange={(event) => setSnapshotCrop((crop) => ({ ...crop, width: Number(event.target.value) / 100 }))} /></label>
                        <label>Crop H<input type="range" min={20} max={100} value={Math.round(snapshotCrop.height * 100)} onChange={(event) => setSnapshotCrop((crop) => ({ ...crop, height: Number(event.target.value) / 100 }))} /></label>
                        <label>Brightness<input type="range" min={50} max={160} value={snapshotBrightness} onChange={(event) => setSnapshotBrightness(Number(event.target.value))} /></label>
                        <label>Contrast<input type="range" min={50} max={180} value={snapshotContrast} onChange={(event) => setSnapshotContrast(Number(event.target.value))} /></label>
                        <label>Sharpen<input type="range" min={0} max={100} value={snapshotSharpen} onChange={(event) => setSnapshotSharpen(Number(event.target.value))} /></label>
                      </div>
                      <input className="cam-panel__input" value={snapshotAnnotation} placeholder="Annotation label / arrow note" onChange={(event) => setSnapshotAnnotation(event.target.value)} />
                      <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void saveSnapshotEdits(); }}>
                        <Crop size={13} /> Save Snapshot Edit
                      </button>
                    </div>
                  ) : (
                    <div className="cam-panel__marker-editor">
                      <div className="cam-panel__settings-row">
                        <label>
                          Trim start
                          <input className="cam-panel__input" value={trimStart} placeholder="0:00" onChange={(event) => setTrimStart(event.target.value)} />
                        </label>
                        <label>
                          Trim end
                          <input className="cam-panel__input" value={trimEnd} placeholder={formatClipDuration(selectedClip.durationMs)} onChange={(event) => setTrimEnd(event.target.value)} />
                        </label>
                      </div>
                      <div className="cam-panel__edit-tools">
                        <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void saveTrimmedVideoCopy(); }}>
                          <Scissors size={13} /> Save Trim
                        </button>
                        <button className="cam-panel__button" type="button" disabled={busy} onClick={trimBetweenFirstTwoMarkers}>
                          <Flag size={13} /> Marker Trim
                        </button>
                        <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void makeTimelapseCopy(); }}>
                          <Copy size={13} /> Timelapse Copy
                        </button>
                      </div>
                      <div className="cam-panel__settings-row">
                        <label>
                          Marker
                          <input className="cam-panel__input" value={markerDraftLabel} placeholder="Label" onChange={(event) => setMarkerDraftLabel(event.target.value)} />
                        </label>
                        <label>
                          Time
                          <input className="cam-panel__input" value={markerDraftTime} placeholder="0:12" onChange={(event) => setMarkerDraftTime(event.target.value)} />
                        </label>
                      </div>
                      <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void addSelectedClipMarker(); }}>
                        <Flag size={13} /> Add Video Marker
                      </button>
                    </div>
                  )}
                  {(selectedClip.markers?.length ?? 0) > 0 && (
                    <div className="cam-panel__markers">
                      {selectedClip.markers?.map((marker) => (
                        <span key={marker.id}>
                          <Flag size={11} /> {marker.label} {formatClipDuration(marker.atMs)}
                          <button type="button" onClick={() => { void removeSelectedClipMarker(marker.id); }}>
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="cam-panel__meta">
                    saved {new Date(selectedClip.createdAt).toLocaleString()}
                    {selectedClip.editedAt ? ` - edited ${new Date(selectedClip.editedAt).toLocaleString()}` : ''}
                  </div>
                </div>
              </>
            ) : (
              <div className="cam-panel__bottom-empty">
                <div>
                  <FolderOpen size={18} />
                  <span>Select saved media to edit it, or create a new capture from the live stream.</span>
                </div>
                <div className="cam-panel__empty-actions">
                  <button className="cam-panel__button cam-panel__button--record" type="button" disabled={!hasCamera || busy} onClick={() => { void startRecording('clip'); }}>
                    <Video size={13} /> Record Clip
                  </button>
                  <button className="cam-panel__button" type="button" disabled={!hasCamera || busy || recording} onClick={() => { void captureSnapshot(); }}>
                    <Image size={13} /> Snapshot
                  </button>
                  <button className="cam-panel__button" type="button" onClick={() => setActiveControlSection('library')}>
                    <FolderOpen size={13} /> Open Library
                  </button>
                </div>
              </div>
            )}
            </>
            )}
          </div>}
        </div>

        {!compact && <aside className="cam-panel__controls" aria-label="Camera controls and saved clips">
          <div className="cam-panel__control-tabs" role="tablist" aria-label="Camera control sections">
            {([
              ['record', 'Record', Video],
              ['settings', 'Settings', Settings],
              ['library', 'Library', FolderOpen],
              ['timeline', 'Timeline', Timer],
              ['health', 'Health', Gauge],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                className={`cam-panel__tab${activeControlSection === key ? ' is-active' : ''}`}
                type="button"
                role="tab"
                aria-selected={activeControlSection === key}
                onClick={() => setActiveControlSection(key)}
              >
                <Icon size={13} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {activeControlSection === 'record' && (
          <section className="cam-panel__control-section cam-panel__control-section--record" aria-label="Current record controls">
            <div className="cam-panel__section-head">
              <span><Video size={14} /> Current Record</span>
              <small>{recording ? formatClipDuration(elapsedMs) : 'Ready'}</small>
            </div>
            <div className="cam-panel__toolbar">
            {recording ? (
              <button className="cam-panel__button cam-panel__button--stop" type="button" onClick={stopRecording}>
                <Square size={13} /> Stop
              </button>
            ) : (
              <button className="cam-panel__button cam-panel__button--record" type="button" disabled={!hasCamera || busy} onClick={() => { void startRecording('clip'); }}>
                <Video size={13} /> Record Clip
              </button>
            )}
            <button className="cam-panel__button" type="button" disabled={!hasCamera || busy || recording} onClick={() => { void captureSnapshot(); }}>
              <Image size={13} /> Snapshot
            </button>
            <button className="cam-panel__button" type="button" disabled={!hasCamera || busy || recording} onClick={() => { void startRecording('timelapse'); }}>
              <Timer size={13} /> Timelapse
            </button>
            <button className="cam-panel__button" type="button" disabled={!hasCamera || !recording} onClick={addMarker}>
              <Flag size={13} /> Marker
            </button>
            </div>
          </section>
          )}

          {activeControlSection === 'record' && (
          <section className="cam-panel__control-section" aria-label="Camera view controls">
            <div className="cam-panel__section-head">
              <span><Crosshair size={14} /> View</span>
              <small>{rotation}deg</small>
            </div>
            <div className="cam-panel__secondary-grid" aria-label="Camera view options">
            <button className={`cam-panel__button ${showGrid ? 'is-active' : ''}`} type="button" onClick={() => setShowGrid((value) => !value)}>
              <Grid2X2 size={13} /> Grid
            </button>
            <button className={`cam-panel__button ${showCrosshair ? 'is-active' : ''}`} type="button" onClick={() => setShowCrosshair((value) => !value)}>
              <Crosshair size={13} /> Center
            </button>
            <button className={`cam-panel__button ${flipImage ? 'is-active' : ''}`} type="button" onClick={() => setFlipImage((value) => !value)}>
              <FlipHorizontal size={13} /> Flip
            </button>
            <button className="cam-panel__button" type="button" onClick={() => setRotation((value) => (value + 90) % 360)}>
              <RotateCw size={13} /> Rotate
            </button>
            </div>
            <div className="cam-panel__calibration-tools">
              <label className="cam-panel__toggle">
                <input
                  type="checkbox"
                  checked={calibration.enabled}
                  onChange={(event) => setCalibration((value) => ({ ...value, enabled: event.target.checked }))}
                />
                <span>Calibration overlay</span>
              </label>
              <label>
                Bed W
                <input
                  className="cam-panel__input"
                  type="number"
                  min={1}
                  value={bedWidthMm}
                  onChange={(event) => setCalibration((value) => ({ ...value, bedWidthMm: Number(event.target.value) || 1 }))}
                />
              </label>
              <label>
                Bed D
                <input
                  className="cam-panel__input"
                  type="number"
                  min={1}
                  value={bedDepthMm}
                  onChange={(event) => setCalibration((value) => ({ ...value, bedDepthMm: Number(event.target.value) || 1 }))}
                />
              </label>
              <button
                className={`cam-panel__button ${measurementMode === 'bed' ? 'is-active' : ''}`}
                type="button"
                disabled={!hasCamera}
                onClick={() => {
                  setMeasurementMode((mode) => mode === 'bed' ? 'off' : 'bed');
                  setNextBedCornerIndex(0);
                }}
              >
                <Crosshair size={13} /> Pick corners
              </button>
              <button className="cam-panel__button" type="button" disabled={!hasCamera} onClick={() => { void capturePoseStill(); }}>
                <Image size={13} /> Freeze pose
              </button>
              <button className="cam-panel__button" type="button" disabled={!bedCornersComplete || !homography} onClick={savePoseCalibration}>
                <Save size={13} /> Save pose
              </button>
              {poseStillUrl && (
                <button className="cam-panel__button" type="button" onClick={clearPoseStill}>
                  <X size={13} /> Live view
                </button>
              )}
              {finalComparisonUrl && (
                <button
                  className="cam-panel__button"
                  type="button"
                  onClick={() => {
                    setFinalComparisonUrl((url) => {
                      if (url) URL.revokeObjectURL(url);
                      return '';
                    });
                  }}
                >
                  <X size={13} /> Clear compare
                </button>
              )}
              <button
                className={`cam-panel__button ${measurementMode === 'ruler' ? 'is-active' : ''}`}
                type="button"
                disabled={!hasCamera || !bedCornersComplete}
                onClick={() => setMeasurementMode((mode) => mode === 'ruler' ? 'off' : 'ruler')}
              >
                <Ruler size={13} /> Ruler
              </button>
              <button
                className="cam-panel__button"
                type="button"
                onClick={() => {
                  setCalibration((value) => ({ ...value, measureA: undefined, measureB: undefined }));
                  setMeasurementMode('ruler');
                }}
                disabled={!hasCamera || !bedCornersComplete}
              >
                <Eraser size={13} /> Clear ruler
              </button>
              <button
                className="cam-panel__button cam-panel__button--danger"
                type="button"
                onClick={() => {
                  setCalibration((value) => ({ ...value, bedCorners: undefined, measureA: undefined, measureB: undefined, pose: undefined }));
                  setMeasurementMode('off');
                  setNextBedCornerIndex(0);
                }}
              >
                <Trash2 size={13} /> Clear bed
              </button>
              <span className={`cam-panel__pose-status cam-panel__pose-status--${poseStatus.state}`}>
                {poseStatus.label}
              </span>
            </div>
          </section>
          )}

          {activeControlSection === 'settings' && (
          <section className="cam-panel__control-section" aria-label="Camera automation settings">
            <div className="cam-panel__section-head">
              <span><Settings size={14} /> Settings</span>
              <small>{prefs.webcamStreamPreference === 'main' ? 'HD' : 'SD'} stream</small>
            </div>
            <div className="cam-panel__quality-tools" aria-label="Camera quality">
              <button
                className={`cam-panel__button ${prefs.webcamStreamPreference === 'sub' ? 'is-active' : ''}`}
                type="button"
                onClick={() => setCameraQuality('sub')}
              >
                <Video size={13} /> SD
              </button>
              <button
                className={`cam-panel__button ${prefs.webcamStreamPreference === 'main' ? 'is-active' : ''}`}
                type="button"
                onClick={() => setCameraQuality('main')}
                title={hdLiveNeedsBridge ? 'HD uses the local automatic RTSP to HLS bridge.' : 'Use HD stream'}
              >
                <Video size={13} /> HD
              </button>
              {hdLiveNeedsBridge && (
                <span className="cam-panel__note">
                  HD uses a local FFmpeg bridge automatically. First load can take a few seconds.
                </span>
              )}
              {hdLiveNeedsBridge && prefs.webcamStreamPreference === 'main' && (
                <label className="cam-panel__quality-select">
                  Bridge quality
                  <select
                    className="cam-panel__input"
                    value={hdBridgeQuality}
                    onChange={(event) => {
                      setHdBridgeQuality(event.target.value as CameraHdBridgeQuality);
                      setStreamRevision((value) => value + 1);
                      setMessage('Updating HD bridge quality...');
                    }}
                  >
                    {HD_BRIDGE_QUALITIES.map((quality) => (
                      <option key={quality.value} value={quality.value}>{quality.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="cam-panel__settings-row">
            <label>
              Interval
              <input
                className="cam-panel__input"
                type="number"
                min={1}
                max={60}
                value={timelapseIntervalSec}
                onChange={(event) => setTimelapseIntervalSec(Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
            <label>
              FPS
              <input
                className="cam-panel__input"
                type="number"
                min={1}
                max={30}
                value={timelapseFps}
                onChange={(event) => setTimelapseFps(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}
              />
            </label>
            </div>
            <div className="cam-panel__preset-tools">
              <input className="cam-panel__input" value={presetName} placeholder="Preset name" onChange={(event) => setPresetName(event.target.value)} />
              <button className="cam-panel__button" type="button" onClick={saveCameraPreset}>
                <Save size={13} /> Save Preset
              </button>
              {cameraPresets.length === 0 ? (
                <span className="cam-panel__note">Save view/recording settings as presets for repeat camera setups.</span>
              ) : cameraPresets.map((preset) => (
                <div className="cam-panel__preset-row" key={preset.id}>
                  <button className="cam-panel__button" type="button" onClick={() => applyCameraPreset(preset)}>
                    <Play size={13} /> {preset.name}
                  </button>
                  <button className="cam-panel__button cam-panel__button--danger" type="button" onClick={() => deleteCameraPreset(preset.id)}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className="cam-panel__ptz-tools">
              <div className="cam-panel__section-head">
                <span><Camera size={14} /> PTZ</span>
                <small>{ptzEnabled && canUsePtz ? ptzProviderLabel(activeCamera?.ptzProvider ?? 'off') : 'Off'}</small>
              </div>
              <label className="cam-panel__toggle">
                <input
                  type="checkbox"
                  checked={ptzEnabled}
                  onChange={(event) => setPtzEnabled(event.target.checked)}
                />
                <span>Enable move controls</span>
              </label>
              <span className="cam-panel__note">
                Uses the selected camera's PTZ provider, presets, and credentials from Camera Settings.
              </span>
              <div className="cam-panel__settings-row">
                <label>
                  Speed
                  <input
                    className="cam-panel__input"
                    type="number"
                    min={1}
                    max={8}
                    value={ptzSpeed}
                    onChange={(event) => setPtzSpeed(Math.max(1, Math.min(8, Number(event.target.value) || 1)))}
                  />
                </label>
              </div>
              <div className="cam-panel__ptz-grid" aria-label="Camera movement controls">
                <span />
                <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('up')} title="Move up">
                  <ArrowUp size={14} />
                </button>
                <span />
                <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('left')} title="Move left">
                  <ArrowLeft size={14} />
                </button>
                <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('home')} title="Go to home preset">
                  <Home size={14} />
                </button>
                <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('right')} title="Move right">
                  <ArrowRight size={14} />
                </button>
                <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('zoomOut')} title="Zoom out">
                  <ZoomOut size={14} />
                </button>
                <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('down')} title="Move down">
                  <ArrowDown size={14} />
                </button>
                <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzCommand('zoomIn')} title="Zoom in">
                  <ZoomIn size={14} />
                </button>
              </div>
              <div className="cam-panel__ptz-preset-form">
                <input className="cam-panel__input" value={ptzPresetName} placeholder="Preset name" onChange={(event) => setPtzPresetName(event.target.value)} />
                <input className="cam-panel__input" value={ptzPresetToken} placeholder="Slot" onChange={(event) => setPtzPresetToken(event.target.value)} />
                <button className="cam-panel__button" type="button" disabled={!activeCamera} onClick={savePtzPreset}>
                  <Save size={13} /> Save PTZ
                </button>
              </div>
              {activeCamera?.ptzPresets.length ? (
                <div className="cam-panel__ptz-preset-list">
                  {activeCamera.ptzPresets.map((preset) => (
                    <div className="cam-panel__preset-row" key={preset.id}>
                      <button className="cam-panel__button" type="button" disabled={!ptzEnabled || !canUsePtz} onClick={() => void runPtzPreset(preset)}>
                        <Play size={13} /> {preset.name}
                      </button>
                      <button
                        className={`cam-panel__button${activeCamera.ptzStartPresetId === preset.id ? ' is-active' : ''}`}
                        type="button"
                        onClick={() => updateActiveCamera({ ptzStartPresetId: activeCamera.ptzStartPresetId === preset.id ? '' : preset.id })}
                        title="Use on print start"
                      >
                        <Flag size={13} />
                      </button>
                      <button className="cam-panel__button cam-panel__button--danger" type="button" onClick={() => deletePtzPreset(preset.id)}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="cam-panel__note">Save PTZ slot numbers after positioning the camera, then mark one for print-start framing.</span>
              )}
            </div>
            <div className="cam-panel__toggle-grid">
              <label className="cam-panel__toggle">
                <input
                  type="checkbox"
                  checked={autoRecord}
                  onChange={(event) => setAutoRecord(event.target.checked)}
                />
                <span>Auto-record print jobs</span>
              </label>
              <label className="cam-panel__toggle">
                <input
                  type="checkbox"
                  checked={autoTimelapse}
                  onChange={(event) => setAutoTimelapse(event.target.checked)}
                />
                <span>Auto timelapse</span>
              </label>
              <label className="cam-panel__toggle">
                <input
                  type="checkbox"
                  checked={autoSnapshotFirstLayer}
                  onChange={(event) => setAutoSnapshotFirstLayer(event.target.checked)}
                />
                <span>First-layer snapshot</span>
              </label>
              <label className="cam-panel__toggle">
                <input
                  type="checkbox"
                  checked={autoSnapshotLayer}
                  onChange={(event) => setAutoSnapshotLayer(event.target.checked)}
                />
                <span>Every-layer snapshots</span>
              </label>
              <label className="cam-panel__toggle">
                <input
                  type="checkbox"
                  checked={autoSnapshotFinish}
                  onChange={(event) => setAutoSnapshotFinish(event.target.checked)}
                />
                <span>Finish snapshot</span>
              </label>
              <label className="cam-panel__toggle">
                <input
                  type="checkbox"
                  checked={autoSnapshotError}
                  onChange={(event) => setAutoSnapshotError(event.target.checked)}
                />
                <span>Error snapshot</span>
              </label>
              <label className="cam-panel__toggle">
                <input
                  type="checkbox"
                  checked={scheduledSnapshots}
                  onChange={(event) => setScheduledSnapshots(event.target.checked)}
                />
                <span>Timed snapshots</span>
              </label>
              <label className="cam-panel__toggle">
                <input
                  type="checkbox"
                  checked={anomalyCapture}
                  onChange={(event) => setAnomalyCapture(event.target.checked)}
                />
                <span>Anomaly capture</span>
              </label>
              <label>
                Every minutes
                <input
                  className="cam-panel__input"
                  type="number"
                  min={1}
                  max={240}
                  value={scheduledSnapshotIntervalMin}
                  onChange={(event) => setScheduledSnapshotIntervalMin(Math.max(1, Number(event.target.value) || 1))}
                />
              </label>
            </div>
          </section>
          )}

          {activeControlSection === 'health' && (
          <section className="cam-panel__control-section" aria-label="Camera health diagnostics controls">
            <div className="cam-panel__section-head">
              <span><Gauge size={14} /> Health</span>
              <small>{estimatedFps ? `${estimatedFps.toFixed(1)} FPS` : 'Waiting'}</small>
            </div>
            {healthPanelOpen && (
              <div className={`cam-panel__health-card${droppedFrameWarning ? ' is-warning' : ''}`} aria-label="Camera health diagnostics">
                <span>Frames {frameCount}</span>
                <span>Reconnects {reconnectCount}</span>
                <span>{droppedFrameWarning ? `Frame stale: ${clipDurationLabel(frameAgeMs ?? 0)}` : formatLastFrame(lastFrameAt, nowTick)}</span>
                {reconnectHistoryRef.current.length > 0 && (
                  <span>Last reconnect {new Date(reconnectHistoryRef.current[reconnectHistoryRef.current.length - 1]).toLocaleTimeString()}</span>
                )}
              </div>
            )}
            <button className="cam-panel__button" type="button" onClick={() => setHealthPanelOpen((value) => !value)}>
              <Gauge size={13} /> {healthPanelOpen ? 'Hide Health' : 'Show Health'}
            </button>
          </section>
          )}

          {activeControlSection === 'timeline' && (
          <section className="cam-panel__control-section" aria-label="Print event timeline">
            <div className="cam-panel__section-head">
              <span><Timer size={14} /> Print Timeline</span>
              <small>{timelineJobName || 'Recent media'}</small>
            </div>
            <div className="cam-panel__timeline">
              {timelineClips.length === 0 ? (
                <div className="cam-panel__note">No saved captures are tied to the current print yet.</div>
              ) : timelineClips.map((clip) => (
                <button key={clip.id} type="button" onClick={() => { selectClip(clip); setEditorCollapsed(false); }}>
                  <span>{new Date(clip.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  <strong>{clipLabel(clip)}</strong>
                  <em>{clipIssueTags(clip).join(', ') || clipKind(clip)}</em>
                </button>
              ))}
            </div>
            <button className="cam-panel__button" type="button" disabled={timelineClips.length === 0 || busy} onClick={() => { void exportClipBundle(timelineClips); }}>
              <Archive size={13} /> Export Timeline Bundle
            </button>
            <button className="cam-panel__button" type="button" disabled={timelineClips.length === 0} onClick={() => generateJobReport(timelineClips)}>
              <Save size={13} /> Generate Report
            </button>
            <button className="cam-panel__button" type="button" disabled={timelineClips.length === 0 || busy} onClick={() => { void generateContactSheet(timelineClips); }}>
              <Image size={13} /> Contact Sheet
            </button>
          </section>
          )}

          {activeControlSection === 'library' && (
          <section className="cam-panel__control-section cam-panel__control-section--library" aria-label="Saved camera library">
            <div className="cam-panel__library-head">
            <div className="cam-panel__library-title">
              <FolderOpen size={14} /> Saved Clips
            </div>
            <button className="cam-panel__button cam-panel__button--load" type="button" disabled={busy} onClick={() => { void refreshClips(); }}>
              <RefreshCcw size={12} /> Load
            </button>
            </div>

          <div className="cam-panel__selection-tools">
            <button className={`cam-panel__button ${selectionMode ? 'is-active' : ''}`} type="button" onClick={() => setSelectionMode((value) => !value)}>
              <Tags size={13} /> Select Media
            </button>
            <button className="cam-panel__button" type="button" disabled={!selectionMode || visibleClips.length === 0} onClick={() => setSelectedClipIds(visibleClips.map((clip) => clip.id))}>
              <Tags size={13} /> Select Visible
            </button>
            <button className="cam-panel__button" type="button" disabled={selectedClipIds.length === 0} onClick={() => setSelectedClipIds([])}>
              <X size={13} /> Clear {selectedClipIds.length}
            </button>
          </div>

          <div className="cam-panel__filter-row">
            <label className="cam-panel__search">
              <Search size={12} />
              <input
                type="search"
                value={clipQuery}
                placeholder="Search clips"
                onChange={(event) => setClipQuery(event.target.value)}
              />
            </label>
            <select className="cam-panel__select" value={clipFilter} onChange={(event) => setClipFilter(event.target.value as ClipFilter)}>
              <option value="all">All</option>
              <option value="clip">Clips</option>
              <option value="snapshot">Snapshots</option>
              <option value="timelapse">Timelapse</option>
              <option value="auto">Auto</option>
              <option value="job">With job</option>
              <option value="favorite">Favorites</option>
              <option value="album">Albums</option>
              <option value="issue">Issues</option>
            </select>
            <select className="cam-panel__select" value={clipSort} onChange={(event) => setClipSort(event.target.value as ClipSort)}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="largest">Largest</option>
            </select>
          </div>

          <div className="cam-panel__storage" aria-label="Camera clip storage">
            <div>
              <HardDrive size={13} />
              <span>{formatBytes(totalStorageBytes)} local</span>
            </div>
            <div className="cam-panel__storage-bar"><span style={{ width: `${Math.min(100, totalStorageBytes / 5_000_000)}%` }} /></div>
          </div>

          <div className="cam-panel__storage-manager" aria-label="Camera storage manager">
            {(Object.keys(storageByKind) as CameraClipKind[]).map((kind) => (
              <div key={kind}>
                <span>{kind}</span>
                <strong>{storageByKind[kind].count}</strong>
                <em>{formatBytes(storageByKind[kind].size)}</em>
                <div><span style={{ width: `${totalStorageBytes ? Math.max(4, (storageByKind[kind].size / totalStorageBytes) * 100) : 0}%` }} /></div>
              </div>
            ))}
            {storageByJob.map((job) => (
              <div key={job.name}>
                <span>{job.name}</span>
                <strong>{job.count}</strong>
                <em>{formatBytes(job.size)}</em>
                <div><span style={{ width: `${totalStorageBytes ? Math.max(4, (job.size / totalStorageBytes) * 100) : 0}%` }} /></div>
              </div>
            ))}
          </div>

          <div className="cam-panel__bulk-tools">
            <input className="cam-panel__input" value={bulkAlbum} placeholder="Album for visible items" list="camera-albums" onChange={(event) => setBulkAlbum(event.target.value)} />
            <input className="cam-panel__input" value={bulkTags} placeholder="Bulk tags" onChange={(event) => setBulkTags(event.target.value)} />
            <button className="cam-panel__button" type="button" disabled={visibleClips.length === 0 || busy} onClick={() => { void applyBulkTags(); }}>
              <Tags size={13} /> Apply to Visible
            </button>
            <button className="cam-panel__button" type="button" disabled={visibleClips.length === 0} onClick={exportVisibleClips}>
              <Archive size={13} /> Export Visible
            </button>
            <button className="cam-panel__button" type="button" disabled={visibleClips.length === 0 || busy} onClick={() => { void exportClipBundle(visibleClips); }}>
              <Archive size={13} /> Export Bundle
            </button>
            <button className="cam-panel__button" type="button" disabled={selectedBulkClips.length === 0 || busy} onClick={() => { void exportClipBundle(selectedBulkClips); }}>
              <Archive size={13} /> Export Selected
            </button>
            <button className="cam-panel__button" type="button" disabled={selectedBulkClips.length === 0 || busy} onClick={() => { void generateContactSheet(selectedBulkClips); }}>
              <Image size={13} /> Contact Sheet
            </button>
            <button className="cam-panel__button" type="button" disabled={selectedBulkClips.length === 0} onClick={() => generateJobReport(selectedBulkClips)}>
              <Save size={13} /> Report
            </button>
          </div>

          <datalist id="camera-albums">
            {albums.map((album) => <option key={album} value={album} />)}
          </datalist>

          <div className="cam-panel__clip-list" aria-label="Saved camera clips">
            {clips.length === 0 ? (
              <div className="cam-panel__note">Recorded clips save in this browser for the selected printer. Use Download to keep a file outside the app.</div>
            ) : visibleClips.length === 0 ? (
              <div className="cam-panel__note">No saved camera items match the current filter.</div>
            ) : visibleClips.map((clip) => (
              <button
                key={clip.id}
                className={`cam-panel__clip${selectedClip?.id === clip.id ? ' is-selected' : ''}`}
                type="button"
                onClick={() => {
                  if (selectionMode) {
                    toggleBulkSelection(clip.id);
                    return;
                  }
                  selectClip(clip);
                }}
              >
                {selectionMode && (
                  <input
                    className="cam-panel__clip-check"
                    type="checkbox"
                    checked={selectedClipIds.includes(clip.id)}
                    onChange={(event) => {
                      event.stopPropagation();
                      toggleBulkSelection(clip.id);
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                )}
                <span className="cam-panel__thumb">
                  {thumbUrls[clip.id] ? <img src={thumbUrls[clip.id]} alt="" /> : clipKind(clip) === 'snapshot' ? <Image size={15} /> : <Video size={15} />}
                </span>
                <span className="cam-panel__clip-main">
                  <span className="cam-panel__clip-name">
                    {clip.favorite && <Star size={11} />}
                    {clipLabel(clip)}
                  </span>
                  <span className="cam-panel__clip-size">{clip.jobName ? clip.jobName : formatBytes(clip.size)}</span>
                </span>
                <span className="cam-panel__clip-date">{new Date(clip.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                <span className="cam-panel__clip-date">{new Date(clip.createdAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>

          <div className={`cam-panel__danger-zone${dangerOpen ? ' is-open' : ''}`}>
            <button className="cam-panel__danger-toggle" type="button" onClick={() => setDangerOpen((value) => !value)}>
              <AlertTriangle size={13} />
              <span>Danger Zone</span>
              {dangerOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {dangerOpen && (
              <div className="cam-panel__danger-actions">
                <label>
                  Cleanup days
                  <input className="cam-panel__input" type="number" min={1} value={cleanupDays} onChange={(event) => setCleanupDays(Math.max(1, Number(event.target.value) || 1))} />
                </label>
                <button className="cam-panel__button cam-panel__button--danger" type="button" disabled={busy} onClick={() => { void cleanupOldClips(); }}>
                  <Eraser size={13} /> Cleanup Old
                </button>
                <button className="cam-panel__button cam-panel__button--danger" type="button" disabled={visibleClips.length === 0 || busy} onClick={() => { void removeVisibleClips(); }}>
                  <Trash2 size={13} /> Delete Visible
                </button>
                <button className="cam-panel__button cam-panel__button--danger" type="button" disabled={selectedBulkClips.length === 0 || busy} onClick={() => { void Promise.all(selectedBulkClips.map((clip) => removeClip(clip))); }}>
                  <Trash2 size={13} /> Delete Selected
                </button>
              </div>
            )}
          </div>
          </section>
          )}
        </aside>}
      </div>

      {!compact && fullscreen && (
        <div className="cam-panel__fullscreen" role="dialog" aria-label="Fullscreen camera view">
          <button className="cam-panel__fullscreen-close" type="button" onClick={() => setFullscreen(false)}>
            <X size={18} />
          </button>
          <div className={frameClassName}>
            {hasCamera ? (
              <>
                {isVideoStream ? (
                  <video className="cam-panel__video" src={streamSrc} muted playsInline autoPlay controls style={imageStyle} />
                ) : (
                  <img src={streamSrc} alt={`${printerName} fullscreen camera stream`} style={imageStyle} />
                )}
                <div className="cam-panel__health">{formatLastFrame(lastFrameAt, nowTick)}</div>
              </>
            ) : (
              <div className="cam-panel__empty">
                <Camera size={28} />
                <strong>Camera stream unavailable</strong>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
