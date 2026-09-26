/**
 * researchSessionAggregate unit tests: gap splitting (including the exact
 * boundary), input-order independence, single-record accounting, the display
 * cap, tag/domain ranking, starred counts and duration rounding.
 */
import { describe, it, expect } from 'vitest';

import {
  groupResearchSessions,
  sessionDurationMinutes,
  MAX_DISPLAY_SESSIONS,
  SESSION_TOP_TAGS,
  type SessionInput,
} from '../../../researchSessionAggregate.js';

const MINUTE_MS = 60_000;
const BASE = new Date(2026, 8, 26, 10, 0, 0).getTime();

let nextId = 1;
function row(minutes: number, extra: Partial<SessionInput> = {}): SessionInput {
  return {
    id: nextId++,
    url: `https://example.dev/${minutes}`,
    title: `t-${minutes}`,
    domain: 'example.dev',
    tags: null,
    is_starred: null,
    created_at: BASE + minutes * MINUTE_MS,
    ...extra,
  };
}

describe('groupResearchSessions', () => {
  beforeEach(() => {
    nextId = 1;
  });

  it('returns an empty aggregate for no rows', () => {
    expect(groupResearchSessions([], 30)).toEqual({
      sessions: [],
      singleCount: 0,
      totalSessions: 0,
      truncated: false,
    });
  });

  it('keeps a gap of exactly the threshold in one session', () => {
    const result = groupResearchSessions([row(0), row(30)], 30);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.records).toHaveLength(2);
    expect(result.singleCount).toBe(0);
  });

  it('splits one millisecond past the threshold and counts both as single pages', () => {
    const rows = [row(0), { ...row(30), created_at: BASE + 30 * MINUTE_MS + 1 }];
    const result = groupResearchSessions(rows, 30);

    expect(result.sessions).toHaveLength(0);
    expect(result.singleCount).toBe(2);
  });

  it('sorts a reversed input without mutating the caller array', () => {
    const a = row(20);
    const b = row(0);
    const c = row(10);
    const input = [a, b, c];
    const snapshot = [...input];

    const result = groupResearchSessions(input, 30);

    expect(input).toEqual(snapshot);
    expect(result.sessions[0]?.records.map((r) => r.created_at)).toEqual([
      b.created_at,
      c.created_at,
      a.created_at,
    ]);
  });

  it('splits into one session and one single page', () => {
    // 0, 10, 20 are within 30 of each other; 200 is 180 minutes after 20.
    const result = groupResearchSessions([row(0), row(10), row(20), row(200)], 30);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.records).toHaveLength(3);
    expect(result.singleCount).toBe(1);
  });

  it('caps the displayed sessions and flags truncation, newest first', () => {
    const rows: SessionInput[] = [];
    // 101 two-record sessions, each pair two hours apart.
    for (let n = 0; n < 101; n += 1) {
      const start = n * 120;
      rows.push(row(start));
      rows.push(row(start + 30));
    }

    const result = groupResearchSessions(rows, 30);

    expect(result.sessions).toHaveLength(MAX_DISPLAY_SESSIONS);
    expect(result.totalSessions).toBe(101);
    expect(result.truncated).toBe(true);
    // Newest first.
    const starts = result.sessions.map((s) => s.startAt);
    expect([...starts].sort((a, b) => b - a)).toEqual(starts);
  });

  it('ranks tags by count then name and caps the list', () => {
    const result = groupResearchSessions(
      [
        row(0, { tags: '#b' }),
        row(1, { tags: '#b' }),
        row(2, { tags: '#a' }),
        row(3, { tags: '#a' }),
        row(4, { tags: '#c' }),
        row(5, { tags: '#d' }),
        row(6, { tags: '#d' }),
        row(7, { tags: '#d' }),
      ],
      30,
    );

    expect(result.sessions[0]?.topTags).toEqual([
      { name: 'd', count: 3 },
      { name: 'a', count: 2 },
      { name: 'b', count: 2 },
      { name: 'c', count: 1 },
    ]);
    expect(result.sessions[0]?.topTags.length).toBeLessThanOrEqual(SESSION_TOP_TAGS);
  });

  it('caps topTags at SESSION_TOP_TAGS', () => {
    const rows: SessionInput[] = [];
    for (let n = 0; n < 7; n += 1) rows.push(row(n, { tags: `#t${n}` }));
    for (let n = 7; n < 14; n += 1) rows.push(row(n, { tags: '#t0' }));

    const result = groupResearchSessions(rows, 30);

    expect(result.sessions[0]?.topTags).toHaveLength(SESSION_TOP_TAGS);
    // The most frequent tag leads even though its name sorts late.
    expect(result.sessions[0]?.topTags[0]).toEqual({ name: 't0', count: 8 });
  });

  it('re-groups the same rows at a different gap', () => {
    const rows = [row(0), row(10), row(20), row(200)];

    expect(groupResearchSessions(rows, 60).totalSessions).toBe(1);
    // At a 5-minute gap only the 0/10/20 run splits into three singles.
    const tight = groupResearchSessions(rows, 5);
    expect(tight.totalSessions).toBe(0);
    expect(tight.singleCount).toBe(4);
  });

  it('counts starred records', () => {
    const result = groupResearchSessions(
      [row(0, { is_starred: 1 }), row(5, { is_starred: 1 }), row(10, { is_starred: 0 })],
      30,
    );

    expect(result.sessions[0]?.starredCount).toBe(2);
  });

  it('lowercases and trims domains, dropping blanks', () => {
    const result = groupResearchSessions(
      [
        row(0, { domain: '  A.DEV ' }),
        row(1, { domain: 'a.dev' }),
        row(2, { domain: '   ' }),
        row(3, { domain: null }),
      ],
      30,
    );

    expect(result.sessions[0]?.topDomains).toEqual([{ name: 'a.dev', count: 2 }]);
  });

  it('records first-to-last duration, not a sum of gaps', () => {
    const result = groupResearchSessions([row(0), row(10), row(45)], 60);

    expect(result.sessions[0]?.durationMs).toBe(45 * MINUTE_MS);
  });
});

describe('sessionDurationMinutes', () => {
  it('never reports less than one minute', () => {
    expect(sessionDurationMinutes(0)).toBe(1);
    expect(sessionDurationMinutes(89_000)).toBe(1);
  });

  it('rounds to the nearest minute', () => {
    expect(sessionDurationMinutes(91_000)).toBe(2);
    expect(sessionDurationMinutes(45 * MINUTE_MS)).toBe(45);
  });
});
