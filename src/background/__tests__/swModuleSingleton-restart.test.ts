/**
 * swModuleSingleton-restart.test.ts
 * PBI 2026-11-08-01 pin: gateway/queue singletons must come from the
 * composition root as one shared instance (no double generation), with the
 * module lazy default narrowed to the standalone/test fallback.
 *
 * - OffscreenGateway gains an explicit injection seam (setSharedSqliteClient):
 *   production owns the instance through the composition root sqliteClient
 *   entry, tests inject a fake, and a restart drops the reference.
 * - pendingWriteQueue pins that the manifest onReady wiring makes the module
 *   facade delegate to the container instance (InMemory: no chrome use).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compositionManifest } from '../compositionManifest.js';
import { ServiceContainer } from '../serviceContainer.js';
import { InMemoryAdapter } from '../persistentRetryQueue.js';
import {
  createPendingWriteQueue,
  enqueuePendingWrite,
  flushPendingWrites,
} from '../pendingChromeStorageQueue.js';
import type { SqliteClient } from '../sqlite/offscreenGateway.js';

async function freshGatewayModule() {
  vi.resetModules();
  return import('../sqlite/offscreenGateway.js');
}

describe('shared SqliteClient injection (PBI 2026-11-08-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the injected instance instead of lazily generating a second one', async () => {
    const mod = await freshGatewayModule();
    const fake = {} as SqliteClient;
    mod.setSharedSqliteClient(fake);
    expect(mod.getSharedSqliteClient()).toBe(fake);
    // No second generation on repeat access.
    expect(mod.getSharedSqliteClient()).toBe(fake);
  });

  it('drops the reference on SW restart and rebuilds lazily afterwards', async () => {
    const first = await freshGatewayModule();
    const fake = {} as SqliteClient;
    first.setSharedSqliteClient(fake);
    expect(first.getSharedSqliteClient()).toBe(fake);

    // Simulate the SW teardown: the injected reference must not leak across.
    const second = await freshGatewayModule();
    const rebuilt = second.getSharedSqliteClient();
    expect(rebuilt).not.toBe(fake);
    // The lazy default is still a singleton within the new lifetime.
    expect(second.getSharedSqliteClient()).toBe(rebuilt);
  });

  it('clears the injected instance on demand for test isolation', async () => {
    const mod = await freshGatewayModule();
    mod.setSharedSqliteClient({} as SqliteClient);
    mod.__resetSharedSqliteClientForTesting();
    const rebuilt = mod.getSharedSqliteClient();
    expect(rebuilt).not.toBeNull();
    expect(mod.getSharedSqliteClient()).toBe(rebuilt);
  });
});

describe('pendingWriteQueue composition-root wiring (PBI 2026-11-08-01)', () => {
  it('onReady makes the facade delegate to the container instance', async () => {
    const entry = compositionManifest.find((e) => e.key === 'pendingWriteQueue');
    expect(entry).toBeDefined();
    expect(typeof entry!.onReady).toBe('function');

    const container = new ServiceContainer();
    const memQueue = createPendingWriteQueue(new InMemoryAdapter());
    container.override('pendingWriteQueue', memQueue);
    entry!.onReady!(container);

    // The facade now delegates to the container instance (InMemory: no chrome use).
    await enqueuePendingWrite({ key: 'wired-key', value: { n: 1 } });
    const retryFn = vi.fn(async () => true);
    await flushPendingWrites(retryFn);
    expect(retryFn).toHaveBeenCalledTimes(1);
    expect(retryFn).toHaveBeenCalledWith(expect.objectContaining({ key: 'wired-key' }));
  });
});
