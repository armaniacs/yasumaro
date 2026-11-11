/**
 * sqliteHistoryModel.guardInject.test.ts
 * PBI 2026-11-11-07 — Model私設ガードの共有seam注入化。
 *
 * Pins: (1) 注入したガードが実際に使用される (start呼び出し)。
 * (2) 外部からのinvalidateでin-flightが破棄される (stale共有)。
 * (3) 未指定時は従来通り動作する (既定生成)。
 */
import { describe, it, expect, vi } from 'vitest';
import { createSqliteHistoryModel } from '../sqliteHistoryModel.js';
import { ReloadGuard } from '../reloadGuard.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';

function makeRow(id: number): BrowsingLogEntry {
  return { id, url: `https://example.com/${id}`, title: `Example ${id}`, created_at: 1700000000000 + id * 1000 };
}

function deferredQueryHistory() {
  let resolveQuery!: (value: { data: { rows: BrowsingLogEntry[]; total: number } }) => void;
  const promise = new Promise<{ data: { rows: BrowsingLogEntry[]; total: number } }>((resolve) => {
    resolveQuery = resolve;
  });
  const fn = vi.fn(() => promise);
  return { fn, resolveQuery: (rows: BrowsingLogEntry[]) => resolveQuery({ data: { rows, total: rows.length } }) };
}

describe('sqliteHistoryModel reloadGuard injection', () => {
  it('uses the injected guard for fetch generations', async () => {
    const { fn, resolveQuery } = deferredQueryHistory();
    const guard = new ReloadGuard();
    const startSpy = vi.spyOn(guard, 'start');
    const model = createSqliteHistoryModel({ queryHistory: fn as never, reloadGuard: guard });

    const pending = model.fetchData({});
    expect(startSpy).toHaveBeenCalled();
    resolveQuery([makeRow(1)]);
    await pending;

    expect(model.getState().entries.map((e) => e.id)).toEqual([1]);
  });

  it('discards in-flight results invalidated through the shared guard', async () => {
    const { fn, resolveQuery } = deferredQueryHistory();
    const guard = new ReloadGuard();
    const model = createSqliteHistoryModel({ queryHistory: fn as never, reloadGuard: guard });

    const pending = model.fetchData({});
    guard.invalidate();
    resolveQuery([makeRow(1)]);
    await pending;

    expect(model.getState().entries).toEqual([]);
  });

  it('loads normally when no guard is injected (default)', async () => {
    const rows = [makeRow(1), makeRow(2)];
    const fn = vi.fn(async () => ({ data: { rows, total: rows.length } }));
    const model = createSqliteHistoryModel({ queryHistory: fn as never });

    await model.fetchData({});

    expect(model.getState().entries.map((e) => e.id)).toEqual([1, 2]);
  });
});
