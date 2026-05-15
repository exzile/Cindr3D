import type { HelpTopic } from './helpContent';
import { HelpSection } from './HelpSection';
import { TutorialsPanel } from './TutorialsPanel';
import type { TutorialProgress } from './useTutorialProgress';

export function HelpTopicView({
  topic,
  tutorialProgress,
  onToggleTutorialStep,
}: {
  topic: HelpTopic | undefined;
  tutorialProgress: TutorialProgress;
  onToggleTutorialStep: (lessonId: string, stepIndex: number) => void;
}) {
  if (!topic) {
    return (
      <article className="app-help-content">
        <div className="app-help-empty">No help content matches that search.</div>
      </article>
    );
  }

  return (
    <article className="app-help-content">
      <h3>{topic.title}</h3>
      <p className="app-help-summary">{topic.summary}</p>
      {topic.id === 'tutorials' && (
        <TutorialsPanel progress={tutorialProgress} onToggleStep={onToggleTutorialStep} />
      )}
      {topic.sections.map((section) => (
        <HelpSection key={section.heading} section={section} />
      ))}
    </article>
  );
}
