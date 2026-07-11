// @vitest-environment jsdom
/**
 * sqlite-query-limit-cap.test.ts
 * M13: query()/search() must clamp an excessively large `limit` to a hard
 * cap, so a caller (or attacker-controlled input) can't force the entire
 * table to be loaded into JS memory at once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MAX_QUERY_LIMIT = 100000;

const workerMessages: Array<{ type: string; payload?: unknown }> = [];

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  postMessage(msg: { id: number; type: string; payload?: unknown }): void {
    const { id, type, payload } = msg;
    workerMessages.push({ type, payload });

    let result: unknown;
    if (type === 'INIT') {
      result = { initialized: true };
    } else if (type === 'STATUS') {
      result = { initialized: true, path: 'yasumaro.db', fallback: false, fts5: true, count: 0 };
    } else if (type === 'QUERY') {
      result = { rows: [], total: 0 };
    } else if (type === 'SEARCH') {
      result = { rows: [], total: 0 };
    } else {
      result = {};
    }

    Promise.resolve().then(() => {
      if (this.onmessage) {
        this.onmessage({ data: { id, success: true, result } });
      }
    });
  }

  terminate(): void {}
}

describe('Query limit hard cap (M13)', () => {
  let resetForTesting: () => void;

  beforeEach(async () => {
    vi.resetModules();
    workerMessages.length = 0;

    vi.stubGlobal('Worker', FakeWorker);

    Object.defineProperty(globalThis.navigator, 'storage', {
      value: { getDirectory: vi.fn().mockResolvedValue({}) },
      writable: true,
      configurable: true,
    });

    const mod = await import('../sqlite.js');
    resetForTesting = mod._resetForTesting;
  });

  afterEach(() => {
    if (resetForTesting) resetForTesting();
    vi.unstubAllGlobals();
  });

  it('clamps query() limit above the hard cap', async () => {
    const mod = await import('../sqlite.js');
    await mod.init();

    workerMessages.length = 0;
    await mod.query({ limit: MAX_QUERY_LIMIT * 10 });

    const queryMsg = workerMessages.find((m) => m.type === 'QUERY');
    expect(queryMsg).toBeDefined();
    const payload = queryMsg!.payload as Record<string, unknown>;
    expect(payload.limit).toBe(MAX_QUERY_LIMIT);
  });

  it('leaves query() limit under the hard cap unchanged', async () => {
    const mod = await import('../sqlite.js');
    await mod.init();

    workerMessages.length = 0;
    await mod.query({ limit: 500 });

    const queryMsg = workerMessages.find((m) => m.type === 'QUERY');
    expect(queryMsg).toBeDefined();
    const payload = queryMsg!.payload as Record<string, unknown>;
    expect(payload.limit).toBe(500);
  });

  it('clamps search() limit above the hard cap', async () => {
    const mod = await import('../sqlite.js');
    await mod.init();

    workerMessages.length = 0;
    await mod.search('test', MAX_QUERY_LIMIT * 10);

    const searchMsg = workerMessages.find((m) => m.type === 'SEARCH');
    expect(searchMsg).toBeDefined();
    const payload = searchMsg!.payload as Record<string, unknown>;
    expect(payload.limit).toBe(MAX_QUERY_LIMIT);
  });
});
