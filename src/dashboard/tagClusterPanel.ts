/**
 * tagClusterPanel.ts
 * Renders a tag cooccurrence graph (nodes + edges) as SVG in the dashboard.
 */

import { queryLogs } from './dashboardSqliteService.js';
import { computeTagCooccurrence, limitToTopNodes } from './tagCooccurrence.js';
import { computeLayout } from './tagClusterLayout.js';

const MAX_NODES = 50;
const SVG_NS = 'http://www.w3.org/2000/svg';

export async function initTagClusterPanel(): Promise<void> {
  const svg = document.getElementById('tagClusterSvg') as unknown as SVGSVGElement | null;
  const emptyState = document.getElementById('tagClusterEmptyState') as HTMLElement | null;
  const truncatedNotice = document.getElementById('tagClusterTruncatedNotice') as HTMLElement | null;
  if (!svg) return;

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const result = await queryLogs({ limit: 10000 });
  const rows = result?.rows ?? [];

  const { nodes, edges } = computeTagCooccurrence(rows);

  if (nodes.length === 0) {
    if (emptyState) emptyState.hidden = false;
    if (truncatedNotice) truncatedNotice.hidden = true;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  const limited = limitToTopNodes(nodes, edges, MAX_NODES);
  if (truncatedNotice) truncatedNotice.hidden = !limited.truncated;

  let width = 400;
  let height = 300;
  try {
    if (svg.width && svg.width.baseVal && svg.width.baseVal.value) {
      width = svg.width.baseVal.value;
    } else {
      const widthAttr = svg.getAttribute('width');
      if (widthAttr) {
        const parsed = parseInt(widthAttr);
        if (!isNaN(parsed)) width = parsed;
      }
    }
    if (svg.height && svg.height.baseVal && svg.height.baseVal.value) {
      height = svg.height.baseVal.value;
    } else {
      const heightAttr = svg.getAttribute('height');
      if (heightAttr) {
        const parsed = parseInt(heightAttr);
        if (!isNaN(parsed)) height = parsed;
      }
    }
  } catch {
    // Ignore errors, use defaults
  }

  const positions = computeLayout(limited.nodes, limited.edges, width, height);

  for (const edge of limited.edges) {
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) continue;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(a.x));
    line.setAttribute('y1', String(a.y));
    line.setAttribute('x2', String(b.x));
    line.setAttribute('y2', String(b.y));
    line.setAttribute('class', 'tag-cluster-edge');
    line.setAttribute('stroke-width', String(Math.min(edge.weight, 5)));
    svg.appendChild(line);
  }

  for (const node of limited.nodes) {
    const pos = positions.get(node.tag);
    if (!pos) continue;
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(pos.x));
    circle.setAttribute('cy', String(pos.y));
    circle.setAttribute('r', String(4 + Math.min(node.count, 20)));
    circle.setAttribute('class', 'tag-cluster-node');
    circle.style.cursor = 'pointer';
    circle.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: node.tag }));
    });

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `#${node.tag} (${node.count})`;
    circle.appendChild(title);

    svg.appendChild(circle);
  }
}
