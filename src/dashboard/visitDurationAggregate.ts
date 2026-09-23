/**
 * visitDurationAggregate.ts
 * Pure aggregation for the visit-duration panel (PBI 2026-09-24-02).
 *
 * Groups browsing rows by domain and by tag, summing visit_duration
 * (milliseconds — see importLogsService MAX_VISIT_DURATION_MS and the
 * reviewSummaryGenerator ms-to-seconds display; no normalization is applied).
 * Rows with null/non-finite/negative durations are excluded from sums and
 * reported as an unmeasured ratio. Tag splitting reuses
 * parseTagsForDisplay so legacy comma-joined tags match the history view.
 */

import { parseTagsForDisplay } from '../utils/tagUtils.js';

/** Minimal row shape the aggregation reads (subset of BrowsingLogEntry). */
export interface VisitDurationInput {
  domain?: string | null;
  tags?: string | null;
  visit_duration?: number | null;
}

export interface VisitDurationRankRow {
  name: string;
  /** Summed visit_duration in milliseconds. */
  totalMs: number;
  /** Mean visit_duration in milliseconds. */
  avgMs: number;
  /** Measured records contributing to this row. */
  count: number;
}

export interface VisitDurationAggregation {
  domains: VisitDurationRankRow[];
  tags: VisitDurationRankRow[];
  totalCount: number;
  measuredCount: number;
  unmeasuredCount: number;
  /** unmeasuredCount / totalCount, 0 when totalCount is 0. */
  unmeasuredRatio: number;
  /** Distinct measured domains before top-N truncation. */
  domainTotal: number;
  /** Distinct measured tags before top-N truncation. */
  tagTotal: number;
  domainsTruncated: boolean;
  tagsTruncated: boolean;
}

/** Rows shown per ranking table (both tables truncate independently). */
export const VISIT_DURATION_TOP_N = 20;

/** Domain label for rows with a null/empty domain. */
export const UNKNOWN_DOMAIN_LABEL = '(unknown)';

/** A duration counts as measured only when it is a finite, non-negative number. */
export function isMeasuredDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

interface Accumulator {
  totalMs: number;
  count: number;
}

function toRanked(map: Map<string, Accumulator>, topN: number): { rows: VisitDurationRankRow[]; truncated: boolean } {
  const all: VisitDurationRankRow[] = [...map.entries()].map(([name, acc]) => ({
    name,
    totalMs: acc.totalMs,
    avgMs: acc.totalMs / acc.count,
    count: acc.count,
  }));
  // WHY: total ties are common on synthetic data — count desc then name asc
  // keeps the order deterministic instead of input-order dependent.
  all.sort((a, b) => b.totalMs - a.totalMs || b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { rows: all.slice(0, topN), truncated: all.length > topN };
}

/**
 * Aggregates rows into domain and tag rankings. Unmeasured rows contribute
 * only to the unmeasured ratio. Each tag on a measured row is credited with
 * the row's full duration (tag-cooccurrence convention).
 */
export function aggregateVisitDurations(
  rows: readonly VisitDurationInput[],
  topN: number = VISIT_DURATION_TOP_N,
): VisitDurationAggregation {
  const domains = new Map<string, Accumulator>();
  const tags = new Map<string, Accumulator>();
  let measuredCount = 0;

  for (const row of rows) {
    const duration = row.visit_duration;
    if (!isMeasuredDuration(duration)) continue;
    measuredCount += 1;

    const domain = row.domain?.trim() ? row.domain : UNKNOWN_DOMAIN_LABEL;
    const domainAcc = domains.get(domain) ?? { totalMs: 0, count: 0 };
    domainAcc.totalMs += duration;
    domainAcc.count += 1;
    domains.set(domain, domainAcc);

    // WHY: dedupe per row so a repeated tag on one record is credited once.
    const rowTags = new Set(parseTagsForDisplay(row.tags ?? null));
    for (const tag of rowTags) {
      const tagAcc = tags.get(tag) ?? { totalMs: 0, count: 0 };
      tagAcc.totalMs += duration;
      tagAcc.count += 1;
      tags.set(tag, tagAcc);
    }
  }

  const domainRanked = toRanked(domains, topN);
  const tagRanked = toRanked(tags, topN);
  const totalCount = rows.length;
  const unmeasuredCount = totalCount - measuredCount;

  return {
    domains: domainRanked.rows,
    tags: tagRanked.rows,
    totalCount,
    measuredCount,
    unmeasuredCount,
    unmeasuredRatio: totalCount === 0 ? 0 : unmeasuredCount / totalCount,
    domainTotal: domains.size,
    tagTotal: tags.size,
    domainsTruncated: domainRanked.truncated,
    tagsTruncated: tagRanked.truncated,
  };
}

/** Formats milliseconds as seconds (<60s), minutes (<60min), or hours. */
export function formatVisitDuration(ms: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '0s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${trimOne(ms / 60_000)} min`;
  return `${trimOne(ms / 3_600_000)} h`;
}

function trimOne(value: number): string {
  return String(Math.round(value * 10) / 10);
}
