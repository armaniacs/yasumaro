import { describe, it, expect } from 'vitest';
import {
  computeTagCooccurrence,
  narrowEntriesToTopTags,
} from '../tagCooccurrence.js';
import { MAX_TAGS_PER_RECORD, MAX_TAG_CLUSTER_TAGS } from '../../utils/computeLimits.js';
import { parseTagsForDisplay } from '../../utils/tagUtils.js';

// Wall-clock timing signals belong in bench/ (non-gating), not in unit
// pass/fail assertions: sub-millisecond workloads pick up scheduling noise.

function countUniqueTags(entries: Array<{ tags?: string | null }>): number {
  return new Set(entries.flatMap(e => parseTagsForDisplay(e.tags))).size;
}

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

  it('cap: 4x tags/record stays bounded and identical to the capped result', () => {
    const build = (tagsPerRecord: number): Array<{ tags: string }> =>
      Array.from({ length: 50 }, () => ({ tags: makeTagString(tagsPerRecord) }));
    // Raw inputs exceed the cap — without per-record capping these bounds fail (VULN-041).
    expect(125).toBeGreaterThan(MAX_TAGS_PER_RECORD);
    expect(500).toBeGreaterThan(MAX_TAGS_PER_RECORD);
    const small = computeTagCooccurrence(build(125));
    const large = computeTagCooccurrence(build(500));
    const perRecordEdgeCap = (MAX_TAGS_PER_RECORD * (MAX_TAGS_PER_RECORD - 1)) / 2;
    for (const result of [small, large]) {
      expect(result.nodes.length).toBeLessThanOrEqual(MAX_TAGS_PER_RECORD);
      expect(result.edges.length).toBeLessThanOrEqual(perRecordEdgeCap);
      expect(result.edges.length).toBeLessThanOrEqual(
        (result.nodes.length * (result.nodes.length - 1)) / 2
      );
    }
    // Capping keeps the first N tags in parse order, so both inputs collapse to the same output.
    expect(large.nodes).toEqual(small.nodes);
    expect(large.edges).toEqual(small.edges);
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

  it('cap: 4x unique tags stays bounded when pre-narrowed', () => {
    const build = (uniqueTags: number): Array<{ tags: string }> =>
      Array.from({ length: uniqueTags }, (_, i) => ({ tags: `#u${i} #u${(i + 1) % uniqueTags}` }));
    // Raw 4x input exceeds the cap — without pre-narrowing the bounds below fail (VULN-053).
    expect(countUniqueTags(build(2000))).toBeGreaterThan(MAX_TAG_CLUSTER_TAGS);
    const narrowed = narrowEntriesToTopTags(build(2000), MAX_TAG_CLUSTER_TAGS);
    expect(countUniqueTags(narrowed)).toBeLessThanOrEqual(MAX_TAG_CLUSTER_TAGS);
    const { nodes, edges } = computeTagCooccurrence(narrowed);
    expect(nodes.length).toBeLessThanOrEqual(MAX_TAG_CLUSTER_TAGS);
    expect(edges.length).toBeLessThanOrEqual((nodes.length * (nodes.length - 1)) / 2);
    // Every narrowed record still respects the per-record cap.
    for (const entry of narrowed) {
      expect(new Set(parseTagsForDisplay(entry.tags)).size).toBeLessThanOrEqual(
        MAX_TAGS_PER_RECORD
      );
    }
    // Narrowing is a fixpoint: re-narrowing is a no-op returning the same array.
    expect(narrowEntriesToTopTags(narrowed, MAX_TAG_CLUSTER_TAGS)).toBe(narrowed);
  });
});
