// @vitest-environment jsdom
/**
 * tagClusterDiff unit tests (PBI 2026-09-24-08): the four diff categories,
 * delta values, deterministic ordering (delta desc then name asc for
 * increased/decreased, name asc for appeared/disappeared), and empty-side
 * boundary cases.
 */
import { describe, it, expect } from 'vitest';
import { computeTagDiff } from '../tagClusterDiff.js';
import type { TagNode } from '../tagCooccurrence.js';

function nodes(...entries: Array<[string, number]>): TagNode[] {
  return entries.map(([tag, count]) => ({ tag, count }));
}

describe('computeTagDiff — categories', () => {
  it('classifies appeared, disappeared, increased, and decreased with deltas', () => {
    const diff = computeTagDiff(
      nodes(['rust', 5], ['go', 3], ['swift', 1]),
      nodes(['rust', 2], ['go', 6], ['swift', 1], ['zig', 4])
    );
    expect(diff.appeared).toEqual(['zig']);
    expect(diff.disappeared).toEqual([]);
    expect(diff.increased).toEqual([{ tag: 'go', before: 3, after: 6, delta: 3 }]);
    expect(diff.decreased).toEqual([{ tag: 'rust', before: 5, after: 2, delta: -3 }]);
  });

  it('puts tags with equal counts in no category', () => {
    const diff = computeTagDiff(nodes(['a', 3]), nodes(['a', 3]));
    expect(diff).toEqual({ appeared: [], disappeared: [], increased: [], decreased: [] });
  });

  it('treats a 0-count second-half node as decreased, not disappeared', () => {
    // cooccurrence never emits 0-count nodes, but the diff stays total.
    const diff = computeTagDiff(nodes(['a', 4]), nodes(['a', 0]));
    expect(diff.decreased).toEqual([{ tag: 'a', before: 4, after: 0, delta: -4 }]);
    expect(diff.disappeared).toEqual([]);
  });
});

describe('computeTagDiff — deterministic ordering', () => {
  it('orders increased by delta descending, then name ascending on ties', () => {
    const diff = computeTagDiff(
      nodes(['b', 1], ['a', 1], ['c', 1], ['d', 1]),
      nodes(['b', 6], ['a', 6], ['c', 9], ['d', 5])
    );
    expect(diff.increased.map((entry) => entry.tag)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('orders decreased by signed delta descending (smallest drop first), then name', () => {
    const diff = computeTagDiff(
      nodes(['a', 10], ['b', 10], ['c', 10], ['d', 10]),
      nodes(['a', 3], ['b', 3], ['c', 9], ['d', 1])
    );
    // Signed delta desc: -1 (c) first, then the -7 tie (a/b → name asc), then -9 (d).
    expect(diff.decreased.map((entry) => entry.tag)).toEqual(['c', 'a', 'b', 'd']);
    expect(diff.decreased.map((entry) => entry.delta)).toEqual([-1, -7, -7, -9]);
  });

  it('sorts appeared and disappeared by name ascending regardless of input order', () => {
    const diff = computeTagDiff(
      nodes(['zeta', 1], ['alpha', 1], ['mid', 1]),
      nodes(['yankee', 2], ['beta', 2])
    );
    expect(diff.appeared).toEqual(['beta', 'yankee']);
    expect(diff.disappeared).toEqual(['alpha', 'mid', 'zeta']);
  });
});

describe('computeTagDiff — empty sides', () => {
  it('returns all-empty sections for two empty snapshots', () => {
    expect(computeTagDiff([], [])).toEqual({ appeared: [], disappeared: [], increased: [], decreased: [] });
  });

  it('classifies every tag of the second snapshot as appeared when the first is empty', () => {
    const diff = computeTagDiff([], nodes(['b', 2], ['a', 1]));
    expect(diff.appeared).toEqual(['a', 'b']);
    expect(diff.disappeared).toEqual([]);
    expect(diff.increased).toEqual([]);
    expect(diff.decreased).toEqual([]);
  });

  it('classifies every tag of the first snapshot as disappeared when the second is empty', () => {
    const diff = computeTagDiff(nodes(['b', 2], ['a', 1]), []);
    expect(diff.appeared).toEqual([]);
    expect(diff.disappeared).toEqual(['a', 'b']);
    expect(diff.increased).toEqual([]);
    expect(diff.decreased).toEqual([]);
  });
});
