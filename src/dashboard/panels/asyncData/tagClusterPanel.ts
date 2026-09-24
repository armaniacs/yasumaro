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

import { limitToTopNodes } from '../../tagCooccurrence.js';
import {
    computeTagCooccurrenceHybrid,
    narrowEntriesToTopTagsHybrid,
} from '../../tagCooccurrenceHybrid.js';
import { MAX_TAG_CLUSTER_TAGS } from '../../../utils/computeLimits.js';
import { computeLayout, computeCanvasSize } from '../../tagClusterLayout.js';
import { TagClusterLoadingManager } from '../../tagClusterLoading.js';
import { TagClusterPanZoomController } from '../../tagClusterPanZoom.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { PanelNotices } from '../PanelNotices.js';
import { getMessageOr } from '../../../utils/i18n.js';
import {
    createPeriodFilter,
    type PeriodFilterHandle,
    type PeriodRange,
    } from '../../components/periodFilter.js';
import { type PanelLifecycle } from '../types.js';
import { navigateToHistoryWithTag } from '../navigateToHistory.js';

const MAX_NODES = 50;
const SVG_NS = 'http://www.w3.org/2000/svg';

export function createTagClusterPanel(): PanelLifecycle {
  let svg: SVGSVGElement | null = null;
  let panZoomController: TagClusterPanZoomController | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  // WHY: the empty-state element doubles as the error surface (one element,
  // two modes) with a period-aware empty wording swapped via setEmptyMessage.
  const notices = new PanelNotices();
  let loadSeq = 0;

  /** The period-aware empty message when a filter bounds the query. */
  function periodEmptyKey(bounds: PeriodRange): string {
    const hasBounds = bounds.since !== undefined || bounds.until !== undefined;
    return hasBounds ? 'tagCluster_empty_period' : 'tagClusterEmptyState';
  }

  function periodEmptyFallback(bounds: PeriodRange): string {
    const hasBounds = bounds.since !== undefined || bounds.until !== undefined;
    return hasBounds
      ? 'No records in the selected period. Try a wider range.'
      : 'No tagged history yet.';
  }

  async function reload(): Promise<void> {
    if (!svg) return;
    const seq = ++loadSeq;
    // WHY: getRange() is the single source of truth (PBI 2026-09-24-11); the
    // snapshot lets retries reuse one consistent window even if the user
    // changes the filter mid-flight (stale loads bail via seq). No filter
    // host → unbounded, like the pre-filter panel.
    const bounds = filterHandle ? filterHandle.getRange() : {};

    panZoomController?.cleanup();
    panZoomController = null;

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.removeAttribute('viewBox');

    // Fresh-fetch reset: restores the normal empty binding in case a previous
    // load failed and swapped in the error message, and hides the truncation
    // notice so a stale one cannot outlive its fetch.
    notices.reset();
    if (bounds.since !== undefined || bounds.until !== undefined) {
      // WHY: sync the period-aware binding while hidden so a later language
      // switch re-applies the period-aware message instead of the generic one.
      notices.setEmptyMessage(periodEmptyKey(bounds), periodEmptyFallback(bounds));
    }

    const loadingManager = new TagClusterLoadingManager(svg);
    loadingManager.show();

    try {
      const fetched = await fetchPeriodRows({ ...bounds, limit: 10000, label: 'tagCluster' });
      const rows = fetched.rows;
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
        notices.showEmpty(periodEmptyKey(bounds), periodEmptyFallback(bounds));
        notices.hide('truncated');
        return;
      }

      const limited = limitToTopNodes(nodes, edges, MAX_NODES);
      if (limited.truncated) {
        notices.show('truncated');
      } else {
        notices.hide('truncated');
      }

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
      // WHY: a persistent query failure must not render as an empty graph —
      // show a distinct error state (timeHeatmapPanel convention).
      if (seq !== loadSeq) return;
      notices.showError('tagClusterError', 'Failed to load the tag cluster. Try again.');
    }
  }

  return {
    id: 'panel-tag-cluster',
    category: 'async-data',
    mount(container) {
      // WHY: `querySelector` returns `Element | null`; cast needed for SVG-specific API access
      svg = container.querySelector('#tagClusterSvg') as unknown as SVGSVGElement | null;
      notices.register('empty', container.querySelector('#tagClusterEmptyState'), {
        i18nKey: 'tagClusterEmptyState',
        fallbackText: 'No tagged history yet.',
      });
      notices.register('truncated', container.querySelector('#tagClusterTruncatedNotice'));
      const filterHost = container.querySelector('#tagClusterFilter');
      if (filterHost) {
        filterHandle = createPeriodFilter({
          initialPreset: 'last7',
          onChange: () => {
            // WHY: auto-apply on selection — the PBI acceptance criteria
            // require queryLogs({since, until, limit}) at selection time, and
            // each load is a single capped query (no 50k paging), so the
            // explicit Run-button pattern of the domain-analysis panel is not
            // warranted here. Construction emits nothing (PBI 2026-09-24-11),
            // so firing reload directly is duplicate-safe.
            void reload();
          },
        });
        filterHost.appendChild(filterHandle.element);
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
      notices.clear();
    },
    init(init?: Record<string, unknown>) {
      if (init?.focusTag) {
        // focus on a specific tag — data will be reloaded via load
      }
    },
  };
}
