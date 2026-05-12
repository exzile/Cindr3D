/* =============================================================================
   USB serial diagnostic console.
   Lets the user open a temporary Web Serial connection from the Connection
   tab — independent of the main DuetService — to send raw G-code and watch
   replies. Handy for verifying baud / port choices before committing to a
   full Connect.
   ============================================================================= */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Power, PowerOff, Send, Terminal, Trash2 } from 'lucide-react';
import { errorMessage } from '../../../utils/errorHandling';
import {
  WebSerialConnection,
  findGrantedPort,
  isWebSerialSupported,
} from '../../../services/usb/webSerial';

interface Line {
  ts: number;
  kind: 'out' | 'in' | 'sys' | 'err';
  text: string;
}

const MAX_LINES = 400;

export function SerialConsoleSection({
  baudRate,
  vendorId,
  productId,
  portLabel,
  busy,
}: {
  baudRate: number;
  vendorId?: number;
  productId?: number;
  portLabel: string;
  busy: boolean;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const connectionRef = useRef<WebSerialConnection | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Always close the temporary connection on unmount so unplug doesn't
  // leak file descriptors held by the browser.
  useEffect(() => () => {
    void connectionRef.current?.close();
    connectionRef.current = null;
  }, []);

  // Auto-scroll to bottom on new lines.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const append = (kind: Line['kind'], text: string) => {
    setLines((prev) => {
      const next = [...prev, { ts: Date.now(), kind, text }];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  };

  const handleOpen = async () => {
    if (!isWebSerialSupported()) {
      append('err', 'Web Serial is not supported by this browser.');
      return;
    }
    setOpening(true);
    try {
      const port = await findGrantedPort(vendorId, productId);
      if (!port) {
        append('err', 'No granted USB port to open. Pick one above first.');
        return;
      }
      const conn = new WebSerialConnection(baudRate);
      await conn.open(port);
      conn.onLine((line) => append('in', line));
      conn.onDisconnect((err) => {
        append('err', `Serial connection lost: ${err.message}`);
        connectionRef.current = null;
        setOpen(false);
      });
      connectionRef.current = conn;
      setOpen(true);
      append('sys', `Opened ${portLabel || 'serial port'} @ ${baudRate} baud`);
    } catch (err) {
      append('err', errorMessage(err, 'Unknown error') || 'Could not open the serial port.');
    } finally {
      setOpening(false);
    }
  };

  const handleClose = async () => {
    try { await connectionRef.current?.close(); } catch { /* best-effort */ }
    connectionRef.current = null;
    setOpen(false);
    append('sys', 'Closed serial port');
  };

  const handleSend = async () => {
    const code = input.trim();
    if (!code) return;
    if (!connectionRef.current?.isOpen()) {
      append('err', 'Port is not open.');
      return;
    }
    append('out', code);
    setInput('');
    try {
      await connectionRef.current.sendGCode(code, 4000);
      // The reply lines arrive via onLine and are already appended.
    } catch (err) {
      append('err', errorMessage(err, 'Unknown error'));
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const cantOpen = busy || opening || !isWebSerialSupported() || !portLabel;

  return (
    <div className="duet-settings__section">
      <div className="duet-settings__section-title">
        <Terminal size={14} style={{ marginRight: 4 }} /> Diagnostic Console
      </div>

      <div className="duet-settings__hint" style={{ marginBottom: 8 }}>
        Open a temporary serial connection without committing to Connect. Useful for
        sanity-checking baud and port choice — try <code>M115</code> for a firmware
        identifier or <code>M105</code> for a temperature line.
      </div>

      <div className="duet-settings__btn-row">
        {!open ? (
          <button
            className={`duet-settings__btn duet-settings__btn--secondary${cantOpen ? ' duet-settings__btn--disabled' : ''}`}
            disabled={cantOpen}
            onClick={handleOpen}
          >
            {opening ? <><Loader2 size={14} className="spin" /> Opening…</> : <><Power size={14} /> Open Port</>}
          </button>
        ) : (
          <button className="duet-settings__btn duet-settings__btn--danger" onClick={handleClose}>
            <PowerOff size={14} /> Close Port
          </button>
        )}
        <button
          className="duet-settings__btn duet-settings__btn--secondary"
          onClick={() => setLines([])}
          disabled={lines.length === 0}
        >
          <Trash2 size={14} /> Clear
        </button>
      </div>

      <div ref={logRef} className="duet-settings__serial-log" role="log" aria-live="polite">
        {lines.length === 0
          ? <span className="duet-settings__dim-text">No output yet.</span>
          : lines.map((l, i) => (
              <div key={`${l.ts}-${i}`} className={`duet-settings__serial-line duet-settings__serial-line--${l.kind}`}>
                <span className="duet-settings__serial-prefix">
                  {l.kind === 'out' ? '>' : l.kind === 'in' ? '<' : l.kind === 'err' ? '!' : '·'}
                </span>
                {l.text}
              </div>
            ))
        }
      </div>

      <div className="duet-settings__serial-input-row">
        <input
          className="duet-settings__input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={open ? 'Type a G-code (e.g. M115) and press Enter' : 'Open the port to send commands'}
          disabled={!open}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className={`duet-settings__btn duet-settings__btn--primary${!open || !input.trim() ? ' duet-settings__btn--disabled' : ''}`}
          onClick={handleSend}
          disabled={!open || !input.trim()}
        >
          <Send size={14} /> Send
        </button>
      </div>
    </div>
  );
}
