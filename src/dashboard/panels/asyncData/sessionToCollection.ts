/**
 * sessionToCollection.ts
 *
 * Research-session → collection handoff (PBI 2026-11-02-05).
 *
 * The research-sessions panel groups records by time gaps; this module packs
 * ONE session into the stored collection query the collections editor draft
 * understands (`serializeClausesQuery` v2 shape), so the transfer reuses the
 * history→draft handoff bus (`historyHandoff.ts`) with no silent direct save.
 *
 * Mapping policy (ids-first):
 * - `ids` always pins every record id (ascending), never cut: more than
 *   MAX_QUERY_IDS refuses with 'over-limit' instead of truncating.
 * - `date` is added only when every record falls on the same local calendar
 *   day; a cross-day session stays ids-only with the 'cross-day' note.
 * - `tag` is added only when every record carries the same single tag; mixed
 *   or multi-tag sets stay ids-only with the 'mixed-tags' note. An
 *   all-untagged session carries no tag clause and no note (nothing was lost).
 * - `search` is added only when every record shares one non-empty
 *   search_query (uniform single value); otherwise it is omitted — with the
 *   'search-omitted' note when at least one record had a term (no auto
 *   confirm, no silent narrowing: the ids still pin the exact set).
 * - A session with zero quotable records still saves (report shows holes,
 *   so the pin set stays useful) with the non-blocking 'quotable-zero' note.
 *   Quotability defaults to "has a non-blank title" — SessionInput carries
 *   no content/summary, so callers with richer rows inject `isQuotable`.
 */

import { MAX_QUERY_IDS } from '../../../utils/limits.js';
import { formatLocalDateString } from '../../../utils/localDate.js';
import { parseTagsForDisplay } from '../../../utils/tagUtils.js';
import type {
  ResearchSession,
  SessionInput,
} from '../../researchSessionAggregate.js';
import { serializeClausesQuery } from './savedCollectionQuery.js';

export type SessionToCollectionNote =
  | 'mixed-tags'
  | 'cross-day'
  | 'search-omitted'
  | 'quotable-zero';

export type SessionToCollectionRefusal = 'empty' | 'over-limit';

export interface SessionToCollectionSuccess {
  ok: true;
  /** Stored query record: v2 `{ version: 2, op: 'and', clauses, ids }`. */
  query: Record<string, unknown>;
  notes: SessionToCollectionNote[];
  count: number;
  earliest: number;
  latest: number;
}

export interface SessionToCollectionFailure {
  ok: false;
  reason: SessionToCollectionRefusal;
  count: number;
}

export type SessionToCollectionResult =
  | SessionToCollectionSuccess
  | SessionToCollectionFailure;

export interface SessionToCollectionOptions {
  /**
   * Quotability probe. The default counts a record quotable when its title
   * is non-blank; inject a content-aware probe when the caller has one.
   */
  isQuotable?: (record: SessionInput) => boolean;
}

/** Default probe: SessionInput has no content/summary, so a blank title is the visible hole. */
export function defaultIsQuotableRecord(record: SessionInput): boolean {
  return (record.title ?? '').trim() !== '';
}

function sameTagArrays(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function buildSessionToCollectionQuery(
  session: Pick<ResearchSession, 'records'>,
  options?: SessionToCollectionOptions,
): SessionToCollectionResult {
  const records = session.records;
  const count = records.length;
  if (count === 0) {
    return { ok: false, reason: 'empty', count };
  }
  const ids = records.map((record) => record.id).sort((a, b) => a - b);
  if (ids.length > MAX_QUERY_IDS) {
    return { ok: false, reason: 'over-limit', count };
  }

  const notes: SessionToCollectionNote[] = [];

  const daySet = new Set(records.map((record) => formatLocalDateString(record.created_at)));
  const date = daySet.size === 1 ? [...daySet][0] ?? null : null;
  if (date === null) notes.push('cross-day');

  const tagSets = records.map((record) =>
    [...parseTagsForDisplay(record.tags)].sort(),
  );
  const firstTags = tagSets[0] ?? [];
  const uniformTags = tagSets.every((tags) => sameTagArrays(tags, firstTags));
  let tag: string | null = null;
  if (uniformTags && firstTags.length === 1) {
    tag = firstTags[0] ?? null;
  } else if (!(uniformTags && firstTags.length === 0)) {
    notes.push('mixed-tags');
  }

  const searches = records.map((record) => (record.search_query ?? '').trim());
  const firstSearch = searches[0] ?? '';
  const uniformSearch = searches.every((search) => search === firstSearch);
  let search = '';
  if (uniformSearch && firstSearch !== '') {
    search = firstSearch;
  } else if (searches.some((item) => item !== '')) {
    notes.push('search-omitted');
  }

  const isQuotable = options?.isQuotable ?? defaultIsQuotableRecord;
  if (!records.some((record) => isQuotable(record))) {
    notes.push('quotable-zero');
  }

  const clauses =
    search !== '' || tag !== null || date !== null
      ? [{ search, tag, date }]
      : [];
  const query = serializeClausesQuery('and', clauses, ids);

  let earliest = records[0]?.created_at ?? 0;
  let latest = earliest;
  for (const record of records) {
    if (record.created_at < earliest) earliest = record.created_at;
    if (record.created_at > latest) latest = record.created_at;
  }

  return { ok: true, query, notes, count, earliest, latest };
}

/** Save affordance guard: an empty session disables the button, an over-long one refuses on click. */
export function isSessionSaveable(count: number): boolean {
  return count > 0 && count <= MAX_QUERY_IDS;
}
