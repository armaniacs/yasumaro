/**
 * pendingStorageBounds.test.ts
 * PBI-26: addPendingPage enforces an absolute cap (drop-oldest) and clamps
 * caller-supplied expiry to PENDING_MAX_TTL_MS, inside the existing
 * withOptimisticLock updater (lock discipline unchanged).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addPendingPage,
  getPendingPages,
  clearExpiredPages,
  PENDING_PAGES_KEY,
  MAX_PENDING_PAGES,
  PENDING_MAX_TTL_MS,
  type PendingPage,
} from '../pendingStorage.js';

vi.mock('../logger.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', ERROR: 'ERROR' },
  ErrorCode: {
    STORAGE_READ_FAILURE: 'x',
    STORAGE_WRITE_FAILURE: 'x',
    STORAGE_MIGRATION_FAILURE: 'x',
  },
}));

vi.mock('../crypto/index.js', () => ({ hashUrl: vi.fn(async () => 'hash') }));
vi.mock('../i18n.js', () => ({ getMessage: vi.fn(() => '') }));

const DAY_MS = 24 * 60 * 60 * 1000;

function makePage(i: number, expiry: number): PendingPage {
  return {
    url: `https://b.com/${i}`,
    title: `t${i}`,
    timestamp: 0,
    reason: 'cache-control',
    expiry,
  };
}

describe('pendingStorage absolute bounds (PBI-26)', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[] | null) => {
            if (keys === null) return { ...store };
            if (Array.isArray(keys)) {
              const out: Record<string, unknown> = {};
              for (const k of keys) if (k in store) out[k] = store[k];
              return out;
            }
            return { [keys]: store[keys] };
          }),
          set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
        },
      },
    } as unknown as typeof chrome;
  });

  it('exposes the named bound constants', () => {
    expect(MAX_PENDING_PAGES).toBe(200);
    expect(PENDING_MAX_TTL_MS).toBe(DAY_MS);
  });

  it('drop-oldest: adding past the cap keeps length at MAX and evicts the oldest', async () => {
    const future = Date.now() + DAY_MS;
    const full: PendingPage[] = [];
    for (let i = 0; i < MAX_PENDING_PAGES; i++) full.push(makePage(i, future));
    store[PENDING_PAGES_KEY] = full;

    await addPendingPage(makePage(9999, future));

    const saved = store[PENDING_PAGES_KEY] as PendingPage[];
    expect(saved).toHaveLength(MAX_PENDING_PAGES);
    expect(saved.map(p => p.url)).not.toContain('https://b.com/0');
    expect(saved.map(p => p.url)).toContain('https://b.com/9999');
    expect(saved.map(p => p.url)).toContain('https://b.com/1');
  });

  it('boundary: adding at exactly MAX - 1 grows to exactly MAX without eviction', async () => {
    const future = Date.now() + DAY_MS;
    const pages: PendingPage[] = [];
    for (let i = 0; i < MAX_PENDING_PAGES - 1; i++) pages.push(makePage(i, future));
    store[PENDING_PAGES_KEY] = pages;

    await addPendingPage(makePage(7777, future));

    const saved = store[PENDING_PAGES_KEY] as PendingPage[];
    expect(saved).toHaveLength(MAX_PENDING_PAGES);
    expect(saved.map(p => p.url)).toContain('https://b.com/0');
    expect(saved.map(p => p.url)).toContain('https://b.com/7777');
  });

  it('clamps a far-future caller expiry to now + PENDING_MAX_TTL_MS', async () => {
    const before = Date.now();
    await addPendingPage(makePage(1, before + 30 * DAY_MS));

    const saved = store[PENDING_PAGES_KEY] as PendingPage[];
    expect(saved).toHaveLength(1);
    expect(saved[0].expiry).toBeLessThanOrEqual(Date.now() + PENDING_MAX_TTL_MS);
    expect(saved[0].expiry).toBeGreaterThanOrEqual(before + PENDING_MAX_TTL_MS - 5000);
    expect(saved[0].expiry).toBeLessThan(before + 30 * DAY_MS);
  });

  it('keeps expiry values within the TTL untouched', async () => {
    const now = Date.now();
    const expiry = now + 60 * 60 * 1000;
    await addPendingPage(makePage(2, expiry));

    const saved = store[PENDING_PAGES_KEY] as PendingPage[];
    expect(saved[0].expiry).toBe(expiry);
  });

  it('getPendingPages / clearExpiredPages expiry filtering still works', async () => {
    const past = Date.now() - 1000;
    const future = Date.now() + DAY_MS;
    store[PENDING_PAGES_KEY] = [makePage(0, past), makePage(1, future)];

    expect((await getPendingPages()).map(p => p.url)).toEqual(['https://b.com/1']);

    await clearExpiredPages();
    const saved = store[PENDING_PAGES_KEY] as PendingPage[];
    expect(saved.map(p => p.url)).toEqual(['https://b.com/1']);
  });
});
