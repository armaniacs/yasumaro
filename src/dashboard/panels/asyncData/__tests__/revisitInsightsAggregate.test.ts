/**
 * revisitInsightsAggregate unit tests: the four buckets over one row set.
 * `now` is pinned so the recent/middle/past and week boundaries are
 * deterministic; rows are built by `daysAgo` so a case reads as a timeline.
 */
import { describe, it, expect } from 'vitest';

import {
  aggregateRevisitInsights,
  formatLoopVisitsMarkdown,
  REVISIT_CONFIG,
  type RevisitInput,
} from '../../../revisitInsightsAggregate.js';

const DAY_MS = 86_400_000;
const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime();

let nextId = 1;
function row(partial: Partial<RevisitInput> & { url: string; created_at: number }): RevisitInput {
  return {
    id: nextId++,
    title: null,
    domain: null,
    tags: null,
    ...partial,
  };
}

/** daysAgo=0 means "right now"; 1 means yesterday. */
function daysAgo(days: number): number {
  return NOW - days * DAY_MS;
}

/** Local YYYY-MM-DD, mirroring the aggregate's bucket label format. */
function formatBucketDateForTest(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A row offset by whole days from NOW. */
function at(days: number, partial: Partial<RevisitInput> & { url: string }): RevisitInput {
  return row({ ...partial, created_at: daysAgo(days) });
}

function reset(): void {
  nextId = 1;
}

describe('aggregateRevisitInsights', () => {
  beforeEach(reset);

  it('returns empty buckets for an empty row set', () => {
    const result = aggregateRevisitInsights([], NOW);

    expect(result.loops).toEqual([]);
    expect(result.ranking).toEqual([]);
    expect(result.dormant).toEqual([]);
    expect(result.capsule.topTags).toEqual([]);
    expect(result.capsule.topDomains).toEqual([]);
    expect(result.capsule.visits).toEqual([]);
    // The week window is still resolved even with no rows.
    expect(result.capsule.rangeEnd).toBeGreaterThan(result.capsule.rangeStart);
  });

  it('detects a domain revisited after a long gap as a loop', () => {
    const rows = [
      at(100, { url: 'https://a.dev/1', domain: 'a.dev' }),
      at(1, { url: 'https://a.dev/2', domain: 'a.dev' }),
      at(5, { url: 'https://a.dev/3', domain: 'a.dev' }),
      at(10, { url: 'https://a.dev/4', domain: 'a.dev' }),
    ];

    const result = aggregateRevisitInsights(rows, NOW);

    const loop = result.loops.find((l) => l.kind === 'domain' && l.key === 'a.dev');
    expect(loop).toBeDefined();
    expect(loop?.recentDays).toBe(3);
    expect(loop?.pastCount).toBe(1);
  });

  it('excludes a domain that kept showing up in the middle window', () => {
    const rows = [
      at(100, { url: 'https://a.dev/1', domain: 'a.dev' }),
      at(60, { url: 'https://a.dev/2', domain: 'a.dev' }),
      at(1, { url: 'https://a.dev/3', domain: 'a.dev' }),
      at(5, { url: 'https://a.dev/4', domain: 'a.dev' }),
      at(10, { url: 'https://a.dev/5', domain: 'a.dev' }),
    ];

    const result = aggregateRevisitInsights(rows, NOW);

    expect(result.loops.some((l) => l.kind === 'domain' && l.key === 'a.dev')).toBe(false);
  });

  it('requires distinct recent days for a domain loop', () => {
    // Three rows on the SAME recent day count as one distinct day.
    const sameDay = daysAgo(2);
    const rows = [
      at(100, { url: 'https://b.dev/1', domain: 'b.dev' }),
      row({ url: 'https://b.dev/2', domain: 'b.dev', created_at: sameDay }),
      row({ url: 'https://b.dev/3', domain: 'b.dev', created_at: sameDay + 3_600_000 }),
    ];

    const result = aggregateRevisitInsights(rows, NOW);

    expect(result.loops.some((l) => l.kind === 'domain' && l.key === 'b.dev')).toBe(false);
  });

  it('accepts a url loop on a single recent day', () => {
    const u1 = 'https://deep.example/page';
    const rows = [at(100, { url: u1 }), at(2, { url: u1 })];

    const result = aggregateRevisitInsights(rows, NOW);

    const loop = result.loops.find((l) => l.kind === 'url' && l.key === u1);
    expect(loop).toBeDefined();
    expect(loop?.recentDays).toBe(1);
    expect(loop?.pastCount).toBe(1);
  });

  it('treats the boundaries as recent/middle respectively', () => {
    const recentStart = NOW - REVISIT_CONFIG.recentDays * DAY_MS;
    const dormantBoundary = NOW - REVISIT_CONFIG.dormantFromDays * DAY_MS;
    const domain = 'edge.dev';
    const rows = [
      row({ url: 'https://edge.dev/1', domain, created_at: dormantBoundary }),
      // Exactly on recentStart counts as recent; exactly on dormantBoundary
      // counts as middle, so the key has a middle row and cannot be a loop.
      row({ url: 'https://edge.dev/2', domain, created_at: recentStart }),
      row({ url: 'https://edge.dev/3', domain, created_at: recentStart - DAY_MS }),
      row({ url: 'https://edge.dev/4', domain, created_at: dormantBoundary - DAY_MS }),
    ];

    const result = aggregateRevisitInsights(rows, NOW);

    // 2 distinct recent days would qualify on the recentDays axis, but the
    // dormantBoundary row is middle, so the key is excluded.
    expect(result.loops.some((l) => l.kind === 'domain' && l.key === domain)).toBe(false);
  });

  it('skips blank domains but still keys the row by url', () => {
    const rows = [
      at(100, { url: 'https://nodomain/1', domain: null }),
      at(100, { url: 'https://nodomain/2', domain: '   ' }),
      at(2, { url: 'https://nodomain/1' }),
      at(2, { url: 'https://nodomain/2' }),
    ];

    const result = aggregateRevisitInsights(rows, NOW);

    expect(result.loops.some((l) => l.kind === 'domain')).toBe(false);
    expect(result.loops.filter((l) => l.kind === 'url').map((l) => l.key).sort()).toEqual([
      'https://nodomain/1',
      'https://nodomain/2',
    ]);
  });

  it('keys tags individually and ignores rows without tags', () => {
    // A tag loop needs 3 distinct recent days, so each tag is carried by
    // three separate recent rows plus one older row.
    const rows = [
      at(100, { url: 'https://t.dev/0', domain: 't.dev', tags: '#a #b' }),
      at(1, { url: 'https://t.dev/1', domain: 't.dev', tags: '#a' }),
      at(2, { url: 'https://t.dev/2', domain: 't.dev', tags: '#a' }),
      at(3, { url: 'https://t.dev/3', domain: 't.dev', tags: '#a' }),
      at(1, { url: 'https://t.dev/4', domain: 't.dev', tags: '#b' }),
      at(2, { url: 'https://t.dev/5', domain: 't.dev', tags: '#b' }),
      at(3, { url: 'https://t.dev/6', domain: 't.dev', tags: '#b' }),
      at(4, { url: 'https://t.dev/7', domain: 't.dev', tags: null }),
    ];

    const result = aggregateRevisitInsights(rows, NOW);

    const tagKeys = result.loops.filter((l) => l.kind === 'tag').map((l) => l.key).sort();
    expect(tagKeys).toEqual(['a', 'b']);
  });

  it('ranks urls by distinct days, drops single-day urls, and cuts at topN', () => {
    const rows: RevisitInput[] = [];
    // 3, 2 and 1 distinct days.
    for (const day of [1, 2, 3]) rows.push(at(day, { url: 'https://three.dev/a' }));
    for (const day of [1, 2]) rows.push(at(day, { url: 'https://two.dev/b' }));
    rows.push(at(1, { url: 'https://one.dev/c' }));
    // One url on 25 distinct days — the ranking leader.
    for (let day = 1; day <= 25; day += 1) {
      rows.push(at(day, { url: 'https://many.dev/same', domain: 'many.dev' }));
    }
    // 21 more urls on 2 distinct days each, so the list exceeds topN = 20.
    for (let n = 1; n <= 21; n += 1) {
      rows.push(at(1, { url: `https://bulk.dev/${n}`, domain: 'bulk.dev' }));
      rows.push(at(2, { url: `https://bulk.dev/${n}`, domain: 'bulk.dev' }));
    }

    const result = aggregateRevisitInsights(rows, NOW);

    expect(result.ranking.length).toBe(REVISIT_CONFIG.topN);
    expect(result.ranking[0]?.url).toBe('https://many.dev/same');
    expect(result.ranking[0]?.distinctDays).toBe(25);
    expect(result.ranking.some((r) => r.url === 'https://one.dev/c')).toBe(false);
    // Sorted by distinctDays descending.
    const days = result.ranking.map((r) => r.distinctDays);
    expect([...days].sort((a, b) => b - a)).toEqual(days);
  });

  it('reports a dormant key from the 2-4 month window and drops it once it is recent', () => {
    const domain = 'c.dev';
    const rows = [
      at(70, { url: 'https://c.dev/1', domain }),
      at(80, { url: 'https://c.dev/2', domain }),
      at(90, { url: 'https://c.dev/3', domain }),
    ];

    const quiet = aggregateRevisitInsights(rows, NOW);
    expect(quiet.dormant.some((d) => d.key === domain && d.windowCount === 3)).toBe(true);

    const touched = aggregateRevisitInsights([...rows, at(2, { url: 'https://c.dev/4', domain })], NOW);
    expect(touched.dormant.some((d) => d.key === domain)).toBe(false);
  });

  it('excludes the dormant window boundary and keeps only the closed interval', () => {
    const domain = 'w.dev';
    const windowStart = NOW - REVISIT_CONFIG.dormantWindowStartDays * DAY_MS;
    const windowEnd = NOW - REVISIT_CONFIG.dormantWindowEndDays * DAY_MS;
    const rows = [
      row({ url: 'https://w.dev/1', domain, created_at: windowStart }),
      row({ url: 'https://w.dev/2', domain, created_at: windowStart + DAY_MS }),
      row({ url: 'https://w.dev/3', domain, created_at: windowEnd - DAY_MS }),
      // windowEnd is exclusive, and the row below sits at the recent edge of
      // the window only if it is older than recentStart (it is: 59 days).
      row({ url: 'https://w.dev/4', domain, created_at: windowEnd }),
    ];

    const result = aggregateRevisitInsights(rows, NOW);

    const item = result.dormant.find((d) => d.key === domain);
    expect(item?.windowCount).toBe(3);
  });

  it('selects only the rows inside the capsule week and anchors rangeStart to local Sunday', () => {
    // 364 days back lands in the same weekday week one year earlier.
    const rangeStart = new Date(NOW - REVISIT_CONFIG.capsuleOffsetDays * DAY_MS);
    rangeStart.setHours(0, 0, 0, 0);
    rangeStart.setDate(rangeStart.getDate() - rangeStart.getDay());
    const start = rangeStart.getTime();
    const end = start + 7 * DAY_MS;

    const rows = [
      row({ url: 'https://in.dev/1', domain: 'in.dev', created_at: start + DAY_MS }),
      row({ url: 'https://in.dev/2', domain: 'in.dev', created_at: end - 1 }),
      // Outside: one millisecond before the window opens.
      row({ url: 'https://out.dev/1', domain: 'out.dev', created_at: start - 1 }),
    ];

    const result = aggregateRevisitInsights(rows, NOW);

    expect(result.capsule.rangeStart).toBe(start);
    expect(new Date(result.capsule.rangeStart).getDay()).toBe(0);
    expect(result.capsule.visits.map((v) => v.url).sort()).toEqual([
      'https://in.dev/1',
      'https://in.dev/2',
    ]);
    expect(result.capsule.topDomains.map((d) => d.name)).toEqual(['in.dev']);
  });

  it('orders loops by recentDays, then pastCount, then kind, then key', () => {
    const rows = [
      // b: 3 recent days, 1 past
      at(100, { url: 'https://b.dev/1', domain: 'b.dev' }),
      at(1, { url: 'https://b.dev/2', domain: 'b.dev' }),
      at(2, { url: 'https://b.dev/3', domain: 'b.dev' }),
      at(3, { url: 'https://b.dev/4', domain: 'b.dev' }),
      // a: 3 recent days, 2 past — outranks b on pastCount
      at(120, { url: 'https://a.dev/1', domain: 'a.dev' }),
      at(100, { url: 'https://a.dev/2', domain: 'a.dev' }),
      at(1, { url: 'https://a.dev/3', domain: 'a.dev' }),
      at(2, { url: 'https://a.dev/4', domain: 'a.dev' }),
      at(3, { url: 'https://a.dev/5', domain: 'a.dev' }),
    ];

    const result = aggregateRevisitInsights(rows, NOW);
    const domains = result.loops.filter((l) => l.kind === 'domain').map((l) => l.key);

    expect(domains[0]).toBe('a.dev');
    expect(domains[1]).toBe('b.dev');
  });

  it('accepts a custom config', () => {
    const rows = [
      at(100, { url: 'https://x.dev/1', domain: 'x.dev' }),
      at(1, { url: 'https://x.dev/2', domain: 'x.dev' }),
    ];

    // Default needs 3 distinct recent days for a domain; 1 makes it a loop.
    expect(aggregateRevisitInsights(rows, NOW).loops.some((l) => l.key === 'x.dev')).toBe(false);
    const relaxed = aggregateRevisitInsights(rows, NOW, {
      ...REVISIT_CONFIG,
      loopMinRecentDays: 1,
    });
    expect(relaxed.loops.some((l) => l.key === 'x.dev')).toBe(true);
  });
});

describe('formatLoopVisitsMarkdown', () => {
  it('renders a heading plus one dated link per visit', () => {
    const md = formatLoopVisitsMarkdown({
      kind: 'domain',
      key: 'a.dev',
      recentDays: 1,
      pastCount: 1,
      visits: [
        { id: 2, url: 'https://a.dev/2', title: 'Second', created_at: daysAgo(1) },
        { id: 1, url: 'https://a.dev/1', title: 'First', created_at: daysAgo(100) },
      ],
    });

    const lines = md.split('\n');
    expect(lines[0]).toBe('## a.dev');
    expect(lines[1]).toBe('');
    expect(lines[2]).toMatch(/^- \d{4}-\d{2}-\d{2} \[Second\]\(https:\/\/a\.dev\/2\)$/);
    expect(lines[3]).toMatch(/^- \d{4}-\d{2}-\d{2} \[First\]\(https:\/\/a\.dev\/1\)$/);
    // Trailing newline after the final line.
    expect(md.endsWith('\n')).toBe(true);
  });

  it('escapes link syntax in the key and title and neutralizes a non-http target', () => {
    const md = formatLoopVisitsMarkdown({
      kind: 'tag',
      key: 'a[b](c)',
      recentDays: 1,
      pastCount: 1,
      visits: [
        {
          id: 1,
          url: 'javascript:alert(1)',
          title: 'x[y](z)',
          created_at: daysAgo(1),
        },
      ],
    });

    const lines = md.split('\n');
    expect(lines[0]).toBe('## a\\[b\\]\\(c\\)');
    // Link text escaped inside [], target neutralized to about:blank.
    expect(lines[2]).toBe(
      `- ${formatBucketDateForTest(daysAgo(1))} [x\\[y\\]\\(z\\)](about:blank)`,
    );
  });

  it('falls back to the url when a visit has no title', () => {
    const md = formatLoopVisitsMarkdown({
      kind: 'url',
      key: 'https://a.dev/',
      recentDays: 1,
      pastCount: 1,
      visits: [{ id: 1, url: 'https://a.dev/', title: null, created_at: daysAgo(1) }],
    });

    expect(md).toContain('[https://a.dev/](https://a.dev/)');
  });
});
