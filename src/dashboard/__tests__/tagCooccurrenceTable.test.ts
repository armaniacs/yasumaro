import { describe, it, expect } from 'vitest';
import {
  buildCooccurrencePairRows,
  COOCCURRENCE_TABLE_TOP_N,
  type CooccurrenceGraph,
} from '../tagCooccurrenceTable.js';
import type { TagEdge, TagNode } from '../tagCooccurrence.js';

function graph(nodes: Array<[string, number]>, edges: Array<[string, string, number]>): CooccurrenceGraph {
  return {
    nodes: nodes.map(([tag, count]): TagNode => ({ tag, count })),
    edges: edges.map(([source, target, weight]): TagEdge => ({ source, target, weight })),
  };
}

describe('buildCooccurrencePairRows — pair label', () => {
  it('normalizes the pair alphabetically within the label', () => {
    // Edge orientation reversed relative to alphabetical order.
    const result = buildCooccurrencePairRows(graph([['zeta', 3], ['alpha', 2]], [['zeta', 'alpha', 5]]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.label).toBe('#alpha × #zeta');
    expect(result.rows[0]!.tagA).toBe('alpha');
    expect(result.rows[0]!.tagB).toBe('zeta');
  });

  it('looks up the individual node counts for both pair members', () => {
    const result = buildCooccurrencePairRows(
      graph([['b', 9], ['a', 4]], [['b', 'a', 2]]),
    );
    expect(result.rows[0]!.countA).toBe(4);
    expect(result.rows[0]!.countB).toBe(9);
    expect(result.rows[0]!.weight).toBe(2);
  });

  it('reports 0 for a count missing from nodes (defensive)', () => {
    const result = buildCooccurrencePairRows(graph([['a', 1]], [['a', 'ghost', 1]]));
    expect(result.rows[0]!.countB).toBe(0);
  });
});

describe('buildCooccurrencePairRows — ranking and ties', () => {
  it('sorts by weight descending', () => {
    const result = buildCooccurrencePairRows(
      graph(
        [['a', 1], ['b', 1], ['c', 1], ['d', 1]],
        [['a', 'b', 1], ['c', 'd', 3]],
      ),
    );
    expect(result.rows.map((r) => r.label)).toEqual(['#c × #d', '#a × #b']);
  });

  it('breaks weight ties by pair label ascending (deterministic order)', () => {
    const result = buildCooccurrencePairRows(
      graph(
        [['b', 1], ['a', 1], ['d', 1], ['c', 1]],
        [
          ['b', 'd', 2],
          ['a', 'c', 2],
          ['a', 'b', 2],
        ],
      ),
    );
    expect(result.rows.map((r) => r.label)).toEqual(['#a × #b', '#a × #c', '#b × #d']);
  });

  it('never swaps equal pairs regardless of input edge order', () => {
    const g = graph([['x', 1], ['y', 1]], [['y', 'x', 1]]);
    const once = buildCooccurrencePairRows(g);
    const twice = buildCooccurrencePairRows(g);
    expect(once.rows).toEqual(twice.rows);
  });
});

describe('buildCooccurrencePairRows — top-N truncation', () => {
  it('keeps the default top 20 and flags truncation beyond it', () => {
    const edges: Array<[string, string, number]> = [];
    const tags: Array<[string, number]> = [];
    for (let i = 0; i < COOCCURRENCE_TABLE_TOP_N + 5; i++) {
      const tag = `t${String(i).padStart(2, '0')}`;
      tags.push([tag, 1]);
      edges.push([tag, 'anchor', COOCCURRENCE_TABLE_TOP_N + 5 - i]);
    }
    tags.push(['anchor', 1]);
    const result = buildCooccurrencePairRows(graph(tags, edges));

    expect(result.rows).toHaveLength(COOCCURRENCE_TABLE_TOP_N);
    expect(result.totalPairs).toBe(COOCCURRENCE_TABLE_TOP_N + 5);
    expect(result.truncated).toBe(true);
    // Highest weight first, and exactly the top-20 slice of the ranking.
    expect(result.rows[0]!.weight).toBe(COOCCURRENCE_TABLE_TOP_N + 5);
    expect(result.rows[COOCCURRENCE_TABLE_TOP_N - 1]!.weight).toBe(6);
  });

  it('does not flag truncation when the pair count is within the cap', () => {
    const result = buildCooccurrencePairRows(
      graph([['a', 1], ['b', 1]], [['a', 'b', 1]]),
    );
    expect(result.truncated).toBe(false);
    expect(result.totalPairs).toBe(1);
  });
});

describe('buildCooccurrencePairRows — single-tag filter mode', () => {
  const g = graph(
    [['a', 5], ['b', 3], ['c', 2], ['solo', 7]],
    [
      ['a', 'b', 4],
      ['a', 'c', 1],
      ['b', 'c', 2],
    ],
  );

  it('ranks only edges involving the selected tag, partner counts from the full graph', () => {
    const result = buildCooccurrencePairRows(g, { tag: 'a' });
    expect(result.totalPairs).toBe(2);
    expect(result.rows.map((r) => r.label)).toEqual(['#a × #b', '#a × #c']);
    // b's count stays its FULL-graph count (3), not the co-occurrence weight.
    expect(result.rows[0]!.countB).toBe(3);
    expect(result.rows[0]!.countA).toBe(5);
  });

  it('shows 0 partners for a selected tag with no edges', () => {
    const result = buildCooccurrencePairRows(g, { tag: 'solo' });
    expect(result.rows).toHaveLength(0);
    expect(result.totalPairs).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('keeps the pair label normalized when the selected tag sorts second', () => {
    const result = buildCooccurrencePairRows(g, { tag: 'c' });
    expect(result.rows.map((r) => r.label)).toEqual(['#b × #c', '#a × #c']);
  });
});

describe('buildCooccurrencePairRows — empty inputs', () => {
  it('handles a graph with 0 edges (all records single-tag only)', () => {
    const result = buildCooccurrencePairRows(graph([['a', 2], ['b', 1]], []));
    expect(result.rows).toHaveLength(0);
    expect(result.totalPairs).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('handles a fully empty graph', () => {
    const result = buildCooccurrencePairRows(graph([], []));
    expect(result.rows).toHaveLength(0);
    expect(result.totalPairs).toBe(0);
  });

  it('supports a custom topN cap', () => {
    const result = buildCooccurrencePairRows(
      graph([['a', 1], ['b', 1], ['c', 1]], [['a', 'b', 1], ['b', 'c', 1], ['a', 'c', 1]]),
      { topN: 1 },
    );
    expect(result.rows).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});
