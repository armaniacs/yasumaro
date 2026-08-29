import { describe, it, expect } from 'vitest';
import {
  ChromeDomainPolicyPort,
  InMemoryDomainPolicyPort,
  CACHE_TTL,
} from '../domainPolicyPort.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { StorageKeys } from '../../utils/storage/types.js';

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
