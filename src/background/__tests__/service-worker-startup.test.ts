import { describe, it, expect, vi } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';

type ChromeStub = Record<string, unknown> & {
  storage: { local: Record<string, unknown>; session?: unknown; onChanged?: { addListener: () => void } };
  action: { setBadgeText: ReturnType<typeof vi.fn>; setBadgeBackgroundColor: ReturnType<typeof vi.fn> };
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
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
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

  describe('degraded startup', () => {
    it('loads the module and reports failures instead of crash-looping when a factory throws', async () => {
      const stub = installChromeStub();
      vi.resetModules();
      // A deterministic factory bug (not a transient failure): the old
      // module-level createBackgroundServices() throw failed the whole SW
      // load, and Chrome retried the same factories on every restart.
      vi.doMock('../obsidianClient.js', () => ({
        ObsidianClient: class {
          constructor() {
            throw new Error('obsidian boom');
          }
        },
      }));
      const serviceWorker = await import('../service-worker.js');

      // The module loads: startup is degraded, not dead.
      expect(serviceWorker.isStartupDegraded()).toBe(true);
      expect(serviceWorker.startupFailures.map((failure) => failure.key)).toContain('obsidian');
      expect(serviceWorker.startupUnexpectedError).toBeUndefined();
      // Honest slots: the router cascade is undefined (no silent fake),
      // while healthy paths keep working functions.
      expect(serviceWorker.handlePing).toBeUndefined();
      expect(serviceWorker.handleTabRemoved).toBeTypeOf('function');
      expect(typeof serviceWorker.createMessageHandler).toBe('function');
      // The message listener answers with an explicit degraded error instead
      // of crashing the sender's port.
      const sendResponse = vi.fn();
      const handled = serviceWorker.createMessageHandler()(
        { type: 'PING' },
        { id: 'test-extension-id' } as chrome.runtime.MessageSender,
        sendResponse,
      );
      expect(handled).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: expect.stringContaining('degraded') }),
      );
      // Startup phases stay observable: the alarm phase is recorded as failed.
      const phases = await serviceWorker.init();
      expect(phases).toHaveLength(3);
      expect(phases.find((phase) => phase.phase === 'alarm-registry')?.ok).toBe(false);
      // The outage is visible on the toolbar badge.
      await waitForMock(() => {
        expect(stub.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
      });
    });
  });
});
