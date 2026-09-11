import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ChromeDomainPolicyPort,
  CACHE_TTL,
} from '../domainPolicyPort.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { StorageKeys } from '../../utils/storage/types.js';

// Hoisted mock: the SW-parity tests swap the settings the background
// isDomainAllowed reads via the SettingsRepository seam.
const getAll = vi.fn();
vi.mock('../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: { getAll: (...args: unknown[]) => getAll(...args) },
}));

describe('ChromeDomainPolicyPort', () => {
  const now = 1_700_000_000_000;

  it('shouldSkip returns true for internal schemes', () => {
    const port = new ChromeDomainPolicyPort(new InMemoryStoragePort(), () => now);
    expect(port.shouldSkip('chrome-extension://abc/popup.html')).toBe(true);
    expect(port.shouldSkip('about:blank')).toBe(true);
  });

  it('shouldSkip returns false for http/https', () => {
    const port = new ChromeDomainPolicyPort(new InMemoryStoragePort(), () => now);
    expect(port.shouldSkip('https://example.com')).toBe(false);
  });

  it('returns allowed=false when URL has no domain', async () => {
    const port = new ChromeDomainPolicyPort(new InMemoryStoragePort(), () => now);
    const result = await port.checkDomainAllowedFromCache('');
    expect(result).toEqual({ allowed: false, useCache: true });
  });

  it('returns useCache=false when cache is expired', async () => {
    const storage = new InMemoryStoragePort();
    storage.seed({
      [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now - CACHE_TTL - 1,
      [StorageKeys.DOMAIN_FILTER_MODE]: 'whitelist',
    });
    const port = new ChromeDomainPolicyPort(storage, () => now);
    const result = await port.checkDomainAllowedFromCache('https://example.com');
    expect(result).toEqual({ allowed: false, useCache: false });
  });

  it('returns allowed=true when mode is disabled', async () => {
    const storage = new InMemoryStoragePort();
    storage.seed({
      [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
      [StorageKeys.DOMAIN_FILTER_MODE]: 'disabled',
    });
    const port = new ChromeDomainPolicyPort(storage, () => now);
    const result = await port.checkDomainAllowedFromCache('https://example.com');
    expect(result).toEqual({ allowed: true, useCache: true });
  });

  it('allows whitelisted domains and blocks others', async () => {
    const storage = new InMemoryStoragePort();
    storage.seed({
      [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
      [StorageKeys.DOMAIN_FILTER_MODE]: 'whitelist',
      [StorageKeys.DOMAIN_FILTER_CACHE]: ['example.com'],
    });
    const port = new ChromeDomainPolicyPort(storage, () => now);
    expect(await port.checkDomainAllowedFromCache('https://example.com/page')).toEqual({
      allowed: true,
      useCache: true,
    });
    expect(await port.checkDomainAllowedFromCache('https://other.com/page')).toEqual({
      allowed: false,
      useCache: true,
    });
  });

  it('blacklist mode with ublock enabled returns useCache=false', async () => {
    const storage = new InMemoryStoragePort();
    storage.seed({
      [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
      [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
      [StorageKeys.UBLOCK_FORMAT_ENABLED]: true,
    });
    const port = new ChromeDomainPolicyPort(storage, () => now);
    const result = await port.checkDomainAllowedFromCache('https://example.com');
    expect(result).toEqual({ allowed: false, useCache: false });
  });

  it('blacklist mode with simple enabled blocks listed domains', async () => {
    const storage = new InMemoryStoragePort();
    storage.seed({
      [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
      [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
      [StorageKeys.SIMPLE_FORMAT_ENABLED]: true,
      [StorageKeys.DOMAIN_BLACKLIST]: ['blocked.com'],
    });
    const port = new ChromeDomainPolicyPort(storage, () => now);
    expect(await port.checkDomainAllowedFromCache('https://blocked.com/page')).toEqual({
      allowed: false,
      useCache: true,
    });
    expect(await port.checkDomainAllowedFromCache('https://allowed.com/page')).toEqual({
      allowed: true,
      useCache: true,
    });
  });

  it('blacklist mode with simple disabled allows everything', async () => {
    const storage = new InMemoryStoragePort();
    storage.seed({
      [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
      [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
      [StorageKeys.SIMPLE_FORMAT_ENABLED]: false,
      [StorageKeys.UBLOCK_FORMAT_ENABLED]: false,
      [StorageKeys.DOMAIN_BLACKLIST]: ['blocked.com'],
    });
    const port = new ChromeDomainPolicyPort(storage, () => now);
    const result = await port.checkDomainAllowedFromCache('https://blocked.com/page');
    expect(result).toEqual({ allowed: true, useCache: true });
  });
});

describe('InMemoryDomainPolicyPort', () => {
  const now = 1_700_000_000_000;

  it('covers all cache branches with in-memory store', async () => {
    const port = new InMemoryDomainPolicyPort({}, () => now);
    // no domain
    expect(await port.checkDomainAllowedFromCache('')).toEqual({ allowed: false, useCache: true });
  });

  it('seed and whitelist branch', async () => {
    const port = new InMemoryDomainPolicyPort({}, () => now);
    port.seed({
      [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
      [StorageKeys.DOMAIN_FILTER_MODE]: 'whitelist',
      [StorageKeys.DOMAIN_FILTER_CACHE]: ['allowed.com'],
    });
    expect(await port.checkDomainAllowedFromCache('https://allowed.com')).toEqual({
      allowed: true,
      useCache: true,
    });
    expect(await port.checkDomainAllowedFromCache('https://denied.com')).toEqual({
      allowed: false,
      useCache: true,
    });
  });

  it('blacklist ublock branch', async () => {
    const port = new InMemoryDomainPolicyPort({}, () => now);
    port.seed({
      [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
      [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
      [StorageKeys.UBLOCK_FORMAT_ENABLED]: true,
    });
    expect(await port.checkDomainAllowedFromCache('https://example.com')).toEqual({
      allowed: false,
      useCache: false,
    });
  });

  it('blacklist simple branch', async () => {
    const port = new InMemoryDomainPolicyPort({}, () => now);
    port.seed({
      [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
      [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
      [StorageKeys.SIMPLE_FORMAT_ENABLED]: true,
      [StorageKeys.DOMAIN_BLACKLIST]: ['bad.com'],
    });
    expect(await port.checkDomainAllowedFromCache('https://bad.com')).toEqual({
      allowed: false,
      useCache: true,
    });
    expect(await port.checkDomainAllowedFromCache('https://good.com')).toEqual({
      allowed: true,
      useCache: true,
    });
  });

  it('disabled mode branch', async () => {
    const port = new InMemoryDomainPolicyPort({}, () => now);
    port.seed({
      [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
      [StorageKeys.DOMAIN_FILTER_MODE]: 'disabled',
    });
    expect(await port.checkDomainAllowedFromCache('https://anything.com')).toEqual({
      allowed: true,
      useCache: true,
    });
  });

  it('expired cache branch', async () => {
    const port = new InMemoryDomainPolicyPort({}, () => now);
    port.seed({
      [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now - CACHE_TTL - 1,
      [StorageKeys.DOMAIN_FILTER_MODE]: 'whitelist',
    });
    expect(await port.checkDomainAllowedFromCache('https://example.com')).toEqual({
      allowed: false,
      useCache: false,
    });
  });
});

describe('content path vs service-worker verdict parity (PBI 2026-09-12-03)', () => {
  const now = 1_700_000_000_000;

  beforeEach(() => {
    getAll.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Matrix row: [url, mode, list, matchSubdomains, expected allowed]. */
  const matrix: Array<{ url: string; mode: string; entry: string; subdomains: boolean }> = [
    { url: 'https://sub.example.com', mode: 'whitelist', entry: 'example.com', subdomains: true },
    { url: 'https://sub.example.com', mode: 'whitelist', entry: 'example.com', subdomains: false },
    { url: 'https://example.com', mode: 'whitelist', entry: 'example.com', subdomains: false },
    { url: 'https://sub.blocked.com', mode: 'blacklist', entry: 'blocked.com', subdomains: true },
    { url: 'https://sub.blocked.com', mode: 'blacklist', entry: 'blocked.com', subdomains: false },
  ];

  for (const row of matrix) {
    it(`agrees on ${row.url} (mode=${row.mode}, matchSubdomains=${row.subdomains})`, async () => {
      const { isDomainAllowed } = await import('../../utils/domainUtils.js');
      const listKey = row.mode === 'whitelist'
        ? StorageKeys.DOMAIN_WHITELIST
        : StorageKeys.DOMAIN_BLACKLIST;
      getAll.mockResolvedValue({
        [StorageKeys.DOMAIN_FILTER_MODE]: row.mode,
        [listKey]: [row.entry],
        [StorageKeys.DOMAIN_SUBDOMAIN_MATCHING]: row.subdomains,
        [StorageKeys.SIMPLE_FORMAT_ENABLED]: true,
        [StorageKeys.UBLOCK_FORMAT_ENABLED]: false,
      });

      const storage = new InMemoryStoragePort();
      storage.seed({
        [StorageKeys.DOMAIN_FILTER_MODE]: row.mode,
        [StorageKeys.DOMAIN_FILTER_CACHE]: [row.entry],
        [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
        [StorageKeys.DOMAIN_BLACKLIST]: row.mode === 'blacklist' ? [row.entry] : [],
        [StorageKeys.SIMPLE_FORMAT_ENABLED]: true,
        [StorageKeys.UBLOCK_FORMAT_ENABLED]: false,
        [StorageKeys.DOMAIN_SUBDOMAIN_MATCHING]: row.subdomains,
      });
      const port = new ChromeDomainPolicyPort(storage, () => now);
      const contentVerdict = await port.checkDomainAllowedFromCache(row.url);

      const swVerdict = await isDomainAllowed(row.url);
      expect(contentVerdict.allowed).toBe(swVerdict);
    });
  }
});
