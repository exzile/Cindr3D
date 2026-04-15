export function HomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function ArrowIcon({ rotation }: { rotation: number }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ transform: `rotate(${rotation}deg)` }}>
      <path d="M12 2l-8 14h16z" />
    </svg>
  );
}

export function OrbitIcon({ rotation }: { rotation: number }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ transform: `rotate(${rotation}deg)` }}>
      <path d="M4 12a8 8 0 0 1 14-5" />
      <path d="M18 7l1.5-3.5L16 5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ZoomFitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}
