import { ChevronDown, ChevronRight, Copy, List, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cindr3dMcpClient, type Cindr3dMcpAuditEntry, type Cindr3dMcpStatus } from '../../../services/mcp/client';
import { errorMessage } from '../../../utils/errorHandling';

/**
 * MCP tab — shows the local MCP server's status, the pairing line for
 * external Claude Code clients, and a recent-tool-calls audit log.
 */
export function McpTab() {
  const [status, setStatus] = useState<Cindr3dMcpStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEntries, setAuditEntries] = useState<Cindr3dMcpAuditEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    cindr3dMcpClient.heartbeat().then(setStatus).catch((e) => setErr(errorMessage(e, 'Unknown error')));
  }, []);

  const copy = useCallback(async () => {
    if (!status) return;
    await navigator.clipboard.writeText(status.pairingLine);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [status]);

  const rotate = useCallback(async () => {
    try { setStatus(await cindr3dMcpClient.rotateToken()); setErr(null); }
    catch (e) { setErr(errorMessage(e, 'Unknown error')); }
  }, []);

  const toggleAudit = useCallback(async () => {
    const next = !auditOpen;
    setAuditOpen(next);
    if (!next) return;
    try {
      const { entries } = await cindr3dMcpClient.audit();
      setAuditEntries(entries);
      setErr(null);
    } catch (e) { setErr(errorMessage(e, 'Unknown error')); }
  }, [auditOpen]);

  const clearAudit = useCallback(async () => {
    try { await cindr3dMcpClient.clearAudit(); setAuditEntries([]); } catch { /* ignore */ }
  }, []);

  return (
    <div className="ai-tab-content">
      <div className="ai-mcp-status">
        <span className={`ai-mcp-dot ${status?.running ? 'ai-mcp-dot-on' : ''}`} />
        <span>{status?.running ? 'MCP Server Running' : 'MCP Server Starting…'}</span>
        {status && (
          <span className="ai-mcp-port">:{status.port}</span>
        )}
      </div>

      {err && <div className="ai-error">{err}</div>}

      {status && (
        <>
          <div className="ai-section-label">Claude Code Config</div>
          <div className="ai-code-block">
            <pre>{status.pairingLine}</pre>
            <div className="ai-code-actions">
              <button type="button" className="ai-icon-btn" onClick={copy} title="Copy" aria-label="Copy Claude Code MCP config">
                <Copy size={12} />
                {copied && <span className="ai-copied-label">Copied</span>}
              </button>
              <button type="button" className="ai-icon-btn" onClick={rotate} title="Rotate token" aria-label="Rotate Claude Code MCP pairing token">
                <RefreshCw size={12} />
              </button>
            </div>
          </div>
          <p className="ai-hint">
            Add the config above to your Claude Code MCP settings (Settings → MCP Servers), then chat in your terminal — geometry updates appear here instantly.
          </p>
        </>
      )}

      <div className="ai-audit-header">
        <button type="button" className="ai-collapse-btn" onClick={toggleAudit} aria-expanded={auditOpen} aria-controls="ai-mcp-audit-list">
          {auditOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span>Recent Tool Calls</span>
          <List size={11} />
        </button>
        {auditOpen && (
          <button type="button" className="ai-icon-btn" onClick={clearAudit} title="Clear" aria-label="Clear recent MCP tool calls">
            <X size={11} />
          </button>
        )}
      </div>

      {auditOpen && (
        <div className="ai-audit-list" id="ai-mcp-audit-list">
          {auditEntries.length === 0 && <div className="ai-audit-empty">No tool calls yet</div>}
          {auditEntries.slice(0, 12).map((e) => (
            <div key={`${e.callId}-${e.timestamp}`} className={`ai-audit-row ai-audit-${e.status}`}>
              <span className="ai-audit-tool">{e.tool}</span>
              <span className="ai-audit-status">{e.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
