import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DomainFilter, DomainFilterCacheAdapter } from '../domainFilter/DomainFilter.js';

// PBI 04 — domain-filter mode inversion fix
// Verifies that isAllowedCached and CacheAdapter correctly invert list check
// depending on mode (whitelist = in-list, blacklist = !in-list).

const FIXED_NOW = 1_700_000_000_000;
const TTL = 5000;

function makeCached(
  allowedDomains: string[],
  cachedAt: number,
  mode?: string,
): { allowedDomains: string[]; cachedAt: number; mode?: string } {
  return mode === undefined ? { allowedDomains, cachedAt } : { allowedDomains, cachedAt, mode };
}

describe('DomainFilter mode inversion (PBI 04)', () => {
  let filter: DomainFilter;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    filter = new DomainFilter({ ttlMs: TTL });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Allowlist mode: listed -> true, unlisted -> false, wildcard -> true
  // -------------------------------------------------------------------------
  describe('Allowlist mode — isAllowedCached', () => {
    it('listed domain returns allowed: true', async () => {
      const cached = makeCached(['example.com', 'allowed.org'], FIXED_NOW, 'whitelist');
      expect(await filter.isAllowedCached('https://example.com/page', cached, 'whitelist')).toBe(true);
      expect(await filter.isAllowedCached('https://allowed.org/', cached, 'whitelist')).toBe(true);
    });

    it('unlisted domain returns allowed: false', async () => {
      const cached = makeCached(['example.com'], FIXED_NOW, 'whitelist');
      expect(await filter.isAllowedCached('https://other.com/page', cached, 'whitelist')).toBe(false);
    });

    it('wildcard match returns true', async () => {
      const cached = makeCached(['*.example.com'], FIXED_NOW, 'whitelist');
      expect(await filter.isAllowedCached('https://sub.example.com/page', cached, 'whitelist')).toBe(true);
      expect(await filter.isAllowedCached('https://deep.sub.example.com/page', cached, 'whitelist')).toBe(true);
      // apex should NOT match *.example.com (requires sub)
      expect(await filter.isAllowedCached('https://example.com/page', cached, 'whitelist')).toBe(false);
    });

    it('uses cached.mode when mode param is omitted', async () => {
      const cached = makeCached(['example.com'], FIXED_NOW, 'whitelist');
      expect(await filter.isAllowedCached('https://example.com/page', cached)).toBe(true);
      expect(await filter.isAllowedCached('https://other.com/page', cached)).toBe(false);
    });

    it('is case-insensitive', async () => {
      const cached = makeCached(['Example.COM'], FIXED_NOW, 'whitelist');
      expect(await filter.isAllowedCached('https://example.com/', cached, 'whitelist')).toBe(true);
      expect(await filter.isAllowedCached('https://EXAMPLE.COM/', cached, 'whitelist')).toBe(true);
    });

    it('strips www. prefix', async () => {
      const cached = makeCached(['example.com'], FIXED_NOW, 'whitelist');
      expect(await filter.isAllowedCached('https://www.example.com/page', cached, 'whitelist')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Blacklist mode: listed -> false, unlisted -> true, wildcard listed -> false
  // -------------------------------------------------------------------------
  describe('Blacklist mode — isAllowedCached', () => {
    it('listed domain returns allowed: false', async () => {
      const cached = makeCached(['blocked.com', 'evil.org'], FIXED_NOW, 'blacklist');
      expect(await filter.isAllowedCached('https://blocked.com/page', cached, 'blacklist')).toBe(false);
      expect(await filter.isAllowedCached('https://evil.org/', cached, 'blacklist')).toBe(false);
    });

    it('unlisted domain returns allowed: true', async () => {
      const cached = makeCached(['blocked.com'], FIXED_NOW, 'blacklist');
      expect(await filter.isAllowedCached('https://allowed.com/page', cached, 'blacklist')).toBe(true);
      expect(await filter.isAllowedCached('https://other.org/', cached, 'blacklist')).toBe(true);
    });

    it('wildcard listed returns false, unlisted returns true', async () => {
      const cached = makeCached(['*.blocked.com'], FIXED_NOW, 'blacklist');
      expect(await filter.isAllowedCached('https://sub.blocked.com/page', cached, 'blacklist')).toBe(false);
      expect(await filter.isAllowedCached('https://deep.sub.blocked.com/page', cached, 'blacklist')).toBe(false);
      expect(await filter.isAllowedCached('https://allowed.com/page', cached, 'blacklist')).toBe(true);
      // apex not matched by *.blocked.com so allowed
      expect(await filter.isAllowedCached('https://blocked.com/page', cached, 'blacklist')).toBe(true);
    });

    it('uses cached.mode when mode param is omitted', async () => {
      const cached = makeCached(['blocked.com'], FIXED_NOW, 'blacklist');
      expect(await filter.isAllowedCached('https://blocked.com/page', cached)).toBe(false);
      expect(await filter.isAllowedCached('https://allowed.com/page', cached)).toBe(true);
    });

    it('explicit mode param overrides cached.mode', async () => {
      // cached says whitelist but explicit param says blacklist -> should invert
      const cached = makeCached(['example.com'], FIXED_NOW, 'whitelist');
      expect(await filter.isAllowedCached('https://example.com/page', cached, 'blacklist')).toBe(false);
      expect(await filter.isAllowedCached('https://other.com/page', cached, 'blacklist')).toBe(true);
    });

    it('strips www. prefix for blacklist', async () => {
      const cached = makeCached(['blocked.com'], FIXED_NOW, 'blacklist');
      expect(await filter.isAllowedCached('https://www.blocked.com/page', cached, 'blacklist')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Cache hit preserves mode: in blacklist mode, cache hit for blacklisted domain returns false
  // -------------------------------------------------------------------------
  describe('Cache hit preserves mode', () => {
    it('blacklist cache hit for blacklisted domain returns false (not true)', async () => {
      const cached = makeCached(['blocked.com'], FIXED_NOW, 'blacklist');
      // If mode inversion were broken, this would return true (isDomainInList)
      // Correct is !isDomainInList => false
      const result = await filter.isAllowedCached('https://blocked.com/page', cached, 'blacklist');
      expect(result).toBe(false);
    });

    it('blacklist cache hit via cached.mode (no explicit param) also returns false', async () => {
      const cached = makeCached(['blocked.com'], FIXED_NOW, 'blacklist');
      const result = await filter.isAllowedCached('https://blocked.com/page', cached);
      expect(result).toBe(false);
    });

    it('DomainFilterCacheAdapter — cache hit preserves blacklist mode', async () => {
      const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });
      adapter.updateCache(['blocked.com'], 'blacklist');
      expect(await adapter.isAllowed('https://blocked.com/page', 'blacklist')).toBe(false);
      expect(await adapter.isAllowed('https://allowed.com/page', 'blacklist')).toBe(true);
    });

    it('DomainFilterCacheAdapter — cachedMode preserved when mode param omitted', async () => {
      const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });
      adapter.updateCache(['blocked.com'], 'blacklist');
      // no mode param -> should use cachedMode = blacklist
      expect(await adapter.isAllowed('https://blocked.com/page')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Adapter parity: DomainFilterCacheAdapter produces same result as DomainFilter.isAllowedCached
  // -------------------------------------------------------------------------
  describe('Adapter parity', () => {
    const cases: Array<{
      domains: string[];
      mode: string;
      url: string;
      expected: boolean;
      label: string;
    }> = [
      { domains: ['example.com'], mode: 'whitelist', url: 'https://example.com/page', expected: true, label: 'whitelist listed -> true' },
      { domains: ['example.com'], mode: 'whitelist', url: 'https://other.com/page', expected: false, label: 'whitelist unlisted -> false' },
      { domains: ['*.example.com'], mode: 'whitelist', url: 'https://sub.example.com/page', expected: true, label: 'whitelist wildcard listed -> true' },
      { domains: ['blocked.com'], mode: 'blacklist', url: 'https://blocked.com/page', expected: false, label: 'blacklist listed -> false' },
      { domains: ['blocked.com'], mode: 'blacklist', url: 'https://allowed.com/page', expected: true, label: 'blacklist unlisted -> true' },
      { domains: ['*.blocked.com'], mode: 'blacklist', url: 'https://sub.blocked.com/page', expected: false, label: 'blacklist wildcard listed -> false' },
      { domains: ['*.blocked.com'], mode: 'blacklist', url: 'https://allowed.com/page', expected: true, label: 'blacklist wildcard unlisted -> true' },
    ];

    for (const c of cases) {
      it(`${c.label} — adapter and filter agree`, async () => {
        const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });
        adapter.updateCache(c.domains, c.mode);
        const cached = makeCached(c.domains, FIXED_NOW, c.mode);

        const fromFilter = await filter.isAllowedCached(c.url, cached, c.mode);
        const fromAdapter = await adapter.isAllowed(c.url, c.mode);

        expect(fromFilter).toBe(c.expected);
        expect(fromAdapter).toBe(c.expected);
        expect(fromAdapter).toBe(fromFilter);
      });
    }

    it('both adapters invert consistently when mode switches', async () => {
      const domains = ['example.com'];
      const urlListed = 'https://example.com/page';
      const urlUnlisted = 'https://other.com/page';

      const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });

      // Whitelist mode
      adapter.updateCache(domains, 'whitelist');
      const wlCached = makeCached(domains, FIXED_NOW, 'whitelist');
      expect(await filter.isAllowedCached(urlListed, wlCached, 'whitelist')).toBe(true);
      expect(await adapter.isAllowed(urlListed, 'whitelist')).toBe(true);
      expect(await filter.isAllowedCached(urlUnlisted, wlCached, 'whitelist')).toBe(false);
      expect(await adapter.isAllowed(urlUnlisted, 'whitelist')).toBe(false);

      // Switch to blacklist with same list
      adapter.updateCache(domains, 'blacklist');
      const blCached = makeCached(domains, FIXED_NOW, 'blacklist');
      expect(await filter.isAllowedCached(urlListed, blCached, 'blacklist')).toBe(false);
      expect(await adapter.isAllowed(urlListed, 'blacklist')).toBe(false);
      expect(await filter.isAllowedCached(urlUnlisted, blCached, 'blacklist')).toBe(true);
      expect(await adapter.isAllowed(urlUnlisted, 'blacklist')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // TTL boundary: cache valid within ttlMs, stale outside falls back to live
  // -------------------------------------------------------------------------
  describe('TTL boundary', () => {
    it('cache valid within ttlMs returns cached result (not live)', async () => {
      const liveSpy = vi.spyOn(filter, 'isAllowed').mockResolvedValue(false);
      // whitelist cached says true, but live says false -> if hit, we get true
      const cached = makeCached(['example.com'], FIXED_NOW, 'whitelist');
      // Date.now is FIXED_NOW, cachedAt is FIXED_NOW => age 0 < TTL => hit
      const result = await filter.isAllowedCached('https://example.com/page', cached, 'whitelist');
      expect(result).toBe(true);
      expect(liveSpy).not.toHaveBeenCalled();
    });

    it('cache valid at ttlMs - 1 still hits', async () => {
      const liveSpy = vi.spyOn(filter, 'isAllowed').mockResolvedValue(false);
      const cached = makeCached(['example.com'], FIXED_NOW - TTL + 1, 'whitelist');
      // age = TTL -1 < TTL => hit
      const result = await filter.isAllowedCached('https://example.com/page', cached, 'whitelist');
      expect(result).toBe(true);
      expect(liveSpy).not.toHaveBeenCalled();
    });

    it('cache exactly at ttlMs is stale — falls back to live', async () => {
      const liveSpy = vi.spyOn(filter, 'isAllowed').mockResolvedValue(false);
      const cached = makeCached(['example.com'], FIXED_NOW - TTL, 'whitelist');
      // age = TTL not < TTL => stale -> live (false)
      const result = await filter.isAllowedCached('https://example.com/page', cached, 'whitelist');
      expect(result).toBe(false);
      expect(liveSpy).toHaveBeenCalledWith('https://example.com/page');
    });

    it('cache stale outside ttlMs falls back to live', async () => {
      const liveSpy = vi.spyOn(filter, 'isAllowed').mockResolvedValue(true);
      const cached = makeCached(['example.com'], FIXED_NOW - TTL - 1, 'whitelist');
      // For whitelist cached with ['example.com'], a hit for 'other.com' would be false,
      // but live returns true -> proves fallback happened.
      const result = await filter.isAllowedCached('https://other.com/page', cached, 'whitelist');
      expect(result).toBe(true);
      expect(liveSpy).toHaveBeenCalledWith('https://other.com/page');
    });

    it('DomainFilterCacheAdapter — valid within ttlMs returns cached', async () => {
      const liveSpy = vi.spyOn(filter, 'isAllowed').mockResolvedValue(false);
      const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });
      adapter.updateCache(['example.com'], 'whitelist');
      // still at FIXED_NOW -> valid
      expect(await adapter.isAllowed('https://example.com/page', 'whitelist')).toBe(true);
      expect(liveSpy).not.toHaveBeenCalled();
    });

    it('DomainFilterCacheAdapter — stale outside ttlMs falls back to live', async () => {
      const liveSpy = vi.spyOn(filter, 'isAllowed').mockResolvedValue(false);
      const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });
      adapter.updateCache(['example.com'], 'whitelist');
      // advance time beyond TTL
      vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW + TTL + 1);
      const result = await adapter.isAllowed('https://example.com/page', 'whitelist');
      expect(result).toBe(false);
      expect(liveSpy).toHaveBeenCalledWith('https://example.com/page');
    });

    it('DomainFilterCacheAdapter — exactly at ttlMs is stale', async () => {
      const liveSpy = vi.spyOn(filter, 'isAllowed').mockResolvedValue(true);
      const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });
      adapter.updateCache(['example.com'], 'whitelist');
      vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW + TTL);
      const result = await adapter.isAllowed('https://other.com/page', 'whitelist');
      // other.com not in whitelist cached would be false, but stale live is true
      expect(result).toBe(true);
      expect(liveSpy).toHaveBeenCalled();
    });

    it('null cache always falls back to live', async () => {
      const liveSpy = vi.spyOn(filter, 'isAllowed').mockResolvedValue(true);
      expect(await filter.isAllowedCached('https://example.com/page', null, 'whitelist')).toBe(true);
      expect(liveSpy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // No mode / disabled: empty list allows all
  // -------------------------------------------------------------------------
  describe('No mode / disabled — empty list allows all', () => {
    it('disabled mode with empty list allows all (explicit mode)', async () => {
      const cached = makeCached([], FIXED_NOW, 'disabled');
      expect(await filter.isAllowedCached('https://example.com/page', cached, 'disabled')).toBe(true);
      expect(await filter.isAllowedCached('https://any.other/page', cached, 'disabled')).toBe(true);
    });

    it('no mode param and cached.mode undefined with empty list allows all', async () => {
      const cached = makeCached([], FIXED_NOW);
      expect(await filter.isAllowedCached('https://example.com/page', cached)).toBe(true);
      expect(await filter.isAllowedCached('https://evil.com/page', cached)).toBe(true);
    });

    it('no mode with non-empty list falls back to isDomainInList (allow if listed)', async () => {
      const cached = makeCached(['example.com'], FIXED_NOW);
      expect(await filter.isAllowedCached('https://example.com/page', cached)).toBe(true);
      expect(await filter.isAllowedCached('https://other.com/page', cached)).toBe(false);
    });

    it('undefined mode with empty string also allows all', async () => {
      const cached: { allowedDomains: string[]; cachedAt: number; mode?: string } = {
        allowedDomains: [],
        cachedAt: FIXED_NOW,
      };
      expect(await filter.isAllowedCached('https://example.com/page', cached, undefined)).toBe(true);
    });

    it('DomainFilterCacheAdapter — no mode with empty list allows all', async () => {
      const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });
      adapter.updateCache([], 'disabled');
      expect(await adapter.isAllowed('https://example.com/page', 'disabled')).toBe(true);
    });

    it('DomainFilterCacheAdapter — no mode/undefined with empty list allows all', async () => {
      const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });
      // no mode set, empty list
      adapter.updateCache([]);
      expect(await adapter.isAllowed('https://example.com/page')).toBe(true);
    });

    it('DomainFilterCacheAdapter — no mode with non-empty list checks membership', async () => {
      const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });
      adapter.updateCache(['example.com']);
      // effectiveMode is null, list non-empty => isDomainInList
      expect(await adapter.isAllowed('https://example.com/page')).toBe(true);
      expect(await adapter.isAllowed('https://other.com/page')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Invalid URL: returns false
  // -------------------------------------------------------------------------
  describe('Invalid URL', () => {
    it('DomainFilter.isAllowedCached returns false for invalid URL (whitelist)', async () => {
      const cached = makeCached(['example.com'], FIXED_NOW, 'whitelist');
      expect(await filter.isAllowedCached('not-a-url', cached, 'whitelist')).toBe(false);
      expect(await filter.isAllowedCached('', cached, 'whitelist')).toBe(false);
      expect(await filter.isAllowedCached('http://', cached, 'whitelist')).toBe(false);
    });

    it('DomainFilter.isAllowedCached returns false for invalid URL (blacklist)', async () => {
      const cached = makeCached(['blocked.com'], FIXED_NOW, 'blacklist');
      expect(await filter.isAllowedCached('not-a-url', cached, 'blacklist')).toBe(false);
    });

    it('DomainFilterCacheAdapter returns false for invalid URL', async () => {
      const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });
      adapter.updateCache(['example.com'], 'whitelist');
      expect(await adapter.isAllowed('not-a-url', 'whitelist')).toBe(false);
      expect(await adapter.isAllowed('', 'whitelist')).toBe(false);
    });

    it('DomainFilterCacheAdapter blacklist invalid URL returns false', async () => {
      const adapter = new DomainFilterCacheAdapter(filter, { ttlMs: TTL });
      adapter.updateCache(['blocked.com'], 'blacklist');
      expect(await adapter.isAllowed('ht!tp://[invalid]', 'blacklist')).toBe(false);
    });

    it('invalid URL still returns false even when list is empty (no mode)', async () => {
      const cached = makeCached([], FIXED_NOW, 'disabled');
      expect(await filter.isAllowedCached('not-a-url', cached, 'disabled')).toBe(false);
    });
  });
});
