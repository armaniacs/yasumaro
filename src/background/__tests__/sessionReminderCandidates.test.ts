/**
 * sessionReminderCandidates.test.ts
 * PBI 2026-10-22-04 O3 ― the SW-side candidate provider: one query, the
 * unread/private/trail rules, oldest-first cap, and the parity pin against
 * the dashboard aggregate's constants (dual-implementation drift guard).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createReminderCandidateProvider,
  pickReminderCandidateRows,
  toReminderCandidate,
  REMINDER_CANDIDATES_MAX,
  REMINDER_UNREAD_SCROLL_RATIO,
  REMINDER_QUERY_ROWS,
} from '../sessionReminderCandidates.js';
// Parity pin: tests may cross the layer boundary the production import ban
// guards (background → dashboard imports are prohibited, dev-docs/LAYERS.md).
import {
  buildReminderCandidates,
  REMINDER_MAX_CANDIDATES,
  UNREAD_SCROLL_RATIO,
} from '../../dashboard/sessionTimelineAggregate.js';
import { isPlaybackExcluded } from '../../dashboard/sessionTimelinePanel.js';
import type { BrowsingLogEntry, BrowsingLogRecord } from '../../utils/sqlite-types.js';
import type { Clock } from '../../utils/ports.js';
import { startOfLocalDayMs } from '../../utils/localDate.js';

function makeRow(overrides: Partial<BrowsingLogRecord> = {}): BrowsingLogRecord {
  return {
    id: 1,
    url: 'https://example.com/p1',
    title: 'Page 1',
    created_at: 1000,
    domain: 'example.com',
    scroll_ratio: 0.4,
    search_query: 'wasm',
    ...overrides,
  };
}

/** 2026-10-24 10:00 local — the day gate tests drive the clock to this. */
const NOW_MS = new Date(2026, 9, 24, 10, 0, 0).getTime();
const clock: Clock = { now: () => NOW_MS };

describe('toReminderCandidate', () => {
  it('maps an unread trailed row to a candidate', () => {
    const candidate = toReminderCandidate(makeRow());
    expect(candidate).not.toBeNull();
    expect(candidate?.record.id).toBe(1);
    expect(candidate?.record.title).toBe('Page 1');
    expect(candidate?.record.url).toBe('https://example.com/p1');
    expect(candidate?.scrollRatio).toBe(0.4);
  });

  it('drops rows without a numeric id (fail-closed)', () => {
    // exactOptionalPropertyTypes rejects an explicit undefined-valued key, so
    // the id is stripped through the widened record shape.
    const rowless = { ...makeRow(), id: undefined } as unknown as BrowsingLogRecord;
    expect(toReminderCandidate(rowless)).toBeNull();
  });

  it('drops 私物判定 rows (masked content)', () => {
    expect(toReminderCandidate(makeRow({ masked_count: 2 }))).toBeNull();
    expect(toReminderCandidate(makeRow({ masked_count: null }))).not.toBeNull();
  });

  it('drops already-read rows and keeps only ratios below the threshold', () => {
    expect(toReminderCandidate(makeRow({ scroll_ratio: 0.9 }))).toBeNull();
    expect(toReminderCandidate(makeRow({ scroll_ratio: 1 }))).toBeNull();
    expect(toReminderCandidate(makeRow({ scroll_ratio: 0.89 }))).not.toBeNull();
  });

  it('drops rows without a scroll ratio (fail-closed, absent scalar)', () => {
    expect(toReminderCandidate(makeRow({ scroll_ratio: null }))).toBeNull();
  });

  it('drops trail-less rows (not a session member)', () => {
    expect(toReminderCandidate(makeRow({ search_query: null, nav_source_url: null }))).toBeNull();
    expect(toReminderCandidate(makeRow({ search_query: '  ', nav_source_url: null }))).toBeNull();
    expect(toReminderCandidate(makeRow({ search_query: null, nav_source_url: 'https://a.dev/one' }))).not.toBeNull();
  });

  it('degrades a NULL title to the URL', () => {
    expect(toReminderCandidate(makeRow({ title: null }))?.record.title).toBe('https://example.com/p1');
  });
});

describe('pickReminderCandidateRows', () => {
  it('orders oldest unread first and caps the set', () => {
    const rows = [
      makeRow({ id: 3, created_at: 3000, title: 'Page 3' }),
      makeRow({ id: 1, created_at: 1000, title: 'Page 1' }),
      makeRow({ id: 2, created_at: 2000, title: 'Page 2' }),
    ];
    expect(pickReminderCandidateRows(rows, NOW_MS).map((c) => c.record.id)).toEqual([1, 2, 3]);
  });

  it('keeps at most the candidate cap', () => {
    const rows = Array.from({ length: REMINDER_CANDIDATES_MAX + 2 }, (_, i) =>
      makeRow({ id: i + 1, created_at: 1000 + i }),
    );
    expect(pickReminderCandidateRows(rows, NOW_MS)).toHaveLength(REMINDER_CANDIDATES_MAX);
  });

  it('skips rows without created_at', () => {
    const noTime = { ...makeRow(), created_at: undefined } as unknown as BrowsingLogRecord;
    expect(pickReminderCandidateRows([noTime], NOW_MS)).toEqual([]);
  });

  it('excludes unread pages recorded today (docs 契約: 前日までに読みかけたページを翌日に通知)', () => {
    const todayStart = startOfLocalDayMs(NOW_MS);
    const today = makeRow({ id: 7, created_at: todayStart + 1000 });
    const yesterday = makeRow({ id: 8, created_at: todayStart - 1000 });
    const picked = pickReminderCandidateRows([today, yesterday], NOW_MS).map((c) => c.record.id);
    expect(picked).toEqual([8]);
  });

  it('keeps unread pages recorded yesterday', () => {
    const todayStart = startOfLocalDayMs(NOW_MS);
    const rows = [
      makeRow({ id: 9, created_at: todayStart - 1 }),
      makeRow({ id: 10, created_at: todayStart - 90_000_000 }),
    ];
    expect(pickReminderCandidateRows(rows, NOW_MS).map((c) => c.record.id)).toEqual([10, 9]);
  });
});

describe('createReminderCandidateProvider', () => {
  it('runs one listing query with the shared row cap', async () => {
    const query = vi.fn(async () => ({
      success: true as const,
      data: { rows: [makeRow()], total: 1 },
    }));
    const provider = createReminderCandidateProvider({ query }, clock);
    const candidates = await provider();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ limit: REMINDER_QUERY_ROWS });
    expect(candidates).toHaveLength(1);
  });

  it('returns an empty set on a failed read (next tick retries)', async () => {
    const query = vi.fn(async () => ({
      success: false as const,
      error: { message: 'storage read failure' },
    }));
    const provider = createReminderCandidateProvider({ query }, clock);
    expect(await provider()).toEqual([]);
  });

  it('gates the day through the clock (unread recorded today is not a candidate)', async () => {
    const todayStart = startOfLocalDayMs(NOW_MS);
    const query = vi.fn(async () => ({
      success: true as const,
      data: { rows: [makeRow({ id: 11, created_at: todayStart + 500 })], total: 1 },
    }));
    const provider = createReminderCandidateProvider({ query }, clock);
    expect(await provider()).toEqual([]);
  });
});

describe('parity with the dashboard aggregate (drift guard)', () => {
  it('keeps the unread threshold and cap identical on both sides', () => {
    expect(REMINDER_UNREAD_SCROLL_RATIO).toBe(UNREAD_SCROLL_RATIO);
    expect(REMINDER_CANDIDATES_MAX).toBe(REMINDER_MAX_CANDIDATES);
  });

  it('agrees with the aggregate on which rows are candidates', () => {
    const rows = [
      makeRow({ id: 1, created_at: 1000, masked_count: 2 }),
      makeRow({ id: 2, created_at: 2000, scroll_ratio: 0.95 }),
      makeRow({ id: 3, created_at: 3000, scroll_ratio: null }),
      makeRow({ id: 4, created_at: 4000, search_query: null, nav_source_url: null }),
      makeRow({ id: 5, created_at: 5000 }),
      makeRow({ id: 6, created_at: 6000, scroll_ratio: 0.2 }),
    ];
    const swRecords = pickReminderCandidateRows(rows, NOW_MS).map((c) => c.record.id);
    // The aggregate's candidates run over the panel-side mapping and require
    // only the unread ratio; the SW set additionally narrows by the trail
    // columns (a reminder resumes a session, the aggregate's 縮退の出口), so
    // the SW set must be the subset of the aggregate's that has a trail.
    // The private-row exclusion rides the dashboard's own isPlaybackExcluded
    // (NOT a hand-rolled masked_count re-implementation), so a drift in the
    // panel contract fails this test with it.
    const aggregateRecords = buildReminderCandidates(
      rows
        .filter((row) => typeof row.id === 'number')
        .map((row) => ({
          id: row.id as number,
          title: row.title ?? row.url,
          url: row.url,
          createdAt: row.created_at as number,
          domain: row.domain ?? '',
          masked_count: row.masked_count ?? null,
          ...(typeof row.scroll_ratio === 'number' ? { scrollRatio: row.scroll_ratio } : {}),
          ...(typeof row.nav_source_url === 'string' ? { navSourceUrl: row.nav_source_url } : {}),
          ...(typeof row.search_query === 'string' ? { searchQuery: row.search_query } : {}),
        }))
        .filter((entry) => !isPlaybackExcluded(entry as unknown as BrowsingLogEntry)),
    ).map((c) => c.record.id);
    const aggregateSet = new Set(aggregateRecords);
    for (const id of swRecords) {
      expect(aggregateSet.has(id), `SW candidate ${id} must be an aggregate candidate`).toBe(true);
    }
    // The trail-less row stays in the aggregate (unread, non-private) but is
    // deliberately out of the SW set (no session to resume).
    expect(swRecords).not.toContain(4);
    expect(swRecords).toEqual([5, 6]);
  });
});
