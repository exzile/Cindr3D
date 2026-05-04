/* =============================================================================
   Web Serial transport for USB-connected 3D printer boards.

   Marlin / grbl / Smoothie / Klipper-over-USB / RepRapFirmware-USB all speak
   newline-terminated G-code over a serial UART. This adapter:
     - feature-detects navigator.serial
     - requests / re-uses port permissions (vendorId/productId-matched)
     - opens the port at a chosen baud rate
     - sends a single G-code line and waits for "ok" / response
     - emits incoming async lines via a listener
   ============================================================================= */

export interface WebSerialPortInfo {
  vendorId?: number;
  productId?: number;
  label: string;
}

export interface WebSerialPort {
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

interface SerialNavigator {
  serial?: {
    requestPort: (options?: { filters?: { usbVendorId?: number }[] }) => Promise<WebSerialPort>;
    getPorts: () => Promise<WebSerialPort[]>;
  };
}

function getSerial(): SerialNavigator['serial'] | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as unknown as SerialNavigator).serial;
}

export function isWebSerialSupported(): boolean {
  return Boolean(getSerial());
}

function describePort(port: WebSerialPort): WebSerialPortInfo {
  const info = port.getInfo();
  const vid = info.usbVendorId;
  const pid = info.usbProductId;
  const label = vid !== undefined && pid !== undefined
    ? `USB device ${vid.toString(16).padStart(4, '0')}:${pid.toString(16).padStart(4, '0')}`
    : 'USB serial device';
  return { vendorId: vid, productId: pid, label };
}

export async function requestSerialPort(): Promise<{ port: WebSerialPort; info: WebSerialPortInfo }> {
  const serial = getSerial();
  if (!serial) throw new Error('Web Serial is not supported by this browser. Try Chrome, Edge, or Opera over HTTPS.');
  const port = await serial.requestPort();
  return { port, info: describePort(port) };
}

export async function findGrantedPort(
  vendorId?: number,
  productId?: number,
): Promise<WebSerialPort | null> {
  const serial = getSerial();
  if (!serial) return null;
  const ports = await serial.getPorts();
  if (vendorId !== undefined || productId !== undefined) {
    const match = ports.find((p) => {
      const i = p.getInfo();
      const vMatch = vendorId === undefined || i.usbVendorId === vendorId;
      const pMatch = productId === undefined || i.usbProductId === productId;
      return vMatch && pMatch;
    });
    if (match) return match;
  }
  return ports[0] ?? null;
}

export type SerialLineListener = (line: string) => void;
export type SerialDisconnectListener = (error: Error) => void;

/**
 * One open Web Serial connection. Buffers incoming bytes, splits on newlines,
 * and emits each completed line to the listener. sendGCode() writes a line and
 * resolves with the next "ok"-bearing response (or all collected lines until
 * an "ok" / "error" / timeout).
 */
export class WebSerialConnection {
  private port: WebSerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private buffer = '';
  private listeners = new Set<SerialLineListener>();
  private disconnectListeners = new Set<SerialDisconnectListener>();
  private pending: Array<{
    resolve: (response: string) => void;
    reject: (err: Error) => void;
    collected: string[];
    timeoutHandle: ReturnType<typeof setTimeout>;
  }> = [];
  private closed = false;
  private readonly baudRate: number;

  constructor(baudRate: number) {
    this.baudRate = baudRate;
  }

  isOpen(): boolean {
    return this.port !== null && !this.closed;
  }

  onLine(listener: SerialLineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onDisconnect(listener: SerialDisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async open(port: WebSerialPort): Promise<void> {
    if (this.port) throw new Error('Serial connection already open.');
    await port.open({ baudRate: this.baudRate, bufferSize: 8 * 1024 });
    if (!port.readable || !port.writable) {
      await port.close().catch(() => {});
      throw new Error('Serial port did not provide both readable and writable streams.');
    }
    this.port = port;
    this.closed = false;
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
    void this.readLoop().catch(() => {/* swallow — close() will report */});
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Cancel reader before closing the port so the read loop unwinds and the
    // stream lock is released cleanly. Each step is best-effort.
    if (this.reader) {
      try { await this.reader.cancel(); } catch { /* read may already be done */ }
      try { this.reader.releaseLock(); } catch { /* cancel released the lock */ }
      this.reader = null;
    }
    if (this.writer) {
      try { await this.writer.close(); } catch { /* writer may already be closed */ }
      try { this.writer.releaseLock(); } catch { /* close released the lock */ }
      this.writer = null;
    }
    if (this.port) {
      try { await this.port.close(); } catch { /* port may already be closed */ }
      this.port = null;
    }

    for (const p of this.pending) {
      clearTimeout(p.timeoutHandle);
      p.reject(new Error('Serial connection closed'));
    }
    this.pending = [];
    this.listeners.clear();
    this.disconnectListeners.clear();
    this.buffer = '';
  }

  /**
   * Send a single G-code line and wait for the printer's response.
   * Most firmwares (Marlin, RRF, Klipper) terminate each command with an "ok"
   * line; we resolve when we see it, or after a soft timeout.
   */
  async sendGCode(code: string, timeoutMs = 4000): Promise<string> {
    if (!this.writer) throw new Error('Serial connection is not open.');
    const line = code.endsWith('\n') ? code : `${code}\n`;
    return new Promise<string>((resolve, reject) => {
      const collected: string[] = [];
      const timeoutHandle = setTimeout(() => {
        const idx = this.pending.findIndex((p) => p.timeoutHandle === timeoutHandle);
        if (idx >= 0) this.pending.splice(idx, 1);
        // Resolve with whatever we have rather than rejecting — many commands
        // produce no acknowledgement at all (e.g. raw movement).
        resolve(collected.join('\n').trim());
      }, timeoutMs);

      this.pending.push({ resolve, reject, collected, timeoutHandle });

      this.writer!
        .write(this.encoder.encode(line))
        .catch((err) => {
          clearTimeout(timeoutHandle);
          const idx = this.pending.findIndex((p) => p.timeoutHandle === timeoutHandle);
          if (idx >= 0) this.pending.splice(idx, 1);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  private async readLoop(): Promise<void> {
    if (!this.reader) return;
    try {
      while (!this.closed) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        this.buffer += this.decoder.decode(value, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = this.buffer.indexOf('\n')) >= 0) {
          const rawLine = this.buffer.slice(0, newlineIdx);
          this.buffer = this.buffer.slice(newlineIdx + 1);
          const line = rawLine.replace(/\r$/, '').trim();
          if (!line) continue;
          this.dispatchLine(line);
        }
      }
    } catch (err) {
      // Read errors usually mean the port was unplugged. Treat that as a hard
      // disconnect so pending commands reject and isOpen() flips immediately.
      if (!this.closed) await this.handleReadFailure(err);
    }
  }

  private async handleReadFailure(err: unknown): Promise<void> {
    const error = err instanceof Error ? err : new Error(String(err || 'Serial connection lost'));
    for (const listener of this.disconnectListeners) {
      try { listener(error); } catch { /* listener errors must not break teardown */ }
    }
    await this.close();
  }

  private dispatchLine(line: string): void {
    for (const listener of this.listeners) {
      try { listener(line); } catch { /* listener errors must not break the read loop */ }
    }
    if (this.pending.length === 0) return;
    const first = this.pending[0];
    first.collected.push(line);
    const lower = line.toLowerCase();
    if (lower === 'ok' || lower.startsWith('ok ') || lower.startsWith('error') || lower.startsWith('!!')) {
      this.pending.shift();
      clearTimeout(first.timeoutHandle);
      first.resolve(first.collected.join('\n').trim());
    }
  }
}
