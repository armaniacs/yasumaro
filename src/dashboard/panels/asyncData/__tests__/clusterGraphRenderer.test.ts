// @vitest-environment jsdom
/**
 * clusterGraphRenderer (PBI 2026-09-28-17): one pin for the draw skeleton the
 * tag-cluster, word-cluster and tag-cluster-compare panels now share, and one
 * pin per option that keeps a panel's look of its own — the compare panel's
 * extra node class and per-tag hue, the word panel's prefix-less labels, and
 * the compare panel's union-sized canvas.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_NODES,
  SVG_NS,
  limitClusterNodes,
  renderClusterGraph,
  showRowCapNotice,
} from '../clusterGraphRenderer.js';
import { PanelNotices } from '../../PanelNotices.js';
import { tagHue } from '../../../tagClusterColor.js';
import type { TagEdge, TagNode } from '../../../tagCooccurrence.js';

const NODES: TagNode[] = [
  { tag: 'rust', count: 12 },
  { tag: 'wasm', count: 7 },
  { tag: 'web', count: 3 },
];
const EDGES: TagEdge[] = [
  { source: 'rust', target: 'wasm', weight: 9 },
  { source: 'wasm', target: 'web', weight: 2 },
];

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', '800');
  svg.setAttribute('height', '600');
  document.body.appendChild(svg);
  return svg;
}

function tagAriaLabel(nodes: TagNode[]): string {
  return `Tag cluster: ${nodes.map((node) => `#${node.tag}`).join(', ')}`;
}

describe('clusterGraphRenderer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('renderClusterGraph', () => {
    it('draws the whole shared skeleton and attaches pan/zoom', () => {
      const svg = makeSvg();

      renderClusterGraph({ svg, nodes: NODES, edges: EDGES, ariaLabel: tagAriaLabel });

      const lines = Array.from(svg.querySelectorAll('line.tag-cluster-edge'));
      expect(lines).toHaveLength(EDGES.length);
      // The heaviest edge clamps to the shared stroke cap instead of thinning.
      expect(lines[0]!.getAttribute('stroke-width')).toBe('5');
      expect(lines[1]!.getAttribute('stroke-width')).toBe('2');

      const circles = Array.from(svg.querySelectorAll('circle.tag-cluster-node'));
      expect(circles).toHaveLength(NODES.length);
      expect(circles[0]!.getAttribute('r')).toBe('16');
      expect(circles[0]!.getAttribute('role')).toBe('button');
      expect(circles[0]!.getAttribute('tabindex')).toBe('0');
      expect(circles[0]!.getAttribute('aria-label')).toBe('#rust (12)');
      expect(circles[0]!.querySelector('title')?.textContent).toBe('#rust (12)');

      const texts = Array.from(svg.querySelectorAll('text.tag-cluster-text'));
      expect(texts.map((text) => text.textContent)).toEqual(['#rust', '#wasm', '#web']);
      // The label rides its own node, not a second layout pass.
      expect(texts[0]!.getAttribute('x')).toBe(circles[0]!.getAttribute('cx'));
      expect(texts[0]!.getAttribute('y')).toBe(circles[0]!.getAttribute('cy'));

      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toBe('Tag cluster: #rust, #wasm, #web');
      // attach() is what writes the viewBox, so its presence proves the
      // controller was created and bound.
      expect(svg.getAttribute('viewBox')).toBe('0 0 800 600');
    });

    it('navigates to history with the clicked node tag', () => {
      const svg = makeSvg();
      renderClusterGraph({ svg, nodes: NODES, edges: EDGES, ariaLabel: tagAriaLabel });

      const seen: unknown[] = [];
      const onNavigate = (event: Event): void => {
        seen.push((event as CustomEvent).detail);
      };
      document.addEventListener('navigate-to-tag', onNavigate);
      svg.querySelector('circle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.removeEventListener('navigate-to-tag', onNavigate);

      expect(seen).toEqual(['rust']);
    });

    it('adds the compare node class only when nodeClassName asks for it', () => {
      const compareSvg = makeSvg();
      renderClusterGraph({
        svg: compareSvg,
        nodes: NODES,
        edges: EDGES,
        ariaLabel: tagAriaLabel,
        nodeClassName: 'tag-cluster-node tag-cluster-compare-node',
      });
      expect(compareSvg.querySelector('circle')!.getAttribute('class')).toBe(
        'tag-cluster-node tag-cluster-compare-node',
      );

      const plainSvg = makeSvg();
      renderClusterGraph({ svg: plainSvg, nodes: NODES, edges: EDGES, ariaLabel: tagAriaLabel });
      expect(plainSvg.querySelector('circle')!.getAttribute('class')).toBe('tag-cluster-node');
    });

    it('sets --tag-hue only when hueByTag asks for it', () => {
      const compareSvg = makeSvg();
      renderClusterGraph({
        svg: compareSvg,
        nodes: NODES,
        edges: EDGES,
        ariaLabel: tagAriaLabel,
        hueByTag: true,
      });
      expect(compareSvg.querySelector('circle')!.style.getPropertyValue('--tag-hue')).toBe(
        String(tagHue('rust')),
      );

      const plainSvg = makeSvg();
      renderClusterGraph({ svg: plainSvg, nodes: NODES, edges: EDGES, ariaLabel: tagAriaLabel });
      expect(plainSvg.querySelector('circle')!.style.getPropertyValue('--tag-hue')).toBe('');
    });

    it('drops the tag prefix from labels when labelPrefix is empty', () => {
      const svg = makeSvg();
      renderClusterGraph({
        svg,
        nodes: NODES,
        edges: EDGES,
        labelPrefix: '',
        ariaLabel: (nodes) => `Word Cluster: ${nodes.map((node) => node.tag).join(', ')}`,
      });

      const circle = svg.querySelector('circle')!;
      expect(circle.querySelector('title')?.textContent).toBe('rust (12)');
      expect(circle.getAttribute('aria-label')).toBe('rust (12)');
      expect(svg.querySelector('text')!.textContent).toBe('rust');
      expect(svg.getAttribute('aria-label')).toBe('Word Cluster: rust, wasm, web');
    });

    it('sizes the canvas from canvasNodeCount so compared halves share one geometry', () => {
      const unionSvg = makeSvg();
      renderClusterGraph({
        svg: unionSvg,
        nodes: NODES,
        edges: EDGES,
        ariaLabel: tagAriaLabel,
        canvasNodeCount: 12,
      });

      const ownSvg = makeSvg();
      renderClusterGraph({ svg: ownSvg, nodes: NODES, edges: EDGES, ariaLabel: tagAriaLabel });

      // 12 nodes > the 800x600 floor, 3 nodes sits on it: the union-sized
      // canvas differs from the node-count-sized one, which is the whole
      // point of the option.
      expect(unionSvg.getAttribute('viewBox')).toBe('0 0 880 660');
      expect(ownSvg.getAttribute('viewBox')).toBe('0 0 800 600');
    });
  });

  describe('limitClusterNodes', () => {
    function registerTruncated(): { notices: PanelNotices; element: HTMLElement } {
      const element = document.createElement('div');
      element.hidden = true;
      document.body.appendChild(element);
      const notices = new PanelNotices();
      notices.register('truncated', element);
      return { notices, element };
    }

    it('caps at MAX_NODES, drops the edges of dropped nodes, and shows the notice', () => {
      const { notices, element } = registerTruncated();
      const nodes: TagNode[] = Array.from({ length: MAX_NODES + 10 }, (_, i) => ({
        tag: `t${i}`,
        count: i,
      }));
      const edges: TagEdge[] = [{ source: 't59', target: 't0', weight: 4 }];

      const limited = limitClusterNodes(nodes, edges, notices);

      expect(MAX_NODES).toBe(50);
      expect(limited.truncated).toBe(true);
      expect(limited.nodes).toHaveLength(MAX_NODES);
      // Highest counts survive; t0 (count 0) is the one dropped, so its edge
      // goes with it.
      expect(limited.nodes[0]!.tag).toBe('t59');
      expect(limited.edges).toHaveLength(0);
      expect(element.hidden).toBe(false);
    });

    it('hides the notice again when the cluster fits under the cap', () => {
      const { notices, element } = registerTruncated();

      const limited = limitClusterNodes(NODES, EDGES, notices);

      expect(limited.truncated).toBe(false);
      expect(limited.nodes).toHaveLength(NODES.length);
      expect(limited.edges).toHaveLength(EDGES.length);
      expect(element.hidden).toBe(true);
    });
  });

  describe('showRowCapNotice', () => {
    it('publishes the capped fetch with its substitutions in the panel notice', () => {
      const element = document.createElement('div');
      element.hidden = true;
      document.body.appendChild(element);
      const notices = new PanelNotices();
      notices.register('rowCap', element);

      showRowCapNotice({
        notices,
        messageKey: 'wordClusterRowCapNotice',
        fallback: 'unused',
        shown: 10_000,
        total: 12_345,
        limit: 10_000,
      });

      expect(element.hidden).toBe(false);
      expect(element.textContent).toContain('12345');
      expect(element.textContent).toContain('10000');
    });
  });
});
