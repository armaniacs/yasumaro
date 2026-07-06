import { describe, it, expect } from 'vitest';
import { computeTagCooccurrence } from '../tagCooccurrence.js';

describe('computeTagCooccurrence', () => {
  it('returns empty nodes and edges for empty input', () => {
    const result = computeTagCooccurrence([]);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('returns empty nodes and edges when no entries have tags', () => {
    const result = computeTagCooccurrence([{ tags: null }, { tags: '' }, { tags: undefined }]);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('counts a single tag with no cooccurrence (no edges)', () => {
    const result = computeTagCooccurrence([{ tags: '#tech' }]);
    expect(result.nodes).toEqual([{ tag: 'tech', count: 1 }]);
    expect(result.edges).toEqual([]);
  });

  it('counts cooccurrence between two tags on the same entry', () => {
    const result = computeTagCooccurrence([{ tags: '#tech #ai' }]);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes).toContainEqual({ tag: 'tech', count: 1 });
    expect(result.nodes).toContainEqual({ tag: 'ai', count: 1 });
    expect(result.edges).toEqual([{ source: 'ai', target: 'tech', weight: 1 }]);
  });

  it('accumulates node count and edge weight across multiple entries', () => {
    const result = computeTagCooccurrence([
      { tags: '#tech #ai' },
      { tags: '#tech #ai' },
      { tags: '#tech' },
    ]);
    expect(result.nodes).toContainEqual({ tag: 'tech', count: 3 });
    expect(result.nodes).toContainEqual({ tag: 'ai', count: 2 });
    expect(result.edges).toEqual([{ source: 'ai', target: 'tech', weight: 2 }]);
  });

  it('does not double count a tag pair within the same entry regardless of order', () => {
    const result = computeTagCooccurrence([{ tags: '#ai #tech' }]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({ source: 'ai', target: 'tech', weight: 1 });
  });

  it('handles three or more tags on the same entry (all pairs counted)', () => {
    const result = computeTagCooccurrence([{ tags: '#a #b #c' }]);
    expect(result.edges).toHaveLength(3);
    const pairs = result.edges.map(e => `${e.source}-${e.target}`).sort();
    expect(pairs).toEqual(['a-b', 'a-c', 'b-c']);
  });
});

import { limitToTopNodes } from '../tagCooccurrence.js';

describe('limitToTopNodes', () => {
  it('returns all nodes and edges when count is within the limit', () => {
    const nodes = [{ tag: 'a', count: 3 }, { tag: 'b', count: 1 }];
    const edges = [{ source: 'a', target: 'b', weight: 1 }];
    const result = limitToTopNodes(nodes, edges, 5);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it('keeps only the top-N nodes by count, descending', () => {
    const nodes = [
      { tag: 'low', count: 1 },
      { tag: 'high', count: 10 },
      { tag: 'mid', count: 5 },
    ];
    const result = limitToTopNodes(nodes, [], 2);
    expect(result.nodes.map(n => n.tag)).toEqual(['high', 'mid']);
  });

  it('drops edges referencing a node that was cut', () => {
    const nodes = [
      { tag: 'a', count: 10 },
      { tag: 'b', count: 5 },
      { tag: 'c', count: 1 },
    ];
    const edges = [
      { source: 'a', target: 'b', weight: 3 },
      { source: 'a', target: 'c', weight: 1 },
    ];
    const result = limitToTopNodes(nodes, edges, 2);
    expect(result.nodes.map(n => n.tag)).toEqual(['a', 'b']);
    expect(result.edges).toEqual([{ source: 'a', target: 'b', weight: 3 }]);
  });

  it('reports whether truncation occurred', () => {
    const nodes = [{ tag: 'a', count: 2 }, { tag: 'b', count: 1 }];
    const notTruncated = limitToTopNodes(nodes, [], 5);
    const truncated = limitToTopNodes(nodes, [], 1);
    expect(notTruncated.truncated).toBe(false);
    expect(truncated.truncated).toBe(true);
  });
});
