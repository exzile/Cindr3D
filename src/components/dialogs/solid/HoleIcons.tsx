/**
 * Schematic SVG icons for the Hole dialog — Hole Type, Hole Tap Type,
 * and Drill Point. Each icon is 18×18 and inherits stroke from currentColor
 * so it flips white when its segmented-button is the active option.
 */

const SIZE = 18;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      {children}
    </svg>
  );
}

// ── Hole Type ────────────────────────────────────────────────────────────────

export function SimpleHoleIcon() {
  // Plain straight cylinder.
  return (
    <Frame>
      <line x1={5} y1={2} x2={5} y2={16} />
      <line x1={13} y1={2} x2={13} y2={16} />
      <line x1={2} y1={2} x2={16} y2={2} />
    </Frame>
  );
}

export function CounterboreIcon() {
  // Wide upper section, narrow lower body.
  return (
    <Frame>
      <line x1={2} y1={2} x2={16} y2={2} />
      <polyline points="3,2 3,7 5,7 5,16" />
      <polyline points="15,2 15,7 13,7 13,16" />
    </Frame>
  );
}

export function CountersinkIcon() {
  // Conical taper at top, narrow body below.
  return (
    <Frame>
      <line x1={2} y1={2} x2={16} y2={2} />
      <polyline points="3,2 5,7 5,16" />
      <polyline points="15,2 13,7 13,16" />
    </Frame>
  );
}

// ── Hole Tap Type ────────────────────────────────────────────────────────────

export function TapSimpleIcon() {
  return (
    <Frame>
      <rect x={5} y={3} width={8} height={12} />
    </Frame>
  );
}

export function TapClearanceIcon() {
  return (
    <Frame>
      <rect x={5} y={3} width={8} height={12} />
      <line x1={5} y1={6} x2={13} y2={6} strokeDasharray="1,1" />
      <line x1={5} y1={9} x2={13} y2={9} strokeDasharray="1,1" />
      <line x1={5} y1={12} x2={13} y2={12} strokeDasharray="1,1" />
    </Frame>
  );
}

export function TapTappedIcon() {
  return (
    <Frame>
      <rect x={5} y={3} width={8} height={12} />
      <path d="M5 5 L13 5 M5 8 L13 8 M5 11 L13 11 M5 14 L13 14" />
    </Frame>
  );
}

export function TapTaperTappedIcon() {
  return (
    <Frame>
      <polygon points="5,3 13,3 11,15 7,15" />
      <line x1={6} y1={6} x2={12} y2={6} />
      <line x1={6.5} y1={9} x2={11.5} y2={9} />
      <line x1={7} y1={12} x2={11} y2={12} />
    </Frame>
  );
}

// ── Drill Point ──────────────────────────────────────────────────────────────

export function DrillFlatIcon() {
  return (
    <Frame>
      <line x1={5} y1={3} x2={5} y2={14} />
      <line x1={13} y1={3} x2={13} y2={14} />
      <line x1={5} y1={14} x2={13} y2={14} />
    </Frame>
  );
}

export function DrillAngledIcon() {
  return (
    <Frame>
      <line x1={5} y1={3} x2={5} y2={12} />
      <line x1={13} y1={3} x2={13} y2={12} />
      <polyline points="5,12 9,16 13,12" />
    </Frame>
  );
}
