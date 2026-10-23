/**
 * sessionTimelineAggregate.ts
 *
 * Session restoration aggregation (PBI 2026-10-22-04).
 * セッション復元: a research session is the records that share a trail —
 * the same search query or the same navigation source — ordered by visit time
 * (oldest first reads as the trail the user actually walked). 読みかけリマインド:
 * records that never reached the end become reminder candidates, rate-limited
 * so a heavy day cannot spam the notification surface.
 *
 * 縮退の出口: records with neither trail column are not session members —
 * the panel shows the reason instead of a session built on a single row.
 * プライベート除外: the caller filters the private判定 records before the
 * aggregation; this module never re-admits them.
 */

/** The persisted record fields the session aggregation reads. */
export interface SessionTimelineRecord {
  id: number;
  title: string;
  url: string;
  /** Local epoch ms the visit happened at. */
  createdAt: number;
  domain: string;
  /** Stay seconds (NULL-safe: absent stays absent). */
  visitDuration?: number | undefined;
  /** Scroll ratio 0-1 (NULL-safe: absent stays absent). */
  scrollRatio?: number | undefined;
  /** PBI 03 trail columns (absent = the visit has no trail). */
  navSourceUrl?: string | undefined;
  searchQuery?: string | undefined;
}

/** One restored session: the trail in visit order. */
export interface SessionTimeline {
  /** The trail key the session was grouped on (query or source url). */
  key: string;
  /** Which column formed the trail (算出根拠の表示). */
  basis: 'search_query' | 'nav_source_url';
  records: SessionTimelineRecord[];
}

/** Sessions need at least this many visits (少件数の縮退). */
export const MIN_SESSION_SIZE = 2;

/** A record below this scroll ratio counts as 読みかけ (not read to the end). */
export const UNREAD_SCROLL_RATIO = 0.9;

/** Reminders per day are capped (間引き): at most one notification a day. */
export const REMINDER_MAX_PER_DAY = 1;

/** Reminder candidates kept per aggregation (上限). */
export const REMINDER_MAX_CANDIDATES = 3;

function trailKeyOf(record: SessionTimelineRecord): { key: string; basis: 'search_query' | 'nav_source_url' } | null {
  const query = typeof record.searchQuery === 'string' ? record.searchQuery.trim() : '';
  if (query !== '') return { key: `query:${query}`, basis: 'search_query' };
  const source = typeof record.navSourceUrl === 'string' ? record.navSourceUrl.trim() : '';
  if (source !== '') return { key: `source:${source}`, basis: 'nav_source_url' };
  return null;
}

/**
 * Groups the records into research sessions. 縮退の出口: a record with no
 * trail is not a session member, and a group below MIN_SESSION_SIZE is
 * dropped — the panel shows the single rows instead of a fake session.
 */
export function buildSessionTimelines(records: SessionTimelineRecord[]): SessionTimeline[] {
  const groups = new Map<string, SessionTimeline>();
  for (const record of records) {
    const trail = trailKeyOf(record);
    if (trail === null) continue;
    const existing = groups.get(trail.key);
    if (existing) {
      existing.records.push(record);
      continue;
    }
    groups.set(trail.key, { key: trail.key, basis: trail.basis, records: [record] });
  }
  const sessions: SessionTimeline[] = [];
  for (const group of groups.values()) {
    if (group.records.length < MIN_SESSION_SIZE) continue;
    group.records.sort((a, b) => a.createdAt - b.createdAt);
    sessions.push(group);
  }
  sessions.sort((a, b) => b.records.length - a.records.length);
  return sessions;
}

/** One 読みかけ reminder candidate (再訪候補). */
export interface ReminderCandidate {
  record: SessionTimelineRecord;
  /** The scroll ratio that decided 読みかけ (判断根拠の表示). */
  scrollRatio: number;
}

/**
 * 読みかけ candidates: records that never reached the end. 縮退の出口: a
 * record with no scroll ratio is not judged — the panel shows the reason
 * instead of a reminder built on absent engagement data.
 */
export function buildReminderCandidates(records: SessionTimelineRecord[]): ReminderCandidate[] {
  const candidates: ReminderCandidate[] = [];
  for (const record of records) {
    if (record.scrollRatio === undefined) continue;
    if (record.scrollRatio >= UNREAD_SCROLL_RATIO) continue;
    candidates.push({ record, scrollRatio: record.scrollRatio });
  }
  // Oldest 読みかけ first: the trail the user walked away from earliest is
  // the one most worth resuming, and the cap keeps the surface quiet.
  candidates.sort((a, b) => a.record.createdAt - b.record.createdAt);
  return candidates.slice(0, REMINDER_MAX_CANDIDATES);
}

/**
 * The daily 間引き gate: at most REMINDER_MAX_PER_DAY notifications fire per
 * local day (PBI: 通知が多すぎる場合の上限と間引き). Pure — the caller passes
 * the last-fired day it stored.
 */
export function shouldFireReminderToday(lastFiredDay: string | null, today: string): boolean {
  if (lastFiredDay === today) return false;
  return true;
}
