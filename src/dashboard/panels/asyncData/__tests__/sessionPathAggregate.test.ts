/**
 * sessionPathAggregate unit tests: the trail gate, the parent-matching rule
 * (including the "latest wins" and "no cycle" edges), and the search→goal
 * bucketing, rounding and ordering.
 */
import { describe, it, expect } from 'vitest';

import {
  buildSessionTree,
  computeSearchToGoal,
  hasNavTrail,
  SEARCH_TO_GOAL_MIN_SESSIONS,
  UNTAGGED_KEY,
} from '../../../sessionPathAggregate.js';
import type {
  ResearchSession,
  SessionInput,
} from '../../../researchSessionAggregate.js';

const MINUTE_MS = 60_000;
const BASE = new Date(2026, 8, 26, 9, 0, 0).getTime();

let nextId = 1;
function rec(
  minutes: number,
  over: Partial<SessionInput> = {},
): SessionInput {
  return {
    id: nextId++,
    url: `https://a.dev/${minutes}`,
    title: `t-${minutes}`,
    domain: 'a.dev',
    tags: null,
    is_starred: null,
    created_at: BASE + minutes * MINUTE_MS,
    ...over,
  };
}

function session(records: SessionInput[]): ResearchSession {
  const startAt = records[0]!.created_at;
  const endAt = records[records.length - 1]!.created_at;
  return {
    startAt,
    endAt,
    durationMs: endAt - startAt,
    records,
    topTags: [],
    topDomains: [],
    starredCount: 0,
  };
}

describe('hasNavTrail', () => {
  it('is false for a session with no referrer', () => {
    expect(hasNavTrail(session([rec(0), rec(5)]))).toBe(false);
  });

  it('is true when any record carries a referrer', () => {
    expect(hasNavTrail(session([rec(0), rec(5, { nav_source_url: 'https://a.dev/0' })]))).toBe(true);
  });

  it('treats an empty-string referrer as absent', () => {
    expect(hasNavTrail(session([rec(0, { nav_source_url: '' }), rec(5)]))).toBe(false);
  });
});

describe('buildSessionTree', () => {
  it('makes every record a root when there is no trail', () => {
    const roots = buildSessionTree(session([rec(0), rec(5), rec(9)]));

    expect(roots).toHaveLength(3);
    expect(roots.every((n) => n.children.length === 0)).toBe(true);
  });

  it('nests a record under the record that referred to it', () => {
    const a = rec(0, { url: 'https://a.dev/x' });
    const b = rec(5, { url: 'https://b.dev/y', nav_source_url: 'https://a.dev/x' });
    const c = rec(9, { url: 'https://c.dev/z', nav_source_url: 'https://b.dev/y' });

    const roots = buildSessionTree(session([a, b, c]));

    expect(roots).toHaveLength(1);
    expect(roots[0]?.record).toBe(a);
    expect(roots[0]?.children[0]?.record).toBe(b);
    expect(roots[0]?.children[0]?.children[0]?.record).toBe(c);
  });

  it('normalizes both sides of the comparison, so a fragment does not split the chain', () => {
    const a = rec(0, { url: 'https://a.dev/x' });
    const b = rec(5, { url: 'https://b.dev/y', nav_source_url: 'https://a.dev/x#section' });

    const roots = buildSessionTree(session([a, b]));

    expect(roots).toHaveLength(1);
    expect(roots[0]?.children[0]?.record).toBe(b);
  });

  it('parents a repeat visit onto the most recent predecessor with that url', () => {
    const first = rec(0, { url: 'https://a.dev/x' });
    const other = rec(5, { url: 'https://b.dev/y' });
    const again = rec(9, { url: 'https://a.dev/x', nav_source_url: 'https://b.dev/y' });

    const roots = buildSessionTree(session([first, other, again]));

    // The second visit of a.dev/x hangs off b.dev/y, not off its own earlier self.
    expect(roots[0]?.record).toBe(first);
    expect(roots[1]?.record).toBe(other);
    expect(roots[1]?.children[0]?.record).toBe(again);
  });

  it('never produces a cycle, because a parent is always an earlier record', () => {
    const a = rec(0, { url: 'https://a.dev/x' });
    const b = rec(5, { url: 'https://b.dev/y', nav_source_url: 'https://a.dev/x' });
    const c = rec(9, { url: 'https://c.dev/z', nav_source_url: 'https://a.dev/x' });

    const roots = buildSessionTree(session([a, b, c]));

    expect(roots).toHaveLength(1);
    expect(roots[0]?.children).toHaveLength(2);
  });

  it('treats an unparseable referrer as no parent', () => {
    const a = rec(0, { url: 'https://a.dev/x' });
    const b = rec(5, { url: 'https://b.dev/y', nav_source_url: 'not a url' });

    expect(buildSessionTree(session([a, b]))).toHaveLength(2);
  });
});

describe('computeSearchToGoal', () => {
  /** A search-started session of `pages` minutes ending on `tags`. */
  function searchSession(pages: number, tags: string | null): ResearchSession {
    const records: SessionInput[] = [rec(0, { url: 'https://g.test/', search_query: 'q' })];
    for (let n = 1; n < pages; n += 1) {
      records.push(rec(n, { url: `https://a.dev/${n}`, tags }));
    }
    return session(records);
  }

  it('returns nothing when no session started from a search', () => {
    expect(computeSearchToGoal([session([rec(0), rec(5)])])).toEqual([]);
  });

  it('ignores a session with an empty search query', () => {
    const s = session([rec(0, { search_query: '' }), rec(5)]);
    expect(computeSearchToGoal([s])).toEqual([]);
  });

  it('buckets by the last page tag and averages pages and minutes', () => {
    const rows = computeSearchToGoal([
      searchSession(3, '#a'), // 2-minute span -> 2 min
      searchSession(5, '#a'), // 4-minute span -> 4 min
      searchSession(4, '#a'), // 3-minute span -> 3 min
    ]);

    expect(rows).toEqual([{ tag: 'a', sessions: 3, avgPages: 4, avgMinutes: 3 }]);
  });

  it('credits a multi-tagged last page to each of its tags', () => {
    const rows = computeSearchToGoal([
      searchSession(3, '#a #b'),
      searchSession(3, '#a #b'),
      // A single #a session pushes #a over the minimum, which is what makes
      // the two-bucket comparison below meaningful.
      searchSession(3, '#a'),
    ]);

    expect(rows.map((r) => r.tag).sort()).toEqual(['a', 'b']);
    expect(rows.find((r) => r.tag === 'a')?.sessions).toBe(3);
    expect(rows.find((r) => r.tag === 'b')?.sessions).toBe(2);
  });

  it('drops a tag credited by only one multi-tagged session', () => {
    const rows = computeSearchToGoal([
      searchSession(3, '#a #b'),
      searchSession(3, '#a'),
      searchSession(3, '#a'),
    ]);

    expect(rows.map((r) => r.tag)).toEqual(['a']);
  });

  it('buckets an untagged last page separately instead of dropping it', () => {
    const rows = computeSearchToGoal([searchSession(3, null), searchSession(3, null)]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tag).toBe(UNTAGGED_KEY);
  });

  it(`drops a tag seen in fewer than ${SEARCH_TO_GOAL_MIN_SESSIONS} sessions`, () => {
    const rows = computeSearchToGoal([
      searchSession(3, '#a'),
      searchSession(3, '#a'),
      searchSession(3, '#b'),
    ]);

    expect(rows.map((r) => r.tag)).toEqual(['a']);
  });

  it('rounds avgPages to one decimal and avgMinutes to a whole minute', () => {
    const rows = computeSearchToGoal([searchSession(2, '#a'), searchSession(3, '#a')]);

    // pages 2 and 3 -> 2.5 ; spans 1 and 2 minutes -> 1.5 -> 2
    expect(rows[0]?.avgPages).toBe(2.5);
    expect(rows[0]?.avgMinutes).toBe(2);
  });

  it('orders by avgPages desc, then sessions desc, then tag asc', () => {
    const rows = computeSearchToGoal([
      // #slow: 2 sessions of 6 pages -> 6
      searchSession(6, '#slow'),
      searchSession(6, '#slow'),
      // #mid: 2 sessions of 4 pages -> 4
      searchSession(4, '#mid'),
      searchSession(4, '#mid'),
      // #tie: 2 sessions of 4 pages too, same avg, sorts by name after #mid
      searchSession(4, '#tie'),
      searchSession(4, '#tie'),
      // #many: same avg as #tie but more sessions -> outranks it
      searchSession(4, '#many'),
      searchSession(4, '#many'),
      searchSession(4, '#many'),
    ]);

    expect(rows.map((r) => r.tag)).toEqual(['slow', 'many', 'mid', 'tie']);
  });

  it('returns nothing for an empty session list', () => {
    expect(computeSearchToGoal([])).toEqual([]);
  });
});
