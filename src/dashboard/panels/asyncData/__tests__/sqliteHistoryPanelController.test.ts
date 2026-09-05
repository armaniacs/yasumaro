/**
 * sqliteHistoryPanelController.test.ts
 * DOM-independent verification of the SQLite history panel controller.
 *
 * Unlike sqliteHistoryPanel-generation.test.ts (jsdom, asserts on rendered
 * DOM text as a proxy for the race guard), this file exercises the
 * controller directly through its public interface — no jsdom, no DOM
 * string assertions. queryHistory/getSqliteStatus are injected via deps.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSqliteHistoryController } from '../sqliteHistoryPanelController.js';
import type { UnifiedHistoryQueryResult } from '../sqliteHistoryQuery.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';

function makeRow(id: number, overrides: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Example ${id}`,
    created_at: 1700000000000 + id,
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('sqliteHistoryPanelController — requestGeneration race guard', () => {
  it('ignores a stale response that resolves after a newer one', async () => {
    const stale = deferred<UnifiedHistoryQueryResult>();
    const newer = deferred<UnifiedHistoryQueryResult>();
    const queryHistory = vi.fn()
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => newer.promise);

    const onStateChange = vi.fn();
    const controller = createSqliteHistoryController({ queryHistory, onStateChange });

    const first = controller.fetchData({ page: 0 });
    const second = controller.fetchData({ page: 0 });

    newer.resolve({ data: { rows: [makeRow(2)], total: 1 } });
    await second;
    expect(controller.getState().entries.map(e => e.id)).toEqual([2]);

    stale.resolve({ data: { rows: [makeRow(1)], total: 1 } });
    await first;

    // The stale generation's result must never overwrite the newer one.
    expect(controller.getState().entries.map(e => e.id)).toEqual([2]);
    expect(controller.getState().loading).toBe(false);
  });

  it('keeps the newest response when a stale one fails after a success', async () => {
    const stale = deferred<UnifiedHistoryQueryResult>();
    const newer = deferred<UnifiedHistoryQueryResult>();
    const queryHistory = vi.fn()
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => newer.promise);

    const controller = createSqliteHistoryController({ queryHistory, onStateChange: vi.fn() });

    const first = controller.fetchData({ page: 0 });
    const second = controller.fetchData({ page: 0 });

    newer.resolve({ data: { rows: [makeRow(2)], total: 1 } });
    await second;

    stale.resolve({ error: 'stale network failure' });
    await first;

    expect(controller.getState().entries.map(e => e.id)).toEqual([2]);
    expect(controller.getState().error).toBeNull();
    expect(controller.getState().loading).toBe(false);
  });

  it('onNavigateOut causes any still-pending fetch to be discarded', async () => {
    const pending = deferred<UnifiedHistoryQueryResult>();
    const queryHistory = vi.fn().mockImplementationOnce(() => pending.promise);
    const controller = createSqliteHistoryController({ queryHistory, onStateChange: vi.fn() });

    const inFlight = controller.fetchData({ page: 0 });
    controller.onNavigateOut();

    pending.resolve({ data: { rows: [makeRow(1)], total: 1 } });
    await inFlight;

    // The generation bump must make the panel treat this response as stale.
    expect(controller.getState().entries).toEqual([]);
  });
});

describe('sqliteHistoryPanelController — onNavigateIn lifecycle', () => {
  it('navigating in with a tag activates the tag filter', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
    const controller = createSqliteHistoryController({ queryHistory, onStateChange: vi.fn() });

    await controller.onNavigateIn({ searchTag: 'AI' });

    expect(controller.getState().activeTagFilter).toBe('AI');
  });

  it('navigating in with a domain searches it', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
    const controller = createSqliteHistoryController({ queryHistory, onStateChange: vi.fn() });

    await controller.onNavigateIn({ searchDomain: 'example.com' });

    expect(controller.getState().searchQuery).toBe('example.com');
  });

  it('plain navigation carries no leftover init (no leak into a later call)', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
    const controller = createSqliteHistoryController({ queryHistory, onStateChange: vi.fn() });

    await controller.onNavigateIn({});
    expect(controller.getState().activeTagFilter).toBeNull();
    // Second call still sees no init (no leftover state to leak).
    await controller.onNavigateIn({});
    expect(controller.getState().activeTagFilter).toBeNull();
  });

  it('a tag navigation is consumed exactly once (loadData/onActivate race)', async () => {
    const controller = createSqliteHistoryController({
      queryHistory: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
      onStateChange: vi.fn(),
    });

    await controller.onNavigateIn({ searchTag: 'AI' });
    expect(controller.getState().activeTagFilter).toBe('AI');
    // A second plain navigation must not see the same init again.
    await controller.onNavigateIn({});
    expect(controller.getState().activeTagFilter).toBeNull();
  });
});

describe('sqliteHistoryPanelController — selectAllEntries (段階C-2 bug fix)', () => {
  it('replaces the selection set rather than adding to it, matching historyStateReducer', async () => {
    const queryHistory = vi.fn().mockResolvedValue({
      data: { rows: [makeRow(1), makeRow(2)], total: 2 },
    });
    const controller = createSqliteHistoryController({ queryHistory, onStateChange: vi.fn() });
    await controller.fetchData({ page: 0 });

    // Simulate a stale id that should NOT survive a fresh "select all":
    // select id 1 alone, then deselect it, leaving selectedIds conceptually
    // empty — a correct selectAllEntries(true) must select exactly the
    // current entries, not the leftover value of any prior Set.
    controller.selectEntry(1, true);
    controller.selectEntry(1, false);

    controller.selectAllEntries(true);
    expect(controller.getState().selectedIds).toEqual(new Set([1, 2]));

    controller.selectAllEntries(false);
    expect(controller.getState().selectedIds).toEqual(new Set());
  });
});

describe('sqliteHistoryPanelController — fallback check inside onNavigateIn', () => {
  it('sets fallbackMode when getSqliteStatus reports fallback', async () => {
    const getSqliteStatus = vi.fn().mockResolvedValue({ fallback: true });
    const onStateChange = vi.fn();
    const controller = createSqliteHistoryController({ getSqliteStatus, onStateChange });

    await controller.onNavigateIn({});

    expect(controller.getState().fallbackMode).toBe(true);
    expect(onStateChange).toHaveBeenCalled();
  });

  it('does not throw and does not set fallbackMode when getSqliteStatus rejects', async () => {
    const getSqliteStatus = vi.fn().mockRejectedValue(new Error('network down'));
    const controller = createSqliteHistoryController({ getSqliteStatus, onStateChange: vi.fn() });

    await expect(controller.onNavigateIn({})).resolves.toBeUndefined();
    expect(controller.getState().fallbackMode).toBe(false);
  });
});
