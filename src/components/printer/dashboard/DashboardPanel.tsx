import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { panelStyle, sectionTitleStyle } from '../../../utils/printerPanelStyles';

interface Props {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  className?: string;
}

export function DashboardPanel({ icon: Icon, title, children, className }: Props) {
  return (
    <div style={panelStyle()} className={className}>
      <div style={sectionTitleStyle()} className="duet-dash-section-title-row">
        <Icon size={14} /> {title}
      </div>
      {children}
    </div>
  );
}
