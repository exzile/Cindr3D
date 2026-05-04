/**
 * Moonraker REST API service for Klipper printers.
 * Moonraker is the API server that fronts Klipper on most Klipper installs
 * (Mainsail, Fluidd, Obico, etc.). All calls go through the /duet-proxy/ dev
 * shim in development so CORS is not an issue.
 */

export interface MoonrakerPrinterInfo {
  state: string;
  state_message: string;
  hostname: string;
  software_version: string;
  cpu_info: string;
  klipper_path: string;
  python_path: string;
  log_file: string;
  config_file: string;
}

export interface MoonrakerExcludeObjectStatus {
  current_object: string | null;
  excluded_objects: string[];
  objects: Array<{ center: [number, number]; name: string; polygon?: number[][] }>;
}

export interface MoonrakerPowerDevice {
  device: string;
  status: 'on' | 'off' | 'error' | 'init';
  locked_while_printing: boolean;
  type: string;
}

export interface MoonrakerUpdateComponent {
  channel: string;
  debug_enabled: boolean;
  detected_type: string;
  is_dirty: boolean;
  is_valid: boolean;
  version: string;
  remote_version: string;
  full_version_string: string;
  commits_behind: Array<{
    sha: string;
    subject: string;
    message: string;
    tag: string | null;
    author: string;
    date: string;
  }>;
}

export interface MoonrakerUpdateStatus {
  busy: boolean;
  components: Record<string, MoonrakerUpdateComponent>;
}

export interface MoonrakerBedMeshProfile {
  points: number[][];
  mesh_params: {
    x_offset: number;
    y_offset: number;
    x_count: number;
    y_count: number;
    min_x: number;
    max_x: number;
    min_y: number;
    max_y: number;
  };
}

export interface MoonrakerBedMesh {
  active_profile: string;
  profiles: Record<string, MoonrakerBedMeshProfile>;
}

export interface MoonrakerSpoolmanSpool {
  id: number;
  filament: {
    name: string;
    material: string;
    color_hex: string;
    vendor: { name: string };
  };
  remaining_length?: number;
  remaining_weight?: number;
  used_length?: number;
  used_weight?: number;
}

export interface MoonrakerTimelapseState {
  enabled: boolean;
  base_path: string;
  output_path: string;
  last_render_file: string | null;
}

export interface MoonrakerTimelapseFile {
  filename: string;
  size: number;
  modified: number;
}

/**
 * Live print-status snapshot synthesised from Klipper's print_stats and
 * display_status objects. `currentLayer` / `totalLayers` are populated
 * when the user's macros call `SET_PRINT_STATS_INFO`; otherwise they're
 * left undefined and consumers should estimate from `progress` × known
 * layer count.
 */
export interface MoonrakerPrintStatus {
  state: 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error' | string;
  filename: string;
  /** 0–1 fraction printed, from display_status. */
  progress: number;
  /** Seconds the current job has been printing. */
  printDuration: number;
  /** Filament length consumed so far, mm. */
  filamentUsed: number;
  /** From print_stats.info.current_layer (Mainsail/Fluidd convention). */
  currentLayer?: number;
  /** From print_stats.info.total_layer. */
  totalLayers?: number;
  /** Any non-empty status message Klipper has set, e.g. "Printing layer 5". */
  message?: string;
}

export class MoonrakerService {
  private baseUrl: string;

  constructor(hostname: string) {
    const host = hostname.replace(/\/+$/, '').replace(/^https?:\/\//, '');
    if (import.meta.env.DEV) {
      this.baseUrl = `/duet-proxy/${host}`;
    } else {
      this.baseUrl = `http://${host}`;
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`Moonraker ${path}: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { result: T };
    return json.result;
  }

  private async post<T = 'ok'>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Moonraker ${path}: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { result: T };
    return json.result;
  }

  /** Send a raw G-code script through Moonraker. */
  async sendGCode(script: string): Promise<void> {
    await this.post('/printer/gcode/script', { script });
  }

  async getPrinterInfo(): Promise<MoonrakerPrinterInfo> {
    return this.get('/printer/info');
  }

  // ── Exclude Object ────────────────────────────────────────────────────────

  async getExcludeObjectStatus(): Promise<MoonrakerExcludeObjectStatus> {
    const res = await this.get<{ exclude_object: MoonrakerExcludeObjectStatus }>(
      '/printer/objects/query?exclude_object',
    );
    return res.exclude_object;
  }

  async excludeObject(name: string): Promise<void> {
    await this.sendGCode(`EXCLUDE_OBJECT NAME=${name}`);
  }

  async resetExcludeObjects(): Promise<void> {
    await this.sendGCode('EXCLUDE_OBJECT_RESET');
  }

  // ── Power Devices ─────────────────────────────────────────────────────────

  async getPowerDevices(): Promise<MoonrakerPowerDevice[]> {
    const res = await this.get<{ devices: MoonrakerPowerDevice[] }>('/machine/device_power/devices');
    return res.devices;
  }

  async setPowerDevice(device: string, action: 'on' | 'off' | 'toggle'): Promise<void> {
    await this.post(
      `/machine/device_power/device?device=${encodeURIComponent(device)}&action=${action}`,
    );
  }

  // ── Update Manager ────────────────────────────────────────────────────────

  async getUpdateStatus(refresh = false): Promise<MoonrakerUpdateStatus> {
    return this.get(`/machine/update/status${refresh ? '?refresh=true' : ''}`);
  }

  async updateComponent(name: string): Promise<void> {
    await this.post('/machine/update/update', { name });
  }

  async fullUpdate(): Promise<void> {
    await this.post('/machine/update/full');
  }

  // ── Bed Mesh ──────────────────────────────────────────────────────────────

  async getBedMesh(): Promise<MoonrakerBedMesh> {
    const res = await this.get<{ bed_mesh: MoonrakerBedMesh }>('/printer/objects/query?bed_mesh');
    return res.bed_mesh;
  }

  async calibrateBedMesh(): Promise<void> {
    await this.sendGCode('BED_MESH_CALIBRATE');
  }

  async loadBedMeshProfile(name: string): Promise<void> {
    await this.sendGCode(`BED_MESH_PROFILE LOAD="${name}"`);
  }

  async saveBedMeshProfile(name: string): Promise<void> {
    await this.sendGCode(`BED_MESH_PROFILE SAVE="${name}"`);
  }

  async deleteBedMeshProfile(name: string): Promise<void> {
    await this.sendGCode(`BED_MESH_PROFILE REMOVE="${name}"`);
  }

  // ── Input Shaper ──────────────────────────────────────────────────────────

  async testResonances(axis: 'X' | 'Y'): Promise<void> {
    await this.sendGCode(`TEST_RESONANCES AXIS=${axis}`);
  }

  async setInputShaper(
    shaperType: string,
    freqX: number,
    freqY: number,
    dampingRatio?: number,
  ): Promise<void> {
    let cmd = `SET_INPUT_SHAPER SHAPER_TYPE=${shaperType} SHAPER_FREQ_X=${freqX} SHAPER_FREQ_Y=${freqY}`;
    if (dampingRatio !== undefined) cmd += ` DAMPING_RATIO_X=${dampingRatio} DAMPING_RATIO_Y=${dampingRatio}`;
    await this.sendGCode(cmd);
  }

  async getInputShaperCsvFiles(): Promise<string[]> {
    try {
      const res = await this.get<{ files: Array<{ filename: string }> }>(
        '/server/files/list?root=gcodes',
      );
      return res.files
        .map((f) => f.filename)
        .filter((n) => n.startsWith('resonances_'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  // ── Pressure Advance ──────────────────────────────────────────────────────

  async setPressureAdvance(advance: number, extruder = 'extruder'): Promise<void> {
    await this.sendGCode(`SET_PRESSURE_ADVANCE EXTRUDER=${extruder} ADVANCE=${advance}`);
  }

  async setSmoothTime(smoothTime: number, extruder = 'extruder'): Promise<void> {
    await this.sendGCode(`SET_PRESSURE_ADVANCE EXTRUDER=${extruder} SMOOTH_TIME=${smoothTime}`);
  }

  // ── Spoolman ──────────────────────────────────────────────────────────────

  async getActiveSpoolId(): Promise<number | null> {
    try {
      const res = await this.get<{ spoolman: { spool_id: number | null } }>(
        '/printer/objects/query?spoolman',
      );
      return res.spoolman?.spool_id ?? null;
    } catch {
      return null;
    }
  }

  async getSpoolById(spoolId: number): Promise<MoonrakerSpoolmanSpool | null> {
    try {
      const res = await this.get<MoonrakerSpoolmanSpool>(`/server/spoolman/spool_id/${spoolId}`);
      return res;
    } catch {
      return null;
    }
  }

  async setActiveSpool(spoolId: number | null): Promise<void> {
    await this.post('/server/spoolman/spool_id', { spool_id: spoolId });
  }

  getSpoolmanUrl(hostname: string): string {
    const host = hostname.replace(/\/+$/, '').replace(/^https?:\/\//, '');
    return `http://${host}:7912`;
  }

  // ── Timelapse ─────────────────────────────────────────────────────────────

  async getTimelapseState(): Promise<MoonrakerTimelapseState | null> {
    try {
      const res = await this.get<{ timelapse: MoonrakerTimelapseState }>(
        '/printer/objects/query?timelapse',
      );
      return res.timelapse ?? null;
    } catch {
      return null;
    }
  }

  async renderTimelapse(): Promise<void> {
    await this.post('/machine/timelapse/render');
  }

  async getTimelapseFiles(): Promise<MoonrakerTimelapseFile[]> {
    try {
      const res = await this.get<{ files: MoonrakerTimelapseFile[] }>(
        '/server/files/list?root=timelapse',
      );
      return (res.files ?? []).sort((a, b) => b.modified - a.modified);
    } catch {
      return [];
    }
  }

  async deleteTimelapseFile(filename: string): Promise<void> {
    await fetch(
      `${this.baseUrl}/server/files/timelapse/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    );
  }

  getFileUrl(root: string, filename: string): string {
    return `${this.baseUrl}/server/files/${root}/${encodeURIComponent(filename)}`;
  }

  // ── Print status (live layer / progress) ─────────────────────────────────

  /**
   * Fetch a synthesised print-status snapshot from Klipper's print_stats
   * + display_status objects. Returns null when nothing is printing or
   * the query failed.
   */
  async getPrintStatus(): Promise<MoonrakerPrintStatus | null> {
    try {
      const res = await this.get<{
        print_stats?: {
          state?: string;
          filename?: string;
          print_duration?: number;
          filament_used?: number;
          message?: string;
          info?: { current_layer?: number; total_layer?: number };
        };
        display_status?: { progress?: number; message?: string };
      }>('/printer/objects/query?print_stats&display_status');

      const ps = res.print_stats ?? {};
      const ds = res.display_status ?? {};
      if (!ps.state) return null;

      return {
        state: ps.state,
        filename: ps.filename ?? '',
        progress: ds.progress ?? 0,
        printDuration: ps.print_duration ?? 0,
        filamentUsed: ps.filament_used ?? 0,
        currentLayer: ps.info?.current_layer,
        totalLayers: ps.info?.total_layer,
        message: ps.message || ds.message || undefined,
      };
    } catch {
      return null;
    }
  }
}
