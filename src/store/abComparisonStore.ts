import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ComparisonLegId = 'a' | 'b';
export type ComparisonLegStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed';
export type ComparisonQualityRating = 'unrated' | 'best' | 'acceptable' | 'needs-review' | 'failed';

export interface ComparisonSample {
  at: number;
  layer?: number;
  elapsedSeconds?: number;
  remainingSeconds?: number;
}

export interface ComparisonLeg {
  printerId: string;
  printerName: string;
  status: ComparisonLegStatus;
  queueJobId?: string;
  startedAt?: number;
  finishedAt?: number;
  totalSeconds?: number;
  quality: ComparisonQualityRating;
  notes: string;
  samples: ComparisonSample[];
}

export interface ComparisonSession {
  id: string;
  filePath: string;
  fileName: string;
  createdAt: number;
  updatedAt: number;
  legs: Record<ComparisonLegId, ComparisonLeg>;
}

interface CreateComparisonInput {
  filePath: string;
  printerA: { id: string; name: string };
  printerB: { id: string; name: string };
}

interface AbComparisonStore {
  sessions: ComparisonSession[];
  activeSessionId: string | null;
  createSession: (input: CreateComparisonInput) => string;
  setActiveSession: (sessionId: string | null) => void;
  updateLeg: (sessionId: string, legId: ComparisonLegId, patch: Partial<Omit<ComparisonLeg, 'samples'>>) => void;
  recordSample: (sessionId: string, legId: ComparisonLegId, sample: Omit<ComparisonSample, 'at'>) => void;
  setLegQuality: (sessionId: string, legId: ComparisonLegId, quality: ComparisonQualityRating) => void;
  setLegNotes: (sessionId: string, legId: ComparisonLegId, notes: string) => void;
  removeSession: (sessionId: string) => void;
  clearSessions: () => void;
}

export interface ComparisonReport {
  fasterLeg: ComparisonLegId | null;
  qualityLeg: ComparisonLegId | null;
  timeDeltaSeconds: number | null;
  summary: string;
}

function now(): number {
  return Date.now();
}

function createId(): string {
  return `ab-${now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split('/').filter(Boolean).pop() ?? filePath;
}

function createLeg(printer: { id: string; name: string }): ComparisonLeg {
  return {
    printerId: printer.id,
    printerName: printer.name,
    status: 'idle',
    quality: 'unrated',
    notes: '',
    samples: [],
  };
}

function bestQualityScore(quality: ComparisonQualityRating): number {
  if (quality === 'best') return 4;
  if (quality === 'acceptable') return 3;
  if (quality === 'needs-review') return 2;
  if (quality === 'failed') return 1;
  return 0;
}

export function summarizeComparison(session: ComparisonSession | null | undefined): ComparisonReport {
  if (!session) {
    return { fasterLeg: null, qualityLeg: null, timeDeltaSeconds: null, summary: 'No comparison selected.' };
  }

  const aTime = session.legs.a.totalSeconds;
  const bTime = session.legs.b.totalSeconds;
  const fasterLeg = aTime && bTime ? aTime <= bTime ? 'a' : 'b' : null;
  const timeDeltaSeconds = aTime && bTime ? Math.abs(aTime - bTime) : null;
  const aQuality = bestQualityScore(session.legs.a.quality);
  const bQuality = bestQualityScore(session.legs.b.quality);
  const qualityLeg = aQuality === bQuality || (aQuality === 0 && bQuality === 0)
    ? null
    : aQuality > bQuality ? 'a' : 'b';

  const summary = [
    fasterLeg ? `${session.legs[fasterLeg].printerName} is faster` : 'Timing winner pending',
    qualityLeg ? `${session.legs[qualityLeg].printerName} has the better quality mark` : 'Quality winner pending',
  ].join('. ');

  return { fasterLeg, qualityLeg, timeDeltaSeconds, summary };
}

export const useAbComparisonStore = create<AbComparisonStore>()(
  persist(
    (set) => ({
      sessions: [],
      activeSessionId: null,

      createSession: (input) => {
        const id = createId();
        const stamp = now();
        const session: ComparisonSession = {
          id,
          filePath: input.filePath,
          fileName: fileNameFromPath(input.filePath),
          createdAt: stamp,
          updatedAt: stamp,
          legs: {
            a: createLeg(input.printerA),
            b: createLeg(input.printerB),
          },
        };
        set((state) => ({ sessions: [session, ...state.sessions], activeSessionId: id }));
        return id;
      },

      setActiveSession: (activeSessionId) => set({ activeSessionId }),

      updateLeg: (sessionId, legId, patch) => {
        set((state) => ({
          sessions: state.sessions.map((session) => (
            session.id === sessionId
              ? {
                ...session,
                updatedAt: now(),
                legs: {
                  ...session.legs,
                  [legId]: { ...session.legs[legId], ...patch },
                },
              }
              : session
          )),
        }));
      },

      recordSample: (sessionId, legId, sample) => {
        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId) return session;
            const leg = session.legs[legId];
            const last = leg.samples[leg.samples.length - 1];
            if (
              last
              && last.layer === sample.layer
              && last.elapsedSeconds === sample.elapsedSeconds
              && last.remainingSeconds === sample.remainingSeconds
            ) {
              return session;
            }
            return {
              ...session,
              updatedAt: now(),
              legs: {
                ...session.legs,
                [legId]: {
                  ...leg,
                  status: leg.status === 'idle' || leg.status === 'queued' ? 'running' : leg.status,
                  samples: [...leg.samples, { ...sample, at: now() }].slice(-240),
                },
              },
            };
          }),
        }));
      },

      setLegQuality: (sessionId, legId, quality) => {
        set((state) => ({
          sessions: state.sessions.map((session) => (
            session.id === sessionId
              ? {
                ...session,
                updatedAt: now(),
                legs: {
                  ...session.legs,
                  [legId]: { ...session.legs[legId], quality },
                },
              }
              : session
          )),
        }));
      },

      setLegNotes: (sessionId, legId, notes) => {
        set((state) => ({
          sessions: state.sessions.map((session) => (
            session.id === sessionId
              ? {
                ...session,
                updatedAt: now(),
                legs: {
                  ...session.legs,
                  [legId]: { ...session.legs[legId], notes },
                },
              }
              : session
          )),
        }));
      },

      removeSession: (sessionId) => {
        set((state) => ({
          sessions: state.sessions.filter((session) => session.id !== sessionId),
          activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
        }));
      },

      clearSessions: () => set({ sessions: [], activeSessionId: null }),
    }),
    {
      name: 'cindr3d-ab-comparisons',
      version: 1,
    },
  ),
);
