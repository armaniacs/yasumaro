import { describe, it, expect } from 'vitest';

type ChromeStub = Record<string, unknown> & {
  storage: { local: Record<string, unknown>; session?: unknown; onChanged?: { addListener: () => void } };
};

function installChromeStub(): ChromeStub {
  const area = () => ({
    get: async () => ({}),
    set: async () => undefined,
    remove: async () => undefined,
  });
  const stub: ChromeStub = {
    storage: { local: area(), onChanged: { addListener: () => undefined } },
    alarms: {
      create: async () => undefined,
      clear: async () => true,
      onAlarm: { addListener: () => undefined },
    },
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
      lastError: null,
    },
    i18n: { getMessage: () => '' },
  };
  (globalThis as Record<string, unknown>).chrome = stub;
  return stub;
}

describe('service-worker startup observability', () => {
  describe('init', () => {
    it('resolves with one result per startup phase in startup-sequence order', async () => {
      installChromeStub();
      const serviceWorker = await import('../service-worker.js');

      const phases = await serviceWorker.init();

      expect(phases.map((phase) => phase.phase)).toEqual(['allowed-urls-sync', 'alarm-registry', 'export-scheduler']);
      for (const phase of phases) {
        expect(typeof phase.ok).toBe('boolean');
      }
    });

    it('records a failing phase instead of rejecting the whole startup', async () => {
      const stub = installChromeStub();
      // initAllowedUrlsSync reads the seed inside its own try/catch, but the
      // listener registration after it has no handler: a missing onChanged
      // surface rejects the phase task, which must be recorded, not thrown.
      delete stub.storage.onChanged;
      const serviceWorker = await import('../service-worker.js');

      const phases = await serviceWorker.init();

      const seed = phases.find((phase) => phase.phase === 'allowed-urls-sync');
      expect(seed?.ok).toBe(false);
      // The other phases still ran to completion.
      expect(phases).toHaveLength(3);
    });
  });
});
