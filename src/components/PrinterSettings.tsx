import { useState } from 'react';
import { X, Wifi, Loader2 } from 'lucide-react';
import { usePrinterStore } from '../store/printerStore';

export default function PrinterSettings() {
  const showSettings = usePrinterStore((s) => s.showSettings);
  const setShowSettings = usePrinterStore((s) => s.setShowSettings);
  const connected = usePrinterStore((s) => s.connected);
  const config = usePrinterStore((s) => s.config);
  const connectPrinter = usePrinterStore((s) => s.connectPrinter);
  const disconnectPrinter = usePrinterStore((s) => s.disconnectPrinter);
  const error = usePrinterStore((s) => s.error);

  const [url, setUrl] = useState(config?.url || 'http://octopi.local');
  const [apiKey, setApiKey] = useState(config?.apiKey || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);

  if (!showSettings) return null;

  const handleConnect = async () => {
    if (!url || !apiKey) return;
    setTesting(true);
    setTestResult(null);

    try {
      await connectPrinter({ url: url.replace(/\/$/, ''), apiKey });
      setTestResult('success');
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = () => {
    disconnectPrinter();
    setTestResult(null);
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>Printer Connection</h3>
          <button className="dialog-close" onClick={() => setShowSettings(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="connection-status-banner">
            {connected ? (
              <div className="banner success">
                <Wifi size={16} /> Connected to printer
              </div>
            ) : (
              <div className="banner info">
                Connect to your 3D printer via OctoPrint
              </div>
            )}
          </div>

          <div className="form-group">
            <label>OctoPrint URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://octopi.local or http://192.168.1.100"
              disabled={connected}
            />
            <span className="form-hint">
              The address of your OctoPrint instance
            </span>
          </div>

          <div className="form-group">
            <label>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Your OctoPrint API key"
              disabled={connected}
            />
            <span className="form-hint">
              Found in OctoPrint Settings &gt; API &gt; Global API Key
            </span>
          </div>

          {testResult === 'success' && (
            <div className="banner success">Connection successful</div>
          )}
          {testResult === 'fail' && (
            <div className="banner error">
              Connection failed. Check the URL and API key.
            </div>
          )}
          {error && (
            <div className="banner error">{error}</div>
          )}

          <div className="help-section">
            <h4>Setup Guide</h4>
            <ol>
              <li>Install OctoPrint on a Raspberry Pi connected to your printer</li>
              <li>Open OctoPrint in your browser</li>
              <li>Go to Settings &gt; API</li>
              <li>Copy the Global API Key</li>
              <li>Enter the URL and API key above</li>
            </ol>
            <p className="help-note">
              Both your computer and printer must be on the same network.
              If using a hostname like "octopi.local", make sure mDNS is working
              on your network, or use the IP address directly.
            </p>
          </div>
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={() => setShowSettings(false)}>
            Close
          </button>
          {connected ? (
            <button className="btn btn-danger" onClick={handleDisconnect}>
              Disconnect
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleConnect}
              disabled={!url || !apiKey || testing}
            >
              {testing ? (
                <><Loader2 size={14} className="spin" /> Connecting...</>
              ) : (
                <><Wifi size={14} style={{ marginRight: 6 }} /> Connect</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
