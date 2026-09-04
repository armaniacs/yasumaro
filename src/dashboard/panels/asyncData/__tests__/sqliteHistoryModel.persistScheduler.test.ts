import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSqliteHistoryModel,
  createTimeoutPersistScheduler,
} from '../sqliteHistoryModel.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';

function makeRow(id: number): BrowsingLogEntry {
  return { id, url: `https://example.com/${id}`, title: `Example ${id}`, created_at: 1700000000000 + id };
}

beforeEach(() => {
  vi.useFakeTimers();
  (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockClear();
  (chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createTimeoutPersistScheduler — production timing policy', () => {
  it('does not run before the delay, runs once after', async () => {
    const scheduler = createTimeoutPersistScheduler();
    const fn = vi.fn();
    scheduler.defer(fn, 500);
    await vi.advanceTimersByTimeAsync(499);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a second defer resets the debounce — only the last fn runs', async () => {
    const scheduler = createTimeoutPersistScheduler();
    const first = vi.fn();
    const second = vi.fn();
    scheduler.defer(first, 500);
    await vi.advanceTimersByTimeAsync(400);
    scheduler.defer(second, 500);
    await vi.advanceTimersByTimeAsync(500);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancel prevents the deferred fn from running', async () => {
    const scheduler = createTimeoutPersistScheduler();
    const fn = vi.fn();
    scheduler.defer(fn, 500);
    scheduler.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('sqliteHistoryModel with production scheduler — 500ms debounce', () => {
  it('5 rapid changeSort -> 1 set with the last value after 500ms', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
    const model = createSqliteHistoryModel({ queryHistory, scheduler: createTimeoutPersistScheduler() });

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

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      history_sort_preference: JSON.stringify({ sortBy: 'created_at', sortDir: 'ASC' }),
    });
  });

  it('unmount flush writes immediately and the timer does not write again', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
    const model = createSqliteHistoryModel({ queryHistory, scheduler: createTimeoutPersistScheduler() });

    void model.changeSort('relevance', 'DESC');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    model.bumpGenerationOnUnmount();
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      history_sort_preference: JSON.stringify({ sortBy: 'relevance', sortDir: 'DESC' }),
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });
});
