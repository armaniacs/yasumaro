import { describe, it, expect, vi } from 'vitest';
import { checkDomainWithRetry, resolveVisitAdmission, type VisitAdmissionDeps } from '../visitAdmission.js';

describe('visitAdmission twins parity (PBI 07)', () => {
  it('backs off identically on empty responses as on throws', async () => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn(async () => undefined);
    await checkDomainWithRetry(send, sleep);
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 200);
    expect(sleep).toHaveBeenNthCalledWith(2, 400);
  });

  it('warns identically on the cache-hit and background-verdict load paths', async () => {
    const makeDeps = (checkCache: VisitAdmissionDeps['checkCache']): VisitAdmissionDeps & { warns: string[] } => {
      const warns: string[] = [];
      return {
        warns,
        url: 'https://example.com/page',
        warnLabel: '',
        shouldSkip: () => false,
        checkCache,
        sendCheckDomain: async () => ({ allowed: true }),
        sleep: async () => {},
        loadExtractor: async () => {
          throw new Error('blocked');
        },
        warn: (message: string) => {
          warns.push(message);
        },
      } as unknown as VisitAdmissionDeps & { warns: string[] };
    };
    const viaCache = makeDeps(async () => ({ allowed: true, useCache: true }));
    const viaBackground = makeDeps(async () => ({ allowed: false, useCache: false }));
    expect(await resolveVisitAdmission(viaCache)).toBe('injected');
    expect(await resolveVisitAdmission(viaBackground)).toBe('injected');
    expect(viaCache.warns).toEqual(['[OWeave] Dynamic import blocked']);
    expect(viaBackground.warns).toEqual(viaCache.warns);
  });
});
