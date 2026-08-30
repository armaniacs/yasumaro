import { describe, it, expect } from 'vitest';
import { computeTagCooccurrence, narrowEntriesToTopTags, limitToTopNodes } from '../tagCooccurrence.js';
import { computeLayout, computeCanvasSize } from '../tagClusterLayout.js';
import { MAX_TAG_CLUSTER_TAGS } from '../../utils/computeLimits.js';

const MAX_NODES = 50;

function bigHistory(uniqueTags: number): Array<{ tags: string }> {
  return Array.from({ length: uniqueTags * 3 }, (_, i) => ({
    tags: `#tag${i % uniqueTags} #tag${(i + 1) % uniqueTags} #tag${(i + 7) % uniqueTags}`,
  }));
}

// AC8: the tag-cluster render path must not get slower as the raw history grows,
// because narrowing now happens before cooccurrence.
describe('tagCluster render path is bounded regardless of history size', () => {
  const render = (uniqueTags: number): number => {
    const rows = bigHistory(uniqueTags);
    const start = performance.now();
    const narrowed = narrowEntriesToTopTags(rows, MAX_TAG_CLUSTER_TAGS);
    const { nodes, edges } = computeTagCooccurrence(narrowed);
    const limited = limitToTopNodes(nodes, edges, MAX_NODES);
    const size = computeCanvasSize(limited.nodes.length);
    computeLayout(limited.nodes, limited.edges, size.width, size.height);
    return performance.now() - start;
  };

  it('4x unique tags does not make rendering ~16x slower', () => {
    render(500);
    const t1 = Math.max(render(500), 0.5);
    const t4 = render(2000);
    expect(t4).toBeLessThan(t1 * 8);
  });

  it('layout node count never exceeds the render cap', () => {
    const rows = bigHistory(3000);
    const narrowed = narrowEntriesToTopTags(rows, MAX_TAG_CLUSTER_TAGS);
    const { nodes, edges } = computeTagCooccurrence(narrowed);
    const limited = limitToTopNodes(nodes, edges, MAX_NODES);
    expect(limited.nodes.length).toBeLessThanOrEqual(MAX_NODES);
  });
});
