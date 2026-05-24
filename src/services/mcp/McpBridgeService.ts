import { TOOL_HANDLERS } from './tools/index';

// McpBridgeService — connects the browser to the Vite-side MCP relay.
//
// Lifecycle:
//   McpBridgeService.start()   — called once on app mount
//   McpBridgeService.stop()    — called on unload / hot-module reload
//
// Protocol:
//   GET  /mcp-control/relay         → SSE stream; server pushes { callId, tool, args }
//   POST /mcp-control/relay-result  → browser posts { callId, result } or { callId, error }
//   POST /mcp-control/heartbeat     → keeps MCP server alive (every 10 s)

const CONTROL_BASE = '/mcp-control';
const HEARTBEAT_INTERVAL_MS = 10_000;

interface RelayCall {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
}

class McpBridgeServiceClass {
  private evtSource: EventSource | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;

  start(): void {
    if (this.evtSource) return; // already running
    this.stopping = false;
    this.connectRelay();
    this.startHeartbeat();
  }

  stop(): void {
    this.stopping = true;
    this.clearReconnectTimer();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.closeRelay();
    // Notify the Vite plugin to stop the MCP HTTP server
    fetch(`${CONTROL_BASE}/stop`).catch(() => undefined);
  }

  private connectRelay(): void {
    if (this.stopping) return;
    this.clearReconnectTimer();
    const src = new EventSource(`${CONTROL_BASE}/relay`);
    this.evtSource = src;

    src.onmessage = (ev) => {
      let call: RelayCall;
      try {
        call = JSON.parse(ev.data) as RelayCall;
      } catch {
        return;
      }
      void this.dispatch(call);
    };

    src.onerror = () => {
      // SSE dropped; close and reconnect after a delay
      this.closeRelay();
      if (!this.stopping && this.reconnectTimer === null) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connectRelay();
        }, 2_000);
      }
    };
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private closeRelay(): void {
    this.evtSource?.close();
    this.evtSource = null;
  }

  private async dispatch(call: RelayCall): Promise<void> {
    const handler = TOOL_HANDLERS[call.tool];
    let result: unknown;
    let error: string | undefined;

    if (!handler) {
      error = `Unknown tool: "${call.tool}"`;
    } else {
      try {
        result = await handler(call.args ?? {});
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }

    const body = error
      ? { callId: call.callId, error }
      : { callId: call.callId, result };

    try {
      await fetch(`${CONTROL_BASE}/relay-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (fetchErr) {
      console.warn('[McpBridge] failed to post relay result:', fetchErr);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    // Send an immediate heartbeat so the MCP server starts right away
    void fetch(`${CONTROL_BASE}/heartbeat`).catch(() => undefined);
    this.heartbeatTimer = setInterval(() => {
      fetch(`${CONTROL_BASE}/heartbeat`).catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
  }
}

export const McpBridgeService = new McpBridgeServiceClass();
