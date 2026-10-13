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

import {
    computeTagCooccurrenceHybrid,
    narrowEntriesToTopTagsHybrid,
} from '../../tagCooccurrenceHybrid.js';
import {
  MAX_QUERY_ROWS,
  MAX_TAG_CLUSTER_TAGS,
} from '../../../utils/computeLimits.js';
import { TagClusterLoadingManager } from '../../tagClusterLoading.js';
import { TagClusterPanZoomController } from '../../tagClusterPanZoom.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { PanelNotices } from '../PanelNotices.js';
import { type PeriodRange } from '../../components/periodFilter.js';
import { createAsyncDataPanelLifecycle } from './asyncDataPanelLifecycle.js';
import { limitClusterNodes, renderClusterGraph } from './clusterGraphRenderer.js';
import { type PanelLifecycle } from '../types.js';

export function createTagClusterPanel(): PanelLifecycle {
  let svg: SVGSVGElement | null = null;
  let panZoomController: TagClusterPanZoomController | null = null;
  // WHY: the empty-state element doubles as the error surface (one element,
  // two modes) with a period-aware empty wording swapped via setEmptyMessage.
  const notices = new PanelNotices();

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

  const lifecycle = createAsyncDataPanelLifecycle({
    label: 'tagClusterPanel',
    notices: [notices],
    filterHostSelector: '#tagClusterFilter',
    initialPreset: 'last7',
    // WHY: auto-apply on selection — the PBI acceptance criteria require
    // queryLogs({since, until, limit}) at selection time, and each load is a
    // single capped query (no 50k paging), so the explicit Run-button pattern
    // of the domain-analysis panel is not warranted here. Construction emits
    // nothing (PBI 2026-09-24-11), so firing reload directly is
    // duplicate-safe.
    autoApply: true,
    isReady: () => svg !== null,
    resetOutput: () => {
      panZoomController?.cleanup();
      panZoomController = null;
      if (!svg) return;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.removeAttribute('viewBox');
    },
    // WHY: isReady() already gated this load; the check narrows the captured
    // host for the body.
    load: async ({ range, isStale }) => {
      if (!svg) return;
      if (range.since !== undefined || range.until !== undefined) {
        // WHY: sync the period-aware binding while hidden so a later language
        // switch re-applies the period-aware message instead of the generic one.
        notices.setEmptyMessage(periodEmptyKey(range), periodEmptyFallback(range));
      }

      const loadingManager = new TagClusterLoadingManager(svg);
      loadingManager.show();

      try {
        const fetched = await fetchPeriodRows({ ...range, limit: MAX_QUERY_ROWS, label: 'tagCluster' });
        const rows = fetched.rows;
        if (isStale()) {
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
        if (isStale()) {
          loadingManager.cleanup();
          return;
        }
        loadingManager.updateStep(1);

        if (nodes.length === 0) {
          loadingManager.cleanup();
          notices.showEmpty(periodEmptyKey(range), periodEmptyFallback(range));
          notices.hide('truncated');
          return;
        }

        const limited = limitClusterNodes(nodes, edges, notices);
        loadingManager.updateStep(2);

        panZoomController = renderClusterGraph({
          svg,
          nodes: limited.nodes,
          edges: limited.edges,
          ariaLabel: (rendered) =>
            `Tag cluster: ${rendered
              .slice(0, 10)
              .map((node) => `#${node.tag}`)
              .join(', ')}`,
          buttons: {
            zoomInBtn: document.getElementById('tagClusterZoomIn'),
            zoomOutBtn: document.getElementById('tagClusterZoomOut'),
            resetBtn: document.getElementById('tagClusterZoomReset'),
          },
        });

        loadingManager.updateStep(3);
        loadingManager.cleanup();
      } catch (error) {
        loadingManager.cleanup();
        console.error('[tagClusterPanel] error:', error);
        // WHY: a persistent query failure must not render as an empty graph —
        // show a distinct error state (timeHeatmapPanel convention).
        if (isStale()) return;
        notices.showError('tagClusterError', 'Failed to load the tag cluster. Try again.');
      }
    },
    teardown: () => {
      panZoomController?.cleanup();
      panZoomController = null;
    },
  });

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
      lifecycle.mount(container);
    },
    async load() {
      await lifecycle.reload();
    },
    destroy() {
      lifecycle.destroy();
    },
    init(init?: Record<string, unknown>) {
      if (init?.focusTag) {
        // focus on a specific tag — data will be reloaded via load
      }
    },
  };
}
