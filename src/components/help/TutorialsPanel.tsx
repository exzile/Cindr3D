import { CheckCircle2, Circle, PlayCircle } from 'lucide-react';
import { TUTORIAL_LESSONS } from './helpContent';
import type { TutorialProgress } from './useTutorialProgress';

export function TutorialsPanel({
  progress,
  onToggleStep,
}: {
  progress: TutorialProgress;
  onToggleStep: (lessonId: string, stepIndex: number) => void;
}) {
  return (
    <div className="app-help-tutorials">
      {TUTORIAL_LESSONS.map((lesson) => {
        const done = lesson.steps.filter((_, index) => progress[`${lesson.id}:${index}`]).length;
        return (
          <section key={lesson.id} className="app-help-tutorial">
            <div className="app-help-tutorial__header">
              <PlayCircle size={16} />
              <div>
                <h4>{lesson.title}</h4>
                <p>{lesson.summary}</p>
              </div>
              <span>{done}/{lesson.steps.length}</span>
            </div>
            <div className="app-help-tutorial__steps">
              {lesson.steps.map((step, index) => {
                const checked = progress[`${lesson.id}:${index}`] ?? false;
                return (
                  <button
                    type="button"
                    key={`${lesson.id}:${index}`}
                    role="checkbox"
                    aria-checked={checked}
                    className={`app-help-tutorial__step${checked ? ' is-done' : ''}`}
                    onClick={() => onToggleStep(lesson.id, index)}
                  >
                    {checked ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                    <span>{step}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
