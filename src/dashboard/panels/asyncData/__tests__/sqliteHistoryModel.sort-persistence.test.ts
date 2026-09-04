import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSqliteHistoryModel } from '../sqliteHistoryModel.js';
import type { PersistScheduler } from '../sqliteHistoryModel.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';

function makeRow(id: number): BrowsingLogEntry {
  return { id, url: `https://example.com/${id}`, title: `Example ${id}`, created_at: 1700000000000 + id };
}

// Microtask-coalescing scheduler: buffers the latest deferred callback and
// runs it once on the microtask queue. Lets tests verify debounce + unmount
// flush synchronously without waiting 500ms or using fake timers.
function createImmediatePersistScheduler(): PersistScheduler {
  let queued: (() => void) | null = null;
  let scheduled = false;
  return {
    defer(fn: () => void, ms: number): void {
      void ms;
      queued = fn;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        const toRun = queued;
        queued = null;
        toRun?.();
      });
    },
    cancel(): void {
      queued = null;
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // reset storage
  (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockClear();
  (chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe('sqliteHistoryModel — sort persistence', () => {
  it('startup get called once via loadPersistedSortIntoState', async () => {
    const model = createSqliteHistoryModel({
      queryHistory: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
      scheduler: createImmediatePersistScheduler(),
    });
    await model.loadPersistedSortIntoState();
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.get).toHaveBeenCalledWith('history_sort_preference');
  });

  it('5 rapid changeSort -> after debounce exactly 1 set with last value', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
    const model = createSqliteHistoryModel({ queryHistory, scheduler: createImmediatePersistScheduler() });

    const sorts: Array<['created_at' | 'relevance', 'ASC' | 'DESC']> = [
      ['created_at', 'ASC'],
      ['relevance', 'DESC'],
      ['created_at', 'DESC'],
      ['relevance', 'ASC'],
      ['created_at', 'ASC'],
    ];
    for (const [sortBy, sortDir] of sorts) {
      void model.changeSort(sortBy, sortDir);
    }

    // still within debounce window — no set yet
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    await flush();
    // debounce flush: exactly one write with the last value
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      history_sort_preference: JSON.stringify({ sortBy: 'created_at', sortDir: 'ASC' }),
    });
  });

  it('unmount flushes pending persist immediately', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
    const model = createSqliteHistoryModel({ queryHistory, scheduler: createImmediatePersistScheduler() });

    void model.changeSort('created_at', 'ASC');
    void model.changeSort('relevance', 'DESC');
    // before debounce expiry
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    model.bumpGenerationOnUnmount();
    // flush is synchronous (void persistSort) — set called without waiting 500ms
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      history_sort_preference: JSON.stringify({ sortBy: 'relevance', sortDir: 'DESC' }),
    });

    // the cancelled deferred callback must not cause a second write
    await flush();
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it('changeSort does not trigger additional get calls', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
    const model = createSqliteHistoryModel({ queryHistory, scheduler: createImmediatePersistScheduler() });
    await model.loadPersistedSortIntoState();
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockClear();

    void model.changeSort('created_at', 'ASC');
    await flush();
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });
});
