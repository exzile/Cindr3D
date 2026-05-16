import "./ExportDialog.css";
import { errorMessage } from '../../utils/errorHandling';
import { useCallback, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { DialogShell } from './common/DialogShell';
import { Vector3 } from 'three';
import type { Mesh, Object3D } from 'three';
import { useCADStore } from '../../store/cadStore';
import { usePrinterStore } from '../../store/printerStore';
import { GeometryEngine } from '../../engine/GeometryEngine';
import { STLExporter, ThreeMFExporter } from '../../engine/STLExporter';
import { GCodeGenerator, DEFAULT_SLICER_SETTINGS } from '../../engine/GCodeGenerator';
import type { SlicerSettings } from '../../engine/GCodeGenerator';

type ExportFormat = 'stl-binary' | 'stl-ascii' | '3mf' | 'obj' | 'gcode';
type InfillPattern = SlicerSettings['infillPattern'];

function getRevolveAxisVector(axis: unknown): Vector3 {
  switch (axis) {
    case 'X': return new Vector3(1, 0, 0);
    case 'Z': return new Vector3(0, 0, 1);
    case 'Y':
    default:
      return new Vector3(0, 1, 0);
  }
}

export default function ExportDialog() {
  const showExportDialog = useCADStore((s) => s.showExportDialog);
  const setShowExportDialog = useCADStore((s) => s.setShowExportDialog);
  const features = useCADStore((s) => s.features);
  const sketches = useCADStore((s) => s.sketches);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const printerService = usePrinterStore((s) => s.service);
  const printerConnected = usePrinterStore((s) => s.connected);

  const [format, setFormat] = useState<ExportFormat>('stl-binary');
  const [settings, setSettings] = useState<SlicerSettings>({ ...DEFAULT_SLICER_SETTINGS });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sendToPrinter, setSendToPrinter] = useState(false);
  const [startPrintAfterUpload, setStartPrintAfterUpload] = useState(false);

  const disposeTransientMesh = (mesh: Object3D, disposable: boolean) => {
    if (!disposable) return;
    const m = mesh as Mesh;
    m.geometry?.dispose?.();
    const mats = m.material;
    if (Array.isArray(mats)) {
      mats.forEach((mat) => mat?.dispose?.());
    } else {
      mats?.dispose?.();
    }
  };

  const updateSetting = <K extends keyof SlicerSettings>(key: K, value: SlicerSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const getMeshForExport = useCallback((): { mesh: Object3D; disposable: boolean } | null => {
    // Collect all visible extruded/revolved bodies
    for (const feature of features) {
      if (!feature.visible) continue;

      if (feature.type === 'extrude' && feature.sketchId) {
        const sketch = sketches.find(s => s.id === feature.sketchId);
        if (!sketch) continue;
        const distance = typeof feature.params.distance === 'number' ? feature.params.distance : 10;
        const mesh = GeometryEngine.extrudeSketch(sketch, distance);
        if (mesh) return { mesh, disposable: true };
      }

      if (feature.type === 'revolve' && feature.sketchId) {
        const sketch = sketches.find(s => s.id === feature.sketchId);
        if (!sketch) continue;
        const angleDeg = typeof feature.params.angle === 'number' ? feature.params.angle : 360;
        const angle2Deg = typeof feature.params.angle2 === 'number' ? feature.params.angle2 : angleDeg;
        const direction = (feature.params.direction as 'one-side' | 'symmetric' | 'two-sides') || 'one-side';
        const axis = getRevolveAxisVector(feature.params.axis);
        const { phiStart, sweep } = GeometryEngine.resolveRevolveSweep(angleDeg, angle2Deg, direction);
        const mesh = GeometryEngine.revolveSketch(sketch, sweep, axis, phiStart);
        if (mesh) return { mesh, disposable: true };
      }

      if (feature.type === 'import' && feature.mesh) {
        return { mesh: feature.mesh, disposable: false };
      }
    }
    return null;
  }, [features, sketches]);

  const handleExport = async () => {
    const source = getMeshForExport();
    if (!source) {
      setStatusMessage('No geometry to export. Create an extrusion or import a model first.');
      return;
    }

    const { mesh, disposable } = source;

    mesh.updateMatrixWorld(true);

    let blob: Blob;
    let filename: string;

    try {
      switch (format) {
        case 'stl-binary': {
          const buffer = STLExporter.exportBinary(mesh);
          blob = new Blob([buffer], { type: 'application/sla' });
          filename = 'model.stl';
          break;
        }
        case 'stl-ascii': {
          const text = STLExporter.exportASCII(mesh);
          blob = new Blob([text], { type: 'text/plain' });
          filename = 'model.stl';
          break;
        }
        case '3mf': {
          blob = await ThreeMFExporter.export(mesh);
          filename = 'model.3mf';
          break;
        }
        case 'obj': {
          const text = STLExporter.exportOBJ(mesh);
          blob = new Blob([text], { type: 'text/plain' });
          filename = 'model.obj';
          break;
        }
        case 'gcode': {
          const generator = new GCodeGenerator(settings);
          const gcode = generator.generate(mesh);
          blob = new Blob([gcode], { type: 'text/plain' });
          filename = 'model.gcode';
          break;
        }
        default:
          return;
      }

      if (sendToPrinter && printerService && printerConnected) {
        setStatusMessage(`Uploading ${filename} to printer...`);
        const remotePath = `0:/gcodes/${filename}`;
        await printerService.uploadFile(remotePath, blob);
        if (startPrintAfterUpload) {
          await printerService.startPrint(remotePath);
        }
        setStatusMessage(
          startPrintAfterUpload
            ? `Uploaded and started printing ${filename}`
            : `Uploaded ${filename} to printer`
        );
      } else {
        // Download locally
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatusMessage(`Exported ${filename}`);
      }

      setShowExportDialog(false);
    } catch (err) {
      setStatusMessage(`Export failed: ${errorMessage(err, 'Unknown error')}`);
    } finally {
      disposeTransientMesh(mesh, disposable);
    }
  };

  const estimate = useMemo(() => {
    if (!showExportDialog || format !== 'gcode') return null;
    const source = getMeshForExport();
    if (!source) return null;
    const { mesh, disposable } = source;
    mesh.updateMatrixWorld(true);
    const gen = new GCodeGenerator(settings);
    const result = gen.estimate(mesh);

    disposeTransientMesh(mesh, disposable);

    return result;
  }, [showExportDialog, format, settings, getMeshForExport]);

  if (!showExportDialog) return null;

  return (
    <DialogShell
      title="Export for 3D Printing"
      onClose={() => setShowExportDialog(false)}
      className="export-dialog"
      footer={
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={() => setShowExportDialog(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleExport}>
            <Download size={14} style={{ marginRight: 6 }} />
            {sendToPrinter ? 'Upload to Printer' : 'Export'}
          </button>
        </div>
      }
    >
        <div className="export-body">
          {/* Format selection */}
          <div className="form-group">
            <label>Format</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              <option value="stl-binary">STL (Binary)</option>
              <option value="stl-ascii">STL (ASCII)</option>
              <option value="3mf">3MF</option>
              <option value="obj">OBJ</option>
              <option value="gcode">G-Code (Sliced)</option>
            </select>
          </div>

          {/* G-code specific settings */}
          {format === 'gcode' && (
            <>
              <div className="settings-grid">
                <div className="form-group">
                  <label>Layer Height (mm)</label>
                  <input
                    type="number"
                    value={settings.layerHeight}
                    onChange={(e) => updateSetting('layerHeight', parseFloat(e.target.value) || 0.2)}
                    step={0.05}
                    min={0.05}
                    max={0.5}
                  />
                </div>
                <div className="form-group">
                  <label>Nozzle (mm)</label>
                  <input
                    type="number"
                    value={settings.nozzleDiameter}
                    onChange={(e) => updateSetting('nozzleDiameter', parseFloat(e.target.value) || 0.4)}
                    step={0.1}
                    min={0.1}
                    max={1.0}
                  />
                </div>
                <div className="form-group">
                  <label>Infill (%)</label>
                  <input
                    type="number"
                    value={settings.infillDensity}
                    onChange={(e) => updateSetting('infillDensity', parseInt(e.target.value) || 20)}
                    min={0}
                    max={100}
                  />
                </div>
                <div className="form-group">
                  <label>Infill Pattern</label>
                  <select
                    value={settings.infillPattern}
                    onChange={(e) => updateSetting('infillPattern', e.target.value as InfillPattern)}
                  >
                    <option value="grid">Grid</option>
                    <option value="lines">Lines</option>
                    <option value="triangles">Triangles</option>
                    <option value="gyroid">Gyroid</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Nozzle Temp (C)</label>
                  <input
                    type="number"
                    value={settings.nozzleTemp}
                    onChange={(e) => updateSetting('nozzleTemp', parseInt(e.target.value) || 210)}
                    min={150}
                    max={300}
                  />
                </div>
                <div className="form-group">
                  <label>Bed Temp (C)</label>
                  <input
                    type="number"
                    value={settings.bedTemp}
                    onChange={(e) => updateSetting('bedTemp', parseInt(e.target.value) || 60)}
                    min={0}
                    max={120}
                  />
                </div>
                <div className="form-group">
                  <label>Print Speed (mm/s)</label>
                  <input
                    type="number"
                    value={settings.printSpeed}
                    onChange={(e) => updateSetting('printSpeed', parseInt(e.target.value) || 50)}
                    min={10}
                    max={300}
                  />
                </div>
                <div className="form-group">
                  <label>Walls</label>
                  <input
                    type="number"
                    value={settings.wallCount}
                    onChange={(e) => updateSetting('wallCount', parseInt(e.target.value) || 2)}
                    min={1}
                    max={10}
                  />
                </div>
              </div>

              {/* Advanced settings toggle */}
              <button
                className="btn btn-secondary advanced-toggle"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
              </button>

              {showAdvanced && (
                <div className="settings-grid">
                  <div className="form-group">
                    <label>First Layer Height (mm)</label>
                    <input
                      type="number"
                      value={settings.firstLayerHeight}
                      onChange={(e) => updateSetting('firstLayerHeight', parseFloat(e.target.value) || 0.3)}
                      step={0.05}
                    />
                  </div>
                  <div className="form-group">
                    <label>Filament Diameter (mm)</label>
                    <input
                      type="number"
                      value={settings.filamentDiameter}
                      onChange={(e) => updateSetting('filamentDiameter', parseFloat(e.target.value) || 1.75)}
                      step={0.05}
                    />
                  </div>
                  <div className="form-group">
                    <label>Retraction (mm)</label>
                    <input
                      type="number"
                      value={settings.retractionDistance}
                      onChange={(e) => updateSetting('retractionDistance', parseFloat(e.target.value) || 5)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Top Layers</label>
                    <input
                      type="number"
                      value={settings.topLayers}
                      onChange={(e) => updateSetting('topLayers', parseInt(e.target.value) || 4)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Bottom Layers</label>
                    <input
                      type="number"
                      value={settings.bottomLayers}
                      onChange={(e) => updateSetting('bottomLayers', parseInt(e.target.value) || 3)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Skirt Lines</label>
                    <input
                      type="number"
                      value={settings.skirtLines}
                      onChange={(e) => updateSetting('skirtLines', parseInt(e.target.value) || 2)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Bed X (mm)</label>
                    <input
                      type="number"
                      value={settings.bedSizeX}
                      onChange={(e) => updateSetting('bedSizeX', parseInt(e.target.value) || 220)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Bed Y (mm)</label>
                    <input
                      type="number"
                      value={settings.bedSizeY}
                      onChange={(e) => updateSetting('bedSizeY', parseInt(e.target.value) || 220)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Fan Speed (%)</label>
                    <input
                      type="number"
                      value={settings.fanSpeed}
                      onChange={(e) => updateSetting('fanSpeed', parseInt(e.target.value) || 100)}
                      min={0}
                      max={100}
                    />
                  </div>
                  <div className="form-group">
                    <label>Support</label>
                    <select
                      value={settings.supportEnabled ? 'yes' : 'no'}
                      onChange={(e) => updateSetting('supportEnabled', e.target.value === 'yes')}
                    >
                      <option value="no">Disabled</option>
                      <option value="yes">Enabled</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Print estimate */}
              {estimate && (
                <div className="print-estimate">
                  <h4>Print Estimate</h4>
                  <div className="estimate-grid">
                    <span>Dimensions</span>
                    <span>{estimate.dimensions.x} x {estimate.dimensions.y} x {estimate.dimensions.z} mm</span>
                    <span>Layers</span>
                    <span>{estimate.layerCount}</span>
                    <span>Filament</span>
                    <span>{(estimate.filamentLengthMm / 1000).toFixed(1)}m ({estimate.filamentWeightG}g)</span>
                    <span>Est. Time</span>
                    <span>
                      {Math.floor(estimate.estimatedTimeMinutes / 60)}h{' '}
                      {estimate.estimatedTimeMinutes % 60}m
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Send to printer option */}
          {printerConnected && (
            <div className="printer-upload-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={sendToPrinter}
                  onChange={(e) => setSendToPrinter(e.target.checked)}
                />
                Send directly to printer
              </label>
              {sendToPrinter && (
                <label className="checkbox-label indent">
                  <input
                    type="checkbox"
                    checked={startPrintAfterUpload}
                    onChange={(e) => setStartPrintAfterUpload(e.target.checked)}
                  />
                  Start printing after upload
                </label>
              )}
            </div>
          )}
        </div>
    </DialogShell>
  );
}
