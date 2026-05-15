import { Crosshair, FolderOpen, Gauge, Settings, Timer, Video } from 'lucide-react';
import type { ControlSection } from './types';

/**
 * Six-tab row at the top of the camera-controls aside that toggles which
 * sidebar section is rendered below (Record / View / Settings / Library /
 * Timeline / Health).
 */
export function ControlTabBar(props: {
  activeControlSection: ControlSection;
  setActiveControlSection: (section: ControlSection) => void;
}) {
  const { activeControlSection, setActiveControlSection } = props;
  return (
    <div className="cam-panel__control-tabs" role="tablist" aria-label="Camera control sections">
      {([
        ['record', 'Record', Video],
        ['view', 'View', Crosshair],
        ['settings', 'Settings', Settings],
        ['library', 'Library', FolderOpen],
        ['timeline', 'Timeline', Timer],
        ['health', 'Health', Gauge],
      ] as const).map(([key, label, Icon]) => (
        <button
          key={key}
          className={`cam-panel__tab${activeControlSection === key ? ' is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeControlSection === key}
          onClick={() => setActiveControlSection(key)}
        >
          <Icon size={13} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
