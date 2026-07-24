/**
 * tagClusterPanel.ts
 * Renders a tag cooccurrence graph (nodes + edges) as SVG in the dashboard.
 */

import { queryLogs, getSqliteStatus } from './dashboardSqliteService.js';
import { computeTagCooccurrence, limitToTopNodes } from './tagCooccurrence.js';
import { computeLayout, computeCanvasSize } from './tagClusterLayout.js';
import { TagClusterLoadingManager } from './tagClusterLoading.js';
import { TagClusterPanZoomController } from './tagClusterPanZoom.js';
import { retryWithExponentialBackoff } from './utils/retry.js';
import type { BrowsingLogEntry } from './dashboardSqliteService.js';

const MAX_NODES = 50;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Global state for tag filtering (used by navigate-to-tag event)
let tagFilterState = {
  activeTag: null as string | null,
};

// Holds the controller across initTagClusterPanel() calls so a re-render
// (e.g. re-opening the panel) cleans up the previous instance's listeners
// before attaching a new one.
let panZoomController: TagClusterPanZoomController | null = null;

export async function initTagClusterPanel(): Promise<void> {
  const svg = document.getElementById('tagClusterSvg') as unknown as SVGSVGElement | null;
  const emptyState = document.getElementById('tagClusterEmptyState') as HTMLElement | null;
  const truncatedNotice = document.getElementById('tagClusterTruncatedNotice') as HTMLElement | null;
  if (!svg) {
    return;
  }

  panZoomController?.cleanup();
  panZoomController = null;

  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.removeAttribute('viewBox');

  const loadingManager = new TagClusterLoadingManager(svg);
  loadingManager.show();

  try {
    const rows = await loadRowsWithRetry();

    loadingManager.updateStep(0); // Step 1/4: データ読み込み 完了

    const { nodes, edges } = computeTagCooccurrence(rows);

    loadingManager.updateStep(1); // Step 2/4: ノード分析 完了

    if (nodes.length === 0) {
      loadingManager.cleanup();
      if (emptyState) emptyState.hidden = false;
      if (truncatedNotice) truncatedNotice.hidden = true;
      return;
    }

    if (emptyState) emptyState.hidden = true;

    const limited = limitToTopNodes(nodes, edges, MAX_NODES);
    if (truncatedNotice) truncatedNotice.hidden = !limited.truncated;

    const canvasSize = computeCanvasSize(limited.nodes.length);
    const positions = computeLayout(limited.nodes, limited.edges, canvasSize.width, canvasSize.height);

    loadingManager.updateStep(2); // Step 3/4: レイアウト計算 完了

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
        if (panZoomController?.wasDragSuppressingClick()) return;
        navigateToHistoryWithTag(node.tag);
      });

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `#${node.tag} (${node.count})`;
      circle.appendChild(title);

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(pos.x));
      text.setAttribute('y', String(pos.y));
      text.setAttribute('dy', '0.3em');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'tag-cluster-text');
      text.setAttribute('pointer-events', 'none');
      text.textContent = `#${node.tag}`;

      svg.appendChild(circle);
      svg.appendChild(text);
    }

    loadingManager.updateStep(3); // Step 4/4: グラフ描画 完了
    loadingManager.cleanup();

    panZoomController = new TagClusterPanZoomController(svg, canvasSize, {
      zoomInBtn: document.getElementById('tagClusterZoomIn'),
      zoomOutBtn: document.getElementById('tagClusterZoomOut'),
      resetBtn: document.getElementById('tagClusterZoomReset'),
    });
    panZoomController.attach();
  } catch (error) {
    loadingManager.cleanup();
    console.error('[tagClusterPanel] error:', error);
  }
}

function navigateToHistoryWithTag(tag: string): void {
  document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: tag }));
}

/**
 * Load rows for the tag cluster, retrying with backoff while the SQLite
 * client in the service worker is still initializing (Offscreen Document
 * setup + WASM loading). Without this, the very first Tag Cluster render
 * after browser/extension startup can race the SQLite init and come back
 * with zero rows even though data exists (fixed by a manual reload).
 */
async function loadRowsWithRetry(): Promise<BrowsingLogEntry[]> {
  const result = await retryWithExponentialBackoff<BrowsingLogEntry[]>(
    async () => {
      const status = await getSqliteStatus();
      if (!status?.initialized) {
        return null; // Not ready yet — retry
      }
      const queryResult = await queryLogs({ limit: 10000 });
      return (queryResult && 'rows' in queryResult ? queryResult.rows : null) ?? [];
    },
    { label: 'tagCluster', maxAttempts: 4 }
  );
  return result ?? [];
}
