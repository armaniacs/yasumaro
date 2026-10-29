/**
 * sessionReminderCandidates.ts
 *
 * Candidate provider (PBI 2026-10-22-04, O3): the service-worker-side SQLite
 * read that feeds SessionReminderAlarms.checkToday's injected queryCandidates.
 * One query per call — checkToday already skips the call while the daily gate
 * is closed, so the heavy DB read never runs on every hourly tick (既存
 * checkToday の契約を壊さない).
 *
 * WHY its own module: the dashboard aggregate (buildReminderCandidates) is the
 * mapping the playback panel renders, but background → dashboard imports are
 * prohibited (dev-docs/LAYERS.md), so this module mirrors the same rules and
 * produces ReminderCandidateLike (structurally assignable, no layer-violating
 * import). Dual implementation is accepted with a two-sided test (the R-06
 * day-gate precedent): the parity test pins the constants on both sides.
 *
 * Candidate rules mirrored from the aggregate + the panel's caller-side
 * exclusion:
 * - 私物記録は通知されない: masked_count > 0 rows are dropped (the same
 *   caller-side exclusion isPlaybackExcluded applies before the aggregate).
 * - 読みかけ: a record without a scroll ratio is not judged (fail-closed on
 *   absent scalars, the aggregate's 縮退の出口), and a ratio at or above the
 *   unread threshold is already read.
 * - trail 列あり: the reminder resumes a research session, and a record with
 *   neither trail column is not a session member (the aggregate's 縮退の出口).
 *   The notification candidate set is therefore a subset of the panel's.
 */

import { MAX_QUERY_ROWS } from '../utils/computeLimits.js';
import { startOfLocalDayMs } from '../utils/localDate.js';
import { SYSTEM_CLOCK, type Clock } from '../utils/ports.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
import type { ReminderCandidateLike } from '../utils/sessionReminder/reminderNotify.js';

/**
 * A record below this scroll ratio counts as 読みかけ (parity:
 * sessionTimelineAggregate.ts UNREAD_SCROLL_RATIO, pinned by the test).
 */
export const REMINDER_UNREAD_SCROLL_RATIO = 0.9;

/**
 * Candidates kept per aggregation (parity: sessionTimelineAggregate.ts
 * REMINDER_MAX_CANDIDATES, pinned by the test).
 */
export const REMINDER_CANDIDATES_MAX = 3;

/**
 * One read's window: the same recent slice the playback panel fetches, so a
 * notification candidate and the panel view agree on which records exist
 * (PBI Q3: overflow candidates stay visible in the playback panel).
 */
export const REMINDER_QUERY_ROWS = MAX_QUERY_ROWS;

/** Structural read seam (the offscreen gateway's listing query). */
export interface ReminderCandidateReader {
  query(op: { limit?: number }): Promise<
    | { success: true; data: { rows: BrowsingLogRecord[]; total: number } }
    | { success: false; error: { message: string } }
  >;
}

/**
 * Maps one stored row to a reminder candidate, or null when the row is not a
 * reminder candidate (not a real row, 私物, already read, or trail-less).
 */
export function toReminderCandidate(row: BrowsingLogRecord): ReminderCandidateLike | null {
  // A row without a numeric id is not a real DB row (fail-closed).
  if (typeof row.id !== 'number') return null;
  // 私物判定 rows are never notified (the panel's isPlaybackExcluded contract).
  if ((row.masked_count ?? 0) > 0) return null;
  // A record without a scroll ratio is not judged (fail-closed, absent scalar).
  if (typeof row.scroll_ratio !== 'number') return null;
  if (row.scroll_ratio >= REMINDER_UNREAD_SCROLL_RATIO) return null;
  const source = typeof row.nav_source_url === 'string' ? row.nav_source_url.trim() : '';
  const query = typeof row.search_query === 'string' ? row.search_query.trim() : '';
  // Neither trail column → not a session member → no session to resume.
  if (source === '' && query === '') return null;
  // NULL title degrades to the URL (the panel's toSessionTimelineRecord shape).
  const title = typeof row.title === 'string' && row.title.trim() !== '' ? row.title : row.url;
  return {
    record: { id: row.id, title, url: row.url },
    scrollRatio: row.scroll_ratio,
  };
}

/**
 * Filters and caps the candidates of one read. Oldest 読みかけ first (the
 * same order the aggregate emits: the trail walked away from earliest is the
 * one most worth resuming), capped so the surface stays quiet. `nowMs` gates
 * the day: only records created BEFORE today's local start are candidates
 * (docs 契約: 前日までに読みかけたページを翌日に通知する — a page still
 * being read today belongs to today's session, not to tomorrow's reminder).
 */
export function pickReminderCandidateRows(rows: BrowsingLogRecord[], nowMs: number): ReminderCandidateLike[] {
  const todayStart = startOfLocalDayMs(nowMs);
  const candidates: Array<{ candidate: ReminderCandidateLike; createdAt: number }> = [];
  for (const row of rows) {
    if (typeof row.created_at !== 'number') continue;
    // 当日の読みかけは候補外 (the reminder notifies yesterday's unread pages).
    if (row.created_at >= todayStart) continue;
    const candidate = toReminderCandidate(row);
    if (candidate !== null) {
      candidates.push({ candidate, createdAt: row.created_at });
    }
  }
  candidates.sort((a, b) => a.createdAt - b.createdAt);
  return candidates.slice(0, REMINDER_CANDIDATES_MAX).map((entry) => entry.candidate);
}

/**
 * The queryCandidates seam for SessionReminderAlarms: one listing query, the
 * candidate rules above, and an empty set on a failed read (the alarm's next
 * hourly tick retries; a read failure must not fire a notification from
 * absent data). The clock is injectable so tests drive the day gate.
 */
export function createReminderCandidateProvider(
  reader: ReminderCandidateReader,
  clock: Clock = SYSTEM_CLOCK,
): () => Promise<ReminderCandidateLike[]> {
  return async () => {
    const result = await reader.query({ limit: REMINDER_QUERY_ROWS });
    if (!result.success) return [];
    return pickReminderCandidateRows(result.data.rows, clock.now());
  };
}
