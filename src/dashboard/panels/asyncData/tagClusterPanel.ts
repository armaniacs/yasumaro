/**
 * tagClusterPanel.ts (PanelLifecycle)
 * Renders a tag cooccurrence graph (nodes + edges) as SVG in the dashboard.
 *
 * The shared period filter (PBI 2026-09-24-02) is embedded with the 'last7'
 * preset as default (user decision 2026-09-24: all-time graphs are too noisy
 * as a landing view). Unlike the domain-analysis panel (explicit Run button
 * in front of a paged 50k-row fetch), a selection here refetches immediately:
 * each load is a single capped 10000-row query, the same cost as this
 * panel's routine load.
 */

import { queryLogs, getSqliteStatus, isServiceError } from '../../dashboardSqliteService.js';
import { limitToTopNodes } from '../../tagCooccurrence.js';
import {
    computeTagCooccurrenceHybrid,
    narrowEntriesToTopTagsHybrid,
} from '../../tagCooccurrenceHybrid.js';
import { MAX_TAG_CLUSTER_TAGS } from '../../../utils/computeLimits.js';
import { computeLayout, computeCanvasSize } from '../../tagClusterLayout.js';
import { TagClusterLoadingManager } from '../../tagClusterLoading.js';
import { TagClusterPanZoomController } from '../../tagClusterPanZoom.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { getMessageOr } from '../../../utils/i18n.js';
import {
    createPeriodFilter,
    type PeriodFilterHandle,
    type PeriodRange,
} from '../../components/periodFilter.js';
import type { BrowsingLogEntry } from '../../dashboardSqliteService.js';
import { type PanelLifecycle } from '../types.js';
import { tryNavigateTyped } from '../registryContext.js';

const MAX_NODES = 50;
const SVG_NS = 'http://www.w3.org/2000/svg';

export function createTagClusterPanel(): PanelLifecycle {
  let svg: SVGSVGElement | null = null;
  let emptyState: HTMLElement | null = null;
  let truncatedNotice: HTMLElement | null = null;
  let panZoomController: TagClusterPanZoomController | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  // Fallback when no filter host exists: unbounded, like the pre-filter panel.
  let currentRange: PeriodRange = {};
  let loadSeq = 0;
  let filterReady = false;

  /**
   * Swaps the empty-state text between the generic and the period-aware
   * message so a 0-row result under a period filter explains the filtering.
   */
  function applyEmptyStateMessage(bounds: PeriodRange): void {
    if (!emptyState) return;
    const hasBounds = bounds.since !== undefined || bounds.until !== undefined;
    const key = hasBounds ? 'tagCluster_empty_period' : 'tagClusterEmptyState';
    const fallback = hasBounds
      ? 'No records in the selected period. Try a wider range.'
      : 'No tagged history yet.';
    // WHY: keep the data-i18n binding in sync so a later language switch
    // re-applies the same period-aware message instead of the generic one.
    emptyState.setAttribute('data-i18n', key);
    emptyState.textContent = getMessageOr(key, fallback);
  }

  async function reload(): Promise<void> {
    if (!svg) return;
    const seq = ++loadSeq;

    panZoomController?.cleanup();
    panZoomController = null;

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.removeAttribute('viewBox');

    const loadingManager = new TagClusterLoadingManager(svg);
    loadingManager.show();

    try {
      // WHY: snapshot the range so retries reuse one consistent window even
      // if the user changes the filter mid-flight (stale loads bail via seq).
      const bounds = currentRange;
      const rows = await loadRowsWithRetry(bounds);
      if (seq !== loadSeq) {
        loadingManager.cleanup();
        return;
      }
      loadingManager.updateStep(0);

      // Narrow to the most frequent tags BEFORE cooccurrence so the O(n^2)
      // double loop and force-directed layout stay bounded (VULN-053).
      // Hybrid routes to the WASM core on large inputs and falls back to
      // the sync TS implementations on any WASM failure.
      const narrowedRows = await narrowEntriesToTopTagsHybrid(rows, MAX_TAG_CLUSTER_TAGS);
      const { nodes, edges } = await computeTagCooccurrenceHybrid(narrowedRows);
      if (seq !== loadSeq) {
        loadingManager.cleanup();
        return;
      }
      loadingManager.updateStep(1);

      if (nodes.length === 0) {
        loadingManager.cleanup();
        applyEmptyStateMessage(bounds);
        if (emptyState) emptyState.hidden = false;
        if (truncatedNotice) truncatedNotice.hidden = true;
        return;
      }

      if (emptyState) emptyState.hidden = true;

      const limited = limitToTopNodes(nodes, edges, MAX_NODES);
      if (truncatedNotice) truncatedNotice.hidden = !limited.truncated;

      const canvasSize = computeCanvasSize(limited.nodes.length);
      const positions = computeLayout(limited.nodes, limited.edges, canvasSize.width, canvasSize.height);
      loadingManager.updateStep(2);

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
        // WHY: click-through stays tag-only — carrying the period into the
        // history panel is explicitly out of scope for v1 (PBI 2026-09-24-04).
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

      loadingManager.updateStep(3);
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

  return {
    id: 'panel-tag-cluster',
    category: 'async-data',
    mount(container) {
      // WHY: `querySelector` returns `Element | null`; cast needed for SVG-specific API access
      svg = container.querySelector('#tagClusterSvg') as unknown as SVGSVGElement | null;
      emptyState = container.querySelector('#tagClusterEmptyState');
      truncatedNotice = container.querySelector('#tagClusterTruncatedNotice');
      const filterHost = container.querySelector('#tagClusterFilter');
      if (filterHost) {
        filterHandle = createPeriodFilter({
          initialPreset: 'last7',
          onChange: (range) => {
            currentRange = range;
            // WHY: auto-apply on selection — the PBI acceptance criteria
            // require queryLogs({since, until, limit}) at selection time, and
            // each load is a single capped query (no 50k paging), so the
            // explicit Run-button pattern of the domain-analysis panel is not
            // warranted here.
            if (filterReady) void reload();
          },
        });
        filterHost.appendChild(filterHandle.element);
        currentRange = filterHandle.getRange();
        // WHY: the filter emits once during construction; arming the reload
        // trigger only after that initial emission prevents a duplicate load
        // when mount finishes.
        filterReady = true;
      }
    },
    async load() {
      await reload();
    },
    destroy() {
      loadSeq += 1;
      panZoomController?.cleanup();
      panZoomController = null;
      filterHandle?.destroy();
      filterHandle = null;
    },
    init(init?: Record<string, unknown>) {
      if (init?.focusTag) {
        // focus on a specific tag — data will be reloaded via load
      }
    },
  };
}

function navigateToHistoryWithTag(tag: string): void {
  const fallback = (): void => {
    document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: tag }));
  };
  tryNavigateTyped('panel-sqlite-history', { searchTag: tag }, fallback);
}

async function loadRowsWithRetry(bounds: PeriodRange): Promise<BrowsingLogEntry[]> {
  const result = await retryWithExponentialBackoff<BrowsingLogEntry[]>(
    async () => {
      const status = await getSqliteStatus();
      if (!status?.initialized) {
        return null;
      }
      // WHY: exactOptionalPropertyTypes forbids explicit undefined — unset
      // bounds pass no since/until key, so the all-time query stays
      // byte-identical to the pre-filter { limit: 10000 } call.
      const qRes = await queryLogs({
        ...(bounds.since !== undefined ? { since: bounds.since } : {}),
        ...(bounds.until !== undefined ? { until: bounds.until } : {}),
        limit: 10000,
      });
      // Return null (not []) on failure: retryWithExponentialBackoff only
      // retries when the thunk yields null or throws, so coercing an error to
      // an empty array made it return "successfully" on the first attempt and
      // skip all remaining attempts.
      if (isServiceError(qRes)) {
        return null;
      }
      return qRes.data.rows;
    },
    { label: 'tagCluster', maxAttempts: 4 }
  );
  return result ?? [];
}
