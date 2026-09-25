/**
 * computeLimits.ts
 * Input caps for O(n^2) computations over stored data (VULN-041/051/053, CWE-400).
 *
 * Stored tag strings and extracted sentences flow into double-loop / similarity-matrix
 * computations with no upper bound. Uncapped, a bloated or hostile page can push a single
 * record into hundreds of tags (C(n,2) edges) or thousands of sentences (n^2 similarity
 * matrix), making the dashboard freeze. These caps bound each such computation.
 *
 * Values match existing precedent (MAX_TAGS_AFTER_TRUNCATION = 50 in
 * pendingChromeStorageQueue.ts, MAX_NODES = 50 in tagClusterPanel.ts).
 */

import { QUERY_CAPS } from '../messaging/limits.js';

/**
 * Max unique tags considered per record in tag-cooccurrence.
 * Bounds the per-record double loop to C(50, 2) = 1225 iterations.
 * Tags kept: first N in original parse order (per-record, frequency-agnostic —
 * cross-record frequency is handled later by limitToTopNodes / top-N narrowing).
 */
export const MAX_TAGS_PER_RECORD = 50;

/**
 * Max sentences fed into TextRank. Bounds the similarity matrix to 200^2.
 * Applied after the minLength filter, preferring minLength-passing sentences.
 */
export const MAX_SENTENCES_FOR_TEXTRANK = 200;

/**
 * Max unique tags fed into tag-cooccurrence for the tag-cluster panel,
 * selected by cross-record frequency BEFORE cooccurrence runs. Matches the
 * downstream MAX_NODES render cap so no work is done on nodes that would be dropped.
 */
export const MAX_TAG_CLUSTER_TAGS = 50;

/**
 * Max rows fetched for the time-heatmap panel (12-month rolling window).
 * Aggregation is client-side over created_at; the cap bounds the transfer
 * and the O(n) bucket pass. The panel shows a limit notice when reached.
 */
export const MAX_TIME_HEATMAP_ROWS = 10000;

/**
 * Max rows fetched for the domain-analysis panel (user-selected period+tag).
 * queryLogs caps a single page at 10000 rows, so the panel paginates with
 * offset until this total cap; the panel shows a cap notice when the last
 * page comes back full (more rows likely exist beyond it).
 */
export const MAX_DOMAIN_ANALYSIS_ROWS = 50000;

/** Rows per queryLogs page for the domain-analysis panel (MAX / 5 pages). */
export const DOMAIN_ANALYSIS_PAGE_SIZE = 10000;

/**
 * Max rows fetched for the revisit-insights panel (fixed 400-day window, no
 * period filter). The panel pages with a keyset cursor to this total cap and
 * shows a cap notice when the last page comes back full — older counts in the
 * dormant/loop buckets are then understated rather than silently wrong.
 */
export const MAX_REVISIT_INSIGHTS_ROWS = 50000;

/**
 * Rows per queryLogs page for the revisit-insights panel.
 *
 * WHY: derived by reference from QUERY_CAPS.plain (the wire clamp) rather than
 * re-declared, so a dashboard page size larger than the clamp cannot drift
 * silently — a page asking for more than the wire allows would come back
 * short and end the keyset loop early (MAX_QUERY_ROWS precedent, PBI
 * 2026-09-24-15).
 */
export const REVISIT_INSIGHTS_PAGE_SIZE = QUERY_CAPS.plain;

/**
 * Max rows fetched for the tag-frequency-timeline panel (user-selected period).
 * A single queryLogs page; the cap bounds the transfer and the O(n) bucket
 * pass. The panel shows a cap notice when reached (more rows likely exist).
 */
export const MAX_TAG_TIMELINE_ROWS = 10000;

/**
 * WHY: this must equal QUERY_CAPS.plain (the wire clamp owned by
 * src/messaging/limits.ts) because the panels interpolate it into their
 * truncation notices — if the dashboard ask and the wire clamp drifted, the
 * notice text would quietly lie about the effective limit. It is derived by
 * reference (not re-declared) so drift is structurally impossible.
 *
 * Layer direction: importing it from utils is safe — messaging/limits.ts is a
 * pure foundation module (@layer 0, zero imports, no chrome API), so this edge
 * points downward into foundation, matching the queryPlan.ts precedent and the
 * LAYERS.md rule allowing pure-constant imports across seams (PBI
 * 2026-09-24-09). Equality with QUERY_CAPS.plain is additionally pinned by
 * src/messaging/__tests__/limits-drift.test.ts.
 */
export const MAX_QUERY_ROWS = QUERY_CAPS.plain;
