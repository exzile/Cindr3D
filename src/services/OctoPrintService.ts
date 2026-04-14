export interface OctoPrintConfig {
  url: string;       // e.g. "http://octopi.local" or "http://192.168.1.100"
  apiKey: string;     // OctoPrint API key from settings
}

export interface PrinterStatus {
  state: string;
  stateDescription: string;
  flags: {
    operational: boolean;
    printing: boolean;
    paused: boolean;
    error: boolean;
    ready: boolean;
    closedOrError: boolean;
  };
}

interface OctoPrinterResponse {
  state: PrinterStatus;
  temperature: TemperatureData;
}

interface OctoFilesResponse {
  files: Array<{
    name: string;
    path?: string;
    type: string;
    size: number;
    date: number;
    origin: 'local' | 'sdcard';
  }>;
}

export interface TemperatureData {
  bed: { actual: number; target: number; offset: number };
  tool0: { actual: number; target: number; offset: number };
  tool1?: { actual: number; target: number; offset: number };
}

export interface PrintJob {
  file: { name: string; size: number; date: number };
  estimatedPrintTime: number;
  averagePrintTime: number | null;
  filament: {
    tool0?: { length: number; volume: number };
  };
}

export interface PrintProgress {
  completion: number;          // 0-100
  filepos: number;
  printTime: number;           // seconds elapsed
  printTimeLeft: number;       // seconds remaining
  printTimeLeftOrigin: string;
}

export interface PrinterFile {
  name: string;
  path: string;
  type: string;
  size: number;
  date: number;
  origin: 'local' | 'sdcard';
}

export interface ConnectionSettings {
  ports: string[];
  baudrates: number[];
  printerProfiles: { id: string; name: string }[];
  current: {
    port: string | null;
    baudrate: number | null;
    printerProfile: string | null;
    state: string;
  };
}

export class OctoPrintService {
  private config: OctoPrintConfig;
  private eventSource: EventSource | null = null;
  private _pollInterval: number | null = null;
  private _pollInFlight = false;

  constructor(config: OctoPrintConfig) {
    this.config = config;
  }

  private get headers(): Record<string, string> {
    return {
      'X-Api-Key': this.config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.config.url}/api${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.headers,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OctoPrint API error ${response.status}: ${text}`);
    }

    if (response.status === 204) return {} as T;
    return response.json();
  }

  // ===== Connection =====

  async getConnection(): Promise<ConnectionSettings> {
    return this.request('/connection');
  }

  async connect(port?: string, baudrate?: number, profile?: string): Promise<void> {
    await this.request('/connection', {
      method: 'POST',
      body: JSON.stringify({
        command: 'connect',
        port: port || 'AUTO',
        baudrate: baudrate || 0,
        printerProfile: profile || '_default',
        autoconnect: true,
      }),
    });
  }

  async disconnect(): Promise<void> {
    await this.request('/connection', {
      method: 'POST',
      body: JSON.stringify({ command: 'disconnect' }),
    });
  }

  // ===== Printer Status =====

  async getPrinterState(): Promise<{ state: PrinterStatus; temperature: TemperatureData }> {
    const data = await this.request<OctoPrinterResponse>('/printer');
    return {
      state: data.state,
      temperature: data.temperature,
    };
  }

  async getJob(): Promise<{ job: PrintJob; progress: PrintProgress; state: string }> {
    return this.request('/job');
  }

  // ===== Temperature =====

  async setNozzleTemp(temp: number, tool = 0): Promise<void> {
    await this.request('/printer/tool', {
      method: 'POST',
      body: JSON.stringify({
        command: 'target',
        targets: { [`tool${tool}`]: temp },
      }),
    });
  }

  async setBedTemp(temp: number): Promise<void> {
    await this.request('/printer/bed', {
      method: 'POST',
      body: JSON.stringify({
        command: 'target',
        target: temp,
      }),
    });
  }

  // ===== Print Control =====

  async startPrint(filename: string): Promise<void> {
    // Select file and start printing
    await this.request(`/files/local/${encodeURIComponent(filename)}`, {
      method: 'POST',
      body: JSON.stringify({
        command: 'select',
        print: true,
      }),
    });
  }

  async pausePrint(): Promise<void> {
    await this.request('/job', {
      method: 'POST',
      body: JSON.stringify({ command: 'pause', action: 'pause' }),
    });
  }

  async resumePrint(): Promise<void> {
    await this.request('/job', {
      method: 'POST',
      body: JSON.stringify({ command: 'pause', action: 'resume' }),
    });
  }

  async cancelPrint(): Promise<void> {
    await this.request('/job', {
      method: 'POST',
      body: JSON.stringify({ command: 'cancel' }),
    });
  }

  // ===== File Management =====

  async listFiles(): Promise<PrinterFile[]> {
    const data = await this.request<OctoFilesResponse>('/files');
    return data.files.map((f) => ({
      name: f.name,
      path: f.path || f.name,
      type: f.type,
      size: f.size,
      date: f.date,
      origin: f.origin,
    }));
  }

  async uploadFile(file: File | Blob, filename: string, startPrint = false): Promise<void> {
    const formData = new FormData();
    formData.append('file', file, filename);
    formData.append('select', 'true');
    if (startPrint) formData.append('print', 'true');

    const url = `${this.config.url}/api/files/local`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'X-Api-Key': this.config.apiKey },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
  }

  async deleteFile(filename: string, origin = 'local'): Promise<void> {
    await this.request(`/files/${origin}/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  }

  // ===== Movement =====

  async homeAxes(axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z']): Promise<void> {
    await this.request('/printer/command', {
      method: 'POST',
      body: JSON.stringify({
        commands: [`G28 ${axes.map(a => a.toUpperCase()).join(' ')}`],
      }),
    });
  }

  async jog(x?: number, y?: number, z?: number): Promise<void> {
    await this.request('/printer/printhead', {
      method: 'POST',
      body: JSON.stringify({
        command: 'jog',
        x: x || 0,
        y: y || 0,
        z: z || 0,
      }),
    });
  }

  async sendGCode(commands: string[]): Promise<void> {
    await this.request('/printer/command', {
      method: 'POST',
      body: JSON.stringify({ commands }),
    });
  }

  // ===== Webcam =====

  getWebcamUrl(): string {
    return `${this.config.url}/webcam/?action=stream`;
  }

  getSnapshotUrl(): string {
    return `${this.config.url}/webcam/?action=snapshot`;
  }

  // ===== Server Info =====

  async getVersion(): Promise<{ api: string; server: string; text: string }> {
    return this.request('/version');
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getVersion();
      return true;
    } catch {
      return false;
    }
  }

  // ===== Event Streaming =====

  startEventStream(
    onMessage: (event: OctoPrintEvent) => void,
    onError?: (error: Event) => void
  ): void {
    this.stopEventStream();

    // OctoPrint uses SockJS, but we can poll as a simpler alternative
    // For real-time updates, we'll poll every 2 seconds
    const poll = async () => {
      if (this._pollInFlight) return;
      this._pollInFlight = true;
      try {
        const [printerData, jobData] = await Promise.all([
          this.getPrinterState().catch(() => null),
          this.getJob().catch(() => null),
        ]);

        if (printerData) {
          onMessage({
            type: 'temperature',
            data: printerData.temperature,
          });
          onMessage({
            type: 'state',
            data: printerData.state,
          });
        }

        if (jobData) {
          onMessage({
            type: 'progress',
            data: jobData.progress,
          });
          onMessage({
            type: 'job',
            data: jobData.job,
          });
        }
      } catch {
        onError?.(new Event('error'));
      } finally {
        this._pollInFlight = false;
      }
    };

    poll();
    this._pollInterval = window.setInterval(poll, 2000);
  }

  stopEventStream(): void {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    this._pollInFlight = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

export interface OctoPrintEvent {
  type: 'temperature' | 'state' | 'progress' | 'job';
  data: TemperatureData | PrinterStatus | PrintProgress | PrintJob;
}

// ===== Printer Store =====

export interface PrinterState {
  connected: boolean;
  config: OctoPrintConfig | null;
  status: PrinterStatus | null;
  temperature: TemperatureData | null;
  job: PrintJob | null;
  progress: PrintProgress | null;
  files: PrinterFile[];
  error: string | null;
  webcamUrl: string | null;
}

export const DEFAULT_PRINTER_STATE: PrinterState = {
  connected: false,
  config: null,
  status: null,
  temperature: null,
  job: null,
  progress: null,
  files: [],
  error: null,
  webcamUrl: null,
};
