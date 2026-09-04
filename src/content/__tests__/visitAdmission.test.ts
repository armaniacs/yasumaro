/**
 * visitAdmission.test.ts
 * The admission decision (skip -> cache -> retrying background verdict ->
 * inject) is driven through injected adapters — no chrome, injectable clock.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  evaluateDomainPolicy,
  checkDomainWithRetry,
  resolveVisitAdmission,
  CACHE_TTL,
  type VisitAdmissionDeps,
} from '../visitAdmission.js';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    cachedWhitelist: [],
    cachedAt: 1_700_000_000_000,
    mode: 'disabled',
    blacklist: [],
    simpleEnabled: true,
    ublockEnabled: false,
    ...overrides,
  };
}

const NOW = 1_700_000_000_000;

describe('evaluateDomainPolicy', () => {
  it('rejects unparseable domains without cache', () => {
    expect(evaluateDomainPolicy(null, snapshot(), NOW)).toEqual({ allowed: false, useCache: true });
  });

  it('reports stale cache as unusable', () => {
    expect(evaluateDomainPolicy('example.com', snapshot({ cachedAt: NOW - CACHE_TTL - 1 }), NOW)).toEqual({
      allowed: false,
      useCache: false,
    });
  });

  it('allows everything when disabled', () => {
    expect(evaluateDomainPolicy('example.com', snapshot(), NOW)).toEqual({ allowed: true, useCache: true });
  });

  it('applies whitelist and blacklist semantics', () => {
    expect(
      evaluateDomainPolicy('a.com', snapshot({ mode: 'whitelist', cachedWhitelist: ['a.com'] }), NOW),
    ).toEqual({ allowed: true, useCache: true });
    expect(
      evaluateDomainPolicy('b.com', snapshot({ mode: 'whitelist', cachedWhitelist: ['a.com'] }), NOW),
    ).toEqual({ allowed: false, useCache: true });
    expect(
      evaluateDomainPolicy('b.com', snapshot({ mode: 'blacklist', blacklist: ['b.com'] }), NOW),
    ).toEqual({ allowed: false, useCache: true });
    expect(
      evaluateDomainPolicy('c.com', snapshot({ mode: 'blacklist', blacklist: ['b.com'] }), NOW),
    ).toEqual({ allowed: true, useCache: true });
  });

  it('defers to uncached when ublock handling is on', () => {
    expect(
      evaluateDomainPolicy('c.com', snapshot({ mode: 'blacklist', ublockEnabled: true }), NOW),
    ).toEqual({ allowed: false, useCache: false });
  });
});

describe('checkDomainWithRetry', () => {
  it('returns the first truthy response without sleeping', async () => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn(async () => ({ allowed: true }));
    const { response, lastError } = await checkDomainWithRetry(send, sleep);

    expect(response).toEqual({ allowed: true });
    expect(lastError).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries on throw with linear backoff and surfaces the last error', async () => {
    const sleep = vi.fn(async () => {});
    const send = vi
      .fn<() => Promise<{ allowed: boolean } | undefined>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('still down'))
      .mockResolvedValueOnce(undefined);
    const { response, lastError } = await checkDomainWithRetry(send, sleep);

    expect(response).toBeUndefined();
    expect((lastError as Error).message).toBe('still down');
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 200);
    expect(sleep).toHaveBeenNthCalledWith(2, 400);
  });
});

function admissionDeps(overrides: Partial<VisitAdmissionDeps> = {}): VisitAdmissionDeps & {
  warns: Array<[string, string, string]>;
  injected: { count: number };
  sendCheckDomain: ReturnType<typeof vi.fn>;
} {
  const warns: Array<[string, string, string]> = [];
  const injected = { count: 0 };
  const sendCheckDomain = vi.fn(async () => ({ allowed: true }));
  return {
    warns,
    injected,
    sendCheckDomain,
    url: 'https://example.com/page',
    warnLabel: '',
    shouldSkip: () => false,
    checkCache: async () => ({ allowed: true, useCache: true }),
    sleep: async () => {},
    loadExtractor: async () => {
      injected.count++;
    },
    warn: (message: string, url: string, detail: string) => {
      warns.push([message, url, detail]);
    },
    ...overrides,
  };
}

describe('resolveVisitAdmission', () => {
  it('skips without touching cache or background', async () => {
    const deps = admissionDeps({ shouldSkip: () => true, checkCache: vi.fn(), sendCheckDomain: vi.fn() });
    expect(await resolveVisitAdmission(deps)).toBe('skipped');
    expect(deps.checkCache).not.toHaveBeenCalled();
    expect(deps.sendCheckDomain).not.toHaveBeenCalled();
    expect(deps.injected.count).toBe(0);
  });

  it('injects on cache hit and skips on cache block', async () => {
    const hit = admissionDeps();
    expect(await resolveVisitAdmission(hit)).toBe('injected');
    expect(hit.injected.count).toBe(1);
    expect(hit.sendCheckDomain).not.toHaveBeenCalled();

    const blocked = admissionDeps({ checkCache: async () => ({ allowed: false, useCache: true }) });
    expect(await resolveVisitAdmission(blocked)).toBe('skipped');
    expect(blocked.injected.count).toBe(0);
  });

  it('falls back to the background verdict on cold cache and warns with the e2e label', async () => {
    const deps = admissionDeps({
      warnLabel: ' (e2e)',
      checkCache: async () => ({ allowed: false, useCache: false }),
    });
    expect(await resolveVisitAdmission(deps)).toBe('injected');
    expect(deps.injected.count).toBe(1);
  });

  it('skips and warns when the background never answers', async () => {
    const deps = admissionDeps({
      checkCache: async () => ({ allowed: false, useCache: false }),
      sendCheckDomain: async () => undefined,
    });
    expect(await resolveVisitAdmission(deps)).toBe('skipped');
    expect(deps.warns).toHaveLength(1);
    expect(deps.warns[0]?.[0]).toBe('[OWeave] Domain check failed: no response from service worker');
  });

  it('warns with the label when the extractor import fails', async () => {
    const deps = admissionDeps({
      warnLabel: ' (e2e)',
      loadExtractor: async () => {
        throw new Error('blocked');
      },
    });
    // Import failure is warned, not re-routed.
    expect(await resolveVisitAdmission(deps)).toBe('injected');
    expect(deps.warns).toHaveLength(1);
    expect(deps.warns[0]?.[0]).toBe('[OWeave] Dynamic import blocked (e2e)');
  });
});
