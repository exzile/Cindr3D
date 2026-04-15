import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { colors } from '../../utils/theme';

export function SlicerSection({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: `1px solid ${colors.panelBorder}` }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 10px', cursor: 'pointer',
          color: colors.text, fontSize: 12, fontWeight: 600,
          userSelect: 'none',
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        {title}
      </div>
      {open && <div style={{ padding: '0 10px 10px' }}>{children}</div>}
    </div>
  );
}
