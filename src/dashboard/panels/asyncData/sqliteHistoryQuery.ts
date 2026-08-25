/**
 * sqliteHistoryQuery.ts
 * Unified history query module for the SQLite history panel.
 *
 * The panel used to reach into two storage schemas directly — SQLite rows via
 * dashboardSqliteService.queryLogs/searchLogs and legacy chrome.storage.local
 * entries via storageUrls.getSavedUrlEntries — and joined them at render time.
 * All of that knowledge now lives behind a single queryHistory() entry point:
 * row retrieval, snake_case/camelCase mapping, minute-bucket matching and
 * missing-value handling are hidden from the panel.
 *
 * The pure helpers below stay argument-only so they can be verified without a
 * DB mock or jsdom (existing test seam).
 */

import type { BrowsingLogEntry } from '../../../utils/sqlite-types.js';
import type { SavedUrlEntry } from '../../../utils/storageUrls.js';
import { queryLogs, searchLogs, isServiceError } from '../../dashboardSqliteService.js';
import type { ServiceResult } from '../../dashboardSqliteService.js';
import { getSavedUrlEntries } from '../../../utils/storageUrls.js';
import { pickDefined } from '../../../utils/objectUtils.js';
import { shouldFallbackToTextSearch } from '../../historyFilters.js';

export { isServiceError };
export type { BrowsingLogEntry } from '../../../utils/sqlite-types.js';

/** chrome.storage enrichment lookup key granularity (1 minute). */
const ENRICHMENT_KEY_BUCKET_MS = 60000;

/**
 * Fetch window used only when a tag filter is active.
 *
 * Tag matching runs client-side (see filterRowsByTag), so the rows have to be
 * in memory before they can be filtered and counted. This caps how far back
 * tag filtering can see; the non-tag path pages in SQL and has no such cap.
 */
const TAG_FILTER_FETCH_LIMIT = 5000;

/** Legacy lookup cache TTL; avoids re-reading chrome.storage on every query. */
const LEGACY_LOOKUP_CACHE_TTL_MS = 5000;

/**
 * Build the chrome.storage lookup key for an entry: the URL paired with its
 * timestamp rounded down to the minute.
 */
export function buildEnrichmentKey(url: string, timestampMs: number): string {
  return `${url}|${Math.floor(timestampMs / ENRICHMENT_KEY_BUCKET_MS)}`;
}

/**
 * Build the enrichment lookup map from the legacy chrome.storage entries.
 * Each SavedUrlEntry is keyed by URL + minute bucket of its own timestamp.
 */
export function buildLegacyMetadataMap(entries: SavedUrlEntry[]): Map<string, SavedUrlEntry> {
  const map = new Map<string, SavedUrlEntry>();
  for (const entry of entries) {
    map.set(buildEnrichmentKey(entry.url, entry.timestamp), entry);
  }
  return map;
}

/**
 * Fill diagnostic metadata missing on a SQLite entry from the matching legacy
 * chrome.storage entry. Values already present on the SQLite row always win
 * (left-priority via ??).
 *
 * @returns The enriched entry; the input reference when nothing to fill.
 */
export function enrichEntryWithChromeStorage(
  entry: BrowsingLogEntry,
  storageMap: Map<string, SavedUrlEntry>
): BrowsingLogEntry {
  // The main diagnostic fields are already present — nothing to fill.
  if (entry.sent_tokens != null || entry.received_tokens != null ||
      entry.page_bytes != null || entry.ai_provider != null) {
    return entry;
  }

  const storageEntry = storageMap.get(buildEnrichmentKey(entry.url, entry.created_at));
  if (!storageEntry) {
    return entry;
  }

  return {
    ...entry,
    content: entry.content ?? storageEntry.content ?? null,
    masked_count: entry.masked_count ?? storageEntry.maskedCount ?? null,
    cleansed_reason: entry.cleansed_reason ?? storageEntry.cleansedReason ?? null,
    ai_provider: entry.ai_provider ?? storageEntry.aiProvider ?? null,
    ai_model: entry.ai_model ?? storageEntry.aiModel ?? null,
    ai_duration_ms: entry.ai_duration_ms ?? storageEntry.aiDuration ?? null,
    obsidian_duration_ms: entry.obsidian_duration_ms ?? storageEntry.obsidianDuration ?? null,
    sent_tokens: entry.sent_tokens ?? storageEntry.sentTokens ?? null,
    received_tokens: entry.received_tokens ?? storageEntry.receivedTokens ?? null,
    original_tokens: entry.original_tokens ?? storageEntry.originalTokens ?? null,
    cleansed_tokens: entry.cleansed_tokens ?? storageEntry.cleansedTokens ?? null,
    page_bytes: entry.page_bytes ?? storageEntry.pageBytes ?? null,
    candidate_bytes: entry.candidate_bytes ?? storageEntry.candidateBytes ?? null,
    original_bytes: entry.original_bytes ?? storageEntry.originalBytes ?? null,
    cleansed_bytes: entry.cleansed_bytes ?? storageEntry.cleansedBytes ?? null,
    ai_summary_original_bytes: entry.ai_summary_original_bytes ?? storageEntry.aiSummaryOriginalBytes ?? null,
    ai_summary_cleansed_bytes: entry.ai_summary_cleansed_bytes ?? storageEntry.aiSummaryCleansedBytes ?? null,
    fallback_triggered: entry.fallback_triggered ?? (storageEntry.fallbackTriggered ? 1 : 0),
  };
}

function isNewerRow(a: BrowsingLogEntry, b: BrowsingLogEntry): boolean {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id);
}

/**
 * Enrich SQLite rows with legacy metadata under the per-bucket rule: for the
 * same URL inside the same minute bucket, only the newest SQLite row
 * (created_at DESC, then id DESC as tie-breaker) is enriched.
 *
 * The legacy store keeps one entry per URL with the timestamp of the last
 * visit; applying it to every matching row would attribute that single visit
 * to all of them. Missing legacy metadata never drops rows — each row is
 * returned as-is when no match exists.
 */
export function enrichRowsWithLegacyMetadata(
  rows: BrowsingLogEntry[],
  storageMap: Map<string, SavedUrlEntry>
): BrowsingLogEntry[] {
  const newestIndexByBucket = new Map<string, number>();
  rows.forEach((row, index) => {
    const key = buildEnrichmentKey(row.url, row.created_at);
    const newestIndex = newestIndexByBucket.get(key);
    if (newestIndex === undefined || isNewerRow(row, rows[newestIndex]!)) {
      newestIndexByBucket.set(key, index);
    }
  });

  return rows.map((row, index) => {
    const key = buildEnrichmentKey(row.url, row.created_at);
    if (newestIndexByBucket.get(key) !== index) return row;
    return enrichEntryWithChromeStorage(row, storageMap);
  });
}

/**
 * Tag filtering. Partial match against the comma-separated tags string.
 * Rows with unset or non-string tags are always excluded (existing rule).
 */
export function filterRowsByTag(rows: BrowsingLogEntry[], tagFilter: string): BrowsingLogEntry[] {
  return rows.filter(row => {
    const tagsString = row.tags || '';
    if (typeof tagsString !== 'string') return false;
    return tagsString.split(',').some(tag => tag.trim().includes(tagFilter));
  });
}

/**
 * Convert the calendar-selected date (YYYY-MM-DD) into a local-time range for
 * that day. An empty object (all time) is returned when no date is selected.
 */
export function dateRangeFromSelectedDate(selectedDate: string | null): { since?: number; until?: number } {
  if (!selectedDate) return {};
  const date = new Date(selectedDate + 'T00:00:00');
  return { since: date.getTime(), until: date.getTime() + 86400000 - 1 };
}

// ============================================================================
// Unified query entry point
// ============================================================================

export interface UnifiedHistoryQueryOptions {
  /** Full-text search term. When set, search replaces the paged query. */
  search?: string;
  since?: number;
  until?: number;
  limit: number;
  offset: number;
  /** Active tag filter; kept client-side, never pushed to the SQL query. */
  tagFilter?: string;
  /** True when the tag filter came from a Tag Cluster navigation. */
  tagInitiated?: boolean;
  /** Sort applied to results. 'relevance' is only meaningful when `search` is set. */
  sortBy?: 'created_at' | 'relevance';
  sortDir?: 'ASC' | 'DESC';
}

export interface UnifiedHistoryQueryData {
  /** Already-enriched rows; the panel never joins the two schemas itself. */
  rows: BrowsingLogEntry[];
  total: number;
  /**
   * Present only when a tag filter matched nothing and a full-text search was
   * attempted in its place. `searchQuery` is set when that search succeeded
   * (the panel syncs its search input to it). A failed fallback keeps the raw
   * over-fetched rows and leaves `searchQuery` unset.
   */
  tagFallback?: {
    searchQuery?: string;
    pendingTagFallback: { tag: string; fallbackTo: string; matched: number } | null;
  };
}

export type UnifiedHistoryQueryResult = ServiceResult<UnifiedHistoryQueryData>;

/**
 * Injectable data sources (test seam). Defaults to the real adapters: SQLite
 * via dashboardSqliteService and legacy storage via storageUrls. No new
 * adapter interface is introduced — these reuse the existing signatures.
 */
export interface HistoryQuerySources {
  queryLogs?: typeof queryLogs;
  searchLogs?: typeof searchLogs;
  getSavedUrlEntries?: typeof getSavedUrlEntries;
}

let legacyLookupCache: { map: Map<string, SavedUrlEntry>; builtAt: number } | null = null;

async function loadLegacyLookup(
  fetchEntries: typeof getSavedUrlEntries,
): Promise<Map<string, SavedUrlEntry>> {
  // The cache only wraps the real chrome.storage source; injected fakes stay
  // uncached so tests never observe stale state across cases.
  if (fetchEntries === getSavedUrlEntries && legacyLookupCache &&
      Date.now() - legacyLookupCache.builtAt < LEGACY_LOOKUP_CACHE_TTL_MS) {
    return legacyLookupCache.map;
  }
  const entries = await fetchEntries();
  const map = buildLegacyMetadataMap(entries);
  if (fetchEntries === getSavedUrlEntries) {
    legacyLookupCache = { map, builtAt: Date.now() };
  }
  return map;
}

async function enrichRows(
  rows: BrowsingLogEntry[],
  fetchEntries: typeof getSavedUrlEntries,
): Promise<BrowsingLogEntry[]> {
  if (rows.length === 0) return rows;
  let storageMap: Map<string, SavedUrlEntry>;
  try {
    storageMap = await loadLegacyLookup(fetchEntries);
  } catch (err) {
    // A legacy storage failure must never hide SQLite rows: fall back to the
    // un-enriched rows instead of failing the query.
    console.error('Failed to load chrome.storage entries for enrichment:', err);
    return rows;
  }
  return enrichRowsWithLegacyMetadata(rows, storageMap);
}

/**
 * Fetch browsing history through a single interface.
 *
 * SQLite rows are retrieved (paged query, full-text search, or a wide fetch
 * for client-side tag filtering), enriched with legacy chrome.storage metadata
 * under the per-bucket rule, and returned as unified rows.
 *
 * Tag filtering deliberately stays client-side: the SQL side matches tags via
 * FTS5 trigram MATCH, which needs >= 3 characters and has no LIKE fallback on
 * that path, so short tags (e.g. "AI") would silently return nothing.
 */
export async function queryHistory(
  options: UnifiedHistoryQueryOptions,
  sources: HistoryQuerySources = {},
): Promise<UnifiedHistoryQueryResult> {
  const queryRows = sources.queryLogs ?? queryLogs;
  const searchRows = sources.searchLogs ?? searchLogs;
  const fetchEntries = sources.getSavedUrlEntries ?? getSavedUrlEntries;

  let rows: BrowsingLogEntry[];
  let total: number;
  let tagFallback: UnifiedHistoryQueryData['tagFallback'];

  if (options.search) {
    const sortBy = options.sortBy ?? 'relevance';
    const orderBy = sortBy === 'relevance' ? 'rank' : 'created_at';
    const orderDir = options.sortDir ?? 'DESC';
    const searchResult = await searchRows(options.search, options.limit, options.offset, { orderBy, orderDir });
    if (isServiceError(searchResult)) return searchResult;
    rows = searchResult.data.rows;
    total = searchResult.data.total;
  } else {
    // The tag filter is deliberately NOT pushed down to the server; see the
    // function doc comment. Everything else pages in SQL.
    const useServerPaging = !options.tagFilter;
    const qRes = await queryRows({
      limit: useServerPaging ? options.limit : TAG_FILTER_FETCH_LIMIT,
      offset: useServerPaging ? options.offset : 0,
      ...pickDefined({ since: options.since, until: options.until }),
      orderBy: 'created_at',
      // NOTE: when a tag filter is active, this over-fetch is capped at
      // TAG_FILTER_FETCH_LIMIT and tag matching runs client-side (see
      // filterRowsByTag). Before sortDir was user-controlled, this fetch was
      // always DESC, so the cap consistently meant "the most recent N rows,
      // tag-filtered client-side". Now that orderDir follows the user's sort
      // choice, selecting "oldest first" with a tag filter active flips this
      // to ASC, so the cap instead means "the oldest N rows" — any tagged
      // entries newer than the Nth-oldest row are silently excluded from
      // that view. This is a known limitation, not a bug to fix here.
      orderDir: options.sortDir ?? 'DESC',
    });
    if (isServiceError(qRes)) return qRes;

    if (options.tagFilter) {
      const filteredRows = filterRowsByTag(qRes.data.rows, options.tagFilter);
      const fallbackTerm = shouldFallbackToTextSearch(
        options.tagInitiated ? 'tag' : 'manual',
        { rows: filteredRows, total: filteredRows.length },
        options.tagFilter,
      );
      if (fallbackTerm) {
        const sortBy = options.sortBy ?? 'relevance';
        const orderBy = sortBy === 'relevance' ? 'rank' : 'created_at';
        const orderDir = options.sortDir ?? 'DESC';
        const searchResult = await searchRows(fallbackTerm, options.limit, options.offset, { orderBy, orderDir });
        if (isServiceError(searchResult)) {
          // A failed fallback search must not return the raw over-fetched rows
          // as a successful result; surface the error so the panel can show it.
          return searchResult;
        }
        rows = searchResult.data.rows;
        total = searchResult.data.total;
        tagFallback = {
          searchQuery: fallbackTerm,
          pendingTagFallback: total > 0
            ? { tag: options.tagFilter, fallbackTo: fallbackTerm, matched: total }
            : null,
        };
      } else {
        // Client-side slice: the over-fetch already contains every candidate.
        rows = filteredRows.slice(options.offset, options.offset + options.limit);
        total = filteredRows.length;
      }
    } else {
      rows = qRes.data.rows;
      total = qRes.data.total;
    }
  }

  return {
    data: {
      rows: await enrichRows(rows, fetchEntries),
      total,
      ...(tagFallback ? { tagFallback } : {}),
    },
  };
}
