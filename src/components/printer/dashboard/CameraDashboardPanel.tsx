import { useMemo, useRef, useState } from 'react';
import { useNow } from '../../../hooks/useNow';
import { usePrinterStore } from '../../../store/printerStore';
import { type CameraOverlayMode } from './CameraOverlayPanel';
import { clipKind } from './cameraDashboard/clipStore';
import { type MediaViewportRect } from './cameraDashboard/snapshotEdit';
import { type CameraMeasurementCalibration } from './cameraDashboard/types';
import { buildCameraStreamState } from './cameraDashboard/streamState';
import { CameraDashboardControls } from './cameraDashboard/CameraDashboardControls';
import { CameraDashboardTopbar } from './cameraDashboard/CameraDashboardTopbar';
import { CameraViewer } from './cameraDashboard/CameraViewer';
import { ClipEditorPanel } from './cameraDashboard/ClipEditorPanel';
import { FullscreenViewer } from './cameraDashboard/FullscreenViewer';
import { RecentCapturesStrip } from './cameraDashboard/RecentCapturesStrip';
import { RecordStrip } from './cameraDashboard/RecordStrip';
import { useCameraConfigMutations } from './cameraDashboard/useCameraConfigMutations';
import { useCameraConnection } from './cameraDashboard/useCameraConnection';
import { useCameraFrameStyles } from './cameraDashboard/useCameraFrameStyles';
import { useResolvedDashboardPrefs } from './cameraDashboard/useResolvedDashboardPrefs';
import { useAutoSnapshots } from './cameraDashboard/useAutoSnapshots';
import { useBrowserUsbCamera } from './cameraDashboard/useBrowserUsbCamera';
import { useDashboardPrefsState } from './cameraDashboard/useDashboardPrefsState';
import { useCameraMeasurement } from './cameraDashboard/useCameraMeasurement';
import { useCameraPresets } from './cameraDashboard/useCameraPresets';
import { useCameraRecording } from './cameraDashboard/useCameraRecording';
import { useClipActions } from './cameraDashboard/useClipActions';
import { useClipEditorDrafts } from './cameraDashboard/useClipEditorDrafts';
import { useClipLibrary } from './cameraDashboard/useClipLibrary';
import { useClipThumbnailUrls } from './cameraDashboard/useClipThumbnailUrls';
import { useMediaViewport } from './cameraDashboard/useMediaViewport';
import { useVideoStream } from './cameraDashboard/useVideoStream';
import { usePtzControls } from './cameraDashboard/usePtzControls';
import { useSnapshotCapture } from './cameraDashboard/useSnapshotCapture';
import { useStreamHealth } from './cameraDashboard/useStreamHealth';
import './CameraDashboardPanel.css';

interface CameraDashboardPanelProps {
  compact?: boolean;
}

const OVERLAY_MODE_OPTIONS: Array<{ mode: CameraOverlayMode; label: string; hint: string }> = [
  { mode: 'camera', label: 'Camera', hint: 'Live camera only' },
  { mode: 'both',   label: 'AR',     hint: 'Camera with aligned print preview' },
  { mode: 'print',  label: 'Preview', hint: 'Print preview overlay with camera dimmed' },
];

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
  const { cameras, prefs, activeCamera, dashboardPrefs } = useResolvedDashboardPrefs(activePrinter);

  // DOM refs the JSX attaches.
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const nowTick = useNow(1000);
  const {
    imageFailed, setImageFailed,
    webRtcFailed, setWebRtcFailed,
    streamRevision, setStreamRevision,
    lastFrameAt, setLastFrameAt,
    lastFrameIntervalMs, setLastFrameIntervalMs,
    frameCount, setFrameCount,
    reconnectCount, setReconnectCount,
    frameAgeMs, estimatedFps, droppedFrameWarning,
  } = useStreamHealth(nowTick);
  const [fullscreen, setFullscreen] = useState(false);
  const [showGrid, setShowGrid] = useState(() => dashboardPrefs.showGrid);
  const [showCrosshair, setShowCrosshair] = useState(() => dashboardPrefs.showCrosshair);
  const [flipImage, setFlipImage] = useState(() => dashboardPrefs.flipImage);
  const [rotation, setRotation] = useState(() => dashboardPrefs.rotation % 360);
  const [cameraOverlayMode, setCameraOverlayMode] = useState<CameraOverlayMode>('camera');
  const [mediaViewport, setMediaViewport] = useState<MediaViewportRect>({ left: 0, top: 0, width: 100, height: 100 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

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
    bedWidthMm, bedDepthMm,
    homography, measuredDistanceMm,
    completeBedCorners, bedCornersComplete, poseStatus,
    measurementStatus,
    handleMeasurementPointerDown,
    handleCornerPointerDown, handleCornerPointerMove, handleCornerPointerUp,
    handleRulerPointerDown, handleRulerPointerMove, handleRulerPointerUp,
    savePoseCalibration, clearPoseStill,
  } = measurement;

  const {
    autoRecord, setAutoRecord,
    autoTimelapse, setAutoTimelapse,
    autoSnapshotFirstLayer, setAutoSnapshotFirstLayer,
    autoSnapshotLayer, setAutoSnapshotLayer,
    autoSnapshotFinish, setAutoSnapshotFinish,
    autoSnapshotError, setAutoSnapshotError,
    scheduledSnapshots, setScheduledSnapshots,
    scheduledSnapshotIntervalMin, setScheduledSnapshotIntervalMin,
    anomalyCapture, setAnomalyCapture,
    timelapseIntervalSec, setTimelapseIntervalSec,
    timelapseFps, setTimelapseFps,
    healthPanelOpen, setHealthPanelOpen,
    activeControlSection, setActiveControlSection,
    editorCollapsed, setEditorCollapsed,
    cameraPresets, setCameraPresets,
    ptzEnabled, setPtzEnabled,
    ptzSpeed, setPtzSpeed,
    hdBridgeQuality, setHdBridgeQuality,
  } = useDashboardPrefsState({
    activePrinterId, dashboardPrefs, updatePrinterPrefs,
    viewMode: { showGrid, setShowGrid, showCrosshair, setShowCrosshair, flipImage, setFlipImage, rotation, setRotation },
    calibration,
    setCalibration, setMeasurementMode, setNextBedCornerIndex,
    setPoseStillUrl, setFinalComparisonUrl,
  });

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

  const printerId = activePrinter?.id ?? 'default-printer';
  const printerName = activePrinter?.name ?? 'Printer';

  const {
    clips, setClips,
    selectedClip, setSelectedClip,
    selectedClipUrl, setSelectedClipUrl,
    selectedClipUrlRef,
    clipFilter, setClipFilter,
    clipSort, setClipSort,
    clipQuery, setClipQuery,
    compareClipId, setCompareClipId,
    selectedClipIds, setSelectedClipIds,
    selectionMode, setSelectionMode,
    totalStorageBytes, storageByKind, storageByJob,
    albums, snapshotClips, compareClip,
    selectedBulkClips, visibleClips, recentClips,
    timelineJobName, timelineClips,
    refreshClips,
  } = useClipLibrary({ printerId, jobFileName, setBusy, setMessage });
  const thumbUrls = useClipThumbnailUrls(clips);
  const compareClipUrl = compareClip ? thumbUrls[compareClip.id] : '';

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
  const isPrintActive = printStatus === 'processing' || printStatus === 'simulating';
  const canUsePtz = Boolean(activeCamera?.ptzEnabled && activeCamera.ptzProvider !== 'off');
  const activePtzStartPreset = activeCamera?.ptzPresets.find((preset) => preset.id === activeCamera.ptzStartPresetId);
  const selectedKind = selectedClip ? clipKind(selectedClip) : null;

  useBrowserUsbCamera({
    isBrowserUsbCamera,
    videoRef,
    webcamUsbDeviceId: prefs.webcamUsbDeviceId,
    webcamUsbDeviceLabel: prefs.webcamUsbDeviceLabel,
    setImageFailed,
    setLastFrameAt,
    setMessage,
  });

  const {
    clipDraftName, setClipDraftName,
    clipDraftNotes, setClipDraftNotes,
    clipDraftTags, setClipDraftTags,
    clipDraftJobName, setClipDraftJobName,
    clipDraftAlbum, setClipDraftAlbum,
    clipDraftKind, setClipDraftKind,
    clipDraftRating, setClipDraftRating,
    clipDraftChecklist, setClipDraftChecklist,
    issueDraft, setIssueDraft,
    markerDraftLabel, setMarkerDraftLabel,
    markerDraftTime, setMarkerDraftTime,
    snapshotEditFlip, setSnapshotEditFlip,
    snapshotEditRotation, setSnapshotEditRotation,
    snapshotCrop, setSnapshotCrop,
    snapshotBrightness, setSnapshotBrightness,
    snapshotContrast, setSnapshotContrast,
    snapshotSharpen, setSnapshotSharpen,
    snapshotAnnotation, setSnapshotAnnotation,
    saveSnapshotAsCopy, setSaveSnapshotAsCopy,
    trimStart, setTrimStart,
    trimEnd, setTrimEnd,
  } = useClipEditorDrafts(selectedClip);

  const {
    drawFrame, canvasBlob, captureSnapshot, capturePoseStill,
    captureFinalComparisonFrame, captureAnomaly,
  } = useSnapshotCapture({
    imgRef, videoRef, canvasRef,
    isVideoStream, hasCamera,
    printerId, printerName, jobFileName,
    calibrationPose: calibration.pose,
    setPoseStillUrl, setMeasurementMode, setNextBedCornerIndex,
    setFinalComparisonUrl, setCameraOverlayMode,
    setLastFrameAt, setBusy, setMessage, refreshClips,
    anomalyCapture, scheduledSnapshots, scheduledSnapshotIntervalMin,
    isPrintActive, droppedFrameWarning,
  });

  const {
    startRecording, stopRecording, addMarker,
    recordingKind, elapsedMs,
    recording, isTimelapseRecording, isAutoRecording,
    recordingStatusLabel, recordingMarkerCount,
  } = useCameraRecording({
    canvasRef,
    drawFrame, canvasBlob, hasCamera, canUseBackendRecording,
    isServerUsbCamera, backendRecordingUrl,
    hdBridgeQuality, timelapseFps, timelapseIntervalSec,
    autoRecord, autoTimelapse, isPrintActive, jobFileName,
    printerId, printerName,
    setBusy, setMessage, refreshClips,
    captureAnomaly,
  });

  useAutoSnapshots({
    hasCamera, isPrintActive, printStatus, currentLayer,
    autoSnapshotFirstLayer, autoSnapshotLayer, autoSnapshotFinish, autoSnapshotError,
    captureSnapshot, captureFinalComparisonFrame,
  });



  const { updateActiveCamera, setCameraQuality } = useCameraConfigMutations({
    activePrinterId, activeCamera, cameras: prefs.cameras, hdMainIsRtsp,
    updatePrinterPrefs, setStreamRevision, setMessage,
  });

  const { saveCameraPreset, applyCameraPreset, deleteCameraPreset } = useCameraPresets({
    cameraPresets, setCameraPresets, setMessage,
    showGrid, showCrosshair, flipImage, rotation, timelapseIntervalSec, timelapseFps,
    setShowGrid, setShowCrosshair, setFlipImage, setRotation, setTimelapseIntervalSec, setTimelapseFps,
  });

  const { runPtzCommand, runPtzPreset, savePtzPreset, deletePtzPreset } = usePtzControls({
    activeCamera, hostname: config.hostname, canUsePtz, ptzEnabled, ptzSpeed,
    isPrintActive, printStatus,
    activePtzStartPreset, setMessage, updateActiveCamera,
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
    clips, visibleClips, timelineClips, timelineJobName,
    printerId, printerName,
    setBusy, setMessage, refreshClips,
  });

  const { reconnectCamera, handleCameraError, reconnectHistoryRef } = useCameraConnection({
    activePrinterId,
    webcamStreamPreference: prefs.webcamStreamPreference,
    updatePrinterPrefs,
    captureAnomaly,
    setImageFailed,
    setWebRtcFailed,
    setLastFrameAt,
    setReconnectCount,
    setStreamRevision,
    setMessage,
  });

  useVideoStream({
    videoRef, isVideoStream, streamSrc, cameraSourceUrl, webRtcUrl,
    activeCameraId: activeCamera?.id,
    isBrowserUsbCamera, useWebRtcStream,
    webcamMainStreamProtocol: prefs.webcamMainStreamProtocol,
    webRtcIceServers: activeCamera?.webRtcIceServers ?? '',
    setLastFrameAt, setImageFailed, setWebRtcFailed, setMessage,
    onFatalError: handleCameraError,
  });

  const { handleFrameLoad } = useMediaViewport({
    frameRef, imgRef, videoRef, isVideoStream, streamSrc,
    setMediaViewport, setLastFrameAt, setLastFrameIntervalMs, setFrameCount,
  });

  const { frameClassName, imageStyle, calibrationStyle, mediaViewportStyle } = useCameraFrameStyles({
    showGrid, showCrosshair, measurementMode, cameraOverlayMode,
    flipImage, rotation, calibration, mediaViewport,
  });

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
            overlayModeOptions={OVERLAY_MODE_OPTIONS}
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

        {!compact && (
          <CameraDashboardControls
            activeControlSection={activeControlSection}
            setActiveControlSection={setActiveControlSection}
            recordProps={{
              recording, elapsedMs, hasCamera, busy,
              stopRecording, startRecording, captureSnapshot, addMarker,
            }}
            viewProps={{
              showGrid, setShowGrid, showCrosshair, setShowCrosshair,
              flipImage, setFlipImage, rotation, setRotation,
              calibration, setCalibration, bedWidthMm, bedDepthMm,
              poseStatus, overlayModeOptions: OVERLAY_MODE_OPTIONS,
              cameraOverlayMode, setCameraOverlayMode,
              measurementMode, setMeasurementMode, setNextBedCornerIndex,
              hasCamera, bedCornersComplete, homography,
              capturePoseStill, savePoseCalibration,
              poseStillUrl, clearPoseStill,
              finalComparisonUrl, setFinalComparisonUrl,
              measuredDistanceMm, measurementStatus,
            }}
            settingsProps={{
              webcamStreamPreference: prefs.webcamStreamPreference,
              setCameraQuality, hdLiveNeedsBridge,
              hdBridgeQuality, setHdBridgeQuality,
              setStreamRevision, setMessage,
              timelapseIntervalSec, setTimelapseIntervalSec,
              timelapseFps, setTimelapseFps,
              saveCameraPreset, applyCameraPreset, deleteCameraPreset, cameraPresets,
              ptzEnabled, setPtzEnabled, ptzSpeed, setPtzSpeed, canUsePtz,
              activeCamera, updateActiveCamera,
              runPtzCommand, runPtzPreset, savePtzPreset, deletePtzPreset,
              autoRecord, setAutoRecord,
              autoTimelapse, setAutoTimelapse,
              autoSnapshotFirstLayer, setAutoSnapshotFirstLayer,
              autoSnapshotLayer, setAutoSnapshotLayer,
              autoSnapshotFinish, setAutoSnapshotFinish,
              autoSnapshotError, setAutoSnapshotError,
              scheduledSnapshots, setScheduledSnapshots,
              scheduledSnapshotIntervalMin, setScheduledSnapshotIntervalMin,
              anomalyCapture, setAnomalyCapture,
            }}
            healthProps={{
              estimatedFps, healthPanelOpen, setHealthPanelOpen,
              droppedFrameWarning, frameAgeMs, lastFrameAt, nowTick,
              frameCount, reconnectCount, reconnectHistoryRef,
            }}
            timelineProps={{
              timelineJobName, timelineClips, busy,
              selectClip, setEditorCollapsed,
              exportClipBundle, generateJobReport, generateContactSheet,
            }}
            libraryProps={{
              busy, refreshClips,
              selectionMode, setSelectionMode,
              selectedClipIds, setSelectedClipIds, selectedBulkClips,
              clipQuery, setClipQuery,
              clipFilter, setClipFilter,
              clipSort, setClipSort,
              totalStorageBytes, storageByKind, storageByJob, albums,
              clips, visibleClips, selectedClip, thumbUrls,
              applyBulkTags, exportVisibleClips, exportClipBundle,
              generateContactSheet, generateJobReport,
              selectClip, toggleBulkSelection,
              removeClip, removeVisibleClips, cleanupOldClips,
            }}
          />
        )}
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
