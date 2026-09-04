/**
 * lockContract.test.ts
 * Lock / CAS API contract tests (VULN-028 / VULN-029, CWE-667 / CWE-362).
 *
 * Two invariants every lock-guarded update site must uphold:
 *  1. finally-coverage: an in-flight lock/flag is released even when the
 *     guarded work throws.
 *  2. current-consumption: a CAS updateFn derives its result from the
 *     `current` value it is handed, never from a stale captured snapshot.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TrustDatabase } from '../trustDbSchema.js';
import { mergeTrustDatabase } from '../mergeTrustDatabase.js';

function makeDb(overrides: Partial<TrustDatabase> = {}): TrustDatabase {
  return {
    version: '1',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    tranco: { tier: 'top1k', domains: [], count: 0, sizeBytes: 0 },
    jpAnchor: { tlds: ['.go.jp'], userTlds: [] },
    sensitive: {
      presets: { finance: [], gaming: [], sns: [] },
      userBlacklist: [],
      whitelist: [],
    },
    bloomFilter: {
      data: '',
      hashCount: 1,
      bitCount: 1,
      expectedDomainCount: 0,
      hash: '',
    },
    ...overrides,
  };
}

describe('lock contract: finally-coverage (trancoUpdater)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('releases updateInProgress when the update throws mid-flight', async () => {
    vi.doMock('../TrustDbAdmin.js', () => ({
      getTrustDbAdmin: () => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        updateTranco: vi.fn().mockRejectedValue(new Error('db exploded')),
      }),
    }));

    const globalFetch = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', globalFetch);

    const { TrancoUpdater } = await import('../trancoUpdater.js');
    const updater = new TrancoUpdater();

    const result = await updater.updateTrancoList('top1k');
    expect(result.success).toBe(false);
    // The bug (post-loop reset only) leaves this true after the retry loop
    // returns on the exception path.
    expect(updater.isUpdateInProgress()).toBe(false);

    // A subsequent update must not be rejected as "already in progress".
    const second = await updater.updateTrancoList('top1k');
    expect(second.error).not.toBe('Update already in progress');

    vi.unstubAllGlobals();
  });
});

describe('lock contract: current-consumption (mergeTrustDatabase)', () => {
  it('derives its result from `current`, not from a captured snapshot', () => {
    const current = makeDb({
      sensitive: {
        presets: { finance: [], gaming: [], sns: [] },
        userBlacklist: ['writer-a.example'],
        whitelist: [],
      },
    });
    const local = makeDb({
      sensitive: {
        presets: { finance: [], gaming: [], sns: [] },
        userBlacklist: ['writer-b.example'],
        whitelist: [],
      },
    });

    const merged = mergeTrustDatabase(current, local);

    // Writer A's delta (only present in `current`) survives.
    expect(merged.sensitive.userBlacklist).toContain('writer-a.example');
    // Writer B's own delta survives too.
    expect(merged.sensitive.userBlacklist).toContain('writer-b.example');
  });

  it('does not mutate either argument', () => {
    const current = makeDb();
    const local = makeDb({ jpAnchor: { tlds: ['.go.jp'], userTlds: ['.x'] } });
    const currentCopy = structuredClone(current);
    const localCopy = structuredClone(local);

    mergeTrustDatabase(current, local);

    expect(current).toEqual(currentCopy);
    expect(local).toEqual(localCopy);
  });

  it('returns a fresh object on first write (current undefined)', () => {
    const local = makeDb();
    const merged = mergeTrustDatabase(undefined, local);
    expect(merged).not.toBe(local);
    expect(merged).toEqual(local);
  });

  it('keeps the more recent tranco snapshot', () => {
    const current = makeDb({
      lastUpdated: '2026-05-01T00:00:00.000Z',
      tranco: { tier: 'top10k', domains: ['new.example'], count: 1, sizeBytes: 10 },
    });
    const local = makeDb({
      lastUpdated: '2026-01-01T00:00:00.000Z',
      tranco: { tier: 'top1k', domains: ['old.example'], count: 1, sizeBytes: 10 },
    });

    const merged = mergeTrustDatabase(current, local);
    expect(merged.tranco.domains).toEqual(['new.example']);
    expect(merged.lastUpdated).toBe('2026-05-01T00:00:00.000Z');
  });
});

describe('lock contract: 2-writer CAS integration (trustDb.save)', () => {
  it('preserves both writers deltas through withOptimisticLock', async () => {
    vi.resetModules();

    const store: Record<string, unknown> = {};
    // Serialized fake: updateFn is applied against the live stored value.
    vi.doMock('../../storage/storageTransaction.js', () => ({
      withOptimisticLock: vi.fn(
        async (key: string, fn: (cur: unknown) => unknown) => {
          const next = fn(store[key]);
          store[key] = next;
          return next;
        }
      ),
      ConflictError: class ConflictError extends Error {},
    }));

    const { mergeTrustDatabase: merge } = await import('../mergeTrustDatabase.js');
    const { withOptimisticLock } = await import('../../storage/storageTransaction.js');

    const KEY = 'trust_db:json';
    const writerA = makeDb({
      sensitive: {
        presets: { finance: [], gaming: [], sns: [] },
        userBlacklist: ['a.example'],
        whitelist: [],
      },
    });
    const writerB = makeDb({
      sensitive: {
        presets: { finance: [], gaming: [], sns: [] },
        userBlacklist: ['b.example'],
        whitelist: [],
      },
    });

    await withOptimisticLock(KEY, (cur: unknown) => merge(cur as TrustDatabase | undefined, writerA));
    await withOptimisticLock(KEY, (cur: unknown) => merge(cur as TrustDatabase | undefined, writerB));

    const final = store[KEY] as TrustDatabase;
    // RED without the merge fix: writer B's snapshot overwrites writer A's.
    expect(final.sensitive.userBlacklist).toEqual(
      expect.arrayContaining(['a.example', 'b.example'])
    );
  });
});
