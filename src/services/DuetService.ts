import type {
  DuetConfig,
  DuetObjectModel,
  DuetFileInfo,
  DuetGCodeFileInfo,
  DuetHeightMap,
} from '../types/duet';
import { fetchOrThrow, requestJsonOrText } from './httpRequest';

/**
 * Comprehensive Duet3D API service supporting both standalone (RepRapFirmware)
 * and SBC (DuetSoftwareFramework) connection modes.
 */
export class DuetService {
  private config: DuetConfig;
  private sessionKey: string | null = null;
  private ws: WebSocket | null = null;
  private connected = false;
  private objectModel: Partial<DuetObjectModel> = {};
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollInFlight = false;
  private static readonly POLL_INTERVAL = 250;
  private static readonly RECONNECT_DELAY = 2000;

  constructor(config: DuetConfig) {
    this.config = config;
  }

  onModelUpdate(callback: (model: Partial<DuetObjectModel>) => void): () => void {
    return this.on('modelUpdate', (data) => callback(data as Partial<DuetObjectModel>));
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private get baseUrl(): string {
    let host = this.config.hostname.replace(/\/+$/, '').replace(/^https?:\/\//, '');
    if (import.meta.env.DEV) {
      return `/duet-proxy/${host}`;
    }
    return `http://${host}`;
  }

  private get wsUrl(): string {
    const base = this.baseUrl.replace(/^http/, 'ws');
    if (this.config.mode === 'sbc') {
      return `${base}/machine`;
    }
    return `${base}/machine`;
  }

  /** Convenience wrapper around fetch with common error handling. */
  private async request<T = unknown>(
    url: string,
    init?: RequestInit
  ): Promise<T> {
    return requestJsonOrText<T>(url, init, 'Duet request failed');
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  async connect(): Promise<boolean> {
    try {
      if (this.connected) return true;

      if (this.config.mode === 'sbc') {
        // DSF uses a simple password query param on connect
        const url = `${this.baseUrl}/machine/connect?password=${encodeURIComponent(this.config.password)}`;
        const res = await this.request<string>(url);
        // DSF returns the session key as plain text
        this.sessionKey = typeof res === 'string' ? res.replace(/"/g, '') : null;
      } else {
        // Standalone RRF: /rr_connect returns JSON { err: 0 } on success
        const url = `${this.baseUrl}/rr_connect?password=${encodeURIComponent(this.config.password)}&time=${encodeURIComponent(new Date().toISOString())}`;
        const res = await this.request<{ err: number; sessionTimeout?: number; sessionKey?: string }>(url);
        if (res.err !== 0) {
          throw new Error(`Connection refused (err=${res.err})`);
        }
        this.sessionKey = res.sessionKey ?? null;
      }

      this.connected = true;
      this.emit('connected', null);

      // Fetch runtime snapshot then static config (tool defs, fan names, etc.)
      try {
        const runtime = await this.getObjectModel(undefined, 'd99fn');
        this.applyModelPatch(runtime as Record<string, unknown>);
        await this.fetchConfigSnapshot();
      } catch {
        // Non-fatal – polling will catch up
      }

      // Standalone RRF boards don't expose a /machine WebSocket — poll HTTP.
      // DSF/SBC mode supports WS, so try it there and fall back to polling.
      if (this.config.mode === 'sbc') {
        try {
          this.connectWebSocket();
        } catch {
          this.startPolling();
        }
      } else {
        this.startPolling();
      }

      return true;
    } catch (err) {
      this.connected = false;
      this.emit('error', err);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.stopPolling();
    this.closeWebSocket();

    try {
      if (this.connected) {
        if (this.config.mode === 'sbc') {
          await this.request(`${this.baseUrl}/machine/disconnect`);
        } else {
          await this.request(`${this.baseUrl}/rr_disconnect`);
        }
      }
    } catch {
      // Best-effort
    }

    this.connected = false;
    this.sessionKey = null;
    this.objectModel = {};
    this.emit('disconnected', null);
  }

  async testConnection(): Promise<{
    success: boolean;
    firmwareVersion?: string;
    boardName?: string;
    error?: string;
  }> {
    try {
      const ok = await this.connect();
      if (!ok) {
        return { success: false, error: 'Connection refused' };
      }
      const model = this.objectModel;
      const board = model.boards?.[0];
      const result = {
        success: true,
        firmwareVersion: board?.firmwareVersion,
        boardName: board?.name,
      };
      await this.disconnect();
      return result;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  private connectWebSocket(): void {
    if (this.ws) {
      this.closeWebSocket();
    }

    const url = this.sessionKey
      ? `${this.wsUrl}?sessionKey=${encodeURIComponent(this.sessionKey)}`
      : this.wsUrl;

    this.ws = new WebSocket(url);
    let wsOpened = false;

    this.ws.onopen = () => {
      wsOpened = true;
      this.emit('ws:open', null);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        this.applyModelPatch(data);
        this.emit('modelUpdate', this.objectModel);
      } catch {
        // Non-JSON messages are ignored
      }
    };

    this.ws.onerror = () => {
      this.closeWebSocket();
      this.startPolling();
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (!this.connected) return;
      if (wsOpened) {
        // WS was working — try to reconnect it
        this.scheduleReconnect();
      } else {
        // Never successfully opened (board doesn't support it) — fall back to polling
        this.startPolling();
      }
    };
  }

  private closeWebSocket(): void {
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.connected) {
        try {
          this.connectWebSocket();
        } catch {
          this.startPolling();
        }
      }
    }, DuetService.RECONNECT_DELAY);
  }

  // ---------------------------------------------------------------------------
  // Polling fallback
  // ---------------------------------------------------------------------------

  private startPolling(): void {
    if (this.pollTimer) return;
    if (import.meta.env.DEV) console.log('[DuetService] startPolling()');
    this.pollTimer = setInterval(async () => {
      if (!this.connected) {
        this.stopPolling();
        return;
      }
      if (this.pollInFlight) return;

      this.pollInFlight = true;
      try {
        const patch = await this.getObjectModel(undefined, 'd99fn');
        this.applyModelPatch(patch as Record<string, unknown>);
        this.emit('modelUpdate', this.objectModel);
      } catch (err) {
        if (import.meta.env.DEV) console.error('[DuetService] poll error', err);
        this.emit('error', err);
      } finally {
        this.pollInFlight = false;
      }
    }, DuetService.POLL_INTERVAL);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollInFlight = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private uploadViaXhr(
    method: 'PUT' | 'POST',
    url: string,
    content: Blob | File,
    onProgress?: (percent: number) => void,
    validateResponse?: (responseText: string) => void
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
      }

      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
          return;
        }

        try {
          validateResponse?.(xhr.responseText);
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };

      xhr.onerror = () => reject(new Error('Upload network error'));
      xhr.send(content);
    });
  }

  // ---------------------------------------------------------------------------
  // Object Model
  // ---------------------------------------------------------------------------

  /**
   * Deep-merge a partial patch into the cached object model.
   * Handles both full replacement objects and incremental patches from the WS.
   */
  private applyModelPatch(patch: Record<string, unknown>): void {
    this.objectModel = this.deepMerge(
      this.objectModel as Record<string, unknown>,
      patch
    ) as Partial<DuetObjectModel>;
  }

  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>
  ): Record<string, unknown> {
    const output: Record<string, unknown> = { ...target };
    for (const key of Object.keys(source)) {
      const srcVal = source[key];
      const tgtVal = target[key];
      if (Array.isArray(srcVal) && Array.isArray(tgtVal)) {
        // Merge by index so runtime patches don't wipe config fields on array elements
        output[key] = srcVal.map((sv, i) => {
          const tv = tgtVal[i];
          if (sv && typeof sv === 'object' && !Array.isArray(sv) &&
              tv && typeof tv === 'object' && !Array.isArray(tv)) {
            return this.deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
          }
          return sv;
        });
      } else if (
        srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
        tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
      ) {
        output[key] = this.deepMerge(
          tgtVal as Record<string, unknown>,
          srcVal as Record<string, unknown>
        );
      } else {
        output[key] = srcVal;
      }
    }
    return output;
  }

  /** Fetch static config sections (tool defs, fan names, etc.) and merge into objectModel. */
  private async fetchConfigSnapshot(): Promise<void> {
    const sections = ['tools', 'heat', 'fans', 'move', 'boards', 'sensors', 'state'] as const;
    const results = await Promise.allSettled(
      sections.map((k) => this.getObjectModel(k, 'd99vn'))
    );
    for (let i = 0; i < sections.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        this.applyModelPatch({ [sections[i]]: r.value });
      }
    }
  }

  async getObjectModel(
    key?: string,
    flags?: string
  ): Promise<Partial<DuetObjectModel>> {
    if (this.config.mode === 'sbc') {
      const url = key
        ? `${this.baseUrl}/machine/model/${encodeURIComponent(key)}`
        : `${this.baseUrl}/machine/model`;
      return this.request<Partial<DuetObjectModel>>(url);
    }

    // Standalone – /rr_model; default to full depth so nested objects aren't empty
    const params = new URLSearchParams();
    if (key) params.set('key', key);
    params.set('flags', flags ?? 'd99fn');
    const url = `${this.baseUrl}/rr_model?${params.toString()}`;
    const res = await this.request<{ key: string; result: Partial<DuetObjectModel> }>(url);
    return res.result ?? res as unknown as Partial<DuetObjectModel>;
  }

  getModel(): Partial<DuetObjectModel> {
    return this.objectModel;
  }

  // ---------------------------------------------------------------------------
  // Event system
  // ---------------------------------------------------------------------------

  on(event: string, callback: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: string, data: unknown): void {
    const cbs = this.listeners.get(event);
    if (cbs) {
      for (const cb of cbs) {
        try {
          cb(data);
        } catch {
          // Listener errors must not break the service
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // G-Code execution
  // ---------------------------------------------------------------------------

  async sendGCode(code: string): Promise<string> {
    if (this.config.mode === 'sbc') {
      const url = `${this.baseUrl}/machine/code`;
      const res = await fetchOrThrow(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: code,
      }, 'G-code send failed');
      return res.text();
    }

    // Standalone: send then read reply
    const sendUrl = `${this.baseUrl}/rr_gcode?gcode=${encodeURIComponent(code)}`;
    await this.request(sendUrl);

    // Small delay to let firmware process
    await new Promise((r) => setTimeout(r, 50));

    const replyUrl = `${this.baseUrl}/rr_reply`;
    const reply = await this.request<string>(replyUrl);
    return typeof reply === 'string' ? reply : JSON.stringify(reply);
  }

  /** Drain the next pending G-code reply without sending anything. Used to
   *  tail asynchronous firmware output (e.g. M997 S4 progress messages that
   *  arrive seconds after the command returns). Returns '' when nothing is
   *  pending or when the request fails.
   *
   *  SBC mode has no equivalent pull endpoint — `/machine/code` already blocks
   *  until the command finishes and returns its full output, so callers don't
   *  need to drain a buffer separately. */
  async pollReply(): Promise<string> {
    if (this.config.mode === 'sbc') return '';
    try {
      const url = `${this.baseUrl}/rr_reply`;
      const reply = await this.request<string>(url);
      return typeof reply === 'string' ? reply : '';
    } catch {
      return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Temperature Control
  // ---------------------------------------------------------------------------

  async setToolTemperature(
    toolIndex: number,
    heaterIndex: number,
    temp: number,
    standby = false
  ): Promise<void> {
    const letter = standby ? 'R' : 'S';
    // Build a temperature string for the tool – only set the specific heater
    // G10 P<tool> S<temp> sets active temps, R<temp> sets standby
    // For tools with multiple heaters we need to provide all values.
    const tool = this.objectModel.tools?.find((t) => t.number === toolIndex);
    if (tool) {
      const temps = standby ? [...tool.standby] : [...tool.active];
      temps[heaterIndex] = temp;
      const tempStr = temps.join(':');
      await this.sendGCode(`G10 P${toolIndex} ${letter}${tempStr}`);
    } else {
      await this.sendGCode(`G10 P${toolIndex} ${letter}${temp}`);
    }
  }

  async setBedTemperature(temp: number): Promise<void> {
    await this.sendGCode(`M140 S${temp}`);
  }

  async setChamberTemperature(temp: number): Promise<void> {
    await this.sendGCode(`M141 S${temp}`);
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  async homeAxes(axes?: string[]): Promise<void> {
    if (!axes || axes.length === 0) {
      await this.sendGCode('G28');
    } else {
      const axisStr = axes.map((a) => a.toUpperCase()).join(' ');
      await this.sendGCode(`G28 ${axisStr}`);
    }
  }

  async moveAxis(
    axis: string,
    distance: number,
    feedrate?: number,
    relative = true
  ): Promise<void> {
    const modeCmd = relative ? 'G91' : 'G90';
    const feedStr = feedrate != null ? ` F${feedrate}` : '';
    await this.sendGCode(`${modeCmd}\nG1 ${axis.toUpperCase()}${distance}${feedStr}\nG90`);
  }

  async setSpeedFactor(percent: number): Promise<void> {
    await this.sendGCode(`M220 S${percent}`);
  }

  async setExtrusionFactor(extruder: number, percent: number): Promise<void> {
    await this.sendGCode(`M221 D${extruder} S${percent}`);
  }

  async extrude(amount: number, feedrate: number): Promise<void> {
    await this.sendGCode(`M83\nG1 E${amount} F${feedrate}\nM82`);
  }

  async retract(amount: number, feedrate: number): Promise<void> {
    await this.extrude(-Math.abs(amount), feedrate);
  }

  async setBabyStep(offset: number): Promise<void> {
    await this.sendGCode(`M290 S${offset}`);
  }

  // ---------------------------------------------------------------------------
  // Fan Control
  // ---------------------------------------------------------------------------

  async setFanSpeed(fanIndex: number, speed: number): Promise<void> {
    // Duet firmware expects 0-1 for S parameter
    const clamped = Math.max(0, Math.min(1, speed));
    await this.sendGCode(`M106 P${fanIndex} S${clamped}`);
  }

  // ---------------------------------------------------------------------------
  // Print Control
  // ---------------------------------------------------------------------------

  async startPrint(filename: string): Promise<void> {
    await this.sendGCode(`M32 "${filename}"`);
  }

  async pausePrint(): Promise<void> {
    await this.sendGCode('M25');
  }

  async resumePrint(): Promise<void> {
    await this.sendGCode('M24');
  }

  async cancelPrint(): Promise<void> {
    await this.sendGCode('M0');
  }

  async cancelObject(objectIndex: number): Promise<void> {
    await this.sendGCode(`M486 P${objectIndex}`);
  }

  async simulateFile(filename: string): Promise<void> {
    await this.sendGCode(`M37 S"${filename}"`);
  }

  // ---------------------------------------------------------------------------
  // Emergency Stop
  // ---------------------------------------------------------------------------

  async emergencyStop(): Promise<void> {
    try {
      await this.sendGCode('M112');
    } catch {
      // M112 may kill the connection before we get a reply
    }
    // Give the board a moment then reset
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await this.sendGCode('M999');
    } catch {
      // Board may not respond yet
    }
  }

  // ---------------------------------------------------------------------------
  // Tool Management
  // ---------------------------------------------------------------------------

  async selectTool(toolIndex: number): Promise<void> {
    await this.sendGCode(`T${toolIndex}`);
  }

  async deselectTool(): Promise<void> {
    await this.sendGCode('T-1');
  }

  // ---------------------------------------------------------------------------
  // File Management
  // ---------------------------------------------------------------------------

  async listFiles(directory: string): Promise<DuetFileInfo[]> {
    if (this.config.mode === 'sbc') {
      const url = `${this.baseUrl}/machine/directory/${encodeURIComponent(directory)}`;
      return this.request<DuetFileInfo[]>(url);
    }

    // Standalone – /rr_filelist returns { dir, first, files, next }
    const allFiles: DuetFileInfo[] = [];
    let first = 0;
    let hasMore = true;

    while (hasMore) {
      const url = `${this.baseUrl}/rr_filelist?dir=${encodeURIComponent(directory)}&first=${first}`;
      const res = await this.request<{
        dir: string;
        first: number;
        files: Array<{ type: string; name: string; size: number; date: string }>;
        next: number;
        err?: number;
      }>(url);

      if (res.err !== undefined && res.err !== 0) {
        throw new Error(`File listing error (err=${res.err})`);
      }

      for (const f of res.files ?? []) {
        allFiles.push({
          type: f.type === 'd' ? 'd' : 'f',
          name: f.name,
          size: f.size,
          date: f.date,
        });
      }

      if (res.next !== 0 && res.next > first) {
        first = res.next;
      } else {
        hasMore = false;
      }
    }

    return allFiles;
  }

  async getFileInfo(filename: string): Promise<DuetGCodeFileInfo> {
    if (this.config.mode === 'sbc') {
      const url = `${this.baseUrl}/machine/fileinfo/${encodeURIComponent(filename)}`;
      return this.request<DuetGCodeFileInfo>(url);
    }

    const url = `${this.baseUrl}/rr_fileinfo?name=${encodeURIComponent(filename)}`;
    const res = await this.request<DuetGCodeFileInfo & { err?: number }>(url);
    if (res.err !== undefined && res.err !== 0) {
      throw new Error(`File info error (err=${res.err})`);
    }
    return res;
  }

  async uploadFile(
    path: string,
    content: Blob | File,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    if (this.config.mode === 'sbc') {
      const url = `${this.baseUrl}/machine/file/${encodeURIComponent(path)}`;
      return this.uploadViaXhr('PUT', url, content, onProgress);
    }

    // Standalone – POST to /rr_upload
    const url = `${this.baseUrl}/rr_upload?name=${encodeURIComponent(path)}&time=${encodeURIComponent(new Date().toISOString())}`;
    return this.uploadViaXhr('POST', url, content, onProgress, (responseText) => {
      try {
        const res = JSON.parse(responseText);
        if (res.err !== 0) {
          throw new Error(`Upload error (err=${res.err})`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Upload error')) {
          throw err;
        }
        // Non-JSON response is fine
      }
    });
  }

  async downloadFile(path: string): Promise<Blob> {
    if (this.config.mode === 'sbc') {
      const url = `${this.baseUrl}/machine/file/${encodeURIComponent(path)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Download failed: ${res.status}`);
      }
      return res.blob();
    }

    const url = `${this.baseUrl}/rr_download?name=${encodeURIComponent(path)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status}`);
    }
    return res.blob();
  }

  async deleteFile(path: string): Promise<void> {
    if (this.config.mode === 'sbc') {
      const url = `${this.baseUrl}/machine/file/${encodeURIComponent(path)}`;
      await this.request(url, { method: 'DELETE' });
      return;
    }

    const url = `${this.baseUrl}/rr_delete?name=${encodeURIComponent(path)}`;
    await this.request(url);
  }

  async moveFile(from: string, to: string): Promise<void> {
    if (this.config.mode === 'sbc') {
      const url = `${this.baseUrl}/machine/file/move`;
      await this.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      return;
    }

    const url = `${this.baseUrl}/rr_move?old=${encodeURIComponent(from)}&new=${encodeURIComponent(to)}`;
    await this.request(url);
  }

  async createDirectory(path: string): Promise<void> {
    if (this.config.mode === 'sbc') {
      const url = `${this.baseUrl}/machine/directory/${encodeURIComponent(path)}`;
      await this.request(url, { method: 'PUT' });
      return;
    }

    const url = `${this.baseUrl}/rr_mkdir?dir=${encodeURIComponent(path)}`;
    await this.request(url);
  }

  // ---------------------------------------------------------------------------
  // Macros
  // ---------------------------------------------------------------------------

  async listMacros(): Promise<DuetFileInfo[]> {
    return this.listFiles('0:/macros');
  }

  async runMacro(filename: string): Promise<string> {
    return this.sendGCode(`M98 P"${filename}"`);
  }

  // ---------------------------------------------------------------------------
  // Height Map
  // ---------------------------------------------------------------------------

  async getHeightMap(path = '0:/sys/heightmap.csv'): Promise<DuetHeightMap | null> {
    try {
      const blob = await this.downloadFile(path);
      const text = await blob.text();
      return this.parseHeightMapCsv(text);
    } catch {
      return null;
    }
  }

  private parseHeightMapCsv(csv: string): DuetHeightMap {
    const lines = csv.trim().split('\n');

    // First line: RepRapFirmware height map file ... (header comment)
    // Second line: xmin, xmax, ymin, ymax, radius, xspacing, yspacing, num_x, num_y
    // Remaining lines: grid data rows

    let headerLine = '';
    let dataStartIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Skip comment lines
      if (trimmed.startsWith('RepRapFirmware') || trimmed.startsWith(';')) {
        continue;
      }
      // First non-comment line with "xmin" is the header
      if (trimmed.toLowerCase().includes('xmin') || trimmed.includes(',') && !headerLine) {
        headerLine = trimmed;
        dataStartIndex = i + 1;
        break;
      }
    }

    // Parse header values: "xmin,xmax,ymin,ymax,radius,xspacing,yspacing,num_x,num_y"
    const headerParts = headerLine.split(',').map((s) => s.trim());
    // The header row may contain labels; if the next line has actual numbers we
    // need to read the following line as the parameter row.
    let paramLine: string;
    if (isNaN(parseFloat(headerParts[0]))) {
      // headerLine contains labels, next line has values
      paramLine = lines[dataStartIndex].trim();
      dataStartIndex++;
    } else {
      paramLine = headerLine;
    }

    const params = paramLine.split(',').map((s) => parseFloat(s.trim()));
    const [xMin, xMax, yMin, yMax, radius, xSpacing, ySpacing, numXRaw, numYRaw] = params;
    const numX = Math.round(numXRaw);
    const numY = Math.round(numYRaw);

    // Parse grid data
    const points: number[][] = [];
    for (let i = dataStartIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith(';')) continue;
      const row = line.split(',').map((s) => {
        const val = parseFloat(s.trim());
        return isNaN(val) ? 0 : val;
      });
      points.push(row);
    }

    return { xMin, xMax, xSpacing, yMin, yMax, ySpacing, radius, numX, numY, points };
  }

  async probeGrid(): Promise<void> {
    await this.sendGCode('G29 S0');
  }

  // ---------------------------------------------------------------------------
  // ATX Power
  // ---------------------------------------------------------------------------

  async setAtxPower(on: boolean): Promise<void> {
    await this.sendGCode(on ? 'M80' : 'M81');
  }

  // ---------------------------------------------------------------------------
  // Webcam
  // ---------------------------------------------------------------------------

  getWebcamUrl(): string {
    return `${this.baseUrl}/webcam/?action=stream`;
  }

  getSnapshotUrl(): string {
    return `${this.baseUrl}/webcam/?action=snapshot`;
  }

  // ---------------------------------------------------------------------------
  // Thumbnail
  // ---------------------------------------------------------------------------

  async getThumbnail(
    filename: string,
    offset: number
  ): Promise<string | null> {
    try {
      if (this.config.mode === 'sbc') {
        // DSF exposes thumbnails via the fileinfo endpoint; the data is
        // embedded in the response. Fetch it as a blob from the dedicated
        // thumbnail route if available, otherwise fall back to inline data.
        const url = `${this.baseUrl}/machine/thumbnail/${encodeURIComponent(filename)}?offset=${offset}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      // Standalone: /rr_thumbnail?name=XXX&offset=NNN
      // The response contains { fileName, offset, data, next, err }
      // Data is base64 encoded and may be split across multiple requests.
      let fullData = '';
      let currentOffset = offset;

      while (true) {
        const url = `${this.baseUrl}/rr_thumbnail?name=${encodeURIComponent(filename)}&offset=${currentOffset}`;
        const res = await this.request<{
          fileName: string;
          offset: number;
          data: string;
          next: number;
          err: number;
        }>(url);

        if (res.err !== 0) return null;

        fullData += res.data;

        if (res.next === 0) break;
        currentOffset = res.next;
      }

      if (!fullData) return null;

      // Determine format from the file info thumbnails metadata
      // Default to PNG if we can't determine
      return `data:image/png;base64,${fullData}`;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Connection state accessors
  // ---------------------------------------------------------------------------

  isConnected(): boolean {
    return this.connected;
  }

  getConfig(): DuetConfig {
    return { ...this.config };
  }
}
