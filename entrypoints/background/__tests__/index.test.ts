import { describe, it, expect, vi } from 'vitest';

const { initMock, logErrorMock } = vi.hoisted(() => ({
  initMock: vi.fn(),
  logErrorMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/background/service-worker.js', () => ({
  init: initMock,
}));

vi.mock('../../../src/utils/logger/api.js', () => ({
  logError: logErrorMock,
}));

import backgroundDefinition from '../index.js';
import { getBackgroundStartup } from '../index.js';

describe('background entrypoint', () => {
  describe('main', () => {
    it('starts the service worker and exposes the startup completion', async () => {
      initMock.mockResolvedValue([
        { phase: 'allowed-urls-sync', ok: true },
        { phase: 'alarm-registry', ok: true },
        { phase: 'export-scheduler', ok: true },
      ]);

      backgroundDefinition.main();

      const startup = getBackgroundStartup();
      if (startup === null) throw new Error('main() did not start the background load');
      const phases = await startup;

      expect(initMock).toHaveBeenCalledTimes(1);
      expect(phases.map((phase) => phase.phase)).toEqual(['allowed-urls-sync', 'alarm-registry', 'export-scheduler']);
    });

    it('resolves to an empty phase list when startup rejects', async () => {
      initMock.mockRejectedValue(new Error('startup failed'));

      backgroundDefinition.main();

      const startup = getBackgroundStartup();
      if (startup === null) throw new Error('main() did not start the background load');
      const phases = await startup;

      expect(phases).toEqual([]);
      expect(logErrorMock).toHaveBeenCalled();
    });
  });
});
