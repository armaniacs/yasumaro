// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FTS_QUERY_MAX_LENGTH = 200;

// Track messages sent to the fake worker
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

describe('FTS5 tagFilter query length limit', () => {
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

  it('truncates tagFilter longer than FTS_QUERY_MAX_LENGTH', async () => {
    const mod = await import('../sqlite.js');
    await mod.init();

    // Build a tag longer than the limit
    const longTag = 'a'.repeat(FTS_QUERY_MAX_LENGTH + 50);
    expect(longTag.length).toBeGreaterThan(FTS_QUERY_MAX_LENGTH);

    workerMessages.length = 0;
    await mod.query({ tagFilter: longTag });

    // The worker should have received a QUERY message with a truncated tagFilter
    const queryMsg = workerMessages.find((m) => m.type === 'QUERY');
    expect(queryMsg).toBeDefined();
    const payload = queryMsg!.payload as Record<string, unknown>;
    expect(payload.tagFilter).toBeDefined();
    expect(String(payload.tagFilter).length).toBeLessThanOrEqual(FTS_QUERY_MAX_LENGTH);
  });

  it('passes through tagFilter shorter than limit unchanged', async () => {
    const mod = await import('../sqlite.js');
    await mod.init();

    const shortTag = 'javascript';
    expect(shortTag.length).toBeLessThan(FTS_QUERY_MAX_LENGTH);

    workerMessages.length = 0;
    await mod.query({ tagFilter: shortTag });

    const queryMsg = workerMessages.find((m) => m.type === 'QUERY');
    expect(queryMsg).toBeDefined();
    const payload = queryMsg!.payload as Record<string, unknown>;
    expect(payload.tagFilter).toBe(shortTag);
  });
});
