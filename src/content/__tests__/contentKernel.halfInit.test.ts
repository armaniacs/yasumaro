// @vitest-environment jsdom
/**
 * contentKernel.halfInit.test.ts (review S6)
 * Fail-closed init: a settings-load failure rejects init() with NO
 * periodic timer, NO SPA seam and NO threshold caches armed — the visit
 * pipeline stays silent instead of gating on unloaded thresholds.
 * Recovery is a fresh init() (page reload); no in-page retry loop.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContentKernel } from '../contentKernel.js';
import { FakeScheduler } from './helpers/fakeScheduler.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import { InMemoryStoragePort, type StoragePort } from '../../utils/storage/storagePort.js';
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

describe('ContentKernel — pause subscription rolls back on failed init (No.3)', () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).chrome;
    vi.restoreAllMocks();
  });

  function setPauseChrome(): { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> } {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    (globalThis as unknown as Record<string, unknown>).chrome = {
      storage: {
        local: { get: vi.fn(async () => ({})) },
        onChanged: { addListener, removeListener },
      },
    };
    return { addListener, removeListener };
  }

  function makeKernelWith(storage: StoragePort): ContentKernel {
    const sender = { sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true })) };
    return new ContentKernel(storage, new InMemoryDomainPolicyPort(), () => BASE, new FakeScheduler(), {
      pageState: new PageState(),
      sender: sender as unknown as MessageSender,
      isE2ETest: () => false,
    });
  }

  function makeFailingStorage(): StoragePort {
    return {
      get: vi.fn(async () => {
        throw new Error('storage unavailable');
      }),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    } as unknown as StoragePort;
  }

  it('unsubscribes the pause listener when init rejects', async () => {
    const { addListener, removeListener } = setPauseChrome();
    const kernel = makeKernelWith(makeFailingStorage());
    await expect(kernel.init()).rejects.toThrow();
    // Positive anchor first: the subscription happened, then rolled back.
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener.mock.calls[0]?.[0]).toBe(addListener.mock.calls[0]?.[0]);
  });

  it('keeps the pause listener when init succeeds', async () => {
    const { addListener, removeListener } = setPauseChrome();
    const kernel = makeKernelWith(new InMemoryStoragePort());
    await kernel.init();
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(removeListener).not.toHaveBeenCalled();
  });
});
