import { useRef, useEffect } from 'react';

export default function Popover({
  anchorRef,
  open,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div ref={popRef} className="cc-popover">
      {children}
    </div>
  );
}
