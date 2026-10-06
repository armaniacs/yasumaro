/**
 * nn26-manifest-singletons.test.ts — PBI 2026-10-05-26 acceptance.
 * - settingsRepository entry returns the module singleton (container == module)
 * - both queues accept InMemoryAdapter injection without touching chrome.storage
 * - dashboard append path uses the injected obsidian singleton (no per-call new)
 */
import { describe, it, expect, vi } from 'vitest';
import { compositionManifest } from '../compositionManifest.js';
import { ServiceContainer } from '../serviceContainer.js';
import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { InMemoryAdapter } from '../persistentRetryQueue.js';
import {
  createPendingSqliteQueue,
  setQueueForTesting as setSqliteQueueForTesting,
  enqueuePendingRecord,
  flushPendingRecords,
} from '../pendingSqliteQueue.js';
import {
  createOfflineNetworkQueue,
  setQueueForTesting as setOfflineQueueForTesting,
} from '../offlineNetworkQueue.js';
import { createSqliteClientDeps, setObsidianClient } from '../handlers/dashboardSqlite/deps.js';

function manifestEntry(key: string) {
  const entry = compositionManifest.find((e) => e.key === key);
  expect(entry).toBeDefined();
  return entry!;
}

describe('NN26 settingsRepository single instance', () => {
  it('factory returns the module singleton', () => {
    const entry = manifestEntry('settingsRepository');
    expect(entry.factory(new ServiceContainer())).toBe(settingsRepository);
  });

  it('container resolve is the module singleton', () => {
    const entry = manifestEntry('settingsRepository');
    const container = new ServiceContainer();
    container.register('settingsRepository', () => entry.factory(container), {
      singleton: entry.singleton,
    });
    expect(container.resolve('settingsRepository')).toBe(settingsRepository);
  });
});

describe('NN26 queue test injection (no real storage)', () => {
  it('pendingSqliteQueue facade works on an InMemoryAdapter queue', async () => {
    setSqliteQueueForTesting(createPendingSqliteQueue(new InMemoryAdapter()));

    await enqueuePendingRecord({ url: 'https://nn26.example.com', title: 't', created_at: Date.now() });

    const mutate = vi.fn().mockResolvedValue({ success: true, data: { count: 1 } });
    await flushPendingRecords({ mutate } as any);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect((mutate.mock.calls[0]?.[0] as any).records).toHaveLength(1);
  });

  it('pendingSqliteQueue onReady wires the facade to the container instance', async () => {
    const entry = manifestEntry('pendingSqliteQueue');
    expect(typeof entry.onReady).toBe('function');

    const container = new ServiceContainer();
    const memQueue = createPendingSqliteQueue(new InMemoryAdapter());
    container.override('pendingSqliteQueue', memQueue);
    entry.onReady!(container);

    // Facade now delegates to the container instance (InMemory: no chrome use).
    await enqueuePendingRecord({ url: 'https://nn26-wired.example.com', title: 't', created_at: Date.now() });
    const mutate = vi.fn().mockResolvedValue({ success: true, data: { count: 1 } });
    await flushPendingRecords({ mutate } as any);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect((mutate.mock.calls[0]?.[0] as any).records[0].url).toBe('https://nn26-wired.example.com');
  });

  it('offlineNetworkQueue onReady replaces the shared instance', async () => {
    const entry = manifestEntry('offlineNetworkQueue');
    expect(typeof entry.onReady).toBe('function');

    const container = new ServiceContainer();
    const memQueue = createOfflineNetworkQueue(new InMemoryAdapter());
    container.override('offlineNetworkQueue', memQueue);
    entry.onReady!(container);

    const mod = await import('../offlineNetworkQueue.js');
    expect(mod.sharedOfflineNetworkQueue).toBe(memQueue);

    await memQueue.enqueue({ type: 'ai_summary', payload: { url: 'https://nn26.example.com' } });
    expect(await memQueue.getQueueSize()).toBe(1);
  });

  it('setQueueForTesting swaps the shared offline instance without storage', async () => {
    const injected = createOfflineNetworkQueue(new InMemoryAdapter());
    setOfflineQueueForTesting(injected);

    const mod = await import('../offlineNetworkQueue.js');
    expect(mod.sharedOfflineNetworkQueue).toBe(injected);
  });
});

describe('NN26 dashboard append uses injected obsidian singleton', () => {
  it('routes every append through the same injected client', async () => {
    const appendToDailyNote = vi.fn().mockResolvedValue(undefined);
    setObsidianClient({ appendToDailyNote } as any);

    const deps = createSqliteClientDeps({} as any, {} as any);
    await deps.appendToDailyNote('# one');
    await deps.appendToDailyNote('# two');

    expect(appendToDailyNote).toHaveBeenCalledTimes(2);
    expect(appendToDailyNote).toHaveBeenNthCalledWith(1, '# one');
    expect(appendToDailyNote).toHaveBeenNthCalledWith(2, '# two');
  });

  it('dashboardSqliteHandler entry declares obsidian onReady wiring', () => {
    expect(typeof manifestEntry('dashboardSqliteHandler').onReady).toBe('function');
  });
});
