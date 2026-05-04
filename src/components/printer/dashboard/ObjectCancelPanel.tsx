/**
 * ObjectCancelPanel — cross-firmware dashboard card for mid-print object cancellation.
 *
 * Duet    → reads live object list from the RRF object model (no polling needed).
 * Klipper → fetches from Moonraker on mount + manual refresh; uses MoonrakerService.
 * Marlin  → parses M486 labels from the most-recently sliced G-code.
 * Others  → "not supported" note.
 *
 * Cancel actions on this card are best-effort: the dashboard panel is meant
 * for quick access and does NOT enforce firmware-version gating — sending
 * M486 to a too-old firmware will just be rejected by the printer. Use the
 * dedicated Exclude Object tab when you want the version-aware UI with the
 * red-banner warning and disabled buttons for confirmed-too-old firmware.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Layers, RefreshCw, XCircle, WifiOff, ExternalLink } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';
import { parseM486Labels } from '../../../services/gcode/m486Labels';
import { MoonrakerService } from '../../../services/MoonrakerService';
import { panelStyle, sectionTitleStyle as labelStyle } from '../../../utils/printerPanelStyles';
import { colors as COLORS } from '../../../utils/theme';

// ── shared helpers ────────────────────────────────────────────────────────────

function CancelRow({
  id, name, cancelled, confirming, disabled, onArm, onConfirm,
}: {
  id: string | number;
  name: string;
  cancelled: boolean;
  confirming: boolean;
  disabled: boolean;
  onArm: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '4px 8px', borderRadius: 4,
      background: cancelled ? 'rgba(255,68,68,0.08)' : confirming ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.03)',
      gap: 6,
    }}>
      <span style={{
        fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: cancelled ? COLORS.error ?? '#ef4444' : COLORS.textPrimary ?? '#e0e0ff',
        textDecoration: cancelled ? 'line-through' : 'none',
        opacity: cancelled ? 0.6 : 1,
      }}>
        {name}
      </span>
      {!cancelled && (
        confirming ? (
          <div style={{ display: 'flex', gap: 3, flexShrink: 0, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#f59e0b' }}>Sure?</span>
            <button
              onClick={onConfirm}
              disabled={disabled}
              style={miniBtn('#ef4444')}
              title="Confirm cancel"
            >Yes</button>
            <button
              onClick={onArm}
              disabled={disabled}
              style={miniBtn(COLORS.textDim ?? '#666')}
              title="Never mind"
            >No</button>
          </div>
        ) : (
          <button
            onClick={onArm}
            disabled={disabled}
            style={miniBtn(disabled ? (COLORS.textDim ?? '#666') : '#ef4444')}
            title={disabled ? 'Cannot cancel' : `Cancel ${name}`}
          >
            <XCircle size={11} />
          </button>
        )
      )}
    </div>
  );
}

function miniBtn(color: string) {
  return {
    background: 'none', border: `1px solid ${color}`, color,
    borderRadius: 3, padding: '1px 5px', fontSize: 10,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2,
    opacity: 1,
  } as const;
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div style={{ padding: '12px 8px', fontSize: 11, color: COLORS.textDim ?? '#666', textAlign: 'center' }}>
      {text}
    </div>
  );
}

// ── Duet sub-component ────────────────────────────────────────────────────────

function DuetCancelList() {
  const model = usePrinterStore((s) => s.model);
  const cancelObject = usePrinterStore((s) => s.cancelObject);

  const objects = model.job?.build?.objects ?? [];
  const currentIdx = model.job?.build?.currentObject ?? -1;

  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async (i: number) => {
    setBusy(true);
    try { await cancelObject(i); } finally { setBusy(false); setConfirmIdx(null); }
  };

  if (objects.length === 0) return <EmptyNote text="No labelled objects. Print in progress?" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {objects.map((obj, i) => (
        <CancelRow
          key={i}
          id={i}
          name={obj.name || `Object ${i}`}
          cancelled={obj.cancelled}
          confirming={confirmIdx === i}
          disabled={busy}
          onArm={() => setConfirmIdx(confirmIdx === i ? null : i)}
          onConfirm={() => void handleConfirm(i)}
        />
      ))}
      {currentIdx >= 0 && (
        <div style={{ fontSize: 10, color: COLORS.textDim ?? '#666', padding: '2px 8px' }}>
          Currently printing: <strong style={{ color: COLORS.info ?? '#44aaff' }}>
            {objects[currentIdx]?.name || `Object ${currentIdx}`}
          </strong>
        </div>
      )}
    </div>
  );
}

// ── Marlin sub-component ──────────────────────────────────────────────────────

function MarlinCancelList() {
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const { labels } = useMemo(() => parseM486Labels(sliceResult?.gcode ?? ''), [sliceResult?.gcode]);
  const [cancelled, setCancelled] = useState<Set<number>>(new Set());
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async (id: number) => {
    setBusy(true);
    try {
      await sendGCode(`M486 P${id}`);
      setCancelled((p) => new Set(p).add(id));
    } finally { setBusy(false); setConfirmId(null); }
  };

  if (labels.length === 0) {
    return <EmptyNote text={sliceResult ? 'Slice has no M486 labels — enable "Label objects" in your slicer.' : 'No sliced G-code loaded.'} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {labels.map(({ id, name }) => (
        <CancelRow
          key={id}
          id={id}
          name={name || `Object ${id}`}
          cancelled={cancelled.has(id)}
          confirming={confirmId === id}
          disabled={busy}
          onArm={() => setConfirmId(confirmId === id ? null : id)}
          onConfirm={() => void handleConfirm(id)}
        />
      ))}
      <div style={{ fontSize: 10, color: COLORS.textDim ?? '#666', padding: '2px 8px' }}>
        Cancel state is tracked locally — Marlin doesn't echo it back.
      </div>
    </div>
  );
}

// ── Klipper sub-component ─────────────────────────────────────────────────────

interface KlipperObject { name: string; excluded: boolean }

function KlipperCancelList() {
  const config = usePrinterStore((s) => s.config);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const connected = usePrinterStore((s) => s.connected);

  const svcRef = useRef<MoonrakerService | null>(null);
  if (!svcRef.current && connected) {
    svcRef.current = new MoonrakerService(config.hostname ?? '');
  }

  const [objects, setObjects] = useState<KlipperObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!svcRef.current) return;
    setLoading(true); setError(null);
    try {
      const status = await svcRef.current.getExcludeObjectStatus();
      const excluded = new Set(status.excluded_objects ?? []);
      setObjects((status.objects ?? []).map((o) => ({ name: o.name, excluded: excluded.has(o.name) })));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (connected) void refresh(); }, [connected, refresh]);

  const handleConfirm = async (name: string) => {
    if (!svcRef.current) return;
    setBusy(true);
    try {
      await svcRef.current.excludeObject(name);
      setObjects((prev) => prev.map((o) => o.name === name ? { ...o, excluded: true } : o));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); setConfirmName(null); }
  };

  if (error) return (
    <div>
      <EmptyNote text={`Error: ${error}`} />
      <button onClick={refresh} style={{ ...miniBtn('#f59e0b'), margin: '0 auto', display: 'flex' }}>
        <RefreshCw size={10} /> Retry
      </button>
    </div>
  );

  if (objects.length === 0 && !loading) return (
    <div>
      <EmptyNote text="No labelled objects. Requires EXCLUDE_OBJECTS in Klipper config." />
      <button
        onClick={() => setActiveTab('exclude-object')}
        style={{ ...miniBtn(COLORS.accent ?? '#7c6fff'), margin: '4px auto', display: 'flex' }}
      >
        <ExternalLink size={10} /> Open Exclude Object tab
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {loading && <EmptyNote text="Loading…" />}
      {objects.map((obj) => (
        <CancelRow
          key={obj.name}
          id={obj.name}
          name={obj.name}
          cancelled={obj.excluded}
          confirming={confirmName === obj.name}
          disabled={busy}
          onArm={() => setConfirmName(confirmName === obj.name ? null : obj.name)}
          onConfirm={() => void handleConfirm(obj.name)}
        />
      ))}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function ObjectCancelPanel() {
  const boardType = usePrinterStore((s) => s.config.boardType);
  const connected = usePrinterStore((s) => s.connected);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);

  if (!connected) {
    return (
      <div style={panelStyle()}>
        <div style={labelStyle()}><Layers size={14} /> Object Cancellation</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 8px', color: COLORS.textDim ?? '#666', fontSize: 11 }}>
          <WifiOff size={13} /> Not connected
        </div>
      </div>
    );
  }

  const supportsCancel = boardType === 'duet' || boardType === 'marlin' || boardType === 'klipper';

  return (
    <div style={panelStyle()}>
      <div style={{ ...labelStyle(), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Layers size={14} /> Object Cancellation
        </span>
        <button
          onClick={() => setActiveTab('exclude-object')}
          style={{ ...miniBtn(COLORS.textDim ?? '#666'), fontSize: 10 }}
          title="Open Exclude Object tab"
        >
          <ExternalLink size={10} />
        </button>
      </div>

      {!supportsCancel ? (
        <EmptyNote text={`${boardType ?? 'This firmware'} does not support mid-print object cancellation.`} />
      ) : boardType === 'duet' ? (
        <DuetCancelList />
      ) : boardType === 'marlin' ? (
        <MarlinCancelList />
      ) : (
        <KlipperCancelList />
      )}
    </div>
  );
}
