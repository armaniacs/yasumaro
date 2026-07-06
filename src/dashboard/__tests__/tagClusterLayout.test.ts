import { describe, it, expect } from 'vitest';
import { computeLayout } from '../tagClusterLayout.js';
import type { TagNode, TagEdge } from '../tagCooccurrence.js';

describe('computeLayout', () => {
  it('returns an empty map for no nodes', () => {
    const positions = computeLayout([], [], 400, 400);
    expect(positions.size).toBe(0);
  });

  it('assigns a position to every node', () => {
    const nodes: TagNode[] = [{ tag: 'a', count: 1 }, { tag: 'b', count: 1 }];
    const edges: TagEdge[] = [{ source: 'a', target: 'b', weight: 1 }];
    const positions = computeLayout(nodes, edges, 400, 400);
    expect(positions.size).toBe(2);
    expect(positions.has('a')).toBe(true);
    expect(positions.has('b')).toBe(true);
  });

  it('keeps all node positions within the canvas bounds', () => {
    const nodes: TagNode[] = [
      { tag: 'a', count: 5 }, { tag: 'b', count: 3 }, { tag: 'c', count: 1 },
    ];
    const edges: TagEdge[] = [
      { source: 'a', target: 'b', weight: 2 },
      { source: 'b', target: 'c', weight: 1 },
    ];
    const positions = computeLayout(nodes, edges, 400, 300);
    for (const [, pos] of positions) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.x).toBeLessThanOrEqual(400);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeLessThanOrEqual(300);
    }
  });

  it('places a single node at the center', () => {
    const positions = computeLayout([{ tag: 'solo', count: 1 }], [], 400, 300);
    const pos = positions.get('solo')!;
    expect(pos.x).toBeCloseTo(200, 0);
    expect(pos.y).toBeCloseTo(150, 0);
  });
});
