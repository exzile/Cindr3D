import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useNow } from '../../../hooks/useNow';
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
  type CameraDashboardPrefs,
  type CameraHdBridgeQuality,
  type CameraPtzPreset,
  type DuetPrefs,
} from '../../../utils/duetPrefs';
import { enabledCamerasFromPrefs, prefsWithCamera } from '../../../utils/cameraStreamUrl';
import { buildPtzMoveRequest, buildPtzPresetRequest, ptzProviderLabel, type PtzDirection } from '../../../services/camera/ptzControl';
import { connectWhepVideoStream } from '../../../services/camera/webrtcStream';
import {
  distanceBetweenImagePointsMm,
  hasCompleteBedCorners,
  solveCameraHomography,
  type ImagePoint,
} from '../../../services/vision/cameraMeasurement';
import {
  assessPoseCalibration,
  poseFrameSignature,
  solveCameraPoseCalibration,
} from '../../../services/vision/cameraPose';
import { formatBytes } from './helpers';
import CameraOverlayPanel, { type CameraOverlayMode } from './CameraOverlayPanel';
import {
  CLIP_RATINGS,
  INSPECTION_ITEMS,
  ISSUE_TAGS,
  clipDurationLabel,
  clipIssueTags,
  clipKind,
  clipLabel,
  deleteClip,
  formatClipDuration,
  loadClips,
  pickRecordingMimeType,
  saveClip,
  savedRecordingMessage,
  type BackendRecordingSession,
  type CameraClip,
  type CameraClipKind,
  type CameraMarker,
  type ClipFilter,
  type ClipRating,
  type ClipSort,
  type IssueTag,
  type SnapshotCrop,
} from './cameraDashboard/clipStore';
import {
  buildBulkClipUpdate,
  buildClipDetailsUpdate,
  buildClipMarker,
  buildClipWithMarker,
  buildClipWithoutMarker,
  buildFavoriteToggle,
  buildIssueTagUpdate,
  buildTimelapseCopy,
  buildTrimmedVideoCopy,
} from './cameraDashboard/clipMutations';
import {
  clipAlbums,
  filterVisibleClips,
  selectCompareClip,
  sortedSnapshotClips,
  summarizeClipStorageByJob,
  summarizeClipStorageByKind,
  timelineClipsForJob,
  totalClipStorageBytes,
} from './cameraDashboard/clipLibrary';
import {
  downloadClipBlob,
  downloadClipBundle,
  downloadClipManifest,
  downloadContactSheet,
  downloadJobReport,
} from './cameraDashboard/clipExport';
import {
  sendCameraCommand,
} from './cameraDashboard/cameraUrls';
import {
  clampPercent,
  defaultCrop,
  formatLastFrame,
  formatMeasurementDistance,
  measureContainedMedia,
  sameMediaViewport,
  transformSnapshotBlob,
  type MediaViewportRect,
} from './cameraDashboard/snapshotEdit';
import {
  backendRecordingStorageKey,
  loadCameraDashboardPrefs,
  loadCameraPresets,
} from './cameraDashboard/prefsStorage';
import {
  BED_CORNER_SEQUENCE,
  HD_BRIDGE_QUALITIES,
  RECORDING_FPS,
  type BedCornerKey,
  type CameraMeasurementCalibration,
  type CameraPreset,
  type ControlSection,
  type MeasurementMode,
  type RulerEndpointKey,
} from './cameraDashboard/types';
import { buildCameraStreamState } from './cameraDashboard/streamState';
import { useAutoSnapshots } from './cameraDashboard/useAutoSnapshots';
import { useCameraDashboardPersistence } from './cameraDashboard/useCameraDashboardPersistence';
import { useCameraMeasurement } from './cameraDashboard/useCameraMeasurement';
import { useCameraPresets } from './cameraDashboard/useCameraPresets';
import { useCameraRecording } from './cameraDashboard/useCameraRecording';
import { useClipActions } from './cameraDashboard/useClipActions';
import { usePtzControls } from './cameraDashboard/usePtzControls';
import { useSnapshotCapture } from './cameraDashboard/useSnapshotCapture';
import './CameraDashboardPanel.css';

interface CameraDashboardPanelProps {
  compact?: boolean;
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
  const nowTick = useNow(1000);
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

  const streamState = useMemo(() => buildCameraStreamState({
    prefs,
    hostname: config.hostname,
    hdBridgeQuality,
    serviceWebcamUrl: service?.getWebcamUrl(),
    activeCamera,
    webRtcFailed,
    imageFailed,
    streamRevision,
  }), [activeCamera, config.hostname, hdBridgeQuality, imageFailed, prefs, service, streamRevision, webRtcFailed]);

  const measurement = useCameraMeasurement({
    initialCalibration: dashboardPrefs.calibration as CameraMeasurementCalibration,
    frameRef,
    mediaViewport,
    activeCameraId: activeCamera?.id ?? prefs.activeCameraId,
    rotation,
    flipImage,
    setMessage,
  });
  const {
    calibration, setCalibration,
    measurementMode, setMeasurementMode,
    setNextBedCornerIndex,
    draggingBedCorner, draggingRulerEndpoint,
    poseStillUrl, setPoseStillUrl,
    finalComparisonUrl, setFinalComparisonUrl,
    homography, measuredDistanceMm,
    completeBedCorners, bedCornersComplete, poseStatus,
    measurementStatus,
    handleMeasurementPointerDown,
    handleCornerPointerDown, handleCornerPointerMove, handleCornerPointerUp,
    handleRulerPointerDown, handleRulerPointerMove, handleRulerPointerUp,
    savePoseCalibration, clearPoseStill,
  } = measurement;

  useCameraDashboardPersistence({
    activePrinterId, dashboardPrefs, updatePrinterPrefs,
    hydratedPrinterIdRef, skipNextPrefsSaveRef,
    autoRecord, autoTimelapse, autoSnapshotFirstLayer, autoSnapshotLayer,
    autoSnapshotFinish, autoSnapshotError, scheduledSnapshots,
    scheduledSnapshotIntervalMin, anomalyCapture, timelapseIntervalSec, timelapseFps,
    showGrid, showCrosshair, flipImage, rotation,
    healthPanelOpen, activeControlSection, editorCollapsed,
    cameraPresets, calibration, ptzEnabled, ptzSpeed, hdBridgeQuality,
    setAutoRecord, setAutoTimelapse, setAutoSnapshotFirstLayer, setAutoSnapshotLayer,
    setAutoSnapshotFinish, setAutoSnapshotError, setScheduledSnapshots,
    setScheduledSnapshotIntervalMin, setAnomalyCapture, setTimelapseIntervalSec, setTimelapseFps,
    setShowGrid, setShowCrosshair, setFlipImage, setRotation,
    setHealthPanelOpen, setActiveControlSection, setEditorCollapsed,
    setCameraPresets, setCalibration, setPtzEnabled, setPtzSpeed, setHdBridgeQuality,
    setMeasurementMode, setNextBedCornerIndex, setPoseStillUrl, setFinalComparisonUrl,
  });

  const printerId = activePrinter?.id ?? 'default-printer';
  const printerName = activePrinter?.name ?? 'Printer';
  const {
    hdMainIsRtsp,
    displayUrl,
    backendRecordingUrl,
    isBrowserUsbCamera,
    isServerUsbCamera,
    webRtcUrl,
    useWebRtcStream,
    isVideoStream,
    cameraSourceUrl,
    hasCamera,
    hdLiveNeedsBridge,
    canUseBackendRecording,
    streamSrc,
  } = streamState;
  const recording = recordingKind !== null;
  const isTimelapseRecording = recordingKind === 'timelapse';
  const isAutoRecording = recordingKind === 'auto';
  const isPrintActive = printStatus === 'processing' || printStatus === 'simulating';
  const canUsePtz = Boolean(activeCamera?.ptzEnabled && activeCamera.ptzProvider !== 'off');
  const activePtzStartPreset = activeCamera?.ptzPresets.find((preset) => preset.id === activeCamera.ptzStartPresetId);
  const totalStorageBytes = useMemo(() => totalClipStorageBytes(clips), [clips]);
  const storageByKind = useMemo(() => summarizeClipStorageByKind(clips), [clips]);

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
  const storageByJob = useMemo(() => summarizeClipStorageByJob(clips), [clips]);
  const albums = useMemo(() => clipAlbums(clips), [clips]);
  const snapshotClips = useMemo(() => sortedSnapshotClips(clips), [clips]);
  const compareClip = useMemo(() => selectCompareClip(snapshotClips, compareClipId, selectedClip?.id), [compareClipId, selectedClip?.id, snapshotClips]);
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
  const visibleClips = useMemo(() => filterVisibleClips(clips, clipFilter, clipSort, clipQuery), [clipFilter, clipQuery, clipSort, clips]);
  const recentClips = useMemo(() => clips.slice(0, 6), [clips]);
  const timelineJobName = jobFileName || selectedClip?.jobName || '';
  const timelineClips = useMemo(() => timelineClipsForJob(clips, timelineJobName), [clips, timelineJobName]);

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
    if (!recording) return undefined;
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 500);
    return () => window.clearInterval(interval);
  }, [recording]);


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

  const {
    drawFrame, canvasBlob, captureSnapshot, capturePoseStill,
    captureFinalComparisonFrame, captureAnomaly,
  } = useSnapshotCapture({
    imgRef, videoRef, canvasRef, scheduledSnapshotTimerRef, staleAnomalyCapturedRef,
    isVideoStream, hasCamera,
    printerId, printerName, jobFileName,
    calibrationPose: calibration.pose,
    setPoseStillUrl, setMeasurementMode, setNextBedCornerIndex,
    setFinalComparisonUrl, setCameraOverlayMode,
    setLastFrameAt, setBusy, setMessage, refreshClips,
    anomalyCapture, scheduledSnapshots, scheduledSnapshotIntervalMin,
    isPrintActive, droppedFrameWarning,
  });

  const { startRecording, stopRecording } = useCameraRecording({
    recorderRef, chunksRef, startedAtRef, recordingKindRef, recordingJobRef,
    recordingMarkersRef, recordingThumbnailRef, backendRecordingRef, frameTimerRef,
    canvasRef,
    drawFrame, canvasBlob, hasCamera, recording, canUseBackendRecording,
    isServerUsbCamera, backendRecordingUrl,
    hdBridgeQuality, timelapseFps, timelapseIntervalSec,
    autoRecord, autoTimelapse, isPrintActive, jobFileName,
    printerId, printerName,
    setRecordingKind, setElapsedMs, setBusy, setMessage, refreshClips,
  });

  useAutoSnapshots({
    hasCamera, isPrintActive, printStatus, currentLayer,
    autoSnapshotFirstLayer, autoSnapshotLayer, autoSnapshotFinish, autoSnapshotError,
    previousPrintStatusRef, seenPrintLayersRef,
    captureSnapshot, captureFinalComparisonFrame,
  });



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

  const { saveCameraPreset, applyCameraPreset, deleteCameraPreset } = useCameraPresets({
    cameraPresets, setCameraPresets, presetName, setPresetName, setMessage,
    showGrid, showCrosshair, flipImage, rotation, timelapseIntervalSec, timelapseFps,
    setShowGrid, setShowCrosshair, setFlipImage, setRotation, setTimelapseIntervalSec, setTimelapseFps,
  });

  const { runPtzCommand, runPtzPreset, savePtzPreset, deletePtzPreset } = usePtzControls({
    activeCamera, hostname: config.hostname, canUsePtz, ptzEnabled, ptzSpeed,
    ptzPresetName, ptzPresetToken, isPrintActive, printStatus,
    activePtzStartPreset, setPtzPresetName, setMessage, updateActiveCamera,
  });

  const {
    selectClip, downloadClip, exportVisibleClips, removeClip, removeVisibleClips,
    saveSelectedClipDetails, toggleSelectedClipFavorite,
    applySelectedIssue, toggleInspectionItem, toggleBulkSelection,
    generateJobReport, generateContactSheet, exportClipBundle,
    addSelectedClipMarker, removeSelectedClipMarker,
    saveTrimmedVideoCopy, makeTimelapseCopy, trimBetweenFirstTwoMarkers,
    applyBulkTags, cleanupOldClips, saveSnapshotEdits,
  } = useClipActions({
    selectedClip, setSelectedClip, setSelectedClipUrl, selectedClipUrlRef,
    clipDraftName, clipDraftNotes, clipDraftKind, clipDraftJobName, clipDraftAlbum,
    clipDraftRating, clipDraftChecklist, clipDraftTags, setClipDraftChecklist,
    setSelectedClipIds,
    issueDraft,
    markerDraftLabel, markerDraftTime, setMarkerDraftLabel, setMarkerDraftTime,
    trimStart, trimEnd, setTrimStart, setTrimEnd,
    saveSnapshotAsCopy, snapshotEditFlip, snapshotEditRotation, snapshotCrop,
    snapshotBrightness, snapshotContrast, snapshotSharpen, snapshotAnnotation,
    setSnapshotEditFlip, setSnapshotEditRotation, setSnapshotCrop,
    setSnapshotBrightness, setSnapshotContrast, setSnapshotSharpen, setSnapshotAnnotation,
    bulkTags, bulkAlbum, cleanupDays,
    clips, visibleClips, timelineClips, timelineJobName,
    printerId, printerName,
    setBusy, setMessage, refreshClips,
  });

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
                    {!compact && calibration.enabled && <div className="cam-panel__calibration" style={calibrationStyle} />}
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
                        <button
                          type="button"
                          className={`cam-panel__measure-point cam-panel__measure-point--ruler${draggingRulerEndpoint === 'measureA' ? ' is-dragging' : ''}`}
                          style={{ left: `${calibration.measureA.x}%`, top: `${calibration.measureA.y}%` }}
                          onPointerDown={(event) => handleRulerPointerDown(event, 'measureA')}
                          onPointerMove={(event) => handleRulerPointerMove(event, 'measureA')}
                          onPointerUp={handleRulerPointerUp}
                          onPointerCancel={handleRulerPointerUp}
                          aria-label="Drag ruler endpoint A"
                        >
                          A
                        </button>
                      )}
                      {calibration.measureB && (
                        <button
                          type="button"
                          className={`cam-panel__measure-point cam-panel__measure-point--ruler${draggingRulerEndpoint === 'measureB' ? ' is-dragging' : ''}`}
                          style={{ left: `${calibration.measureB.x}%`, top: `${calibration.measureB.y}%` }}
                          onPointerDown={(event) => handleRulerPointerDown(event, 'measureB')}
                          onPointerMove={(event) => handleRulerPointerMove(event, 'measureB')}
                          onPointerUp={handleRulerPointerUp}
                          onPointerCancel={handleRulerPointerUp}
                          aria-label="Drag ruler endpoint B"
                        >
                          B
                        </button>
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

            {compact && (
              <section className="cam-panel__view-tools cam-panel__view-tools--compact" aria-label="Camera view mode">
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
              ['view', 'View', Crosshair],
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

          {activeControlSection === 'view' && (
          <section className="cam-panel__control-section" aria-label="Camera view controls">
            <div className="cam-panel__section-head">
              <span><Crosshair size={14} /> View</span>
              <small>{rotation}deg</small>
            </div>
            <div className="cam-panel__view-section" aria-label="Camera orientation">
              <div className="cam-panel__view-section-head">
                <span>Orientation</span>
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
            </div>
            <div className="cam-panel__view-section" aria-label="Calibration overlay controls">
              <div className="cam-panel__view-section-head">
                <span>Calibration</span>
                <small>{calibration.enabled ? 'Overlay on' : 'Overlay off'}</small>
              </div>
              <label className="cam-panel__toggle">
                <input
                  type="checkbox"
                  checked={calibration.enabled}
                  onChange={(event) => setCalibration((value) => ({ ...value, enabled: event.target.checked }))}
                />
                <span>Calibration overlay</span>
              </label>
              {calibration.enabled && (
                <div className="cam-panel__view-calibration">
                  <label>X<input type="range" min={0} max={80} value={calibration.x} onChange={(event) => setCalibration((value) => ({ ...value, x: Number(event.target.value) }))} /></label>
                  <label>Y<input type="range" min={0} max={80} value={calibration.y} onChange={(event) => setCalibration((value) => ({ ...value, y: Number(event.target.value) }))} /></label>
                  <label>W<input type="range" min={10} max={100} value={calibration.width} onChange={(event) => setCalibration((value) => ({ ...value, width: Number(event.target.value) }))} /></label>
                  <label>H<input type="range" min={10} max={100} value={calibration.height} onChange={(event) => setCalibration((value) => ({ ...value, height: Number(event.target.value) }))} /></label>
                </div>
              )}
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
            </div>
            <div className="cam-panel__view-section" aria-label="AR and preview corner setup">
              <div className="cam-panel__view-section-head">
                <span>AR / Preview</span>
                <small>{poseStatus.label}</small>
              </div>
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
            <div className="cam-panel__view-section" aria-label="Ruler controls">
              <div className="cam-panel__view-section-head">
                <span>Ruler</span>
                <small>{calibration.measureA && calibration.measureB ? formatMeasurementDistance(measuredDistanceMm) : 'No measure'}</small>
              </div>
              <div className="cam-panel__view-status">
                <Ruler size={13} />
                <span>{calibration.measureA && calibration.measureB ? formatMeasurementDistance(measuredDistanceMm) : measurementMode === 'ruler' ? measurementStatus : 'Start the ruler, then place A and B on the video.'}</span>
              </div>
              <button
                className={`cam-panel__button ${measurementMode === 'ruler' ? 'is-active' : ''}`}
                type="button"
                disabled={!hasCamera || !bedCornersComplete}
                onClick={() => setMeasurementMode((mode) => mode === 'ruler' ? 'off' : 'ruler')}
              >
                <Ruler size={13} /> {measurementMode === 'ruler' ? 'Stop ruler' : 'Start ruler'}
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
              <span className="cam-panel__note">Drag markers A and B on the video to adjust the measurement.</span>
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
