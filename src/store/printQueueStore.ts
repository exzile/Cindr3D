import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SavedPrinter } from '../types/duet';
import type { DuetPrefs, FilamentMaterial, MachineConfig } from '../types/duet-prefs.types';
import { DEFAULT_PREFS } from '../utils/duetPrefs';

export type PrintQueueJobStatus = 'queued' | 'ready' | 'blocked' | 'printing' | 'paused' | 'done' | 'cancelled' | 'failed';
export type PrintQueueRoutingMode = 'auto' | 'manual';

export interface PrintQueueRequirements {
  material?: FilamentMaterial | string;
  nozzleDiameter?: number;
  buildVolume?: {
    x: number;
    y: number;
    z: number;
  };
  printerProfileId?: string;
}

export interface PrintQueueRouting {
  mode: PrintQueueRoutingMode;
  candidatePrinterIds: string[];
  blockedReasons: Record<string, string[]>;
  summary: string;
}

export interface PrintQueueJob {
  id: string;
  filePath: string;
  fileName: string;
  printerId: string | null;
  requestedCopies: number;
  copyIndex: number;
  status: PrintQueueJobStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  requirements: PrintQueueRequirements;
  routing: PrintQueueRouting;
}

export interface AddPrintQueueJobInput {
  filePath: string;
  printerId?: string | null;
  copies?: number;
  requirements?: PrintQueueRequirements;
  routingMode?: PrintQueueRoutingMode;
}

interface PrintQueueStore {
  jobs: PrintQueueJob[];
  activeJobId: string | null;
  autoStart: boolean;

  addJob: (input: AddPrintQueueJobInput, printers?: SavedPrinter[]) => string;
  addCopies: (input: AddPrintQueueJobInput, printers?: SavedPrinter[]) => string[];
  replaceWithFilePaths: (filePaths: string[], printerId?: string | null, printers?: SavedPrinter[]) => void;
  removeJob: (jobId: string) => void;
  clearCompleted: () => void;
  clearAll: () => void;
  moveJob: (jobId: string, offset: number) => void;
  assignPrinter: (jobId: string, printerId: string | null, printers?: SavedPrinter[]) => void;
  setJobStatus: (jobId: string, status: PrintQueueJobStatus) => void;
  setAutoStart: (autoStart: boolean) => void;
  reconcileWithPrinters: (printers: SavedPrinter[]) => void;
  markActiveJobComplete: () => void;
  selectNextReadyJob: (printerId: string, printers: SavedPrinter[]) => PrintQueueJob | null;
  markJobPrinting: (jobId: string) => void;
}

const LEGACY_QUEUE_KEY = 'cindr3d-print-queue';

function now(): number {
  return Date.now();
}

function createId(prefix: string): string {
  return `${prefix}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split('/').filter(Boolean).pop() ?? filePath;
}

function prefsForPrinter(printer: SavedPrinter): DuetPrefs {
  const partial = printer.prefs as Partial<DuetPrefs> | undefined;
  return {
    ...DEFAULT_PREFS,
    ...partial,
    machineConfig: {
      ...DEFAULT_PREFS.machineConfig,
      ...(partial?.machineConfig ?? {}),
    },
    filamentProfiles: partial?.filamentProfiles ?? DEFAULT_PREFS.filamentProfiles,
    defaultFilamentProfileId: partial?.defaultFilamentProfileId ?? DEFAULT_PREFS.defaultFilamentProfileId,
  };
}

function loadedMaterialForPrefs(prefs: DuetPrefs): string {
  const active = prefs.filamentProfiles.find((profile) => profile.id === prefs.defaultFilamentProfileId)
    ?? prefs.filamentProfiles[0];
  return active?.material ?? '';
}

function volumeFits(requirement: NonNullable<PrintQueueRequirements['buildVolume']>, machine: MachineConfig): boolean {
  return requirement.x <= machine.buildVolumeX
    && requirement.y <= machine.buildVolumeY
    && requirement.z <= machine.buildVolumeZ;
}

export function routeJobForPrinters(
  job: Pick<PrintQueueJob, 'printerId' | 'requirements' | 'routing'>,
  printers: SavedPrinter[],
): PrintQueueRouting {
  const blockedReasons: Record<string, string[]> = {};
  const candidates: string[] = [];
  const requestedPrinter = job.routing.mode === 'manual' ? job.printerId : null;

  for (const printer of printers) {
    const reasons: string[] = [];
    const prefs = prefsForPrinter(printer);
    const machine = prefs.machineConfig;

    if (requestedPrinter && printer.id !== requestedPrinter) {
      reasons.push('Assigned to another printer');
    }
    if (!printer.config.hostname.trim()) {
      reasons.push('No host configured');
    }
    if (job.requirements.buildVolume && !volumeFits(job.requirements.buildVolume, machine)) {
      reasons.push('Build volume too small');
    }
    if (
      job.requirements.nozzleDiameter !== undefined
      && Math.abs(machine.nozzleDiameter - job.requirements.nozzleDiameter) > 0.01
    ) {
      reasons.push(`Needs ${job.requirements.nozzleDiameter}mm nozzle`);
    }
    if (job.requirements.material) {
      const loadedMaterial = loadedMaterialForPrefs(prefs).toLowerCase();
      if (loadedMaterial && loadedMaterial !== String(job.requirements.material).toLowerCase()) {
        reasons.push(`Needs ${job.requirements.material}`);
      }
    }
    if (job.requirements.printerProfileId && job.requirements.printerProfileId !== printer.id) {
      reasons.push('Printer profile mismatch');
    }

    if (reasons.length === 0) candidates.push(printer.id);
    else blockedReasons[printer.id] = reasons;
  }

  return {
    mode: job.routing.mode,
    candidatePrinterIds: candidates,
    blockedReasons,
    summary: candidates.length > 0
      ? `${candidates.length} compatible printer${candidates.length === 1 ? '' : 's'}`
      : 'Blocked by routing rules',
  };
}

function routeJobs(jobs: PrintQueueJob[], printers: SavedPrinter[]): PrintQueueJob[] {
  return jobs.map((job) => {
    const routing = routeJobForPrinters(job, printers);
    const status = job.status === 'blocked' || job.status === 'queued' || job.status === 'ready'
      ? routing.candidatePrinterIds.length > 0 ? 'ready' : 'blocked'
      : job.status;
    return { ...job, routing, status, updatedAt: now() };
  });
}

function createJobsFromInput(input: AddPrintQueueJobInput, printers: SavedPrinter[]): PrintQueueJob[] {
  const copies = Math.max(1, Math.floor(input.copies ?? 1));
  const routingMode = input.routingMode ?? (input.printerId ? 'manual' : 'auto');
  const stamp = now();
  const baseJob: PrintQueueJob = {
    id: '',
    filePath: input.filePath,
    fileName: fileNameFromPath(input.filePath),
    printerId: input.printerId ?? null,
    requestedCopies: copies,
    copyIndex: 1,
    status: 'queued',
    createdAt: stamp,
    updatedAt: stamp,
    requirements: input.requirements ?? {},
    routing: {
      mode: routingMode,
      candidatePrinterIds: [],
      blockedReasons: {},
      summary: 'Pending route',
    },
  };
  const provisionalJobs = Array.from({ length: copies }, (_, index) => ({
    ...baseJob,
    id: createId('queue-job'),
    copyIndex: index + 1,
  }));
  const routedJobs = routeJobs(provisionalJobs, printers);
  if (routingMode === 'manual' || printers.length === 0) return routedJobs;

  return routedJobs.map((job, index) => {
    const printerId = job.routing.candidatePrinterIds[index % Math.max(1, job.routing.candidatePrinterIds.length)] ?? null;
    return { ...job, printerId, updatedAt: stamp };
  });
}

function readLegacyQueue(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export const usePrintQueueStore = create<PrintQueueStore>()(
  persist(
    (set, get) => ({
      jobs: [],
      activeJobId: null,
      autoStart: true,

      addJob: (input, printers = []) => {
        const [job] = createJobsFromInput({ ...input, copies: 1 }, printers);
        set((state) => ({ jobs: [...state.jobs, job] }));
        return job.id;
      },

      addCopies: (input, printers = []) => {
        const jobs = createJobsFromInput(input, printers);
        set((state) => ({ jobs: [...state.jobs, ...jobs] }));
        return jobs.map((job) => job.id);
      },

      replaceWithFilePaths: (filePaths, printerId = null, printers = []) => {
        const jobs = filePaths.flatMap((filePath) => createJobsFromInput({ filePath, printerId, copies: 1 }, printers));
        set({ jobs });
      },

      removeJob: (jobId) => {
        set((state) => ({
          jobs: state.jobs.filter((job) => job.id !== jobId),
          activeJobId: state.activeJobId === jobId ? null : state.activeJobId,
        }));
      },

      clearCompleted: () => {
        set((state) => ({
          jobs: state.jobs.filter((job) => !['done', 'cancelled', 'failed'].includes(job.status)),
        }));
      },

      clearAll: () => {
        set({ jobs: [], activeJobId: null });
      },

      moveJob: (jobId, offset) => {
        set((state) => {
          const index = state.jobs.findIndex((job) => job.id === jobId);
          const target = index + offset;
          if (index < 0 || target < 0 || target >= state.jobs.length) return state;
          const jobs = [...state.jobs];
          [jobs[index], jobs[target]] = [jobs[target], jobs[index]];
          return { jobs };
        });
      },

      assignPrinter: (jobId, printerId, printers = []) => {
        set((state) => ({
          jobs: routeJobs(state.jobs.map((job) => (
            job.id === jobId
              ? {
                ...job,
                printerId,
                routing: { ...job.routing, mode: printerId ? 'manual' : 'auto' },
                status: job.status === 'paused' ? job.status : 'queued',
              }
              : job
          )), printers),
        }));
      },

      setJobStatus: (jobId, status) => {
        set((state) => ({
          jobs: state.jobs.map((job) => (
            job.id === jobId
              ? { ...job, status, updatedAt: now(), finishedAt: ['done', 'cancelled', 'failed'].includes(status) ? now() : job.finishedAt }
              : job
          )),
          activeJobId: ['done', 'cancelled', 'failed'].includes(status) && state.activeJobId === jobId ? null : state.activeJobId,
        }));
      },

      setAutoStart: (autoStart) => set({ autoStart }),

      reconcileWithPrinters: (printers) => {
        set((state) => ({ jobs: routeJobs(state.jobs, printers) }));
      },

      markActiveJobComplete: () => {
        const { activeJobId } = get();
        if (!activeJobId) return;
        get().setJobStatus(activeJobId, 'done');
      },

      selectNextReadyJob: (printerId, printers) => {
        const routedJobs = routeJobs(get().jobs, printers);
        set({ jobs: routedJobs });
        return routedJobs.find((job) => (
          (job.status === 'ready' || job.status === 'queued')
          && (job.printerId === printerId || (!job.printerId && job.routing.candidatePrinterIds.includes(printerId)))
        )) ?? null;
      },

      markJobPrinting: (jobId) => {
        set((state) => ({
          activeJobId: jobId,
          jobs: state.jobs.map((job) => (
            job.id === jobId
              ? { ...job, status: 'printing', startedAt: now(), updatedAt: now() }
              : job
          )),
        }));
      },
    }),
    {
      name: 'cindr3d-smart-print-queue',
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (!state || state.jobs.length > 0) return;
        const legacyQueue = readLegacyQueue();
        if (legacyQueue.length > 0) state.replaceWithFilePaths(legacyQueue);
      },
    },
  ),
);
