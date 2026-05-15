import { ArrowLeftRight, X } from 'lucide-react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

const MIN_PAGE_WIDTH = 320;

/**
 * Drag handle at the left/right edge of the dashboard grid that resizes the
 * effective page width. Symmetric: dragging either side changes total width
 * by `2 * delta` so the grid stays horizontally centered.
 */
export function PageWidthHandle({
  side,
  containerWidth,
  effectiveWidth,
  displayWidth,
  onDraft,
  onCommit,
  onReset,
}: {
  side: 'left' | 'right';
  containerWidth: number;
  effectiveWidth: number;
  displayWidth: number;
  onDraft: (px: number) => void;
  onCommit: (px: number) => void;
  onReset: () => void;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const isConstrained = displayWidth < containerWidth - 1;
  const handleLeft = side === 'right'
    ? Math.round((containerWidth + displayWidth) / 2)
    : Math.round((containerWidth - displayWidth) / 2);

  const calcNext = (clientX: number) => {
    const delta = clientX - startX.current;
    // Right handle: drag right → wider. Left handle: drag left → wider (opposite sign).
    const signed = side === 'right' ? delta : -delta;
    return Math.max(MIN_PAGE_WIDTH, startWidth.current + 2 * signed);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    handleRef.current?.setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    startWidth.current = effectiveWidth;
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!handleRef.current?.hasPointerCapture(e.pointerId)) return;
    onDraft(Math.round(calcNext(e.clientX)));
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!handleRef.current?.hasPointerCapture(e.pointerId)) return;
    onCommit(Math.round(calcNext(e.clientX)));
  };

  return (
    <div
      ref={handleRef}
      className={`dc-page-handle dc-page-handle--${side}${isConstrained ? '' : ' is-full-width'}`}
      style={{ left: handleLeft }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title="Drag to adjust page width"
    >
      <div className="dc-page-handle__line" />
      <div className="dc-page-handle__nub">
        <ArrowLeftRight size={10} />
        <span className="dc-page-handle__label">{Math.round(effectiveWidth)}px</span>
        {isConstrained && side === 'right' && (
          <button
            className="dc-page-handle__reset"
            onClick={(e) => { e.stopPropagation(); onReset(); }}
            title="Reset to full width"
          >
            <X size={9} />
          </button>
        )}
      </div>
    </div>
  );
}
