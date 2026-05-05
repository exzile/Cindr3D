import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, WifiOff, Grid3x3, Play, Save, Trash2, AlertCircle } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { useSlicerStore } from '../../store/slicerStore';
import { MoonrakerService, type MoonrakerBedMesh } from '../../services/MoonrakerService';
import './KlipperTabs.css';

function meshColor(v: number, min: number, max: number): string {
  if (max === min) return '#22c55e';
  const t = (v - min) / (max - min);
  if (t < 0.25) {
    const s = t / 0.25;
    return `rgb(${Math.round(59 + 30 * s)}, ${Math.round(130 + 67 * s)}, ${Math.round(246 - 50 * s)})`;
  }
  if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return `rgb(${Math.round(89 + 100 * s)}, ${Math.round(197 - 3 * s)}, ${Math.round(196 - 50 * s)})`;
  }
  if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return `rgb(${Math.round(189 + 56 * s)}, ${Math.round(194 - 36 * s)}, ${Math.round(146 - 78 * s)})`;
  }
  const s = (t - 0.75) / 0.25;
  return `rgb(${Math.round(245 - 6 * s)}, ${Math.round(158 - 100 * s)}, ${Math.round(68 - 50 * s)})`;
}

function MeshHeatmap({ points }: { points: number[][] }) {
  const all = points.flat();
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = (max - min) * 1000;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="klipper-mesh-grid">
        {points.map((row, ri) => (
          <div key={ri} className="klipper-mesh-row">
            {row.map((v, ci) => (
              <div
                key={ci}
                className="klipper-mesh-cell"
                style={{ background: meshColor(v, min, max) }}
                title={`[${ri},${ci}] ${(v * 1000).toFixed(2)} µm`}
              >
                {(v * 1000).toFixed(0)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="klipper-mesh-legend">
        <span>{(min * 1000).toFixed(0)} µm</span>
        <div className="klipper-mesh-legend-bar" />
        <span>{(max * 1000).toFixed(0)} µm</span>
        <span style={{ marginLeft: 8 }}>Range: {range.toFixed(1)} µm</span>
      </div>
    </div>
  );
}

export default function KlipperBedMesh() {
  const connected = usePrinterStore((s) => s.connected);
  const config = usePrinterStore((s) => s.config);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const setActiveBedMesh = useSlicerStore((s) => s.setActiveBedMesh);

  const [mesh, setMesh] = useState<MoonrakerBedMesh | null>(null);
  const [loading, setLoading] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [saveAs, setSaveAs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [service] = useState(() => connected ? new MoonrakerService(config.hostname) : null);

  const refresh = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    setError(null);
    try {
      const m = await service.getBedMesh();
      setMesh(m);
      setSelectedProfile((prev) => prev || m.active_profile || Object.keys(m.profiles)[0] || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bed mesh — ensure [bed_mesh] is in printer.cfg');
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleCalibrate = useCallback(async () => {
    if (!confirm('Run BED_MESH_CALIBRATE? This will probe the full bed.')) return;
    setCalibrating(true);
    try {
      await sendGCode('BED_MESH_CALIBRATE');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Calibration failed');
    } finally {
      setCalibrating(false);
    }
  }, [sendGCode, refresh]);

  const handleLoad = useCallback(async () => {
    if (!service || !selectedProfile) return;
    try { await service.loadBedMeshProfile(selectedProfile); } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    }
  }, [service, selectedProfile]);

  const handleSave = useCallback(async () => {
    if (!service) return;
    const name = saveAs.trim() || selectedProfile || 'default';
    try {
      await service.saveBedMeshProfile(name);
      setSaveAs('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  }, [service, saveAs, selectedProfile, refresh]);

  const handleDelete = useCallback(async () => {
    if (!service || !selectedProfile) return;
    if (!confirm(`Delete profile "${selectedProfile}"?`)) return;
    try {
      await service.deleteBedMeshProfile(selectedProfile);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }, [service, selectedProfile, refresh]);

  const profiles = useMemo(() => Object.keys(mesh?.profiles ?? {}), [mesh]);
  const activePoints = useMemo(() => {
    if (!mesh || !selectedProfile) return null;
    return mesh.profiles[selectedProfile]?.points ?? null;
  }, [mesh, selectedProfile]);

  useEffect(() => {
    if (!mesh || !selectedProfile) {
      setActiveBedMesh(null);
      return undefined;
    }
    const profile = mesh.profiles[selectedProfile];
    if (!profile?.points?.length) {
      setActiveBedMesh(null);
      return undefined;
    }
    setActiveBedMesh({
      points: profile.points,
      minX: profile.mesh_params.min_x,
      maxX: profile.mesh_params.max_x,
      minY: profile.mesh_params.min_y,
      maxY: profile.mesh_params.max_y,
      profileName: selectedProfile,
      updatedAt: Date.now(),
      source: 'klipper',
    });
    return () => setActiveBedMesh(null);
  }, [mesh, selectedProfile, setActiveBedMesh]);

  if (!connected) {
    return (
      <div className="klipper-tab">
        <div className="klipper-disconnected">
          <WifiOff size={32} />
          <span>Connect to a Klipper printer to view bed mesh.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <Grid3x3 size={15} />
        <h3>Bed Mesh</h3>
        <div className="spacer" />
        <button className="klipper-btn klipper-btn-primary" onClick={handleCalibrate} disabled={calibrating || loading}>
          <Play size={13} /> {calibrating ? 'Calibrating…' : 'Calibrate'}
        </button>
        <button className="klipper-btn" onClick={refresh} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div className="klipper-tab-body">
        {error && (
          <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
            <div className="klipper-card-body" style={{ flexDirection: 'row', gap: 8, color: '#ef4444', fontSize: 12 }}>
              <AlertCircle size={14} /> {error}
            </div>
          </div>
        )}

        <div className="klipper-card">
          <div className="klipper-card-header">Profile</div>
          <div className="klipper-card-body">
            <div className="klipper-form-row">
              <label>Active profile</label>
              <select
                value={selectedProfile}
                onChange={(e) => setSelectedProfile(e.target.value)}
                style={{ flex: 1 }}
              >
                {profiles.length === 0 && <option value="">— none —</option>}
                {profiles.map((p) => (
                  <option key={p} value={p}>
                    {p}{p === mesh?.active_profile ? ' (active)' : ''}
                  </option>
                ))}
              </select>
              <button className="klipper-btn klipper-btn-primary" onClick={handleLoad} disabled={!selectedProfile}>
                Load
              </button>
              <button className="klipper-btn klipper-btn-danger" onClick={handleDelete} disabled={!selectedProfile}>
                <Trash2 size={12} />
              </button>
            </div>
            <div className="klipper-form-row">
              <label>Save as</label>
              <input
                type="text"
                placeholder="Profile name…"
                value={saveAs}
                onChange={(e) => setSaveAs(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="klipper-btn" onClick={handleSave}>
                <Save size={12} /> Save
              </button>
            </div>
          </div>
        </div>

        {activePoints && (
          <div className="klipper-card">
            <div className="klipper-card-header">Heat Map — {selectedProfile}</div>
            <div className="klipper-card-body">
              <MeshHeatmap points={activePoints} />
            </div>
          </div>
        )}

        {!activePoints && !loading && (
          <div className="klipper-disconnected" style={{ flex: 'none', padding: '24px' }}>
            <Grid3x3 size={28} />
            <span>No saved mesh profiles. Run Calibrate to probe the bed and then save the result.</span>
          </div>
        )}
      </div>
    </div>
  );
}
