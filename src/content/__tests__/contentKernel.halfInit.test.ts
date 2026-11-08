// @vitest-environment jsdom
/**
 * contentKernel.halfInit.test.ts (review S6)
 * Fail-closed init: a settings-load failure rejects init() with NO
 * periodic timer, NO SPA seam and NO threshold caches armed — the visit
 * pipeline stays silent instead of gating on unloaded thresholds.
 * Recovery is a fresh init() (page reload); no in-page retry loop.
 */
import { describe, it, expect, vi } from 'vitest';
import { ContentKernel } from '../contentKernel.js';
import { FakeScheduler } from './helpers/fakeScheduler.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import type { StoragePort } from '../../utils/storage/storagePort.js';
import { PageState } from '../pageState.js';
import type { MessageSender } from '../visitReporter.js';

const BASE = 1_000_000;

describe('ContentKernel — half-init stays fail-closed (S6)', () => {
  it('rejects init without arming any pipeline traffic when settings fail', async () => {
    const failingStorage: StoragePort = {
      get: vi.fn(async () => {
        throw new Error('storage unavailable');
      }),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    } as unknown as StoragePort;
    const scheduler = new FakeScheduler();
    const sender = { sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true })) };
    const kernel = new ContentKernel(failingStorage, new InMemoryDomainPolicyPort(), () => BASE, scheduler, {
      pageState: new PageState(),
      sender: sender as unknown as MessageSender,
      isE2ETest: () => false,
    });
    await expect(kernel.init()).rejects.toThrow();
    // Nothing armed: no deadline timer, no SPA URL anchor for later resets.
    expect(scheduler.pendingCount()).toBe(0);
    expect(kernel.getLastSpaUrl()).toBeNull();
  });
});
