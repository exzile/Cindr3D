import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, FileCode2, XCircle } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { parseGCodePreviewLines, type GCodeLine } from './gcodePreviewModel';
import './SlicerGCodeDockPanel.css';

const ROW_HEIGHT = 19.5; // px — matches computed line-height + border
const OVERSCAN   = 10;   // extra rows rendered above/below visible window

// ---------------------------------------------------------------------------
// Token colorizer
// ---------------------------------------------------------------------------
function renderTokens(text: string, isComment: boolean) {
  if (!text) return ' ';
  if (isComment) return <span className="gc-comment">{text}</span>;

  const semiIdx = text.indexOf(';');
  const main    = semiIdx >= 0 ? text.slice(0, semiIdx) : text;
  const comment = semiIdx >= 0 ? text.slice(semiIdx) : '';
  const parts   = main.split(/\s+/).filter(Boolean);

  const spans = parts.map((tok, i) => {
    if (/^[GM]\d/i.test(tok)) return <span key={i} className="gc-cmd">{tok}</span>;
    if (tok.startsWith(';')) return <span key={i} className="gc-comment">{tok}</span>;
    const m = tok.match(/^([XYZEFxyzef])(-?\d*\.?\d+)$/);
    if (m) {
      const label = m[1].toUpperCase();
      const cls   = label === 'E' ? 'gc-e' : label === 'F' ? 'gc-f' : label === 'Z' ? 'gc-z' : 'gc-xy';
      return (
        <span key={i}>
          <span className={`gc-axis ${cls}`}>{m[1]}</span>
          <span className="gc-num">{m[2]}</span>
        </span>
      );
    }
    return <span key={i} className="gc-other">{tok}</span>;
  });

  return (
    <>
      {spans.reduce<React.ReactNode[]>((acc, s, i) => { if (i > 0) acc.push(' '); acc.push(s); return acc; }, [])}
      {comment && <span className="gc-comment"> {comment}</span>}
    </>
  );
}

function lineTypeClass(line: GCodeLine): string {
  if (line.isComment)  return 'gc-line--comment';
  if (line.isExtrusion) return 'gc-line--extrusion';
  if (line.isTravel)   return 'gc-line--travel';
  if (['M104', 'M109', 'M140', 'M190'].includes(line.command)) return 'gc-line--temp';
  if (line.command === 'M106' || line.command === 'M107') return 'gc-line--fan';
  if (line.command === 'G28'  || line.command === 'G29')  return 'gc-line--home';
  if (/^M/.test(line.command)) return 'gc-line--firmware';
  return '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function SlicerGCodeDockPanel() {
  const [expanded, setExpanded] = useState(false);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(() => new Set());

  const sliceResult       = useSlicerStore((s) => s.sliceResult);
  const previewLayer      = useSlicerStore((s) => s.previewLayer);
  const previewSimEnabled = useSlicerStore((s) => s.previewSimEnabled);

  const layerTimeCumsum = useMemo(() => {
    if (!sliceResult) return null;
    const cum = new Float32Array(sliceResult.layers.length);
    let t = 0;
    for (let i = 0; i < sliceResult.layers.length; i++) {
      t += sliceResult.layers[i].layerTime ?? 0;
      cum[i] = t;
    }
    return cum;
  }, [sliceResult]);

  const [currentLayerIndex, setCurrentLayerIndex] = useState(() =>
    useSlicerStore.getState().previewLayer,
  );

  // Virtual scroll state
  const [scrollTop, setScrollTop]     = useState(0);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const scrollTopRef = useRef(0);
  const bodyRef      = useRef<HTMLDivElement>(null);

  const cumsumRef      = useRef(layerTimeCumsum);
  const sliceRef       = useRef(sliceResult);
  const expandedRef    = useRef(expanded);
  const breakpointsRef = useRef(breakpoints);
  cumsumRef.current      = layerTimeCumsum;
  sliceRef.current       = sliceResult;
  expandedRef.current    = expanded;
  breakpointsRef.current = breakpoints;

  const parsed = useMemo(
    () => parseGCodePreviewLines(sliceResult?.gcode ?? ''),
    [sliceResult?.gcode],
  );

  const parsedByLayer = useMemo(() => {
    const map = new Map<number, GCodeLine[]>();
    for (const line of parsed) {
      let arr = map.get(line.layerIndex);
      if (!arr) { arr = []; map.set(line.layerIndex, arr); }
      arr.push(line);
    }
    return map;
  }, [parsed]);

  const layerLines = parsedByLayer.get(currentLayerIndex) ?? [];

  const layerLinesRef  = useRef(layerLines);
  layerLinesRef.current = layerLines;

  const prevLayerRef     = useRef(-1);
  const prevLineIdxRef   = useRef(-1);
  const deferredLayerRef = useRef(-1);
  const layerTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending virtual-scroll update — flushed via RAF so setState is never called
  // synchronously inside the Zustand/R3F subscriber (which would trigger a render
  // mid-render and crash).
  const pendingScrollRef  = useRef<{ top: number; idx: number } | null>(null);
  const rafScheduledRef   = useRef(false);

  // Reset scroll + highlight when layer changes
  useEffect(() => {
    setScrollTop(0);
    setHighlightIdx(-1);
    scrollTopRef.current = 0;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [currentLayerIndex]);

  // ---------------------------------------------------------------------------
  // Zustand subscription — zero React re-renders during playback tick
  // ---------------------------------------------------------------------------
  useEffect(() => {
    return useSlicerStore.subscribe((state) => {
      const simEnabled = state.previewSimEnabled;
      const simTime    = state.previewSimTime;

      // ---- Layer tracking ----
      let layerIdx: number;
      if (!simEnabled) {
        layerIdx = state.previewLayer;
      } else {
        const cum = cumsumRef.current;
        if (!cum || cum.length === 0) {
          layerIdx = state.previewLayer;
        } else {
          let lo = 0; let hi = cum.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cum[mid] < simTime) lo = mid + 1; else hi = mid;
          }
          layerIdx = lo;
        }
      }

      if (layerIdx !== prevLayerRef.current) {
        prevLayerRef.current  = layerIdx;
        prevLineIdxRef.current = -1;

        if (state.previewSimPlaying) {
          setCurrentLayerIndex(layerIdx);
        } else {
          deferredLayerRef.current = layerIdx;
          if (layerTimerRef.current) clearTimeout(layerTimerRef.current);
          layerTimerRef.current = setTimeout(() => {
            setCurrentLayerIndex(deferredLayerRef.current);
          }, 150);
        }
      }

      // ---- Per-line tracking — runs during active playback ----
      if (!simEnabled || !state.previewSimPlaying) return;

      const cum = cumsumRef.current;
      const sr  = sliceRef.current;
      if (!cum || !sr) return;

      const layerStartTime = layerIdx > 0 ? (cum[layerIdx - 1] ?? 0) : 0;
      const layerDuration  = sr.layers[layerIdx]?.layerTime ?? 0;
      const elapsed        = Math.max(0, simTime - layerStartTime);
      const fraction       = layerDuration > 0 ? Math.min(1, elapsed / layerDuration) : 0;
      const lineCount      = layerLinesRef.current.length;
      if (lineCount === 0) return;

      const lineIdx = Math.min(lineCount - 1, Math.floor(fraction * lineCount));

      // ---- Breakpoint check — scan every line between prev and current ----
      // A range scan catches breakpoints that are skipped in a single frame at
      // high playback speeds (e.g. 50x can jump 30+ lines per tick).
      if (breakpointsRef.current.size > 0) {
        const scanFrom = Math.max(0, prevLineIdxRef.current + 1);
        for (let i = scanFrom; i <= lineIdx; i++) {
          const ln = layerLinesRef.current[i]?.lineNumber;
          if (ln !== undefined && breakpointsRef.current.has(ln)) {
            // Snap simTime just past line i so resume doesn't re-trigger the
            // same breakpoint (the next tick will compute lineIdx = i+1).
            const nextFraction = Math.min(1, (i + 1) / lineCount);
            const snappedTime  = layerStartTime + nextFraction * layerDuration;
            prevLineIdxRef.current = i;
            // Pause first — subscriber re-fires with playing=false → safe early-return.
            useSlicerStore.getState().setPreviewSimPlaying(false);
            useSlicerStore.getState().setPreviewSimTime(snappedTime);
            // Show the exact breakpoint line in the GCode view.
            if (expandedRef.current && bodyRef.current) {
              const body      = bodyRef.current;
              const targetTop = Math.max(0, i * ROW_HEIGHT - body.clientHeight / 2);
              body.scrollTop  = targetTop;
              scrollTopRef.current = targetTop;
              pendingScrollRef.current = { top: targetTop, idx: i };
              if (!rafScheduledRef.current) {
                rafScheduledRef.current = true;
                requestAnimationFrame(() => {
                  rafScheduledRef.current = false;
                  const p = pendingScrollRef.current;
                  if (p) { pendingScrollRef.current = null; setScrollTop(p.top); setHighlightIdx(p.idx); }
                });
              }
            }
            return;
          }
        }
      }

      if (lineIdx === prevLineIdxRef.current) return;
      prevLineIdxRef.current = lineIdx;

      // ---- Highlight + scroll — only when panel is open ----
      if (!expandedRef.current || !bodyRef.current) return;

      // Apply scroll immediately in DOM so it feels instant
      const body      = bodyRef.current;
      const targetTop = Math.max(0, lineIdx * ROW_HEIGHT - body.clientHeight / 2);
      body.scrollTop  = targetTop;
      scrollTopRef.current = targetTop;

      // Defer React state updates out of this synchronous subscriber — calling
      // setState here would schedule a render while R3F's useFrame may already
      // be mid-render, which crashes the app.
      pendingScrollRef.current = { top: targetTop, idx: lineIdx };
      if (!rafScheduledRef.current) {
        rafScheduledRef.current = true;
        requestAnimationFrame(() => {
          rafScheduledRef.current = false;
          const p = pendingScrollRef.current;
          if (p) {
            pendingScrollRef.current = null;
            setScrollTop(p.top);
            setHighlightIdx(p.idx);
          }
        });
      }
    });
  }, []); // stable — reads values via refs

  useEffect(() => () => {
    if (layerTimerRef.current) clearTimeout(layerTimerRef.current);
    pendingScrollRef.current = null;
  }, []);

  useEffect(() => {
    if (!expanded) { setHighlightIdx(-1); prevLineIdxRef.current = -1; }
  }, [expanded]);

  useEffect(() => {
    if (!previewSimEnabled) setCurrentLayerIndex(previewLayer);
  }, [previewLayer, previewSimEnabled]);

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const st = e.currentTarget.scrollTop;
    scrollTopRef.current = st;
    setScrollTop(st);
  }, []);

  const toggleBreakpoint = useCallback((lineNumber: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(lineNumber)) next.delete(lineNumber); else next.add(lineNumber);
      return next;
    });
  }, []);

  if (!sliceResult) return null;

  const layerZ      = sliceResult.layers[currentLayerIndex]?.z ?? 0;
  const totalLayers = sliceResult.layerCount;

  // Virtual window calculation
  const totalLines = layerLines.length;
  const totalH     = totalLines * ROW_HEIGHT;
  const bodyH      = bodyRef.current?.clientHeight ?? 300;
  const winStart   = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const winEnd     = Math.min(totalLines, Math.ceil((scrollTop + bodyH) / ROW_HEIGHT) + OVERSCAN);
  const offsetY    = winStart * ROW_HEIGHT;
  const visibleLines = layerLines.slice(winStart, winEnd);

  return (
    <div className={`slicer-gcode-dock${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="slicer-gcode-dock__header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Toggle G-code panel"
      >
        <span className="slicer-gcode-dock__header-left">
          <FileCode2 size={13} />
          <span className="slicer-gcode-dock__title">G-code</span>
          <span className="slicer-gcode-dock__layer-badge">
            Layer {currentLayerIndex + 1} / {totalLayers}
          </span>
          <span className="slicer-gcode-dock__z-badge">
            Z {layerZ.toFixed(2)} mm
          </span>
          {previewSimEnabled && (
            <span className="slicer-gcode-dock__sim-badge">● SIM</span>
          )}
          {breakpoints.size > 0 && (
            <span className="slicer-gcode-dock__bp-badge">
              {breakpoints.size} BP
            </span>
          )}
        </span>
        <span className="slicer-gcode-dock__header-right">
          {breakpoints.size > 0 && (
            <button
              type="button"
              className="slicer-gcode-dock__clear-bp"
              onClick={(e) => { e.stopPropagation(); setBreakpoints(new Set()); }}
              title="Clear all breakpoints"
              aria-label="Clear all breakpoints"
            >
              <XCircle size={12} />
              Clear BP
            </button>
          )}
        </span>
        <span className="slicer-gcode-dock__chevron">
          {expanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </span>
      </button>

      {expanded && (
        <div
          className="slicer-gcode-dock__body"
          ref={bodyRef}
          onScroll={handleBodyScroll}
        >
          {totalLines === 0 ? (
            <div className="slicer-gcode-dock__empty">No G-code lines for this layer.</div>
          ) : (
            // Outer spacer maintains total scroll height; inner div shifts rendered rows into position
            <div style={{ height: totalH, position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${offsetY}px)` }}>
                {visibleLines.map((line, i) => {
                  const actualIdx = winStart + i;
                  const hasBp     = breakpoints.has(line.lineNumber);
                  const isCurrent = actualIdx === highlightIdx;
                  return (
                    <div
                      key={line.lineNumber}
                      className={`slicer-gcode-dock__line ${lineTypeClass(line)}${hasBp ? ' gc-line--breakpoint' : ''}${isCurrent ? ' gc-line--current' : ''}`}
                    >
                      <button
                        type="button"
                        className={`slicer-gcode-dock__bp-gutter${hasBp ? ' is-active' : ''}`}
                        onClick={(e) => toggleBreakpoint(line.lineNumber, e)}
                        title={hasBp ? 'Remove breakpoint' : 'Add breakpoint'}
                        aria-label={hasBp ? 'Remove breakpoint' : 'Add breakpoint'}
                      />
                      <span className="slicer-gcode-dock__line-no">{line.lineNumber}</span>
                      <code>{renderTokens(line.text, line.isComment)}</code>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
