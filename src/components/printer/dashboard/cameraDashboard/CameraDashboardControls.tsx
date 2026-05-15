import type { ComponentProps } from 'react';
import { ControlTabBar } from './ControlTabBar';
import { HealthSection } from './HealthSection';
import { LibrarySection } from './LibrarySection';
import { RecordSection } from './RecordSection';
import { SettingsSection } from './SettingsSection';
import { TimelineSection } from './TimelineSection';
import { ViewControlsSection } from './ViewControlsSection';
import type { ControlSection } from './types';

/**
 * The right-hand controls aside: a tab bar at the top, then the active
 * section's panel underneath. The host owns every state value; this
 * component is pure routing — pick the section that matches
 * `activeControlSection` and render it with its prop bag.
 */
export interface CameraDashboardControlsProps {
  activeControlSection: ControlSection;
  setActiveControlSection: (next: ControlSection) => void;
  recordProps: ComponentProps<typeof RecordSection>;
  viewProps: ComponentProps<typeof ViewControlsSection>;
  settingsProps: ComponentProps<typeof SettingsSection>;
  healthProps: ComponentProps<typeof HealthSection>;
  timelineProps: ComponentProps<typeof TimelineSection>;
  libraryProps: ComponentProps<typeof LibrarySection>;
}

export function CameraDashboardControls(props: CameraDashboardControlsProps) {
  const {
    activeControlSection, setActiveControlSection,
    recordProps, viewProps, settingsProps, healthProps, timelineProps, libraryProps,
  } = props;

  return (
    <aside className="cam-panel__controls" aria-label="Camera controls and saved clips">
      <ControlTabBar
        activeControlSection={activeControlSection}
        setActiveControlSection={setActiveControlSection}
      />

      {activeControlSection === 'record' && <RecordSection {...recordProps} />}
      {activeControlSection === 'view' && <ViewControlsSection {...viewProps} />}
      {activeControlSection === 'settings' && <SettingsSection {...settingsProps} />}
      {activeControlSection === 'health' && <HealthSection {...healthProps} />}
      {activeControlSection === 'timeline' && <TimelineSection {...timelineProps} />}
      {activeControlSection === 'library' && <LibrarySection {...libraryProps} />}
    </aside>
  );
}
