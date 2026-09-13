// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: {
    getAll: vi.fn(),
    setAll: vi.fn().mockResolvedValue(undefined),
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
const mockedRefresh = vi.mocked(updateDomainFilterCache);

describe('whitelistWriter (PBI 2026-09-12-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSetAll.mockResolvedValue(undefined);
    mockedRefresh.mockResolvedValue(undefined);
  });

  it('validates, dedups, writes through the blob seam, and refreshes the cache', async () => {
    mockedGetAll
      .mockResolvedValueOnce({ [StorageKeys.DOMAIN_WHITELIST]: [] } as never)
      .mockResolvedValueOnce({ [StorageKeys.DOMAIN_WHITELIST]: ['example.com'] } as never);

    const result = await addDomainToWhitelist('example.com');

    expect(result).toEqual({ ok: true, entry: 'example.com', added: true });
    expect(mockedSetAll).toHaveBeenCalledWith(
      expect.objectContaining({ [StorageKeys.DOMAIN_WHITELIST]: ['example.com'] }),
    );
    expect(mockedRefresh).toHaveBeenCalled();
  });

  it('reports added:false without a write when the entry is already present', async () => {
    mockedGetAll.mockResolvedValue({ [StorageKeys.DOMAIN_WHITELIST]: ['example.com'] } as never);

    const result = await addDomainToWhitelist('example.com');

    expect(result).toEqual({ ok: true, entry: 'example.com', added: false });
    expect(mockedSetAll).not.toHaveBeenCalled();
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
    expect(mockedSetAll).not.toHaveBeenCalled();
  });

  it('normalizes path adds to the URL hostname (the only matchable form)', async () => {
    mockedGetAll
      .mockResolvedValueOnce({ [StorageKeys.DOMAIN_WHITELIST]: [] } as never)
      .mockResolvedValueOnce({ [StorageKeys.DOMAIN_WHITELIST]: ['example.com'] } as never);

    const result = await addPathToWhitelist('https://example.com/page?q=1');

    expect(result).toEqual({ ok: true, entry: 'example.com', added: true });
    const written = mockedSetAll.mock.calls[0]?.[0] as Record<string, string[]>;
    // No raw URL, no anchored regex — the hostname is the entry.
    expect(written[StorageKeys.DOMAIN_WHITELIST]).toEqual(['example.com']);
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
    expect(mockedSetAll).not.toHaveBeenCalled();
  });
});
