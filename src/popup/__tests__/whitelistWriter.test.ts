// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Deferred promise helper — gates the interleave without real-time waits. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

vi.mock('../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: {
    getAll: vi.fn(),
    setAll: vi.fn().mockResolvedValue(undefined),
    // PBI 2026-10-18-12: the whitelist array is written through the
    // lock-internal updater seam (updateDomainWhitelist), not a prebuilt
    // array patch.
    updateDomainWhitelist: vi.fn().mockResolvedValue({ whitelist: [], changed: true }),
  },
}));

vi.mock('../../utils/storage/domainFilterCache.js', () => ({
  updateDomainFilterCache: vi.fn().mockResolvedValue(undefined),
}));

import {
  addDomainToWhitelist,
  addPathToWhitelist,
} from '../whitelistWriter.js';
import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { updateDomainFilterCache } from '../../utils/storage/domainFilterCache.js';
import { StorageKeys } from '../../utils/storage/types.js';

const mockedGetAll = vi.mocked(settingsRepository.getAll);
const mockedSetAll = vi.mocked(settingsRepository.setAll);
const mockedUpdateWhitelist = vi.mocked(settingsRepository.updateDomainWhitelist);
const mockedRefresh = vi.mocked(updateDomainFilterCache);

describe('whitelistWriter (PBI 2026-09-12-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSetAll.mockResolvedValue(undefined);
    mockedUpdateWhitelist.mockResolvedValue({ whitelist: [], changed: true });
    mockedRefresh.mockResolvedValue(undefined);
  });

  it('validates, dedups, writes through the blob seam, and refreshes the cache', async () => {
    mockedGetAll
      .mockResolvedValueOnce({ [StorageKeys.DOMAIN_WHITELIST]: [] } as never)
      .mockResolvedValueOnce({ [StorageKeys.DOMAIN_WHITELIST]: ['example.com'] } as never);

    const result = await addDomainToWhitelist('example.com');

    expect(result).toEqual({ ok: true, entry: 'example.com', added: true });
    // The write goes through the lock-internal updater seam; the updater
    // appends the normalized entry to the CURRENT whitelist it receives.
    expect(mockedUpdateWhitelist).toHaveBeenCalledTimes(1);
    const updater = mockedUpdateWhitelist.mock.calls[0]?.[0];
    expect(typeof updater).toBe('function');
    expect(updater?.(['kept.example'])).toEqual(['kept.example', 'example.com']);
    expect(mockedSetAll).not.toHaveBeenCalled();
    expect(mockedRefresh).toHaveBeenCalled();
  });

  it('reports added:false without a write when the entry is already present', async () => {
    mockedGetAll.mockResolvedValue({ [StorageKeys.DOMAIN_WHITELIST]: ['example.com'] } as never);

    const result = await addDomainToWhitelist('example.com');

    expect(result).toEqual({ ok: true, entry: 'example.com', added: false });
    expect(mockedUpdateWhitelist).not.toHaveBeenCalled();
    expect(mockedSetAll).not.toHaveBeenCalled();
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('reports added:false when the lock-time read already holds the entry', async () => {
    mockedGetAll.mockResolvedValue({ [StorageKeys.DOMAIN_WHITELIST]: [] } as never);
    mockedUpdateWhitelist.mockResolvedValue({ whitelist: ['example.com'], changed: false });

    const result = await addDomainToWhitelist('example.com');

    expect(result).toEqual({ ok: true, entry: 'example.com', added: false });
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('rejects invalid patterns without touching storage (dashboard parity)', async () => {
    // A raw URL is not a hostname pattern — exactly what the popup paths
    // used to write unvalidated, poisoning the dashboard evaluation.
    const result = await addDomainToWhitelist('https://example.com/page');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-pattern');
    }
    expect(mockedUpdateWhitelist).not.toHaveBeenCalled();
    expect(mockedSetAll).not.toHaveBeenCalled();
  });

  it('normalizes path adds to the URL hostname (the only matchable form)', async () => {
    mockedGetAll
      .mockResolvedValueOnce({ [StorageKeys.DOMAIN_WHITELIST]: [] } as never)
      .mockResolvedValueOnce({ [StorageKeys.DOMAIN_WHITELIST]: ['example.com'] } as never);

    const result = await addPathToWhitelist('https://example.com/page?q=1');

    expect(result).toEqual({ ok: true, entry: 'example.com', added: true });
    const updater = mockedUpdateWhitelist.mock.calls[0]?.[0];
    expect(typeof updater).toBe('function');
    // No raw URL, no anchored regex — the hostname is the entry.
    expect(updater?.([])).toEqual(['example.com']);
  });

  it('strips the www. prefix from path adds', async () => {
    mockedGetAll
      .mockResolvedValueOnce({ [StorageKeys.DOMAIN_WHITELIST]: [] } as never)
      .mockResolvedValueOnce({ [StorageKeys.DOMAIN_WHITELIST]: ['example.com'] } as never);

    const result = await addPathToWhitelist('https://www.example.com/page');

    expect(result).toEqual({ ok: true, entry: 'example.com', added: true });
  });

  it('returns no-domain for unparseable URLs', async () => {
    const result = await addPathToWhitelist('not-a-url');

    expect(result).toEqual({ ok: false, reason: 'no-domain' });
    expect(mockedUpdateWhitelist).not.toHaveBeenCalled();
    expect(mockedSetAll).not.toHaveBeenCalled();
  });
});

describe('whitelistWriter — concurrent adds (PBI 2026-10-18-12, Scenario 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRefresh.mockResolvedValue(undefined);
  });

  it('keeps both entries when two adds interleave at the updater seam', async () => {
    // Simulate the lock-internal read: writer A holds a stale (empty) base
    // while writer B commits, then the CAS retry re-runs A's updater on the
    // fresh base — exactly what updateDomainWhitelist does for real.
    let stored: string[] = [];
    let calls = 0;
    const firstInside = deferred();
    const releaseFirst = deferred();
    mockedUpdateWhitelist.mockImplementation(async (updater) => {
      calls += 1;
      if (calls === 1) {
        firstInside.resolve();
        await releaseFirst.promise;
        // CAS retry: the updater re-runs on what writer B stored.
        stored = updater(stored);
        return { whitelist: stored, changed: true };
      }
      stored = updater(stored);
      return { whitelist: stored, changed: true };
    });

    const first = addDomainToWhitelist('one.example');
    await firstInside.promise;
    const second = addDomainToWhitelist('two.example');
    await second;
    releaseFirst.resolve();
    await first;

    expect(stored).toEqual(['two.example', 'one.example']);
    expect(mockedRefresh).toHaveBeenCalled();
  });

  it('does not duplicate an entry the updater already holds (idempotent updater)', async () => {
    let stored: string[] = ['existing.example'];
    mockedUpdateWhitelist.mockImplementation(async (updater) => {
      const next = updater(stored);
      stored = next;
      return { whitelist: next, changed: true };
    });

    await addDomainToWhitelist('new.example');
    expect(stored).toEqual(['existing.example', 'new.example']);

    await addDomainToWhitelist('new.example');
    expect(stored).toEqual(['existing.example', 'new.example']);
  });
});
