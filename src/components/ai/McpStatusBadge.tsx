import { Copy, List, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  cindr3dMcpClient,
  type Cindr3dMcpAuditEntry,
  type Cindr3dMcpStatus,
  stopCindr3dMcpOnUnload,
} from '../../services/mcp/client';
import './McpStatusBadge.css';

const HEARTBEAT_MS = 5_000;

export default function McpStatusBadge() {
  const [status, setStatus] = useState<Cindr3dMcpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [auditEntries, setAuditEntries] = useState<Cindr3dMcpAuditEntry[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const next = await cindr3dMcpClient.heartbeat();
        if (!cancelled) {
          setStatus(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    void sync();
    const id = setInterval(sync, HEARTBEAT_MS);
    window.addEventListener('beforeunload', stopCindr3dMcpOnUnload);
    window.addEventListener('pagehide', stopCindr3dMcpOnUnload);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('beforeunload', stopCindr3dMcpOnUnload);
      window.removeEventListener('pagehide', stopCindr3dMcpOnUnload);
    };
  }, []);

  const copyPairingLine = useCallback(async () => {
    if (!status) return;
    await navigator.clipboard.writeText(status.pairingLine);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [status]);

  const rotateToken = useCallback(async () => {
    try {
      setStatus(await cindr3dMcpClient.rotateToken());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const toggleAudit = useCallback(async () => {
    const nextOpen = !auditOpen;
    setAuditOpen(nextOpen);
    if (!nextOpen) return;
    try {
      const audit = await cindr3dMcpClient.audit();
      setAuditEntries(audit.entries);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [auditOpen]);

  const clearAudit = useCallback(async () => {
    try {
      await cindr3dMcpClient.clearAudit();
      setAuditEntries([]);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const title = error
    ? `AI Assistant MCP error: ${error}`
    : status?.pairingLine ?? 'Starting AI Assistant MCP';

  return (
    <span className="mcp-status-wrap">
      <span className={`mcp-status-badge ${status?.running ? 'active' : ''}`} title={title}>
        <span className="mcp-status-dot" />
        <span>AI MCP</span>
        {status && (
          <>
            <button className="mcp-icon-button" type="button" onClick={copyPairingLine} title="Copy Claude MCP command">
              <Copy size={12} aria-hidden="true" />
            </button>
            <button className="mcp-icon-button" type="button" onClick={rotateToken} title="Rotate pairing token">
              <RefreshCw size={12} aria-hidden="true" />
            </button>
            <button className="mcp-icon-button" type="button" onClick={toggleAudit} title="Show MCP activity">
              <List size={12} aria-hidden="true" />
            </button>
          </>
        )}
        {copied && <span className="mcp-copied">Copied</span>}
      </span>
      {auditOpen && (
        <span className="mcp-audit-popover">
          <span className="mcp-audit-header">
            <span>Activity</span>
            <button className="mcp-icon-button" type="button" onClick={clearAudit} title="Clear MCP activity">
              <X size={12} aria-hidden="true" />
            </button>
          </span>
          <span className="mcp-audit-list">
            {auditEntries.length === 0 && <span className="mcp-audit-empty">No tool calls yet</span>}
            {auditEntries.slice(0, 8).map((entry) => (
              <span className={`mcp-audit-row ${entry.status}`} key={`${entry.callId}-${entry.status}-${entry.timestamp}`}>
                <span>{entry.tool}</span>
                <span>{entry.status}</span>
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}
