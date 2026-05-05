import { beforeEach, describe, expect, it } from 'vitest';
import { useSchedulingStore } from '../store/schedulingStore';

describe('scheduling store', () => {
  beforeEach(() => {
    useSchedulingStore.setState({
      scheduledPrints: [],
      quietWindows: [],
      bedClearSettings: [],
      checklistItems: [
        {
          id: 'bed-clean',
          label: 'Bed is clean',
          description: 'Clean bed',
          defaultEnabled: true,
        },
      ],
      checklistOverrides: [],
    });
  });

  it('treats the after-midnight half of an overnight quiet window as quiet', () => {
    useSchedulingStore.getState().addQuietWindow({
      label: 'Monday night',
      days: [1],
      startHour: 22,
      startMinute: 0,
      endHour: 7,
      endMinute: 0,
    });

    expect(useSchedulingStore.getState().isQuietAt(new Date('2026-05-04T23:00:00').getTime())).toBe(true);
    expect(useSchedulingStore.getState().isQuietAt(new Date('2026-05-05T02:00:00').getTime())).toBe(true);
    expect(useSchedulingStore.getState().isQuietAt(new Date('2026-05-05T08:00:00').getTime())).toBe(false);
  });

  it('returns no checklist items when the printer checklist is hidden', () => {
    useSchedulingStore.getState().setChecklistVisible('printer-a', false);

    expect(useSchedulingStore.getState().getChecklistForPrinter('printer-a')).toEqual([]);
  });
});
