// @layer 1 — DomainFilter deep module (single seam for "is this URL allowed?")
/**
 * DomainFilter — deep module unifying 4 gates that answer "isAllowed(url)?"
 * Previously: isDomainAllowed (live read) / domainFilterCache (5m TTL) /
 * dashboard domainFilter (textarea) / content extractor (callback) each had
 * separate staleness and 3 wildcard engines. Now one isAllowed seam.
 *
 * Two adapters make the seam real: DomainFilter (live) and
 * DomainFilterCacheAdapter (content-script, 5m TTL). One adapter = hypothetical.
 */

import { isDomainAllowed as isDomainAllowedLive } from '../domainUtils.js';
import { wildcardToRegex } from '../wildcardToRegex.js';
import { StorageKeys } from '../storage/types.js';
import type { Settings } from '../storage/types.js';

export interface DomainFilterOptions {
  ttlMs?: number;
}

export const DEFAULT_DOMAIN_FILTER_TTL_MS = 5 * 60 * 1000;

export class DomainFilter {
  private readonly ttlMs: number;
  constructor(private readonly opts: DomainFilterOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_DOMAIN_FILTER_TTL_MS;
  }

  getTtlMs(): number {
    return this.ttlMs;
  }

  /**
   * Single seam: is this URL allowed per current settings?
   * Delegates to the live isDomainAllowed which already handles
   * whitelist/blacklist/uBlock and uses wildcardToRegex (single engine).
   */
  async isAllowed(url: string): Promise<boolean> {
    return isDomainAllowedLive(url);
  }

  /**
   * Parse textarea content (one domain per line) — single place for splitting.
   */
  parse(text: string): string[] {
    if (!text) return [];
    return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  }

  /**
   * Validate a domain list — single place for ReDoS guard via wildcardToRegex.
   */
  validate(list: string[]): string[] {
    return this.parseAndValidate(list).errors;
  }

  /**
   * Parse and validate a domain list (used by dashboard textarea).
   * Returns normalized list or error — single place for ReDoS guard.
   */
  parseAndValidate(list: string[]): { valid: string[]; errors: string[] } {
    const valid: string[] = [];
    const errors: string[] = [];
    for (const raw of list) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      // Use single wildcard engine for validation
      if (trimmed.includes('*')) {
        const re = wildcardToRegex(trimmed);
        if (!re) {
          errors.push(`Invalid pattern: ${trimmed}`);
          continue;
        }
      }
      valid.push(trimmed);
    }
    return { valid, errors };
  }

  /**
   * Build cache payload for a given settings snapshot.
   * Handles whitelist / blacklist / disabled — blacklist now caches blocked
   * domains instead of an empty array (fixes TODO).
   */
  buildCacheDomains(settings: Settings): string[] {
    const mode = settings[StorageKeys.DOMAIN_FILTER_MODE];
    const simpleEnabled = settings[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;
    if (!simpleEnabled) return [];
    if (mode === 'whitelist') {
      return (settings[StorageKeys.DOMAIN_WHITELIST] as string[]) || [];
    }
    if (mode === 'blacklist') {
      return (settings[StorageKeys.DOMAIN_BLACKLIST] as string[]) || [];
    }
    return [];
  }

  /**
   * Generate cache record valid for ttlMs — used by updateDomainFilterCache.
   */
  cache(settings: Settings, now = Date.now()): { cachedDomains: string[]; cachedAt: number; validFor: number } {
    return {
      cachedDomains: this.buildCacheDomains(settings),
      cachedAt: now,
      validFor: this.ttlMs,
    };
  }

  /**
   * Cache-aware isAllowed for content-script path (TTL from construction param).
   * Returns cached result if valid, otherwise falls back to live.
   */
  async isAllowedCached(url: string, cached: { allowedDomains: string[]; cachedAt: number } | null): Promise<boolean> {
    if (cached && Date.now() - cached.cachedAt < this.ttlMs) {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return cached.allowedDomains.some((pattern) => {
        if (!pattern.includes('*')) return hostname.toLowerCase() === pattern.toLowerCase();
        const re = wildcardToRegex(pattern);
        return re ? re.test(hostname) : false;
      });
    }
    return this.isAllowed(url);
  }
}

/**
 * Content-script adapter — second adapter that makes the seam real.
 * Holds a TTL cache and delegates to DomainFilter live when stale.
 */
export class DomainFilterCacheAdapter {
  private cachedAt: number | null = null;
  private allowedDomains: string[] = [];
  private readonly ttlMs: number;

  constructor(
    private readonly filter: DomainFilter = new DomainFilter(),
    opts: DomainFilterOptions = {},
  ) {
    this.ttlMs = opts.ttlMs ?? filter.getTtlMs();
  }

  updateCache(allowedDomains: string[]): void {
    this.allowedDomains = [...allowedDomains];
    this.cachedAt = Date.now();
  }

  /** Expose TTL for tests (construction param seam). */
  getTtlMs(): number {
    return this.ttlMs;
  }

  async isAllowed(url: string): Promise<boolean> {
    if (this.cachedAt && Date.now() - this.cachedAt < this.ttlMs) {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return this.allowedDomains.some((pattern) => {
        if (!pattern.includes('*')) return hostname.toLowerCase() === pattern.toLowerCase();
        const re = wildcardToRegex(pattern);
        return re ? re.test(hostname) : false;
      });
    }
    return this.filter.isAllowed(url);
  }
}

// Default singleton for callers that don't inject
export const domainFilter = new DomainFilter();
