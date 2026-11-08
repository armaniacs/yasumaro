/**
 * envelopeAbsentCounter-restart.test.ts
 * PBI 2026-11-08-01 pin: the absent-protocol-version counter must survive a
 * service worker restart (the sqliteAlert session pattern), so the every-10th
 * migration-progress log keeps its cadence instead of restarting from zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';

const { logInfo } = vi.hoisted(() => ({ logInfo: vi.fn() }));
vi.mock('../../utils/logger/api.js', () => ({
  logInfo,
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

const COUNTER_SESSION_KEY = 'envelopeAbsentVersionCount';

async function freshEnvelopeModule() {
  vi.resetModules();
  return import('../handlers/envelopePolicy.js');
}

function makeDeps() {
  return {
    runDeferredStartupMigrations: vi.fn(async () => {}),
    initializeTabCache: vi.fn(async () => {}),
  };
}

function sender(): chrome.runtime.MessageSender {
  return {} as chrome.runtime.MessageSender;
}

/** Wait for the module's fire-and-forget session write to land. */
async function flushCounterWrite(): Promise<void> {
  await waitForMock(async () => {
    const stored = (await chrome.storage.session.get(COUNTER_SESSION_KEY)) as Record<string, unknown>;
    expect(stored).toHaveProperty(COUNTER_SESSION_KEY);
  });
}

describe('envelopePolicy', () => {
  describe('absent-version counter restart durability (PBI 2026-11-08-01)', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      await chrome.storage.session.clear();
    });

    it('keeps the absent-version count across a simulated SW restart', async () => {
      const first = await freshEnvelopeModule();
      await first.restoreAbsentVersionCount();
      for (let i = 0; i < 3; i++) {
        const outcome = await first.checkEnvelope({ type: 'PING' }, sender(), makeDeps());
        expect(outcome.accepted).toBe(true);
      }
      await flushCounterWrite();
      expect(first.getAbsentVersionCount()).toBe(3);

      // Simulate the SW teardown: drop the module instance, re-import, rehydrate.
      const second = await freshEnvelopeModule();
      await second.restoreAbsentVersionCount();
      expect(second.getAbsentVersionCount()).toBe(3);

      const outcome = await second.checkEnvelope({ type: 'PING' }, sender(), makeDeps());
      expect(outcome.accepted).toBe(true);
      expect(second.getAbsentVersionCount()).toBe(4);
    });

    it('continues the every-10th log cadence after a restart instead of resetting it', async () => {
      const first = await freshEnvelopeModule();
      await first.restoreAbsentVersionCount();
      for (let i = 0; i < 10; i++) {
        await first.checkEnvelope({ type: 'PING' }, sender(), makeDeps());
      }
      await flushCounterWrite();
      expect(first.getAbsentVersionCount()).toBe(10);
      // Only the count=1 message logs (counter % 10 === 1).
      expect(logInfo).toHaveBeenCalledTimes(1);
      logInfo.mockClear();

      const second = await freshEnvelopeModule();
      await second.restoreAbsentVersionCount();
      await second.checkEnvelope({ type: 'PING' }, sender(), makeDeps());

      // Restored 10 + 1 = 11 hits the cadence: the log keeps counting, proof
      // the counter survived the restart.
      expect(logInfo).toHaveBeenCalledTimes(1);
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('count=11'),
        expect.objectContaining({ type: 'PING' }),
      );
    });
  });
});
