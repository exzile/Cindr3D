import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useNow } from '../../../hooks/useNow';
import { usePrinterStore } from '../../../store/printerStore';
import {
  DEFAULT_CAMERA_DASHBOARD_PREFS,
  DEFAULT_PREFS,
  getDuetPrefs,
  type CameraDashboardPrefs,
  type CameraHdBridgeQuality,
  type DuetPrefs,
} from '../../../utils/duetPrefs';
import { enabledCamerasFromPrefs, prefsWithCamera } from '../../../utils/cameraStreamUrl';
import { type CameraOverlayMode } from './CameraOverlayPanel';
import {
  clipKind,
  formatClipDuration,
  loadClips,
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
  defaultCrop,
  type MediaViewportRect,
} from './cameraDashboard/snapshotEdit';
import {
  backendRecordingStorageKey,
  loadCameraDashboardPrefs,
  loadCameraPresets,
} from './cameraDashboard/prefsStorage';
import {
  type CameraMeasurementCalibration,
  type CameraPreset,
  type ControlSection,
} from './cameraDashboard/types';
import { buildCameraStreamState } from './cameraDashboard/streamState';
import { CameraDashboardTopbar } from './cameraDashboard/CameraDashboardTopbar';
import { CameraViewer } from './cameraDashboard/CameraViewer';
import { ClipEditorPanel } from './cameraDashboard/ClipEditorPanel';
import { ControlTabBar } from './cameraDashboard/ControlTabBar';
import { FullscreenViewer } from './cameraDashboard/FullscreenViewer';
import { HealthSection } from './cameraDashboard/HealthSection';
import { MeasurementLayer } from './cameraDashboard/MeasurementLayer';
import { RecentCapturesStrip } from './cameraDashboard/RecentCapturesStrip';
import { RecordSection } from './cameraDashboard/RecordSection';
import { RecordStrip } from './cameraDashboard/RecordStrip';
import { useCameraConnection } from './cameraDashboard/useCameraConnection';
import { LibrarySection } from './cameraDashboard/LibrarySection';
import { SettingsSection } from './cameraDashboard/SettingsSection';
import { TimelineSection } from './cameraDashboard/TimelineSection';
import { ViewControlsSection } from './cameraDashboard/ViewControlsSection';
import { useAutoSnapshots } from './cameraDashboard/useAutoSnapshots';
import { useBrowserUsbCamera } from './cameraDashboard/useBrowserUsbCamera';
import { useCameraDashboardPersistence } from './cameraDashboard/useCameraDashboardPersistence';
import { useCameraMeasurement } from './cameraDashboard/useCameraMeasurement';
import { useCameraPresets } from './cameraDashboard/useCameraPresets';
import { useCameraRecording } from './cameraDashboard/useCameraRecording';
import { useClipActions } from './cameraDashboard/useClipActions';
import { useClipDraftSync } from './cameraDashboard/useClipDraftSync';
import { useMediaViewport } from './cameraDashboard/useMediaViewport';
import { useVideoStream } from './cameraDashboard/useVideoStream';
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

  useBrowserUsbCamera({
    isBrowserUsbCamera,
    videoRef,
    browserUsbStreamRef,
    webcamUsbDeviceId: prefs.webcamUsbDeviceId,
    webcamUsbDeviceLabel: prefs.webcamUsbDeviceLabel,
    setImageFailed,
    setLastFrameAt,
    setMessage,
  });

  useClipDraftSync({
    selectedClip,
    setClipDraftName, setClipDraftNotes, setClipDraftTags,
    setClipDraftJobName, setClipDraftAlbum, setClipDraftKind, setClipDraftRating,
    setClipDraftChecklist,
    setMarkerDraftLabel, setMarkerDraftTime,
    setSnapshotEditFlip, setSnapshotEditRotation, setSnapshotCrop,
    setSnapshotBrightness, setSnapshotContrast, setSnapshotSharpen, setSnapshotAnnotation,
    setTrimStart, setTrimEnd,
  });

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

  const { reconnectCamera, handleCameraError } = useCameraConnection({
    activePrinterId,
    webcamStreamPreference: prefs.webcamStreamPreference,
    updatePrinterPrefs,
    reconnectHistoryRef,
    captureAnomaly,
    setImageFailed,
    setWebRtcFailed,
    setLastFrameAt,
    setReconnectCount,
    setStreamRevision,
    setMessage,
  });

  useVideoStream({
    videoRef, isVideoStream, streamSrc, isBrowserUsbCamera, useWebRtcStream,
    webcamMainStreamProtocol: prefs.webcamMainStreamProtocol,
    webRtcIceServers: activeCamera?.webRtcIceServers ?? '',
    setLastFrameAt, setWebRtcFailed, setMessage,
    onFatalError: handleCameraError,
  });

  const { handleFrameLoad } = useMediaViewport({
    frameRef, imgRef, videoRef, isVideoStream, streamSrc,
    setMediaViewport, setLastFrameAt, setLastFrameIntervalMs, setFrameCount,
  });

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
          <CameraDashboardTopbar
            hasCamera={hasCamera}
            imageFailed={imageFailed}
            printerName={printerName}
            message={message}
            compact={compact}
            reconnectCamera={reconnectCamera}
            setFullscreen={setFullscreen}
            setActiveTab={setActiveTab}
            cameras={cameras}
            activeCameraId={prefs.activeCameraId}
            activePrinterId={activePrinterId}
            updatePrinterPrefs={updatePrinterPrefs}
            setStreamRevision={setStreamRevision}
            setImageFailed={setImageFailed}
            setWebRtcFailed={setWebRtcFailed}
            setMessage={setMessage}
          />


          <CameraViewer
            compact={compact}
            frameClassName={frameClassName}
            imageStyle={imageStyle}
            calibrationStyle={calibrationStyle}
            mediaViewportStyle={mediaViewportStyle}
            frameRef={frameRef}
            videoRef={videoRef}
            imgRef={imgRef}
            canvasRef={canvasRef}
            isVideoStream={isVideoStream}
            isBrowserUsbCamera={isBrowserUsbCamera}
            streamSrc={streamSrc}
            displayUrl={displayUrl}
            hasCamera={hasCamera}
            printerName={printerName}
            handleFrameLoad={handleFrameLoad}
            handleCameraError={handleCameraError}
            poseStillUrl={poseStillUrl}
            finalComparisonUrl={finalComparisonUrl}
            recording={recording}
            isTimelapseRecording={isTimelapseRecording}
            isAutoRecording={isAutoRecording}
            elapsedMs={elapsedMs}
            lastFrameAt={lastFrameAt}
            nowTick={nowTick}
            calibration={calibration}
            cameraOverlayMode={cameraOverlayMode}
            setCameraOverlayMode={setCameraOverlayMode}
            frameCount={frameCount}
            overlayModeOptions={overlayModeOptions}
            measurementMode={measurementMode}
            measurementStatus={measurementStatus}
            bedCornersComplete={bedCornersComplete}
            completeBedCorners={completeBedCorners}
            measuredDistanceMm={measuredDistanceMm}
            draggingBedCorner={draggingBedCorner}
            draggingRulerEndpoint={draggingRulerEndpoint}
            handleMeasurementPointerDown={handleMeasurementPointerDown}
            handleCornerPointerDown={handleCornerPointerDown}
            handleCornerPointerMove={handleCornerPointerMove}
            handleCornerPointerUp={handleCornerPointerUp}
            handleRulerPointerDown={handleRulerPointerDown}
            handleRulerPointerMove={handleRulerPointerMove}
            handleRulerPointerUp={handleRulerPointerUp}
          />

          <RecordStrip
            recording={recording}
            recordingStatusLabel={recordingStatusLabel}
            jobFileName={jobFileName}
            recordingMarkerCount={recordingMarkerCount}
            totalStorageBytes={totalStorageBytes}
          />

          {!compact && (
            <RecentCapturesStrip
              recentClips={recentClips}
              selectedClipId={selectedClip?.id}
              thumbUrls={thumbUrls}
              selectClip={selectClip}
              setEditorCollapsed={setEditorCollapsed}
            />
          )}

          {!compact && (
            <ClipEditorPanel
              editorCollapsed={editorCollapsed}
              setEditorCollapsed={setEditorCollapsed}
              selectedClip={selectedClip}
              selectedClipUrl={selectedClipUrl}
              selectedKind={selectedKind}
              compareClip={compareClip}
              compareClipUrl={compareClipUrl}
              setCompareClipId={setCompareClipId}
              snapshotClips={snapshotClips}
              compareBlend={compareBlend}
              setCompareBlend={setCompareBlend}
              clipDraftName={clipDraftName}
              setClipDraftName={setClipDraftName}
              clipDraftKind={clipDraftKind}
              setClipDraftKind={setClipDraftKind}
              clipDraftJobName={clipDraftJobName}
              setClipDraftJobName={setClipDraftJobName}
              clipDraftAlbum={clipDraftAlbum}
              setClipDraftAlbum={setClipDraftAlbum}
              clipDraftTags={clipDraftTags}
              setClipDraftTags={setClipDraftTags}
              clipDraftRating={clipDraftRating}
              setClipDraftRating={setClipDraftRating}
              clipDraftNotes={clipDraftNotes}
              setClipDraftNotes={setClipDraftNotes}
              clipDraftChecklist={clipDraftChecklist}
              toggleInspectionItem={toggleInspectionItem}
              issueDraft={issueDraft}
              setIssueDraft={setIssueDraft}
              snapshotEditFlip={snapshotEditFlip}
              setSnapshotEditFlip={setSnapshotEditFlip}
              snapshotEditRotation={snapshotEditRotation}
              setSnapshotEditRotation={setSnapshotEditRotation}
              snapshotCrop={snapshotCrop}
              setSnapshotCrop={setSnapshotCrop}
              snapshotBrightness={snapshotBrightness}
              setSnapshotBrightness={setSnapshotBrightness}
              snapshotContrast={snapshotContrast}
              setSnapshotContrast={setSnapshotContrast}
              snapshotSharpen={snapshotSharpen}
              setSnapshotSharpen={setSnapshotSharpen}
              snapshotAnnotation={snapshotAnnotation}
              setSnapshotAnnotation={setSnapshotAnnotation}
              saveSnapshotAsCopy={saveSnapshotAsCopy}
              setSaveSnapshotAsCopy={setSaveSnapshotAsCopy}
              trimStart={trimStart}
              setTrimStart={setTrimStart}
              trimEnd={trimEnd}
              setTrimEnd={setTrimEnd}
              markerDraftLabel={markerDraftLabel}
              setMarkerDraftLabel={setMarkerDraftLabel}
              markerDraftTime={markerDraftTime}
              setMarkerDraftTime={setMarkerDraftTime}
              hasCamera={hasCamera}
              recording={recording}
              busy={busy}
              startRecording={startRecording}
              captureSnapshot={captureSnapshot}
              setActiveControlSection={setActiveControlSection}
              downloadClip={downloadClip}
              toggleSelectedClipFavorite={toggleSelectedClipFavorite}
              selectClip={selectClip}
              saveSelectedClipDetails={saveSelectedClipDetails}
              exportClipBundle={exportClipBundle}
              removeClip={removeClip}
              applySelectedIssue={applySelectedIssue}
              saveSnapshotEdits={saveSnapshotEdits}
              saveTrimmedVideoCopy={saveTrimmedVideoCopy}
              trimBetweenFirstTwoMarkers={trimBetweenFirstTwoMarkers}
              makeTimelapseCopy={makeTimelapseCopy}
              addSelectedClipMarker={addSelectedClipMarker}
              removeSelectedClipMarker={removeSelectedClipMarker}
            />
          )}

        </div>

        {!compact && <aside className="cam-panel__controls" aria-label="Camera controls and saved clips">
          <ControlTabBar
            activeControlSection={activeControlSection}
            setActiveControlSection={setActiveControlSection}
          />

          {activeControlSection === 'record' && (
            <RecordSection
              recording={recording}
              elapsedMs={elapsedMs}
              hasCamera={hasCamera}
              busy={busy}
              stopRecording={stopRecording}
              startRecording={startRecording}
              captureSnapshot={captureSnapshot}
              addMarker={addMarker}
            />
          )}

          {activeControlSection === 'view' && (
            <ViewControlsSection
              showGrid={showGrid}
              setShowGrid={setShowGrid}
              showCrosshair={showCrosshair}
              setShowCrosshair={setShowCrosshair}
              flipImage={flipImage}
              setFlipImage={setFlipImage}
              rotation={rotation}
              setRotation={setRotation}
              calibration={calibration}
              setCalibration={setCalibration}
              bedWidthMm={bedWidthMm}
              bedDepthMm={bedDepthMm}
              poseStatus={poseStatus}
              overlayModeOptions={overlayModeOptions}
              cameraOverlayMode={cameraOverlayMode}
              setCameraOverlayMode={setCameraOverlayMode}
              measurementMode={measurementMode}
              setMeasurementMode={setMeasurementMode}
              setNextBedCornerIndex={setNextBedCornerIndex}
              hasCamera={hasCamera}
              bedCornersComplete={bedCornersComplete}
              homography={homography}
              capturePoseStill={capturePoseStill}
              savePoseCalibration={savePoseCalibration}
              poseStillUrl={poseStillUrl}
              clearPoseStill={clearPoseStill}
              finalComparisonUrl={finalComparisonUrl}
              setFinalComparisonUrl={setFinalComparisonUrl}
              measuredDistanceMm={measuredDistanceMm}
              measurementStatus={measurementStatus}
            />
          )}

          {activeControlSection === 'settings' && (
            <SettingsSection
              webcamStreamPreference={prefs.webcamStreamPreference}
              setCameraQuality={setCameraQuality}
              hdLiveNeedsBridge={hdLiveNeedsBridge}
              hdBridgeQuality={hdBridgeQuality}
              setHdBridgeQuality={setHdBridgeQuality}
              setStreamRevision={setStreamRevision}
              setMessage={setMessage}
              timelapseIntervalSec={timelapseIntervalSec}
              setTimelapseIntervalSec={setTimelapseIntervalSec}
              timelapseFps={timelapseFps}
              setTimelapseFps={setTimelapseFps}
              presetName={presetName}
              setPresetName={setPresetName}
              saveCameraPreset={saveCameraPreset}
              applyCameraPreset={applyCameraPreset}
              deleteCameraPreset={deleteCameraPreset}
              cameraPresets={cameraPresets}
              ptzEnabled={ptzEnabled}
              setPtzEnabled={setPtzEnabled}
              ptzSpeed={ptzSpeed}
              setPtzSpeed={setPtzSpeed}
              canUsePtz={canUsePtz}
              activeCamera={activeCamera}
              updateActiveCamera={updateActiveCamera}
              ptzPresetName={ptzPresetName}
              setPtzPresetName={setPtzPresetName}
              ptzPresetToken={ptzPresetToken}
              setPtzPresetToken={setPtzPresetToken}
              runPtzCommand={runPtzCommand}
              runPtzPreset={runPtzPreset}
              savePtzPreset={savePtzPreset}
              deletePtzPreset={deletePtzPreset}
              autoRecord={autoRecord}
              setAutoRecord={setAutoRecord}
              autoTimelapse={autoTimelapse}
              setAutoTimelapse={setAutoTimelapse}
              autoSnapshotFirstLayer={autoSnapshotFirstLayer}
              setAutoSnapshotFirstLayer={setAutoSnapshotFirstLayer}
              autoSnapshotLayer={autoSnapshotLayer}
              setAutoSnapshotLayer={setAutoSnapshotLayer}
              autoSnapshotFinish={autoSnapshotFinish}
              setAutoSnapshotFinish={setAutoSnapshotFinish}
              autoSnapshotError={autoSnapshotError}
              setAutoSnapshotError={setAutoSnapshotError}
              scheduledSnapshots={scheduledSnapshots}
              setScheduledSnapshots={setScheduledSnapshots}
              scheduledSnapshotIntervalMin={scheduledSnapshotIntervalMin}
              setScheduledSnapshotIntervalMin={setScheduledSnapshotIntervalMin}
              anomalyCapture={anomalyCapture}
              setAnomalyCapture={setAnomalyCapture}
            />
          )}

          {activeControlSection === 'health' && (
            <HealthSection
              estimatedFps={estimatedFps}
              healthPanelOpen={healthPanelOpen}
              setHealthPanelOpen={setHealthPanelOpen}
              droppedFrameWarning={droppedFrameWarning}
              frameAgeMs={frameAgeMs}
              lastFrameAt={lastFrameAt}
              nowTick={nowTick}
              frameCount={frameCount}
              reconnectCount={reconnectCount}
              reconnectHistoryRef={reconnectHistoryRef}
            />
          )}

          {activeControlSection === 'timeline' && (
            <TimelineSection
              timelineJobName={timelineJobName}
              timelineClips={timelineClips}
              busy={busy}
              selectClip={selectClip}
              setEditorCollapsed={setEditorCollapsed}
              exportClipBundle={exportClipBundle}
              generateJobReport={generateJobReport}
              generateContactSheet={generateContactSheet}
            />
          )}

          {activeControlSection === 'library' && (
            <LibrarySection
              busy={busy}
              refreshClips={refreshClips}
              selectionMode={selectionMode}
              setSelectionMode={setSelectionMode}
              selectedClipIds={selectedClipIds}
              setSelectedClipIds={setSelectedClipIds}
              selectedBulkClips={selectedBulkClips}
              clipQuery={clipQuery}
              setClipQuery={setClipQuery}
              clipFilter={clipFilter}
              setClipFilter={setClipFilter}
              clipSort={clipSort}
              setClipSort={setClipSort}
              totalStorageBytes={totalStorageBytes}
              storageByKind={storageByKind}
              storageByJob={storageByJob}
              bulkAlbum={bulkAlbum}
              setBulkAlbum={setBulkAlbum}
              bulkTags={bulkTags}
              setBulkTags={setBulkTags}
              albums={albums}
              clips={clips}
              visibleClips={visibleClips}
              selectedClip={selectedClip}
              thumbUrls={thumbUrls}
              applyBulkTags={applyBulkTags}
              exportVisibleClips={exportVisibleClips}
              exportClipBundle={exportClipBundle}
              generateContactSheet={generateContactSheet}
              generateJobReport={generateJobReport}
              selectClip={selectClip}
              toggleBulkSelection={toggleBulkSelection}
              removeClip={removeClip}
              removeVisibleClips={removeVisibleClips}
              cleanupOldClips={cleanupOldClips}
              dangerOpen={dangerOpen}
              setDangerOpen={setDangerOpen}
              cleanupDays={cleanupDays}
              setCleanupDays={setCleanupDays}
            />
          )}
        </aside>}
      </div>

      {!compact && fullscreen && (
        <FullscreenViewer
          hasCamera={hasCamera}
          isVideoStream={isVideoStream}
          streamSrc={streamSrc}
          printerName={printerName}
          frameClassName={frameClassName}
          imageStyle={imageStyle}
          lastFrameAt={lastFrameAt}
          nowTick={nowTick}
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  );
}
