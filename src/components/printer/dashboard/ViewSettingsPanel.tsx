import { useEffect, useRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useDashboardLayout } from '../../../store/dashboardLayoutStore';

interface PanelEntry {
  id: string;
  title: string;
  icon: React.ReactNode;
}

interface Props {
  panels: PanelEntry[];
  onClose: () => void;
}

export default function ViewSettingsPanel({ panels, onClose }: Props) {
  const hidden       = useDashboardLayout((s) => s.hidden);
  const toggleHidden = useDashboardLayout((s) => s.toggleHidden);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const visibleCount = panels.filter((p) => !hidden[p.id]).length;

  return (
    <div className="vs-panel" ref={ref}>
      <div className="vs-header">
        <span className="vs-title">Visible Panels</span>
        <span className="vs-count">{visibleCount} / {panels.length}</span>
      </div>
      <div className="vs-list">
        {panels.map((p) => {
          const isHidden = hidden[p.id] ?? false;
          return (
            <button
              key={p.id}
              className={`vs-row${isHidden ? ' vs-row--hidden' : ''}`}
              onClick={() => toggleHidden(p.id)}
            >
              <span className="vs-row-icon">{p.icon}</span>
              <span className="vs-row-label">{p.title}</span>
              <span className="vs-row-eye">
                {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
