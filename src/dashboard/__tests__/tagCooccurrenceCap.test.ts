import { describe, it, expect } from 'vitest';
import {
  computeTagCooccurrence,
  narrowEntriesToTopTags,
} from '../tagCooccurrence.js';
import { MAX_TAGS_PER_RECORD, MAX_TAG_CLUSTER_TAGS } from '../../utils/computeLimits.js';

function makeTagString(count: number, prefix = 't'): string {
  return Array.from({ length: count }, (_, i) => `#${prefix}${i}`).join(' ');
}

describe('computeTagCooccurrence input cap (VULN-041)', () => {
  it('caps unique tags per record to MAX_TAGS_PER_RECORD before the double loop', () => {
    const entry = { tags: makeTagString(500) };
    const { nodes, edges } = computeTagCooccurrence([entry]);

    expect(nodes.length).toBe(MAX_TAGS_PER_RECORD);
    // edges bounded by C(cap, 2)
    expect(edges.length).toBe((MAX_TAGS_PER_RECORD * (MAX_TAGS_PER_RECORD - 1)) / 2);
  });

  it('keeps the first N tags in parse order', () => {
    const { nodes } = computeTagCooccurrence([{ tags: makeTagString(MAX_TAGS_PER_RECORD + 5) }]);
    const kept = new Set(nodes.map(n => n.tag));
    expect(kept.has('t0')).toBe(true);
    expect(kept.has(`t${MAX_TAGS_PER_RECORD - 1}`)).toBe(true);
    expect(kept.has(`t${MAX_TAGS_PER_RECORD}`)).toBe(false);
  });

  it('boundary: exactly cap tags is unchanged', () => {
    const { nodes, edges } = computeTagCooccurrence([{ tags: makeTagString(MAX_TAGS_PER_RECORD) }]);
    expect(nodes.length).toBe(MAX_TAGS_PER_RECORD);
    expect(edges.length).toBe((MAX_TAGS_PER_RECORD * (MAX_TAGS_PER_RECORD - 1)) / 2);
  });

  it('boundary: cap+1 tags drops exactly one', () => {
    const { nodes } = computeTagCooccurrence([{ tags: makeTagString(MAX_TAGS_PER_RECORD + 1) }]);
    expect(nodes.length).toBe(MAX_TAGS_PER_RECORD);
  });

  it('normal-size data (tens of tags) is identical to naive result', () => {
    const entries = [{ tags: '#a #b #c' }, { tags: '#b #c #d' }];
    const { nodes, edges } = computeTagCooccurrence(entries);
    expect(nodes).toContainEqual({ tag: 'b', count: 2 });
    expect(edges).toContainEqual({ source: 'b', target: 'c', weight: 2 });
  });

  it('perf: 4x tags/record does NOT give ~16x time (capped, near-constant)', () => {
    const time = (tagsPerRecord: number): number => {
      const entries = Array.from({ length: 50 }, () => ({ tags: makeTagString(tagsPerRecord) }));
      const start = performance.now();
      computeTagCooccurrence(entries);
      return performance.now() - start;
    };
    // warm up
    time(100);
    const t1 = Math.max(time(125), 0.01);
    const t4 = time(500);
    expect(t4).toBeLessThan(t1 * 8);
  });
});

describe('narrowEntriesToTopTags (VULN-053 pre-narrowing)', () => {
  it('keeps only the top-N tags by cross-record frequency', () => {
    const entries = [
      { tags: '#hot #hot-ignore-this' },
      ...Array.from({ length: 10 }, () => ({ tags: '#hot' })),
      { tags: '#rare1' },
      { tags: '#rare2' },
    ];
    const narrowed = narrowEntriesToTopTags(entries, 1);
    const { nodes } = computeTagCooccurrence(narrowed);
    expect(nodes.map(n => n.tag)).toEqual(['hot']);
  });

  it('boundary: top-N tail — Nth and N+1th by frequency', () => {
    const entries = [
      ...Array.from({ length: 5 }, () => ({ tags: '#a' })),
      ...Array.from({ length: 4 }, () => ({ tags: '#b' })),
      ...Array.from({ length: 3 }, () => ({ tags: '#c' })),
    ];
    const narrowed = narrowEntriesToTopTags(entries, 2);
    const { nodes } = computeTagCooccurrence(narrowed);
    const tags = new Set(nodes.map(n => n.tag));
    expect(tags.has('a')).toBe(true);
    expect(tags.has('b')).toBe(true);
    expect(tags.has('c')).toBe(false);
  });

  it('no-op when unique tags <= limit', () => {
    const entries = [{ tags: '#a #b' }, { tags: '#c' }];
    const narrowed = narrowEntriesToTopTags(entries, MAX_TAG_CLUSTER_TAGS);
    expect(narrowed).toBe(entries);
  });

  it('perf: 4x unique tags does NOT blow up cooccurrence when pre-narrowed', () => {
    const build = (uniqueTags: number): Array<{ tags: string }> =>
      Array.from({ length: uniqueTags }, (_, i) => ({ tags: `#u${i} #u${(i + 1) % uniqueTags}` }));
    const run = (uniqueTags: number): number => {
      const entries = narrowEntriesToTopTags(build(uniqueTags), MAX_TAG_CLUSTER_TAGS);
      const start = performance.now();
      computeTagCooccurrence(entries);
      return performance.now() - start;
    };
    run(500);
    const t1 = Math.max(run(500), 0.01);
    const t4 = run(2000);
    expect(t4).toBeLessThan(t1 * 8);
  });
});
