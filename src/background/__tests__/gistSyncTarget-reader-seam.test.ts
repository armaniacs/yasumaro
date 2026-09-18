/**
 * gistSyncTarget-reader-seam.test.ts
 * Pins that GistSyncTarget.sync()/testConnection() honor the injected
 * settings reader and never touch real chrome.storage.
 *
 * WHY: sync()/testConnection() used to `new SettingsRepository()` inline,
 * bypassing the constructor-injected reader (split cache + untestable paths).
 * These tests inject a stub reader and tripwire real storage: any access to
 * ChromeStoragePort throws, so a regression fails instead of silently
 * reading the real store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GistSyncTarget, type GistSettingsStore } from '../syncTargets/gistSyncTarget.js';
import { StorageKeys } from '../../utils/storage/types.js';

vi.mock('../../utils/storage/storagePort.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/storage/storagePort.js')>();
  class TripwirePort extends actual.ChromeStoragePort {
    async get(): Promise<Record<string, unknown>> {
      throw new Error('real chrome.storage touched (get)');
    }
    async set(): Promise<void> {
      throw new Error('real chrome.storage touched (set)');
    }
  }
  return { ...actual, ChromeStoragePort: TripwirePort, ChromeStorageAdapter: TripwirePort };
});

vi.mock('../../utils/logger/types.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));
vi.mock('../../utils/logger/core.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));
vi.mock('../../utils/logger/api.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));

function makeStubReader(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  return {
    store,
    getAll: vi.fn(async () => ({ ...store })),
    getMany: vi.fn(async (keys: readonly string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = store[k];
      return out;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store[key] = value;
    }),
  };
}

function stubSqliteClient() {
  return {
    query: vi.fn(),
    mutate: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    maintain: vi.fn(),
  };
}

function authHeaderOf(callIndex = 0): string | undefined {
  const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return (calls[callIndex]?.[1] as { headers?: Record<string, string> } | undefined)?.headers?.Authorization;
}

const realFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = realFetch;
});

describe('GistSyncTarget injected settings seam', () => {
  it('sync() uses the injected PAT and persists GIST_ID to the injected reader', async () => {
    const reader = makeStubReader({ [StorageKeys.GITHUB_PAT]: 'injected-pat-123' });
    const sqlite = stubSqliteClient();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'new-gist-1' }),
    });

    const target = new GistSyncTarget(sqlite as never, reader as unknown as GistSettingsStore);
    const result = await target.sync(1, 'https://example.com', 'Title', 'Summary');

    expect(result.success).toBe(true);
    expect(authHeaderOf()).toBe('token injected-pat-123');
    expect(reader.set).toHaveBeenCalledWith(StorageKeys.GIST_ID, 'new-gist-1');
    expect(reader.store[StorageKeys.GIST_ID]).toBe('new-gist-1');
    expect(sqlite.mutate).toHaveBeenCalled();
  });

  it('testConnection() uses the injected PAT without touching real storage', async () => {
    const reader = makeStubReader({ [StorageKeys.GITHUB_PAT]: 'injected-pat-456' });
    const sqlite = stubSqliteClient();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const target = new GistSyncTarget(sqlite as never, reader as unknown as GistSettingsStore);
    const result = await target.testConnection();

    expect(result).toEqual({ success: true, message: 'Connected to GitHub successfully' });
    expect(authHeaderOf()).toBe('token injected-pat-456');
    expect(reader.getAll).toHaveBeenCalled();
  });

  it('sync() early-returns without fetch or storage access when the injected reader has no PAT', async () => {
    const reader = makeStubReader({});
    const sqlite = stubSqliteClient();
    const target = new GistSyncTarget(sqlite as never, reader as unknown as GistSettingsStore);

    const result = await target.sync(1, 'https://example.com', 'Title', 'Summary');

    expect(result.success).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(sqlite.mutate).not.toHaveBeenCalled();
  });

  it('testConnection() reports unconfigured without fetch when the injected reader has no PAT', async () => {
    const reader = makeStubReader({});
    const sqlite = stubSqliteClient();
    const target = new GistSyncTarget(sqlite as never, reader as unknown as GistSettingsStore);

    const result = await target.testConnection();

    expect(result).toEqual({ success: false, message: 'GitHub PAT not configured' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
