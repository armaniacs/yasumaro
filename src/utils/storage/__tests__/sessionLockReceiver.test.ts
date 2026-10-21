/**
 * sessionLockReceiver.test.ts
 * Receiver-side pins for the SESSION_LOCK_REQUEST fan-out (PBI 2026-10-21-12):
 * - handleSessionLockRequest: the lock state transition through the seam
 * - subscribeSessionLockRequest: listener wiring + the response-body contract
 * - integration: SessionAlarmService (fake ports) x receiver over an
 *   in-memory wire, observing the lock reflection the sender confirms.
 * chrome global mock なしに自動ロックの受け手を単体テストする。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleSessionLockRequest,
  isSessionLockRequestMessage,
  subscribeSessionLockRequest,
} from '../sessionLockReceiver.js';
import type { SessionLockReceiverDeps } from '../sessionLockReceiver.js';
import { SessionAlarmService } from '../../../background/SessionAlarmService.js';
import type { Clock, StoragePort, StorageArea, AlarmPort } from '../../../ports.js';
import { StorageKeys } from '../types.js';

// The unconfirmed-delivery failure log is the observable sender contract of
// the parent PBI; wrap the real logger in spies so the integration tests can
// assert on it without changing logger behavior.
vi.mock('../../logger/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../logger/api.js')>();
  return {
    ...actual,
    logInfo: vi.fn(actual.logInfo),
    logWarn: vi.fn(actual.logWarn),
    logError: vi.fn(actual.logError),
  };
});

type ReceiverListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

interface MockRuntime {
  listeners: Set<ReceiverListener>;
  extensionId: string;
  /** The cross-context wire: routes a send to the registered page listeners. */
  send: (message: unknown) => Promise<unknown>;
}

function installMockRuntime(): MockRuntime {
  const listeners = new Set<ReceiverListener>();
  const extensionId = 'test-extension-id';
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: extensionId,
      onMessage: {
        addListener: (fn: ReceiverListener) => listeners.add(fn),
        removeListener: (fn: ReceiverListener) => listeners.delete(fn),
      },
    },
    // The logger's lazy default wiring degrades to a no-op without alarms;
    // a storage area keeps its buffered writes quiet.
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
    },
  };
  return {
    listeners,
    extensionId,
    // Models cross-context delivery: the sender's promise resolves with the
    // receiver's sendResponse body. The sender itself registers no listener
    // here, so this is not the self-delivery the platform forbids.
    send: (message: unknown) =>
      new Promise((resolve) => {
        for (const listener of Array.from(listeners)) {
          const result = listener(
            message,
            { id: extensionId } as chrome.runtime.MessageSender,
            (response: unknown) => resolve(response),
          );
          // A listener that declines the message never answers: settle
          // undefined instead of hanging, like a receiver-less fan-out.
          if (result !== true) {
            resolve(undefined);
            break;
          }
        }
      }),
  };
}

function uninstallMockRuntime(): void {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
}

describe('isSessionLockRequestMessage', () => {
  it('accepts the bare envelope and the wire shape the sender sends', () => {
    expect(isSessionLockRequestMessage({ type: 'SESSION_LOCK_REQUEST' })).toBe(true);
    expect(isSessionLockRequestMessage({ type: 'SESSION_LOCK_REQUEST', protocolVersion: 1 })).toBe(true);
  });

  it('rejects other types and non-object messages', () => {
    expect(isSessionLockRequestMessage({ type: 'ACTIVITY_UPDATE' })).toBe(false);
    expect(isSessionLockRequestMessage({})).toBe(false);
    expect(isSessionLockRequestMessage(null)).toBe(false);
    expect(isSessionLockRequestMessage(undefined)).toBe(false);
    expect(isSessionLockRequestMessage('SESSION_LOCK_REQUEST')).toBe(false);
    expect(isSessionLockRequestMessage(42)).toBe(false);
  });
});

describe('handleSessionLockRequest (seam handler: lock state transition)', () => {
  it('transitions to locked: drops the key cache and fires the UI transition', async () => {
    const clearKeyCache = vi.fn();
    const onLocked = vi.fn();
    const handled = await handleSessionLockRequest(
      { type: 'SESSION_LOCK_REQUEST' },
      { isLocked: async () => true, clearKeyCache, onLocked },
    );

    expect(handled).toBe(true);
    expect(clearKeyCache).toHaveBeenCalledTimes(1);
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  it('stays unlocked: no cache drop and no UI transition', async () => {
    const clearKeyCache = vi.fn();
    const onLocked = vi.fn();
    const handled = await handleSessionLockRequest(
      { type: 'SESSION_LOCK_REQUEST' },
      { isLocked: async () => false, clearKeyCache, onLocked },
    );

    expect(handled).toBe(true);
    expect(clearKeyCache).not.toHaveBeenCalled();
    expect(onLocked).not.toHaveBeenCalled();
  });

  it('handles a context with no lock UI (no onLocked wired)', async () => {
    const clearKeyCache = vi.fn();
    const handled = await handleSessionLockRequest(
      { type: 'SESSION_LOCK_REQUEST' },
      { isLocked: async () => true, clearKeyCache },
    );

    expect(handled).toBe(true);
    expect(clearKeyCache).toHaveBeenCalledTimes(1);
  });

  it('ignores a message of another type without touching the lock state', async () => {
    const isLocked = vi.fn(async () => true);
    const clearKeyCache = vi.fn();
    const handled = await handleSessionLockRequest(
      { type: 'ACTIVITY_UPDATE' },
      { isLocked, clearKeyCache },
    );

    expect(handled).toBe(false);
    expect(isLocked).not.toHaveBeenCalled();
    expect(clearKeyCache).not.toHaveBeenCalled();
  });

  it('ignores a non-object message without touching the lock state', async () => {
    const isLocked = vi.fn(async () => true);
    const clearKeyCache = vi.fn();
    for (const message of [null, undefined, 'SESSION_LOCK_REQUEST', 42]) {
      const handled = await handleSessionLockRequest(message, { isLocked, clearKeyCache });
      expect(handled).toBe(false);
    }

    expect(isLocked).not.toHaveBeenCalled();
    expect(clearKeyCache).not.toHaveBeenCalled();
  });
});

describe('subscribeSessionLockRequest (wiring + response-body contract)', () => {
  let runtime: MockRuntime;

  beforeEach(() => {
    runtime = installMockRuntime();
  });

  afterEach(() => {
    uninstallMockRuntime();
  });

  it('registers one listener and removes it on dispose (no leaked listener)', () => {
    expect(runtime.listeners.size).toBe(0);
    const dispose = subscribeSessionLockRequest({ isLocked: async () => false, clearKeyCache: vi.fn() });
    expect(runtime.listeners.size).toBe(1);

    dispose();
    expect(runtime.listeners.size).toBe(0);
  });

  it('confirms delivery with the response body after a locked re-read', async () => {
    const clearKeyCache = vi.fn();
    const onLocked = vi.fn();
    subscribeSessionLockRequest({ isLocked: async () => true, clearKeyCache, onLocked });

    const response = await runtime.send({ type: 'SESSION_LOCK_REQUEST', protocolVersion: 1 });

    expect(response).toEqual({ success: true });
    expect(clearKeyCache).toHaveBeenCalledTimes(1);
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  it('answers the confirming body without a lock transition when the re-read is unlocked', async () => {
    const clearKeyCache = vi.fn();
    const onLocked = vi.fn();
    subscribeSessionLockRequest({ isLocked: async () => false, clearKeyCache, onLocked });

    const response = await runtime.send({ type: 'SESSION_LOCK_REQUEST' });

    expect(response).toEqual({ success: true });
    expect(clearKeyCache).not.toHaveBeenCalled();
    expect(onLocked).not.toHaveBeenCalled();
  });

  it('answers the failure body when the re-read rejects (sender retries)', async () => {
    const clearKeyCache = vi.fn();
    subscribeSessionLockRequest({
      isLocked: async () => {
        throw new Error('storage read failed');
      },
      clearKeyCache,
    });

    const response = await runtime.send({ type: 'SESSION_LOCK_REQUEST' });

    expect(response).toEqual({ success: false });
    expect(clearKeyCache).not.toHaveBeenCalled();
  });

  it('ignores a forged sender (different extension id) and answers nothing', () => {
    const isLocked = vi.fn(async () => true);
    const sendResponse = vi.fn();
    const dispose = subscribeSessionLockRequest({ isLocked, clearKeyCache: vi.fn() });

    const listener = Array.from(runtime.listeners)[0];
    listener?.(
      { type: 'SESSION_LOCK_REQUEST' },
      { id: 'some-other-extension' } as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).not.toHaveBeenCalled();
    expect(isLocked).not.toHaveBeenCalled();
    dispose();
  });

  it('ignores a message of another type and answers nothing', () => {
    const sendResponse = vi.fn();
    const dispose = subscribeSessionLockRequest({ isLocked: async () => true, clearKeyCache: vi.fn() });

    const listener = Array.from(runtime.listeners)[0];
    listener?.(
      { type: 'ACTIVITY_UPDATE' },
      { id: runtime.extensionId } as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).not.toHaveBeenCalled();
    dispose();
  });
});

class InMemoryStorageArea implements StorageArea {
  private data = new Map<string, unknown>();

  async get<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>> {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (this.data.has(key)) {
        result[key] = this.data.get(key);
      }
    }
    return result as Partial<T>;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.data.set(key, value);
    }
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.data.delete(key);
    }
  }
}

function createStoragePort(): StoragePort {
  return { local: new InMemoryStorageArea(), session: new InMemoryStorageArea() };
}

class FakeClock implements Clock {
  constructor(private time: number) {}
  now(): number {
    return this.time;
  }
  advance(ms: number): void {
    this.time += ms;
  }
}

function createAlarmPortStub(): AlarmPort {
  return {
    create: async () => undefined,
    clear: async () => undefined,
    onAlarm: () => undefined,
  };
}

describe('integration: SessionAlarmService fan-out x receiver over the in-memory wire', () => {
  let runtime: MockRuntime;

  beforeEach(() => {
    runtime = installMockRuntime();
  });

  afterEach(() => {
    uninstallMockRuntime();
  });

  it('locks, the receiver drops its key cache, and the sender confirms on the first attempt', async () => {
    // Fixture (parent PBI): in-memory storage shared by the SW-side sender
    // and the page-side receiver, so the re-read observes the same IS_LOCKED
    // write lockSession() persisted before the fan-out.
    const storage = createStoragePort();
    await storage.local.set({
      [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
      session_last_activity: 1_000_000,
    });
    const clearKeyCache = vi.fn();
    subscribeSessionLockRequest({
      isLocked: async () => {
        const status = await storage.local.get<Record<string, boolean>>([
          StorageKeys.MASTER_PASSWORD_ENABLED,
          StorageKeys.IS_LOCKED,
        ]);
        return Boolean(status[StorageKeys.MASTER_PASSWORD_ENABLED] && status[StorageKeys.IS_LOCKED]);
      },
      clearKeyCache,
    });

    const clock = new FakeClock(1_000_000);
    clock.advance(31 * 60 * 1000);
    const sendMessage = vi.fn((message: unknown) => runtime.send(message));
    const stepDelay = vi.fn(async () => {});
    const service = new SessionAlarmService(
      createAlarmPortStub(),
      clock,
      storage,
      sendMessage,
      stepDelay,
    );

    await service.checkTimeout();

    // The receiver applied the lock: the key cache is dropped and the UI
    // transition fires through the same re-read that confirmed delivery.
    expect(clearKeyCache).toHaveBeenCalledTimes(1);
    // The sender confirmed on the first attempt: one send, no retry wait,
    // and no never-confirmed failure log.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(stepDelay).not.toHaveBeenCalled();
    const { logError } = await import('../../logger/api.js');
    expect(logError).not.toHaveBeenCalled();
  });

  it('keeps the 3-attempt / 2-wait retry semantics when the receiver keeps answering failure', async () => {
    const storage = createStoragePort();
    await storage.local.set({
      [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
      session_last_activity: 1_000_000,
    });
    subscribeSessionLockRequest({
      isLocked: async () => {
        throw new Error('storage read failed');
      },
      clearKeyCache: vi.fn(),
    });

    const clock = new FakeClock(1_000_000);
    clock.advance(31 * 60 * 1000);
    const sendMessage = vi.fn((message: unknown) => runtime.send(message));
    const stepDelay = vi.fn(async () => {});
    const service = new SessionAlarmService(
      createAlarmPortStub(),
      clock,
      storage,
      sendMessage,
      stepDelay,
    );

    await service.checkTimeout();

    // A failing receiver answers { success: false }, so the parent PBI's
    // retry contract (3 attempts, 2 waits, never-confirmed log) decides.
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(stepDelay).toHaveBeenCalledTimes(2);
    const { logError } = await import('../../logger/api.js');
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('never confirmed'),
      expect.objectContaining({ confirmed: false }),
      expect.any(String),
      expect.any(String),
    );
  });
});
