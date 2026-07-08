import { describe, it, expect } from 'vitest';
import { computeLayout, computeCanvasSize } from '../tagClusterLayout.js';
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

describe('computeCanvasSize', () => {
  it('returns the base canvas size for zero nodes', () => {
    const size = computeCanvasSize(0);
    expect(size.width).toBe(800);
    expect(size.height).toBe(600);
  });

  it('returns the base canvas size for a single node', () => {
    const size = computeCanvasSize(1);
    expect(size.width).toBe(800);
    expect(size.height).toBe(600);
  });

  it('grows the canvas as node count increases, up to the max (50 nodes)', () => {
    const size = computeCanvasSize(50);
    // 400 + 50*40 = 2400 (hits MAX_CANVAS_WIDTH cap exactly)
    expect(size.width).toBe(2400);
    // 300 + 50*30 = 1800 (hits MAX_CANVAS_HEIGHT cap exactly)
    expect(size.height).toBe(1800);
  });

  it('caps the canvas size for node counts beyond 50 (does not grow unbounded)', () => {
    const size = computeCanvasSize(200);
    expect(size.width).toBe(2400);
    expect(size.height).toBe(1800);
  });

  it('scales up for a mid-range node count without hitting the cap', () => {
    const size = computeCanvasSize(20);
    expect(size.width).toBe(1200); // 400 + 20*40
    expect(size.height).toBe(900); // 300 + 20*30
  });
});
