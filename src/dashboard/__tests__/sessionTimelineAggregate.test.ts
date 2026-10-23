/**
 * sessionTimelineAggregate.test.ts
 * PBI 2026-10-22-04 ― セッション復元 (タイムライン再生と読みかけリマインド).
 * Pins: the trail grouping (search_query / nav_source_url), the few-records
 * 縮退, the 読みかけ candidates with absent-engagement fail-closed, the daily
 * 間引き gate, and the cap.
 */
import { describe, it, expect } from 'vitest';
import {
  buildReminderCandidates,
  buildSessionTimelines,
  MIN_SESSION_SIZE,
  REMINDER_MAX_CANDIDATES,
  REMINDER_MAX_PER_DAY,
  shouldFireReminderToday,
  UNREAD_SCROLL_RATIO,
  type SessionTimelineRecord,
} from '../sessionTimelineAggregate.js';

function makeRecord(overrides: Partial<SessionTimelineRecord> = {}): SessionTimelineRecord {
  return {
    id: 1,
    title: 'Example',
    url: 'https://example.com/p1',
    createdAt: 1000,
    domain: 'example.com',
    ...overrides,
  };
}

describe('buildSessionTimelines (タイムライン再生: トレイル群の集計)', () => {
  it('groups records sharing the same search query in visit order', () => {
    const records = [
      makeRecord({ id: 1, searchQuery: 'wasm', createdAt: 2000 }),
      makeRecord({ id: 2, searchQuery: 'wasm', createdAt: 1000 }),
      makeRecord({ id: 3, searchQuery: 'other', createdAt: 3000 }),
    ];
    const sessions = buildSessionTimelines(records);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.basis).toBe('search_query');
    expect(sessions[0]?.records.map((r) => r.id)).toEqual([2, 1]);
  });

  it('groups records sharing the same navigation source', () => {
    const records = [
      makeRecord({ id: 1, navSourceUrl: 'https://example.com/list', createdAt: 1000 }),
      makeRecord({ id: 2, navSourceUrl: 'https://example.com/list', createdAt: 2000 }),
    ];
    const sessions = buildSessionTimelines(records);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.basis).toBe('nav_source_url');
  });

  it('prefers the search query over the source url (既存2列の優先順)', () => {
    const records = [
      makeRecord({ id: 1, searchQuery: 'q', navSourceUrl: 'https://example.com/s', createdAt: 1000 }),
      makeRecord({ id: 2, searchQuery: 'q', createdAt: 2000 }),
    ];
    const sessions = buildSessionTimelines(records);
    expect(sessions[0]?.basis).toBe('search_query');
  });

  it('drops trail-less records and groups below the minimum (少件数の縮退)', () => {
    expect(MIN_SESSION_SIZE).toBe(2);
    const records = [
      makeRecord({ id: 1, createdAt: 1000 }),
      makeRecord({ id: 2, searchQuery: 'solo', createdAt: 2000 }),
    ];
    expect(buildSessionTimelines(records)).toEqual([]);
  });

  it('sorts the biggest sessions first', () => {
    const records = [
      makeRecord({ id: 1, searchQuery: 'a', createdAt: 1000 }),
      makeRecord({ id: 2, searchQuery: 'a', createdAt: 2000 }),
      makeRecord({ id: 3, searchQuery: 'a', createdAt: 3000 }),
      makeRecord({ id: 4, searchQuery: 'b', createdAt: 1000 }),
      makeRecord({ id: 5, searchQuery: 'b', createdAt: 2000 }),
    ];
    const sessions = buildSessionTimelines(records);
    expect(sessions[0]?.records).toHaveLength(3);
    expect(sessions[1]?.records).toHaveLength(2);
  });
});

describe('buildReminderCandidates (読みかけリマインド: 再訪候補)', () => {
  it('returns records below the unread scroll ratio with the basis', () => {
    expect(UNREAD_SCROLL_RATIO).toBe(0.9);
    const records = [
      makeRecord({ id: 1, scrollRatio: 0.5, createdAt: 2000 }),
      makeRecord({ id: 2, scrollRatio: 1.0, createdAt: 1000 }),
      makeRecord({ id: 3, scrollRatio: 0.3, createdAt: 3000 }),
    ];
    const candidates = buildReminderCandidates(records);
    expect(candidates.map((c) => c.record.id)).toEqual([1, 3]);
    expect(candidates[0]?.scrollRatio).toBe(0.5);
  });

  it('fails closed on absent engagement data (縮退の出口)', () => {
    const records = [makeRecord({ id: 1, scrollRatio: undefined })];
    expect(buildReminderCandidates(records)).toEqual([]);
  });

  it('caps the candidate count (上限)', () => {
    expect(REMINDER_MAX_CANDIDATES).toBe(3);
    const records = Array.from({ length: 6 }, (_, i) =>
      makeRecord({ id: i + 1, scrollRatio: 0.1, createdAt: i * 1000 }),
    );
    expect(buildReminderCandidates(records)).toHaveLength(REMINDER_MAX_CANDIDATES);
  });
});

describe('shouldFireReminderToday (間引き: 1日1件)', () => {
  it('fires at most one reminder per local day', () => {
    expect(REMINDER_MAX_PER_DAY).toBe(1);
    expect(shouldFireReminderToday(null, '2026-10-23')).toBe(true);
    expect(shouldFireReminderToday('2026-10-22', '2026-10-23')).toBe(true);
    expect(shouldFireReminderToday('2026-10-23', '2026-10-23')).toBe(false);
  });
});
