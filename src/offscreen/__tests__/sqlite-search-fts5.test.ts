// @vitest-environment jsdom
/**
 * sqlite-search-fts5.test.ts
 *
 * Verifies that search() in sqlite.ts proxies via the worker's SEARCH message
 * (real FTS5) and returns rank-bearing rows when the OPFS worker is available.
 *
 * Approach: FakeWorker stub via vi.stubGlobal('Worker', FakeWorker).
 * The fake worker intercepts postMessage calls and asynchronously calls
 * onmessage with the appropriate result, simulating the OPFS worker protocol.
 * navigator.storage.getDirectory is stubbed to make isOpfsAvailable() return true.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { SearchResult } from '../../utils/sqlite-types.js';

// ---------------------------------------------------------------------------
// FakeWorker — tracks received messages and responds like the real opfsWorker
// ---------------------------------------------------------------------------

interface WorkerMessage {
  id: number;
  type: string;
  payload?: unknown;
}

const fakeWorkerMessages: WorkerMessage[] = [];

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  postMessage(msg: WorkerMessage): void {
    fakeWorkerMessages.push(msg);

    const { id, type } = msg;
    let result: unknown;

    if (type === 'INIT') {
      result = { initialized: true };
    } else if (type === 'STATUS') {
      result = { initialized: true, path: 'smart-history.db', fallback: false, fts5: true, count: 0 };
    } else if (type === 'SEARCH') {
      const row: SearchResult = {
        id: 1,
        url: 'https://a.com',
        title: 't',
        summary: null,
        tags: null,
        created_at: 1,
        domain: 'a.com',
        visit_duration: null,
        scroll_ratio: null,
        is_starred: 0,
        rank: -1.5,
      };
      result = { rows: [row], total: 1 };
    } else {
      result = {};
    }

    // Respond asynchronously (mimics worker message event)
    Promise.resolve().then(() => {
      if (this.onmessage) {
        this.onmessage({ data: { id, success: true, result } });
      }
    });
  }

  terminate(): void {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let resetForTesting: () => void;

beforeEach(async () => {
  // Reset modules first so each test gets a fresh sqlite.ts module instance
  vi.resetModules();

  fakeWorkerMessages.length = 0;

  // Stub navigator.storage.getDirectory so isOpfsAvailable() returns true
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: { getDirectory: vi.fn() },
    writable: true,
    configurable: true,
  });

  // Stub the Worker constructor
  vi.stubGlobal('Worker', FakeWorker);

  // Import fresh module after stubs are in place
  const mod = await import('../sqlite.js');
  resetForTesting = mod._resetForTesting;
});

afterEach(() => {
  if (resetForTesting) resetForTesting();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search() — OPFS worker SEARCH proxy (FTS5)', () => {
  it('routes search() to the worker SEARCH message and returns rank-bearing rows', async () => {
    const mod = await import('../sqlite.js');

    const initOk = await mod.init();
    expect(initOk).toBe(true);

    const result = await mod.search('hello', 50, 0);

    // Must succeed
    expect(result.success).toBe(true);
    if (!result.success) return; // type narrowing

    // Rank must come from the worker (not zeroed out)
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].rank).toBe(-1.5);
    expect(result.total).toBe(1);

    // The worker must have received a SEARCH message (not QUERY)
    const searchMsg = fakeWorkerMessages.find(m => m.type === 'SEARCH');
    expect(searchMsg).toBeDefined();
    expect((searchMsg?.payload as { searchQuery: string }).searchQuery).toBe('hello');

    // No QUERY message should have been sent for the search
    const queryMsg = fakeWorkerMessages.find(m => m.type === 'QUERY');
    expect(queryMsg).toBeUndefined();
  });

  it('fts5Available is true after OPFS worker initialises', async () => {
    const mod = await import('../sqlite.js');
    await mod.init();

    // getStatus exposes fts5 flag
    const status = await mod.getStatus();
    expect(status.success).toBe(true);
    if (!status.success) return;
    expect(status.fts5).toBe(true);
  });
});
