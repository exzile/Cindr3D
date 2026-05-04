import type {
  DuetConfig,
  DuetObjectModel,
  DuetFileInfo,
  DuetGCodeFileInfo,
  DuetHeightMap,
} from '../types/duet';
import {
  createDirectory as createDirectoryRequest,
  deleteFile as deleteFileRequest,
  downloadFile as downloadFileRequest,
  getFileInfo as getFileInfoRequest,
  listFiles as listFilesRequest,
  moveFile as moveFileRequest,
  uploadFile as uploadFileRequest,
} from './duet/fileApi';
import {
  emergencyStopCommand,
  extrudeCommand,
  homeAxesCommand,
  moveAxisCommand,
  runMacroCommand,
} from './duet/controls';
import { fetchOrThrow, requestJsonOrText } from './httpRequest';
import {
  getHeightMapData,
  getSnapshotImageUrl,
  getThumbnailData,
  getWebcamStreamUrl,
} from './duet/mediaApi';
import { DuetEventBus } from './duet/eventBus';
import {
  applyModelPatch as applyObjectModelPatch,
  fetchConfigSnapshot as fetchObjectModelSnapshot,
  getObjectModelRequest,
} from './duet/modelApi';
import {
  cancelObjectCommand,
  cancelPrintCommand,
  deselectToolCommand,
  pausePrintCommand,
  resumePrintCommand,
  selectToolCommand,
  setBedTemperatureCommand,
  setChamberTemperatureCommand,
  setFanSpeedCommand,
  setToolTemperatureCommand,
  simulateFileCommand,
  startPrintCommand,
} from './duet/machineControls';
import { layerFromPercent, parseMarlinProgress } from './gcode/marlinProgressParser';
import {
  WebSerialConnection,
  findGrantedPort,
  isWebSerialSupported,
} from './usb/webSerial';

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
  private eventBus = new DuetEventBus();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollInFlight = false;
  private serial: WebSerialConnection | null = null;
  private serialLineUnsubscribe: (() => void) | null = null;
  private static readonly POLL_INTERVAL = 250;
  private static readonly RECONNECT_DELAY = 2000;

  constructor(config: DuetConfig) {
    this.config = config;
  }

  private get isUsbTransport(): boolean {
    return this.config.transport === 'usb';
  }

  onModelUpdate(callback: (model: Partial<DuetObjectModel>) => void): () => void {
    return this.on('modelUpdate', (data) => callback(data as Partial<DuetObjectModel>));
  }


  private get baseUrl(): string {
    const host = this.config.hostname.replace(/\/+$/, '').replace(/^https?:\/\//, '');
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

  private get fileApiContext() {
    return {
      config: this.config,
      baseUrl: this.baseUrl,
      request: this.request.bind(this),
    };
  }


  async connect(): Promise<boolean> {
    try {
      if (this.connected) return true;

      if (this.isUsbTransport) {
        return await this.connectSerial();
      }

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

    if (this.isUsbTransport) {
      try { this.serialLineUnsubscribe?.(); } catch { /* best-effort */ }
      this.serialLineUnsubscribe = null;
      try { await this.serial?.close(); } catch { /* best-effort */ }
      this.serial = null;
      this.connected = false;
      this.objectModel = {};
      this.emit('disconnected', null);
      return;
    }

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


  /**
   * Open a Web Serial connection to a USB-attached printer board.
   * Re-uses a previously granted port matching the saved vendor/product IDs;
   * otherwise asks the user to pick one. Once open, sends M115 to read the
   * firmware banner and seeds the objectModel so the UI can show "connected".
   */
  private async connectSerial(): Promise<boolean> {
    try {
      if (!isWebSerialSupported()) {
        throw new Error('Web Serial is not supported by this browser. Use Chrome/Edge over HTTPS, or http://localhost.');
      }

      const port = await findGrantedPort(this.config.serialVendorId, this.config.serialProductId);
      if (!port) {
        throw new Error('No USB printer port has been granted. Click "Select USB Port" in settings first.');
      }

      const baudRate = this.config.serialBaudRate ?? 115200;
      this.serial = new WebSerialConnection(baudRate);
      await this.serial.open(port);

      // Many boards drive RST low on DTR toggle when the port opens — give the
      // bootloader a moment to hand control to the firmware before we talk.
      await new Promise((r) => setTimeout(r, 1500));

      // Marlin / RepRapFirmware / Klipper-USB / grbl all answer to M115 with a
      // firmware identification line. Best-effort: an empty reply is fine.
      let firmwareVersion: string | undefined;
      let boardName: string | undefined;
      try {
        const reply = await this.serial.sendGCode('M115', 3000);
        const fwMatch = reply.match(/FIRMWARE_NAME:([^\s]+(?:\s[^\s:]+)*?)(?=\s+[A-Z_]+:|$)/i);
        const machineMatch = reply.match(/MACHINE_TYPE:([^\s]+(?:\s[^\s:]+)*?)(?=\s+[A-Z_]+:|$)/i);
        if (fwMatch) firmwareVersion = fwMatch[1].trim();
        if (machineMatch) boardName = machineMatch[1].trim();
      } catch {
        // Silent boards (grbl awaiting "$$") still count as connected.
      }

      // Seed the object model so the UI shows the firmware identifier and the
      // store's connected state stays consistent with the network path.
      const seed = {
        boards: [{
          firmwareVersion: firmwareVersion ?? 'USB serial',
          firmwareName: firmwareVersion,
          name: boardName ?? this.config.serialPortLabel ?? 'USB printer',
        }],
      } as unknown as Record<string, unknown>;
      this.applyModelPatch(seed);

      // Subscribe to incoming serial lines so we can parse live print
      // progress (M73, layer markers) for Marlin/USB-attached printers.
      // The dispatcher is firmware-agnostic; non-progress lines no-op.
      this.serialLineUnsubscribe = this.serial.onLine((line) => this.handleSerialLine(line));

      this.connected = true;
      this.emit('connected', null);
      this.emit('modelUpdate', this.objectModel);

      return true;
    } catch (err) {
      this.connected = false;
      try { this.serialLineUnsubscribe?.(); } catch { /* best-effort */ }
      this.serialLineUnsubscribe = null;
      try { await this.serial?.close(); } catch { /* best-effort */ }
      this.serial = null;
      this.emit('error', err);
      return false;
    }
  }

  /**
   * Parse incoming USB serial lines for live print progress and update the
   * object model so cross-firmware UI (MeshPreviewPanel, ProgressSection,
   * etc.) sees layer / percent / time-remaining for Marlin printers.
   */
  private handleSerialLine(line: string): void {
    const update = parseMarlinProgress(line);
    if (!update) return;
    const jobPatch: Record<string, unknown> = {};

    // Total-layer count flows in via "echo:Layer N/M" or future M73 extensions.
    // Update the model first so any percent→layer estimate below sees it.
    const totalLayers = update.totalLayers
      ?? this.objectModel.job?.file?.numLayers
      ?? 0;
    if (update.totalLayers !== undefined) {
      jobPatch.file = { ...(this.objectModel.job?.file ?? {}), numLayers: update.totalLayers };
    }

    // Prefer an explicit layer reading; fall back to estimating it from the
    // M73 percent when we know the total. Marlin's M73 receipt is the only
    // ongoing progress signal for the vast majority of printed jobs.
    if (update.layer !== undefined) {
      jobPatch.layer = update.layer;
    } else if (update.percent !== undefined && totalLayers > 0) {
      jobPatch.layer = layerFromPercent(update.percent, totalLayers);
    }

    if (update.remainingSeconds !== undefined) {
      jobPatch.timesLeft = { ...(this.objectModel.job?.timesLeft ?? {}), file: update.remainingSeconds };
    }

    if (Object.keys(jobPatch).length > 0) {
      this.applyModelPatch({ job: jobPatch });
    }
  }

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


  /**
   * Deep-merge a partial patch into the cached object model.
   * Handles both full replacement objects and incremental patches from the WS.
   */
  /**
   * Deep-merge a partial patch into the cached object model.
   * Handles both full replacement objects and incremental patches from the WS.
   */
  private applyModelPatch(patch: Record<string, unknown>): void {
    this.objectModel = applyObjectModelPatch(this.objectModel, patch);
  }

  /** Fetch static config sections (tool defs, fan names, etc.) and merge into objectModel. */
  private async fetchConfigSnapshot(): Promise<void> {
    await fetchObjectModelSnapshot(
      this.getObjectModel.bind(this),
      this.applyModelPatch.bind(this),
    );
  }

  async getObjectModel(
    key?: string,
    flags?: string
  ): Promise<Partial<DuetObjectModel>> {
    if (this.isUsbTransport) return this.objectModel;
    return getObjectModelRequest(
      this.config,
      this.baseUrl,
      this.request.bind(this),
      key,
      flags,
    );
  }

  getModel(): Partial<DuetObjectModel> {
    return this.objectModel;
  }


  on(event: string, callback: (data: unknown) => void): () => void {
    return this.eventBus.on(event, callback);
  }

  private emit(event: string, data: unknown): void {
    this.eventBus.emit(event, data);
  }
  // G-Code execution

  async sendGCode(code: string): Promise<string> {
    if (this.isUsbTransport) {
      if (!this.serial?.isOpen()) throw new Error('Serial port is not open.');
      return this.serial.sendGCode(code);
    }

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
    if (this.isUsbTransport) return '';
    if (this.config.mode === 'sbc') return '';
    try {
      const url = `${this.baseUrl}/rr_reply`;
      const reply = await this.request<string>(url);
      return typeof reply === 'string' ? reply : '';
    } catch {
      return '';
    }
  }


  async setToolTemperature(
    toolIndex: number,
    heaterIndex: number,
    temp: number,
    standby = false
  ): Promise<void> {
    await setToolTemperatureCommand(this.sendGCode.bind(this), this.objectModel, toolIndex, heaterIndex, temp, standby);
  }

  async setBedTemperature(temp: number): Promise<void> {
    await setBedTemperatureCommand(this.sendGCode.bind(this), temp);
  }

  async setChamberTemperature(temp: number): Promise<void> {
    await setChamberTemperatureCommand(this.sendGCode.bind(this), temp);
  }

  async homeAxes(axes?: string[]): Promise<void> {
    await homeAxesCommand(this.sendGCode.bind(this), axes);
  }

  async moveAxis(
    axis: string,
    distance: number,
    feedrate?: number,
    relative = true
  ): Promise<void> {
    await moveAxisCommand(this.sendGCode.bind(this), axis, distance, feedrate, relative);
  }

  async setSpeedFactor(percent: number): Promise<void> {
    await this.sendGCode(`M220 S${percent}`);
  }

  async setExtrusionFactor(extruder: number, percent: number): Promise<void> {
    await this.sendGCode(`M221 D${extruder} S${percent}`);
  }

  async extrude(amount: number, feedrate: number): Promise<void> {
    await extrudeCommand(this.sendGCode.bind(this), amount, feedrate);
  }

  async retract(amount: number, feedrate: number): Promise<void> {
    await this.extrude(-Math.abs(amount), feedrate);
  }

  async setBabyStep(offset: number): Promise<void> {
    await this.sendGCode(`M290 S${offset}`);
  }

  async setFanSpeed(fanIndex: number, speed: number): Promise<void> {
    await setFanSpeedCommand(this.sendGCode.bind(this), fanIndex, speed);
  }

  async startPrint(filename: string): Promise<void> {
    await startPrintCommand(this.sendGCode.bind(this), filename);
  }

  async pausePrint(): Promise<void> {
    await pausePrintCommand(this.sendGCode.bind(this));
  }

  async resumePrint(): Promise<void> {
    await resumePrintCommand(this.sendGCode.bind(this));
  }

  async cancelPrint(): Promise<void> {
    await cancelPrintCommand(this.sendGCode.bind(this));
  }

  async cancelObject(objectIndex: number): Promise<void> {
    await cancelObjectCommand(this.sendGCode.bind(this), objectIndex);
  }

  async simulateFile(filename: string): Promise<void> {
    await simulateFileCommand(this.sendGCode.bind(this), filename);
  }

  async emergencyStop(): Promise<void> {
    await emergencyStopCommand(this.sendGCode.bind(this));
  }

  async selectTool(toolIndex: number): Promise<void> {
    await selectToolCommand(this.sendGCode.bind(this), toolIndex);
  }

  async deselectTool(): Promise<void> {
    await deselectToolCommand(this.sendGCode.bind(this));
  }


  async listFiles(directory: string): Promise<DuetFileInfo[]> {
    if (this.isUsbTransport) return [];
    return listFilesRequest(this.fileApiContext, directory);
  }

  async getFileInfo(filename: string): Promise<DuetGCodeFileInfo> {
    return getFileInfoRequest(this.fileApiContext, filename);
  }

  async uploadFile(
    path: string,
    content: Blob | File,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    return uploadFileRequest(this.fileApiContext, path, content, onProgress);
  }

  async downloadFile(path: string): Promise<Blob> {
    return downloadFileRequest(this.fileApiContext, path);
  }

  async deleteFile(path: string): Promise<void> {
    return deleteFileRequest(this.fileApiContext, path);
  }

  async moveFile(from: string, to: string): Promise<void> {
    return moveFileRequest(this.fileApiContext, from, to);
  }

  async createDirectory(path: string): Promise<void> {
    return createDirectoryRequest(this.fileApiContext, path);
  }


  async listMacros(): Promise<DuetFileInfo[]> {
    return this.listFiles('0:/macros');
  }

  async runMacro(filename: string): Promise<string> {
    return runMacroCommand(this.sendGCode.bind(this), filename);
  }


  async getHeightMap(path = '0:/sys/heightmap.csv'): Promise<DuetHeightMap | null> {
    return getHeightMapData(this.downloadFile.bind(this), path);
  }
  async probeGrid(): Promise<void> {
    await this.sendGCode('G29 S0');
  }


  async setAtxPower(on: boolean): Promise<void> {
    await this.sendGCode(on ? 'M80' : 'M81');
  }


  getWebcamUrl(): string {
    return getWebcamStreamUrl(this.baseUrl);
  }

  getSnapshotUrl(): string {
    return getSnapshotImageUrl(this.baseUrl);
  }


  async getThumbnail(
    filename: string,
    offset: number
  ): Promise<string | null> {
    return getThumbnailData(this.config, this.baseUrl, filename, offset, this.request.bind(this));
  }


  isConnected(): boolean {
    return this.connected;
  }

  getConfig(): DuetConfig {
    return { ...this.config };
  }
}
