/**
 * tagFrequencyTimeline.ts
 * Pure aggregation for the tag-frequency-timeline panel (PBI 2026-09-24-05).
 *
 * Counts, per tag, the records bucketed into weekly or monthly buckets in
 * LOCAL time, keeping only the top-N tags by total count within the period
 * and aggregating everything beyond N into an "other" total. The panel maps
 * the result onto a stacked SVG chart plus an equal-value numeric table.
 *
 * Bucket rules (PBI 実装メモ):
 * - Week buckets start on local SUNDAY; month buckets are calendar months.
 * - The first/last buckets are never truncated away even when the data only
 *   covers part of the bucket — the partial range is conveyed by labelling
 *   each bucket with its start date.
 * - A record carrying multiple tags adds 1 to every tag it contains
 *   (deduplicated per record), so per-bucket sums can exceed the record count.
 *
 * The bucket range derives from the tagged records themselves (min..max
 * created_at), not from the query window: buckets with no tagged record
 * carry no information the chart or table could show.
 */

import { parseTagsForDisplay } from '../utils/tagUtils.js';
import { MAX_TAGS_PER_RECORD } from '../utils/computeLimits.js';

export type TimelineGranularity = 'week' | 'month';

/** Minimal row shape the aggregation reads (subset of BrowsingLogEntry). */
export interface TimelineInput {
  tags?: string | null;
  created_at: number;
}

/**
 * Default number of individual tag series rendered before the "other"
 * aggregation (PBI 既定10).
 */
export const TIMELINE_DEFAULT_TOP_N = 10;

/**
 * Computation cap for the top-N selection, mirroring
 * MAX_TAG_CLUSTER_TAGS (VULN-053 house rule): the render layer stays bounded
 * even when a caller passes an unclamped N.
 */
export const TIMELINE_MAX_TOP_N = 50;

export interface TimelineBucket {
  /** Inclusive local-midnight start of the bucket (a Sunday or the 1st). */
  start: number;
  /** Exclusive end of the bucket = the next bucket's start (nominal length). */
  end: number;
  /** Per-tag record counts for the top-N tags (zero-count tags omitted). */
  counts: Record<string, number>;
  /** Record-tag pairs for tags outside the top-N, aggregated. */
  otherCount: number;
}

export interface TagFrequencyTimeline {
  granularity: TimelineGranularity;
  /**
   * Top tags in deterministic order (total count desc, then name asc) —
   * also the stacking order for the chart and the column order of the table.
   */
  tags: string[];
  /** True when at least one record-tag pair fell outside the top-N. */
  hasOther: boolean;
  /** Chronological buckets (start ascending). */
  buckets: TimelineBucket[];
}

/** Local-midnight start of the SUNDAY-based week containing `ts`. */
export function startOfLocalWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

/** Local-midnight start of the calendar month containing `ts`. */
export function startOfLocalMonth(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketStart(ts: number, granularity: TimelineGranularity): number {
  return granularity === 'week' ? startOfLocalWeek(ts) : startOfLocalMonth(ts);
}

/**
 * Exclusive end of the bucket starting at `start`. Calendar-day arithmetic
 * via setDate/setMonth keeps the result at a local midnight even across DST
 * transitions (raw ms addition would drift by ±1h).
 */
export function nextBucketStart(start: number, granularity: TimelineGranularity): number {
  const d = new Date(start);
  if (granularity === 'week') {
    d.setDate(d.getDate() + 7);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d.getTime();
}

/** Locale-neutral YYYY-MM-DD label for a bucket start (local parts). */
export function formatBucketDate(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function clampTopN(topN: number | undefined): number {
  if (topN === undefined || !Number.isFinite(topN)) return TIMELINE_DEFAULT_TOP_N;
  return Math.min(Math.max(Math.trunc(topN), 1), TIMELINE_MAX_TOP_N);
}

export function computeTagFrequencyTimeline(
  rows: readonly TimelineInput[],
  options: { granularity: TimelineGranularity; topN?: number },
): TagFrequencyTimeline {
  const { granularity } = options;
  const topN = clampTopN(options.topN);

  // Pass 1: per-tag totals over tagged records (record counts, not tag pairs,
  // so a multi-tag record does not inflate a tag's rank).
  const totals = new Map<string, number>();
  const parsed: Array<{ created_at: number; tags: string[] }> = [];
  for (const row of rows) {
    const createdAt = row.created_at;
    if (!Number.isFinite(createdAt)) continue;
    // WHY: dedupe + cap per record — the same guard tagCooccurrence applies
    // before its O(n^2) loop (VULN-041), and duplicate tags in one record
    // must not double-count (1 record = 1 count per contained tag).
    const tags = Array.from(new Set(parseTagsForDisplay(row.tags))).slice(0, MAX_TAGS_PER_RECORD);
    if (tags.length === 0) continue;
    parsed.push({ created_at: createdAt, tags });
    for (const tag of tags) {
      totals.set(tag, (totals.get(tag) ?? 0) + 1);
    }
  }

  // Deterministic ranking: count desc then name asc (domainAnalysisAggregate
  // convention — keeps reruns stable instead of input-order dependent).
  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([tag]) => tag);
  const topTags = ranked.slice(0, topN);
  const topSet = new Set(topTags);

  // Pass 2: bucket the tagged records.
  const byStart = new Map<number, TimelineBucket>();
  let otherTotal = 0;
  for (const record of parsed) {
    const start = bucketStart(record.created_at, granularity);
    let bucket = byStart.get(start);
    if (!bucket) {
      bucket = { start, end: 0, counts: {}, otherCount: 0 };
      byStart.set(start, bucket);
    }
    for (const tag of record.tags) {
      if (topSet.has(tag)) {
        bucket.counts[tag] = (bucket.counts[tag] ?? 0) + 1;
      } else {
        bucket.otherCount += 1;
        otherTotal += 1;
      }
    }
  }

  const buckets = [...byStart.values()].sort((a, b) => a.start - b.start);
  for (const bucket of buckets) {
    bucket.end = nextBucketStart(bucket.start, granularity);
  }

  return {
    granularity,
    tags: topTags,
    hasOther: otherTotal > 0,
    buckets,
  };
}
