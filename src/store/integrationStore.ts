import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type IntegrationEventType = 'PRINT_START' | 'LAYER_CHANGE' | 'PAUSED' | 'FAILED' | 'DONE';
export type IntegrationTargetType = 'webhook' | 'discord' | 'slack' | 'telegram';

export const INTEGRATION_EVENTS: IntegrationEventType[] = ['PRINT_START', 'LAYER_CHANGE', 'PAUSED', 'FAILED', 'DONE'];

export interface IntegrationTarget {
  id: string;
  name: string;
  type: IntegrationTargetType;
  enabled: boolean;
  url: string;
  token: string;
  chatId: string;
  createdAt: number;
  updatedAt: number;
}

export interface IntegrationRule {
  id: string;
  name: string;
  enabled: boolean;
  printerId: string | null;
  targetIds: string[];
  events: IntegrationEventType[];
  includeTemperatures: boolean;
  includePosition: boolean;
  createdAt: number;
  updatedAt: number;
}

interface IntegrationStore {
  targets: IntegrationTarget[];
  rules: IntegrationRule[];
  addTarget: (target: Partial<Omit<IntegrationTarget, 'id' | 'createdAt' | 'updatedAt'>>) => string;
  updateTarget: (id: string, patch: Partial<Omit<IntegrationTarget, 'id' | 'createdAt'>>) => void;
  removeTarget: (id: string) => void;
  addRule: (rule: Partial<Omit<IntegrationRule, 'id' | 'createdAt' | 'updatedAt'>>) => string;
  updateRule: (id: string, patch: Partial<Omit<IntegrationRule, 'id' | 'createdAt'>>) => void;
  removeRule: (id: string) => void;
  matchingRules: (event: IntegrationEventType, printerId: string | null) => IntegrationRule[];
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowStamp() {
  return Date.now();
}

function cleanTarget(target: Partial<Omit<IntegrationTarget, 'id' | 'createdAt' | 'updatedAt'>>): Omit<IntegrationTarget, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: target.name?.trim() || 'Integration target',
    type: target.type ?? 'webhook',
    enabled: target.enabled ?? true,
    url: target.url?.trim() ?? '',
    token: target.token?.trim() ?? '',
    chatId: target.chatId?.trim() ?? '',
  };
}

function cleanRule(rule: Partial<Omit<IntegrationRule, 'id' | 'createdAt' | 'updatedAt'>>): Omit<IntegrationRule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: rule.name?.trim() || 'Print notifications',
    enabled: rule.enabled ?? true,
    printerId: rule.printerId ?? null,
    targetIds: Array.from(new Set(rule.targetIds ?? [])),
    events: rule.events?.length ? Array.from(new Set(rule.events)) : [...INTEGRATION_EVENTS],
    includeTemperatures: rule.includeTemperatures ?? true,
    includePosition: rule.includePosition ?? true,
  };
}

export const useIntegrationStore = create<IntegrationStore>()(
  persist(
    (set, get) => ({
      targets: [],
      rules: [],

      addTarget: (target) => {
        const id = uid('target');
        const stamp = nowStamp();
        set((state) => ({
          targets: [...state.targets, { id, ...cleanTarget(target), createdAt: stamp, updatedAt: stamp }],
        }));
        return id;
      },

      updateTarget: (id, patch) => {
        const stamp = nowStamp();
        set((state) => ({
          targets: state.targets.map((target) => target.id === id ? { ...target, ...cleanTarget({ ...target, ...patch }), updatedAt: stamp } : target),
        }));
      },

      removeTarget: (id) => {
        set((state) => ({
          targets: state.targets.filter((target) => target.id !== id),
          rules: state.rules.map((rule) => ({ ...rule, targetIds: rule.targetIds.filter((targetId) => targetId !== id) })),
        }));
      },

      addRule: (rule) => {
        const id = uid('rule');
        const stamp = nowStamp();
        set((state) => ({
          rules: [...state.rules, { id, ...cleanRule(rule), createdAt: stamp, updatedAt: stamp }],
        }));
        return id;
      },

      updateRule: (id, patch) => {
        const stamp = nowStamp();
        set((state) => ({
          rules: state.rules.map((rule) => rule.id === id ? { ...rule, ...cleanRule({ ...rule, ...patch }), updatedAt: stamp } : rule),
        }));
      },

      removeRule: (id) => {
        set((state) => ({ rules: state.rules.filter((rule) => rule.id !== id) }));
      },

      matchingRules: (event, printerId) => get().rules.filter((rule) => (
        rule.enabled
        && rule.events.includes(event)
        && (rule.printerId === null || rule.printerId === printerId)
        && rule.targetIds.length > 0
      )),
    }),
    { name: 'cindr3d-integrations-v1' },
  ),
);
