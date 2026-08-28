import { describe, it, expect, vi } from 'vitest';
import { SyncBatchRunner, type PendingSyncRow } from '../SyncBatchRunner.js';

function row(id: number): PendingSyncRow {
  return { id, url: `https://example.com/${id}`, title: `title-${id}`, summary: null };
}

describe('SyncBatchRunner', () => {
  it('delegates to listPending with the configured batch size', async () => {
    const listPending = vi.fn().mockResolvedValue([]);
    const markSynced = vi.fn();
    const runner = new SyncBatchRunner({ targetName: 'Test', listPending, markSynced, batchSize: 25 });

    await runner.run();

    expect(listPending).toHaveBeenCalledWith(25);
  });

  it('uses the default batch size (50) when none is provided', async () => {
    const listPending = vi.fn().mockResolvedValue([]);
    const markSynced = vi.fn();
    const runner = new SyncBatchRunner({ targetName: 'Test', listPending, markSynced });

    await runner.run();

    expect(listPending).toHaveBeenCalledWith(50);
  });

  it('calls markSynced once per pending row and counts successes', async () => {
    const rows = [row(1), row(2), row(3)];
    const listPending = vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    const markSynced = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const runner = new SyncBatchRunner({ targetName: 'Test', listPending, markSynced });

    const total = await runner.run();

    expect(markSynced).toHaveBeenCalledTimes(3);
    expect(markSynced).toHaveBeenNthCalledWith(1, rows[0]);
    expect(markSynced).toHaveBeenNthCalledWith(2, rows[1]);
    expect(markSynced).toHaveBeenNthCalledWith(3, rows[2]);
    expect(total).toBe(2);
  });

  it('stops iterating once listPending returns an empty batch', async () => {
    const listPending = vi.fn().mockResolvedValueOnce([row(1)]).mockResolvedValueOnce([]);
    const markSynced = vi.fn().mockResolvedValue(true);
    const runner = new SyncBatchRunner({ targetName: 'Test', listPending, markSynced });

    await runner.run();

    expect(listPending).toHaveBeenCalledTimes(2);
  });

  it('stops iterating when a batch makes no progress (all markSynced calls fail)', async () => {
    const listPending = vi.fn().mockResolvedValue([row(1)]);
    const markSynced = vi.fn().mockResolvedValue(false);
    const runner = new SyncBatchRunner({ targetName: 'Test', listPending, markSynced });

    const total = await runner.run();

    expect(listPending).toHaveBeenCalledTimes(1);
    expect(total).toBe(0);
  });

  it('respects maxIterations as a hard cap even when progress keeps being made', async () => {
    const listPending = vi.fn().mockResolvedValue([row(1)]);
    const markSynced = vi.fn().mockResolvedValue(true);
    const runner = new SyncBatchRunner({ targetName: 'Test', listPending, markSynced, maxIterations: 3 });

    const total = await runner.run();

    expect(listPending).toHaveBeenCalledTimes(3);
    expect(total).toBe(3);
  });

  it('propagates errors from listPending', async () => {
    const listPending = vi.fn().mockRejectedValue(new Error('query failed'));
    const markSynced = vi.fn();
    const runner = new SyncBatchRunner({ targetName: 'Test', listPending, markSynced });

    await expect(runner.run()).rejects.toThrow('query failed');
  });

  it('propagates errors from markSynced', async () => {
    const listPending = vi.fn().mockResolvedValue([row(1)]);
    const markSynced = vi.fn().mockRejectedValue(new Error('mutate failed'));
    const runner = new SyncBatchRunner({ targetName: 'Test', listPending, markSynced });

    await expect(runner.run()).rejects.toThrow('mutate failed');
  });

  it('returns 0 and does not call markSynced when there is nothing pending', async () => {
    const listPending = vi.fn().mockResolvedValue([]);
    const markSynced = vi.fn();
    const runner = new SyncBatchRunner({ targetName: 'Test', listPending, markSynced });

    const total = await runner.run();

    expect(total).toBe(0);
    expect(markSynced).not.toHaveBeenCalled();
  });
});
