import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIntegrationPayload, sendIntegrationEvent } from './notificationSender';
import { useIntegrationStore } from '../../store/integrationStore';

describe('integration notification sender', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ targets: [], rules: [] });
    vi.restoreAllMocks();
  });

  it('formats print event payloads with printer context', () => {
    const payload = buildIntegrationPayload('LAYER_CHANGE', {
      printerId: 'p1',
      printerName: 'Voron',
      status: 'processing',
      fileName: 'cube.gcode',
      layer: 12,
    });

    expect(payload.event).toBe('LAYER_CHANGE');
    expect(payload.message).toContain('Voron');
    expect(payload.message).toContain('layer 12');
    expect(payload.printer.fileName).toBe('cube.gcode');
  });

  it('sends matching rules to configured targets once', async () => {
    const targetId = useIntegrationStore.getState().addTarget({
      name: 'Generic',
      type: 'webhook',
      url: 'https://example.test/hook',
    });
    useIntegrationStore.getState().addRule({
      name: 'All starts',
      events: ['PRINT_START'],
      targetIds: [targetId, targetId],
      printerId: null,
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const results = await sendIntegrationEvent('PRINT_START', {
      printerId: 'p1',
      printerName: 'Printer',
      status: 'processing',
    });

    expect(results).toEqual([{ targetId, ok: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/hook');
  });
});
