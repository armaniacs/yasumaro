/**
 * researchSessionAggregate.ts
 * Pure grouping for the "Research Sessions" panel (PBI 2026-09-26-02).
 *
 * The analytics panels so far are all point aggregates — pages, domains, tags
 * counted per period. This one recovers the line: records recorded close
 * together in time are one burst of activity, and the shape of a burst
 * (theme, order, length) is what a returning researcher wants to see.
 *
 * WHY the gap is a parameter and not a constant: the recorder only stores
 * pages that passed the engagement gate, and same-day revisits are skipped, so
 * recorded gaps are longer than real reading gaps. The caller re-groups the
 * same rows at a different gap without refetching.
 *
 * WHY `durationMs` is first-to-last and not a sum: nothing in the schema
 * records how long a page was open. The panel states this rather than
 * implying a reading time it cannot know.
 */

import { parseTagsForDisplay } from '../utils/tagUtils.js';
import type { NameCount } from './revisitInsightsAggregate.js';

export const SESSION_GAP_OPTIONS_MIN = [5, 15, 30, 60] as const;
export type SessionGapMinutes = (typeof SESSION_GAP_OPTIONS_MIN)[number];
export const DEFAULT_SESSION_GAP_MIN: SessionGapMinutes = 30;

/** A single record is not a "session" — it is counted separately. */
export const MIN_SESSION_RECORDS = 2;
export const MAX_DISPLAY_SESSIONS = 100;
export const SESSION_TOP_TAGS = 5;
export const SESSION_TOP_DOMAINS = 3;

const MINUTE_MS = 60_000;

export interface SessionInput {
  id: number;
  url: string;
  title?: string | null;
  domain?: string | null;
  tags?: string | null;
  created_at: number;
  is_starred?: number | null;
  // Populated once the navigation trail columns exist (PBI 2026-09-26-03).
  nav_source_url?: string | null;
  search_query?: string | null;
}

export interface ResearchSession {
  startAt: number;
  endAt: number;
  durationMs: number;
  /** Ascending by created_at, then id. */
  records: SessionInput[];
  topTags: NameCount[];
  topDomains: NameCount[];
  starredCount: number;
}

export interface SessionAggregate {
  /** Newest first, multi-record sessions only, capped at MAX_DISPLAY_SESSIONS. */
  sessions: ResearchSession[];
  /** How many one-record groups were set aside. */
  singleCount: number;
  /** Multi-record sessions before the display cap was applied. */
  totalSessions: number;
  truncated: boolean;
}

function compareStrings(a: string, b: string): number {
  // WHY: code-unit comparison, not localeCompare — the order must not shift
  // with the browser's locale (revisitInsightsAggregate convention).
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function countNames(names: readonly string[], limit: number): NameCount[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const list: NameCount[] = [];
  for (const [name, count] of counts) list.push({ name, count });
  list.sort((a, b) => (b.count !== a.count ? b.count - a.count : compareStrings(a.name, b.name)));
  return list.slice(0, limit);
}

export function groupResearchSessions(
  rows: readonly SessionInput[],
  gapMinutes: number,
): SessionAggregate {
  // Copy before sorting: the caller's array is a fetch result it may reuse.
  const ordered = [...rows].sort((a, b) =>
    a.created_at !== b.created_at ? a.created_at - b.created_at : a.id - b.id,
  );
  const gapMs = gapMinutes * MINUTE_MS;

  const groups: SessionInput[][] = [];
  let current: SessionInput[] = [];
  let previousAt: number | null = null;

  for (const row of ordered) {
    // WHY: strictly greater splits, so a gap of exactly the threshold stays
    // in one session — "within N minutes" includes N.
    if (previousAt !== null && row.created_at - previousAt > gapMs) {
      groups.push(current);
      current = [];
    }
    current.push(row);
    previousAt = row.created_at;
  }
  if (current.length > 0) groups.push(current);

  const sessions: ResearchSession[] = [];
  let singleCount = 0;

  for (const records of groups) {
    if (records.length < MIN_SESSION_RECORDS) {
      singleCount += 1;
      continue;
    }
    const startAt = records[0]!.created_at;
    const endAt = records[records.length - 1]!.created_at;
    const tags: string[] = [];
    const domains: string[] = [];
    let starredCount = 0;
    for (const record of records) {
      for (const tag of parseTagsForDisplay(record.tags)) tags.push(tag);
      const domain = record.domain?.trim().toLowerCase() ?? '';
      if (domain.length > 0) domains.push(domain);
      if (record.is_starred === 1) starredCount += 1;
    }
    sessions.push({
      startAt,
      endAt,
      durationMs: endAt - startAt,
      records,
      topTags: countNames(tags, SESSION_TOP_TAGS),
      topDomains: countNames(domains, SESSION_TOP_DOMAINS),
      starredCount,
    });
  }

  sessions.sort((a, b) =>
    a.startAt !== b.startAt
      ? b.startAt - a.startAt
      : b.records[0]!.id - a.records[0]!.id,
  );

  return {
    sessions: sessions.slice(0, MAX_DISPLAY_SESSIONS),
    singleCount,
    totalSessions: sessions.length,
    truncated: sessions.length > MAX_DISPLAY_SESSIONS,
  };
}

/** Rounded minutes, never below 1 so a burst inside one minute still reads as "1 min". */
export function sessionDurationMinutes(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / MINUTE_MS));
}
