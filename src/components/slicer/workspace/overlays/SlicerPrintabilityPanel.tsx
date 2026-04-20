import { useState } from 'react';
import { ShieldCheck, AlertTriangle, AlertCircle, Info, X, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import type { Issue } from '../../../../engine/PrintabilityCheck';
import './SlicerPrintabilityPanel.css';

function iconFor(sev: Issue['severity']) {
  if (sev === 'error') return <AlertCircle size={13} className="spp__icon spp__icon--error" />;
  if (sev === 'warning') return <AlertTriangle size={13} className="spp__icon spp__icon--warning" />;
  return <Info size={13} className="spp__icon spp__icon--info" />;
}

export function SlicerPrintabilityPanel() {
  const report = useSlicerStore((s) => s.printabilityReport);
  const highlight = useSlicerStore((s) => s.printabilityHighlight);
  const setHighlight = useSlicerStore((s) => s.setPrintabilityHighlight);
  const runCheck = useSlicerStore((s) => s.runPrintabilityCheck);
  const clearReport = useSlicerStore((s) => s.clearPrintabilityReport);
  const plateCount = useSlicerStore((s) => s.plateObjects.length);

  const [collapsed, setCollapsed] = useState(false);

  if (!report) {
    // Compact "run check" button when no report exists.
    return (
      <button
        type="button"
        className="spp__run-btn"
        onClick={() => runCheck()}
        disabled={plateCount === 0}
        title="Analyse plate objects for overhangs, tiny features, and off-plate geometry"
      >
        <ShieldCheck size={13} /> Check printability
      </button>
    );
  }

  const { errors, warnings, info } = report.totals;
  const allClean = errors === 0 && warnings === 0 && info === 0;

  return (
    <div className={`spp${collapsed ? ' is-collapsed' : ''}`}>
      <div className="spp__header">
        <button
          type="button"
          className="spp__toggle"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <ShieldCheck size={13} /> Printability
          {!allClean && (
            <span className="spp__totals">
              {errors > 0 && <span className="spp__count spp__count--error">{errors}</span>}
              {warnings > 0 && <span className="spp__count spp__count--warning">{warnings}</span>}
              {info > 0 && <span className="spp__count spp__count--info">{info}</span>}
            </span>
          )}
          {allClean && <span className="spp__clean">✓ clean</span>}
        </button>
        <div className="spp__actions">
          <button
            type="button"
            onClick={() => setHighlight(!highlight)}
            title={highlight ? 'Hide overhang highlight' : 'Show overhang highlight'}
            className={`spp__ghost${highlight ? ' is-active' : ''}`}
          >
            {highlight ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <button
            type="button"
            onClick={() => runCheck()}
            title="Re-run check"
            className="spp__ghost"
          >
            <RefreshCw size={13} />
          </button>
          <button
            type="button"
            onClick={() => clearReport()}
            title="Dismiss"
            className="spp__ghost"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="spp__body">
          {allClean && (
            <div className="spp__all-clean">
              <ShieldCheck size={18} /> No printability issues detected.
            </div>
          )}
          {report.objects.filter((o) => o.issues.length > 0).map((o) => (
            <div key={o.objectId} className="spp__obj">
              <div className="spp__obj-name">{o.objectName}</div>
              <ul className="spp__issues">
                {o.issues.map((issue, idx) => (
                  <li key={idx} className={`spp__issue spp__issue--${issue.severity}`}>
                    {iconFor(issue.severity)}
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
