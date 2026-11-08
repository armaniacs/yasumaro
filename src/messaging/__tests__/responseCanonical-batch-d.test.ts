/**
 * responseCanonical-batch-d.test.ts — PBI 2026-11-08-17 (item 9) pins.
 *
 * The ids slice still truncates (absorption is the contract), but the cut
 * is now detectable: the optional `onTruncated` callback receives
 * `{ requested, kept }`. Omitting the callback keeps the old silent result
 * byte-identical.
 */
import { describe, it, expect, vi } from 'vitest';
import { MAX_QUERY_IDS } from '../../utils/limits.js';
import { normalizeReportScope } from '../responseCanonical.js';

describe('normalizeReportScope truncation notice (PBI 2026-11-08-17 item 9)', () => {
  it('reports the cut through onTruncated without changing the kept ids', () => {
    const onTruncated = vi.fn();
    const ids = Array.from({ length: MAX_QUERY_IDS + 50 }, (_, i) => i + 1);
    const scope = normalizeReportScope({ ids }, onTruncated);

    expect(scope.ids).toHaveLength(MAX_QUERY_IDS);
    expect(scope.ids?.[0]).toBe(1);
    expect(onTruncated).toHaveBeenCalledTimes(1);
    expect(onTruncated).toHaveBeenCalledWith({ requested: MAX_QUERY_IDS + 50, kept: MAX_QUERY_IDS });
  });

  it('stays silent through the same result when no callback is given', () => {
    const ids = Array.from({ length: MAX_QUERY_IDS + 50 }, (_, i) => i + 1);
    const scope = normalizeReportScope({ ids });
    expect(scope.ids).toHaveLength(MAX_QUERY_IDS);
  });

  it('does not fire the callback when nothing is cut', () => {
    const onTruncated = vi.fn();
    const scope = normalizeReportScope({ ids: [1, 2, 3] }, onTruncated);
    expect(scope.ids).toEqual([1, 2, 3]);
    expect(onTruncated).not.toHaveBeenCalled();
  });
});
