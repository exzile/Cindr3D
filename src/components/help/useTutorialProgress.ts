import { useCallback, useState } from 'react';
import { TUTORIAL_PROGRESS_KEY } from './helpContent';

export type TutorialProgress = Record<string, boolean>;

/** Per-step completion state for the help-modal tutorials, persisted to localStorage. */
export function useTutorialProgress() {
  const [progress, setProgress] = useState<TutorialProgress>(() => {
    try {
      const stored = window.localStorage.getItem(TUTORIAL_PROGRESS_KEY);
      return stored ? JSON.parse(stored) as TutorialProgress : {};
    } catch {
      return {};
    }
  });

  const toggleStep = useCallback((lessonId: string, stepIndex: number) => {
    const key = `${lessonId}:${stepIndex}`;
    setProgress((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify(next));
      } catch {
        // Progress is optional; ignore storage failures.
      }
      return next;
    });
  }, []);

  return { progress, toggleStep };
}
