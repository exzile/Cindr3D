import type { ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

interface Props {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  editMode: boolean;
}

export default function DashboardCard({
  title,
  icon,
  children,
  editMode,
}: Props) {
  const cls = ['dc-wrapper', editMode ? 'is-edit' : ''].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <div className="dc-header">
        {editMode && (
          <div className="dc-grip" title="Drag card">
            <GripVertical size={14} />
          </div>
        )}
        <div className="dc-title">
          {icon}
          {title}
        </div>
      </div>

      <div className="dc-body">{children}</div>
    </div>
  );
}
