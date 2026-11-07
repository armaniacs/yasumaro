/**
 * digestBatchToken-restart.test.ts
 * PBI 2026-11-08-01 pin: the digest run token must survive a service worker
 * restart monotonically (BDD: 復元後の token が N 未満に戻らない).
 *
 * The SW is ephemeral (MV3): module-level `latestRunToken` is lost on every
 * restart, so the token is written through to chrome.storage.session and
 * rehydrated at module load (the sqliteAlert pattern). These tests simulate a
 * restart with vi.resetModules() + re-import and assert the restored token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';
import type { AlarmHandlerDeps } from '../alarmRegistry.js';

const TOKEN_SESSION_KEY = 'digestBatchRunToken';

async function freshDigestModule() {
  vi.resetModules();
  return import('../digestBatchAlarm.js');
}

/** Disabled-setting deps: the tick returns early, but the token still advances. */
function makeDisabledDeps(): AlarmHandlerDeps {
  return {
    settingsReader: { getAll: async () => ({}) },
  } as unknown as AlarmHandlerDeps;
}

/** Wait for the module's fire-and-forget session write to land. */
async function flushTokenWrite(): Promise<void> {
  await waitForMock(async () => {
    const stored = (await chrome.storage.session.get(TOKEN_SESSION_KEY)) as Record<string, unknown>;
    expect(stored).toHaveProperty(TOKEN_SESSION_KEY);
  });
}

async function tokenOf(mod: Awaited<ReturnType<typeof freshDigestModule>>): Promise<number> {
  const stored = (await chrome.storage.session.get(TOKEN_SESSION_KEY)) as Record<string, number>;
  const value = stored[TOKEN_SESSION_KEY];
  if (typeof value !== 'number') throw new Error('digest run token was not persisted');
  return value;
}

describe('digestBatchAlarm', () => {
  describe('run token restart durability (PBI 2026-11-08-01)', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      await chrome.storage.session.clear();
    });

    it('keeps the run token monotonic across a simulated SW restart', async () => {
      const first = await freshDigestModule();
      await first.runReviewDigestBatch(makeDisabledDeps());
      await first.runReviewDigestBatch(makeDisabledDeps());
      await first.runReviewDigestBatch(makeDisabledDeps());
      await flushTokenWrite();
      expect(await tokenOf(first)).toBe(3);

      // Simulate the SW teardown: drop the module instance, re-import, tick again.
      const second = await freshDigestModule();
      await second.runReviewDigestBatch(makeDisabledDeps());
      await flushTokenWrite();

      // The restored token (3) plus one tick must not fall back below N.
      expect(await tokenOf(second)).toBe(4);
    });

    it('starts from zero on a fresh install (empty session)', async () => {
      const mod = await freshDigestModule();
      await mod.runReviewDigestBatch(makeDisabledDeps());
      await flushTokenWrite();
      expect(await tokenOf(mod)).toBe(1);
    });
  });
});
