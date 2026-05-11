import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import { PrintSpaceLights } from '../../../components/canvas/PrintSpaceLights';
import { CALIBRATION_STL_URLS, getCalibrationModels } from '../../calibrationModels';
import { useSlicerStore } from '../../../store/slicerStore';

interface StepLoadModelProps {
  testType: string;
}

// Mesh rendered in the local preview canvas — no shared scene.
function PreviewMesh({ geometry }: { geometry: THREE.BufferGeometry }) {
  return (
    <Center>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#7ab8f5" metalness={0.05} roughness={0.65} />
      </mesh>
    </Center>
  );
}

export function StepLoadModel({ testType }: StepLoadModelProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** User-selected custom STL file. Null = use the built-in calibration model. */
  const [customFile, setCustomFile] = useState<File | null>(null);
  const runIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sliceProgress      = useSlicerStore((s) => s.sliceProgress);
  const importFileToPlate  = useSlicerStore((s) => s.importFileToPlate);
  const startSlice         = useSlicerStore((s) => s.startSlice);
  const clearPlate         = useSlicerStore((s) => s.clearPlate);
  const centerPlateObject  = useSlicerStore((s) => s.centerPlateObject);

  const modelEntry = useMemo(
    () => getCalibrationModels().find((m) => m.testType === testType),
    [testType],
  );
  const defaultStlUrl = CALIBRATION_STL_URLS[testType];

  // Dispose the cloned preview geometry when it is replaced or on unmount.
  useEffect(() => () => { geometry?.dispose(); }, [geometry]);

  /** Resolve a Blob from either the custom file or the default URL. */
  const resolveBlob = useCallback(async (): Promise<{ blob: Blob; name: string } | null> => {
    if (customFile) {
      return { blob: customFile, name: customFile.name };
    }
    if (!defaultStlUrl) return null;
    const response = await fetch(defaultStlUrl);
    return { blob: await response.blob(), name: `${testType}.stl` };
  }, [customFile, defaultStlUrl, testType]);

  useEffect(() => {
    // Require at least one source.
    if (!customFile && !defaultStlUrl) return;

    const myRun = ++runIdRef.current;
    let disposed = false;
    const cancelled = () => disposed || runIdRef.current !== myRun;
    setLoading(true);
    setLoadError(null);
    setGeometry(null);

    (async () => {
      try {
        const source = await resolveBlob();
        if (!source || cancelled()) return;

        const { blob, name } = source;

        // Parse for the local preview canvas.
        const { FileImporter } = await import('../../../engine/FileImporter');
        const previewFile = new File([blob], name, { type: 'model/stl' });
        const group = await FileImporter.importFile(previewFile);
        if (cancelled()) return;

        let geo: THREE.BufferGeometry | null = null;
        group.traverse((child) => {
          if (geo) return;
          if ((child as THREE.Mesh).isMesh) {
            geo = ((child as THREE.Mesh).geometry as THREE.BufferGeometry).clone();
          }
        });
        if (geo) {
          (geo as THREE.BufferGeometry).computeBoundingBox();
          (geo as THREE.BufferGeometry).computeVertexNormals();
          setGeometry(geo);
        }

        // Load into the slicer plate and auto-start the slice.
        if (!cancelled()) {
          clearPlate();
          const plateFile = new File([blob], name, { type: 'model/stl' });
          // Pre-warm the dynamic imports that autoArrange uses so they are cached
          // and autoArrange (floating async inside importFileToPlate) can finish
          // synchronously after we await importFileToPlate.
          await Promise.all([
            import('../../../engine/binPacker'),
            import('../../../utils/bedMeshArrange'),
          ]);
          const plateId = await importFileToPlate(plateFile);
          // Yield ≥ 50 ms so the floating autoArrange (two dynamic-import
          // microtasks even when pre-warmed) fully completes before centering.
          await new Promise<void>((r) => setTimeout(r, 50));
          // Center the model on the build plate before slicing.
          if (plateId && !cancelled()) centerPlateObject(plateId);
          if (!cancelled()) startSlice();
        }
      } catch (err) {
        if (!cancelled()) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled()) setLoading(false);
      }
    })();

    return () => { disposed = true; };
    // importFileToPlate / startSlice / clearPlate are stable Zustand actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultStlUrl, testType, customFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) setCustomFile(file);
    // Reset input value so the same file can be re-picked if needed.
    e.target.value = '';
  };

  const handleUseDefault = () => setCustomFile(null);

  const sliceStage = sliceProgress.stage;
  const sliceMsg =
    sliceStage === 'complete' ? 'Slice complete — click Next to preview layers.' :
    sliceStage === 'error'    ? `Slice error: ${sliceProgress.message}` :
    sliceStage === 'idle'     ? 'Model loaded. Slice starting in background…' :
    loading                   ? 'Loading model…' :
                                `Slicing… ${Math.round(sliceProgress.percent)}%`;

  return (
    <div className="calib-step">

      {modelEntry && <p>{modelEntry.description}</p>}

      {/* Source selector */}
      <div className="calib-step__model-source">
        <div className="calib-step__model-source-info">
          {customFile ? (
            <>
              <span className="calib-step__model-source-name">{customFile.name}</span>
              <span className="calib-step__muted">(custom file)</span>
            </>
          ) : (
            <>
              <span className="calib-step__model-source-name">
                {modelEntry?.filename ?? testType} <span className="calib-step__muted">(default)</span>
              </span>
            </>
          )}
        </div>
        <div className="calib-step__model-source-actions">
          {customFile && (
            <button type="button" onClick={handleUseDefault}>
              Use default
            </button>
          )}
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            {customFile ? 'Replace file…' : 'Choose custom STL…'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".stl"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* 3-D preview */}
      <div className="calib-step__model-canvas">
        {loadError ? (
          <div className="calib-step__model-placeholder">Failed to load: {loadError}</div>
        ) : geometry ? (
          <Canvas
            frameloop="demand"
            camera={{ position: [0, -90, 25], up: [0, 0, 1], fov: 42 }}
            style={{ width: '100%', height: '100%' }}
          >
            <PrintSpaceLights />
            <PreviewMesh geometry={geometry} />
            <OrbitControls enablePan={false} />
          </Canvas>
        ) : (
          <div className="calib-step__model-placeholder">
            {loading ? 'Loading model…' : 'No model loaded'}
          </div>
        )}
      </div>

      <div className="calib-step__checklist">
        <span>{sliceMsg}</span>
        {modelEntry && !customFile && (
          <span>Base size: {modelEntry.baseDimMm} mm · nozzle {modelEntry.baseNozzleDiameter} mm · layer {modelEntry.baseLayerHeight} mm</span>
        )}
      </div>
    </div>
  );
}
