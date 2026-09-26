// @vitest-environment jsdom
/**
 * fetchPeriodRows unit tests: the single panel fetch seam — success shape,
 * throw on persistent failure (service error and uninitialized DB), cap
 * detection via total > rows.length, key omission for undefined bounds and
 * tagFilter (exactOptionalPropertyTypes convention), and label propagation
 * into the thrown error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
const mockGetSqliteStatus = vi.fn();

vi.mock('../../dashboardSqliteService.js', () => ({
  queryLogs: (...args: unknown[]) => mockQueryLogs(...args),
  getSqliteStatus: (...args: unknown[]) => mockGetSqliteStatus(...args),
  isServiceError: (result: object) => 'error' in result,
}));

// Keep the backoff instant so the retries do not slow the suite down.
vi.mock('../../utils/retry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/retry.js')>();
  return {
    retryWithExponentialBackoff: (fn: () => Promise<unknown>, options: Record<string, unknown> = {}) =>
      actual.retryWithExponentialBackoff(fn as never, { ...options, baseDelayMs: 0, maxDelayMs: 0 }),
  };
});

import { fetchPeriodRows, fetchAllPeriodRows } from '../fetchPeriodRows.js';

function row(id: number): { id: number; url: string; title: string; created_at: number } {
  return { id, url: 'https://example.com/', title: 't', created_at: 1_700_000_000_000 + id };
}

/** A page of `size` rows whose created_at descends from `startAt`. */
function page(startId: number, size: number): { id: number; url: string; title: string; created_at: number }[] {
  return Array.from({ length: size }, (_, i) => row(startId - i));
}

describe('fetchPeriodRows', () => {
  beforeEach(() => {
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it('returns { rows, total, capped } on success', async () => {
    const rows = [row(1), row(2)];
    mockQueryLogs.mockResolvedValue({ data: { rows, total: 2 } });

    const result = await fetchPeriodRows({ since: 100, until: 200, limit: 50 });

    expect(result).toEqual({ rows, total: 2, capped: false });
    expect(mockQueryLogs).toHaveBeenCalledWith({ since: 100, until: 200, limit: 50 });
  });

  it('retries a service error up to maxAttempts and then throws', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'sqlite unavailable' });

    await expect(fetchPeriodRows({ limit: 10, label: 'timeHeatmap' })).rejects.toThrow(
      'timeHeatmap: query failed after retries',
    );
    expect(mockQueryLogs).toHaveBeenCalledTimes(4);
  });

  it('retries while the database is uninitialized and then throws without querying', async () => {
    mockGetSqliteStatus.mockResolvedValue({ initialized: false });

    await expect(fetchPeriodRows({ limit: 10, label: 'wordCluster' })).rejects.toThrow(
      'wordCluster: query failed after retries',
    );
    // The not-initialized guard returns null before querying, so the backoff
    // must retry the status check instead of treating the first null as done.
    expect(mockGetSqliteStatus.mock.calls.length).toBe(4);
    expect(mockQueryLogs).not.toHaveBeenCalled();
  });

  it('stops retrying as soon as a query succeeds', async () => {
    mockQueryLogs
      .mockResolvedValueOnce({ error: 'transient' })
      .mockResolvedValue({ data: { rows: [row(1)], total: 1 } });

    const result = await fetchPeriodRows({ limit: 10 });

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    expect(result.capped).toBe(false);
  });

  it('marks capped=true when total exceeds the fetched rows', async () => {
    const rows = [row(1), row(2)];
    mockQueryLogs.mockResolvedValue({ data: { rows, total: 15000 } });

    const result = await fetchPeriodRows({ limit: 2 });

    expect(result.capped).toBe(true);
    expect(result.rows).toEqual(rows);
    expect(result.total).toBe(15000);
  });

  it('marks capped=false when a period holds exactly the cap', async () => {
    const rows = [row(1), row(2)];
    mockQueryLogs.mockResolvedValue({ data: { rows, total: 2 } });

    const result = await fetchPeriodRows({ limit: 2 });

    expect(result.capped).toBe(false);
  });

  it('marks capped=false for 0 rows', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

    const result = await fetchPeriodRows({ limit: 10 });

    expect(result).toEqual({ rows: [], total: 0, capped: false });
  });

  it('omits since/until keys entirely when bounds are undefined', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

    await fetchPeriodRows({ limit: 10 });

    // Byte-identical to the pre-filter call: no since/until keys at all.
    expect(mockQueryLogs).toHaveBeenCalledWith({ limit: 10 });
    const args = mockQueryLogs.mock.calls[0]![0] as Record<string, unknown>;
    expect('since' in args).toBe(false);
    expect('until' in args).toBe(false);
  });

  it('omits only the undefined side of the bounds', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

    await fetchPeriodRows({ until: 500, limit: 10 });

    const args = mockQueryLogs.mock.calls[0]![0] as Record<string, unknown>;
    expect('since' in args).toBe(false);
    expect(args.until).toBe(500);
  });

  it('passes tagFilter through to queryLogs', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

    await fetchPeriodRows({ since: 1, until: 2, limit: 10, tagFilter: 'travel' });

    expect(mockQueryLogs).toHaveBeenCalledWith({
      since: 1,
      until: 2,
      tagFilter: 'travel',
      limit: 10,
    });
  });

  it('omits the tagFilter key when the tag is undefined', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

    await fetchPeriodRows({ since: 1, limit: 10, tagFilter: undefined });

    const args = mockQueryLogs.mock.calls[0]![0] as Record<string, unknown>;
    expect('tagFilter' in args).toBe(false);
  });

  it('propagates a custom label into the thrown error', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'down' });

    await expect(
      fetchPeriodRows({ limit: 10, label: 'tagClusterTimeSliderFirst' }),
    ).rejects.toThrow('tagClusterTimeSliderFirst: query failed after retries');
  });

  it('uses a default label in the thrown error when none is given', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'down' });

    await expect(fetchPeriodRows({ limit: 10 })).rejects.toThrow(
      'fetchPeriodRows: query failed after retries',
    );
  });

  it('honors a custom maxAttempts', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'down' });

    await expect(fetchPeriodRows({ limit: 10, maxAttempts: 2 })).rejects.toThrow();
    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
  });
});

describe('fetchAllPeriodRows', () => {
  const PAGE = 4;
  const MAX = 100;

  beforeEach(() => {
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it('stops on a short page and reports capped=false', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: page(4, PAGE - 1), total: 3 } });

    const result = await fetchAllPeriodRows({ pageSize: PAGE, maxRows: MAX, label: 'revisitInsights' });

    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(PAGE - 1);
    expect(result.capped).toBe(false);
  });

  it('pages until a short page arrives', async () => {
    mockQueryLogs
      .mockResolvedValueOnce({ data: { rows: page(4, PAGE), total: 10 } })
      .mockResolvedValueOnce({ data: { rows: page(0, PAGE - 1), total: 10 } });

    const result = await fetchAllPeriodRows({ pageSize: PAGE, maxRows: MAX, label: 'revisitInsights' });

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    expect(result.rows).toHaveLength(PAGE + (PAGE - 1));
    expect(result.capped).toBe(false);
  });

  it('de-duplicates boundary ties by id across pages', async () => {
    // The cursor is the previous page's oldest created_at and queryLogs' `until`
    // is inclusive, so a tie re-reads ids 2 and 3 from the first page.
    mockQueryLogs
      .mockResolvedValueOnce({ data: { rows: page(4, PAGE), total: 10 } })
      .mockResolvedValueOnce({ data: { rows: page(2, PAGE - 1), total: 10 } });

    const result = await fetchAllPeriodRows({ pageSize: PAGE, maxRows: MAX, label: 'revisitInsights' });

    const ids = result.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([4, 3, 2, 1, 0]);
  });

  it('reports capped=true and stops at maxRows', async () => {
    mockQueryLogs.mockImplementation(async () => ({
      data: { rows: page(4, PAGE), total: 10_000 },
    }));

    const result = await fetchAllPeriodRows({ pageSize: PAGE, maxRows: 4, label: 'revisitInsights' });

    expect(result.rows).toHaveLength(4);
    expect(result.capped).toBe(true);
  });

  it('advances the cursor to the previous page boundary, then steps back 1ms on a full tie page', async () => {
    // Page 1 is all boundary ties relative to the incoming cursor, so the
    // cursor steps back 1ms instead of stalling on the same timestamp.
    const tied = [row(1), row(1)];
    Object.assign(tied[1]!, { id: 1, created_at: tied[0]!.created_at });
    mockQueryLogs
      .mockResolvedValueOnce({ data: { rows: page(4, PAGE), total: 10 } })
      .mockResolvedValueOnce({ data: { rows: tied, total: 10 } })
      .mockResolvedValueOnce({ data: { rows: [], total: 0 } });

    await fetchAllPeriodRows({ pageSize: 2, maxRows: MAX, label: 'revisitInsights', until: 5000 });

    const secondUntil = (mockQueryLogs.mock.calls[1]![0] as { until: number }).until;
    const thirdUntil = (mockQueryLogs.mock.calls[2]![0] as { until: number }).until;
    expect(thirdUntil).toBe(secondUntil - 1);
  });

  it('omits since and tagFilter keys when they are undefined', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

    await fetchAllPeriodRows({ pageSize: PAGE, maxRows: MAX, label: 'revisitInsights' });

    const args = mockQueryLogs.mock.calls[0]![0] as Record<string, unknown>;
    expect('since' in args).toBe(false);
    expect('tagFilter' in args).toBe(false);
    expect(args.limit).toBe(PAGE);
  });

  it('propagates a persistent failure instead of returning a short set', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'sqlite unavailable' });

    await expect(
      fetchAllPeriodRows({ pageSize: PAGE, maxRows: MAX, label: 'revisitInsights' }),
    ).rejects.toThrow('revisitInsights: query failed after retries');
  });
});
