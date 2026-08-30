/**
 * pendingStoragePrune.test.ts
 * addPendingPage must prune expired entries once the list crosses the
 * threshold, so a user who never opens the pending panel does not accumulate
 * an unbounded list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addPendingPage,
  PENDING_PAGES_KEY,
  PENDING_PAGES_PRUNE_THRESHOLD,
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

function makePage(i: number, expiry: number): PendingPage {
  return {
    url: `https://e.com/${i}`,
    title: `t${i}`,
    timestamp: 0,
    reason: 'cache-control',
    expiry,
  };
}

describe('addPendingPage pruning', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (k: string) => ({ [k]: store[k] })),
          set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
        },
      },
    } as unknown as typeof chrome;
  });

  it('does not prune below the threshold', async () => {
    const past = Date.now() - 1000;
    store[PENDING_PAGES_KEY] = [makePage(0, past), makePage(1, past)];
    await addPendingPage(makePage(99, Date.now() + 100000));
    const saved = store[PENDING_PAGES_KEY] as PendingPage[];
    expect(saved).toHaveLength(3);
  });

  it('prunes expired entries once above the threshold', async () => {
    const past = Date.now() - 1000;
    const future = Date.now() + 100000;
    const many: PendingPage[] = [];
    for (let i = 0; i < PENDING_PAGES_PRUNE_THRESHOLD + 1; i++) {
      many.push(makePage(i, past));
    }
    many.push(makePage(500, future));
    store[PENDING_PAGES_KEY] = many;

    await addPendingPage(makePage(999, future));

    const saved = store[PENDING_PAGES_KEY] as PendingPage[];
    // only the one non-expired existing entry + the newly added one
    expect(saved).toHaveLength(2);
    expect(saved.map(p => p.url)).toContain('https://e.com/999');
    expect(saved.map(p => p.url)).toContain('https://e.com/500');
  });
});
