/**
 * wordClusterPanel.ts (PanelLifecycle)
 * Keyword cooccurrence cluster graph (PBI 2026-09-24-07). Extracts keywords
 * from each row's summary+title (keywordExtractor), fakes them as "#kw"
 * pseudo-tags (wordClusterAdapter), then reuses the tag-cluster pipeline
 * unchanged: narrowEntriesToTopTagsHybrid → computeTagCooccurrenceHybrid →
 * limitToTopNodes → computeLayout → SVG with pan/zoom.
 *
 * Fetch strategy follows the domain-analysis panel (explicit-apply): the
 * panel passes no onChange handler and the Run button reads the current
 * filter selection via getRange() to trigger the single capped query
 * (PBI 2026-09-24-11 contract) — keyword extraction reruns client-side over
 * the whole fetch, so a reload per preset click is disproportionate.
 *
 * Click-through on keyword nodes reuses the tag navigate-to-history pattern;
 * keywords are not stored tags, so the history search may be empty —
 * accepted for v1 (PBI acceptance criteria: click-through is unified on
 * search navigation).
 */

import { limitToTopNodes, type TagNode } from '../../tagCooccurrence.js';
import {
  computeTagCooccurrenceHybrid,
  narrowEntriesToTopTagsHybrid,
} from '../../tagCooccurrenceHybrid.js';
import { MAX_TAG_CLUSTER_TAGS } from '../../../utils/computeLimits.js';
import { computeLayout, computeCanvasSize } from '../../tagClusterLayout.js';
import { TagClusterLoadingManager } from '../../tagClusterLoading.js';
import { TagClusterPanZoomController } from '../../tagClusterPanZoom.js';
import { buildWordClusterRows } from '../../wordClusterAdapter.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { PanelNotices } from '../PanelNotices.js';
import { getMessage, getMessageOr } from '../../../utils/i18n.js';
import {
  createPeriodFilter,
  type PeriodFilterHandle,
} from '../../components/periodFilter.js';
import { type PanelLifecycle } from '../types.js';
import { navigateToHistoryWithTag } from '../navigateToHistory.js';

const MAX_NODES = 50;
const MAX_QUERY_ROWS = 10000;
const SVG_NS = 'http://www.w3.org/2000/svg';
// Keywords are longer than tags; the aria-label stays a compact summary.
const ARIA_LABEL_MAX_KEYWORDS = 8;

/** getMessage with {name} substitutions and an English fallback template. */
function msg(key: string, subs: Record<string, string | number>, fallback: string): string {
  const translated = getMessage(key, subs);
  if (translated) return translated;
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) =>
    subs[name] !== undefined ? String(subs[name]) : `{${name}}`,
  );
}

export function createWordClusterPanel(): PanelLifecycle {
  let svg: SVGSVGElement | null = null;
  let truncatedNotice: HTMLElement | null = null;
  let rowCapNotice: HTMLElement | null = null;
  let excludedNotice: HTMLElement | null = null;
  let filterHost: HTMLElement | null = null;
  let runButton: HTMLButtonElement | null = null;
  let panZoomController: TagClusterPanZoomController | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  // WHY: the empty-state element doubles as the error surface (one element,
  // two modes, two empty wordings swapped via setEmptyMessage). The row-cap
  // notice describes the FETCH, so it is fetch-scoped; loading status and
  // the aggregation notices are re-decided per fetch.
  const notices = new PanelNotices();
  let loadSeq = 0;

  async function reload(): Promise<void> {
    if (!svg) return;
    const seq = ++loadSeq;

    panZoomController?.cleanup();
    panZoomController = null;

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.removeAttribute('viewBox');
    notices.reset();
    notices.show('loading');

    const loadingManager = new TagClusterLoadingManager(svg);
    loadingManager.show();

    try {
      // WHY: getRange() is the single source of truth (PBI 2026-09-24-11);
      // the snapshot lets retries reuse one consistent window even if the
      // user changes the filter mid-flight (stale loads bail via seq). No
      // filter host → unbounded, like the pre-filter panel.
      const bounds = filterHandle ? filterHandle.getRange() : {};
      const fetched = await fetchPeriodRows({
        since: bounds.since,
        until: bounds.until,
        limit: MAX_QUERY_ROWS,
        label: 'wordCluster',
      });
      const rows = fetched.rows;
      if (seq !== loadSeq) {
        loadingManager.cleanup();
        return;
      }
      loadingManager.updateStep(0);

      // WHY: queryLogs caps the fetch at MAX_QUERY_ROWS, so when the period
      // holds more rows the analyzed set is a prefix — the PBI requires the
      // truncation to be visible (BDD "上限 10000 行での期間フィルタ").
      if (fetched.capped && rowCapNotice) {
        rowCapNotice.textContent = msg(
          'wordClusterRowCapNotice',
          { max: MAX_QUERY_ROWS, shown: rows.length, total: fetched.total },
          `The query hit the ${MAX_QUERY_ROWS}-row limit — aggregating the most recent ${rows.length} of ${fetched.total} records.`,
        );
        notices.show('rowCap');
      }

      const adapter = buildWordClusterRows(rows);
      if (adapter.summaryExcludedCount > 0 && excludedNotice) {
        excludedNotice.textContent = msg(
          'wordClusterExcludedCount',
          { count: adapter.summaryExcludedCount },
          'Excluded {count} rows without a usable summary (AI failure or fallback text); titles were still used.',
        );
        notices.show('excluded');
      }

      if (adapter.rows.length === 0) {
        loadingManager.cleanup();
        notices.hide('loading');
        // Every fetched row was skipped (no usable text) → the no-usable-rows
        // empty state; rows existed but zero keywords survived filtering →
        // the no-keywords empty state (PBI empty-state distinction).
        const noUsableRows = adapter.skippedRows === rows.length;
        notices.setEmptyMessage(
          noUsableRows ? 'wordClusterEmpty' : 'wordClusterEmptyNoKeywords',
          noUsableRows
            ? 'No records with usable text in the selected period. Try a wider range.'
            : 'Records were found, but no keywords remained after filtering.',
        );
        notices.show('empty');
        return;
      }

      // Narrow to the most frequent keywords BEFORE cooccurrence — same
      // O(n^2) bound as the tag-cluster panel (VULN-053), now over the
      // pseudo-tag rows.
      const narrowedRows = await narrowEntriesToTopTagsHybrid(adapter.rows, MAX_TAG_CLUSTER_TAGS);
      const { nodes, edges } = await computeTagCooccurrenceHybrid(narrowedRows);
      if (seq !== loadSeq) {
        loadingManager.cleanup();
        return;
      }
      loadingManager.updateStep(1);

      if (nodes.length === 0) {
        loadingManager.cleanup();
        notices.hide('loading');
        notices.setEmptyMessage(
          'wordClusterEmptyNoKeywords',
          'Records were found, but no keywords remained after filtering.',
        );
        notices.show('empty');
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
        // WHY: keyword nodes reuse the tag search navigation — keywords are
        // not stored tags, so the history search may be empty, accepted for
        // v1 (PBI: click-through unified on search navigation).
        circle.addEventListener('click', () => {
          if (panZoomController?.wasDragSuppressingClick()) return;
          navigateToHistoryWithTag(node.tag);
        });

        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = `${node.tag} (${node.count})`;
        circle.appendChild(title);

        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', String(pos.x));
        text.setAttribute('y', String(pos.y));
        text.setAttribute('dy', '0.3em');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'tag-cluster-text');
        text.setAttribute('pointer-events', 'none');
        text.textContent = node.tag;

        svg.appendChild(circle);
        svg.appendChild(text);
      }

      // WHY: a text alternative for the graph (PBI a11y requirement) — the
      // top keywords list changes per render, so the aria-label is rebuilt
      // from the localized panel title plus the rendered keyword list.
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', buildGraphAriaLabel(limited.nodes));

      loadingManager.updateStep(3);
      loadingManager.cleanup();
      notices.hide('loading');

      panZoomController = new TagClusterPanZoomController(svg, canvasSize, {
        zoomInBtn: document.getElementById('wordClusterZoomIn'),
        zoomOutBtn: document.getElementById('wordClusterZoomOut'),
        resetBtn: document.getElementById('wordClusterZoomReset'),
      });
      panZoomController.attach();
    } catch (error) {
      loadingManager.cleanup();
      notices.hide('loading');
      console.error('[wordClusterPanel] error:', error);
      if (seq !== loadSeq) return;
      notices.showError('wordClusterError', 'Failed to load the word cluster. Try again.');
    }
  }

  function buildGraphAriaLabel(nodes: TagNode[]): string {
    const topKeywords = nodes
      .slice(0, ARIA_LABEL_MAX_KEYWORDS)
      .map((node) => node.tag)
      .join(', ');
    return `${getMessageOr('wordClusterTitle', 'Word Cluster')}: ${topKeywords}`;
  }

  return {
    id: 'panel-word-cluster',
    category: 'async-data',
    mount(container) {
      // WHY: `querySelector` returns `Element | null`; cast needed for SVG-specific API access
      svg = container.querySelector('#wordClusterSvg') as unknown as SVGSVGElement | null;
      truncatedNotice = container.querySelector('#wordClusterTruncatedNotice');
      rowCapNotice = container.querySelector('#wordClusterRowCapNotice');
      excludedNotice = container.querySelector('#wordClusterExcludedNotice');
      filterHost = container.querySelector('#wordClusterFilter');
      runButton = container.querySelector('#wordClusterRunBtn');

      notices.register('empty', container.querySelector('#wordClusterEmptyState'), {
        i18nKey: 'wordClusterEmpty',
        fallbackText: 'No records with usable text in the selected period. Try a wider range.',
      });
      notices.register('truncated', truncatedNotice);
      notices.register('rowCap', rowCapNotice, { fetchScoped: true });
      notices.register('excluded', excludedNotice);
      notices.register('loading', container.querySelector('#wordClusterLoadingStatus'));

      if (filterHost) {
        filterHandle = createPeriodFilter({
          // WHY: 'last7' as the landing view (user decision 2026-09-24) —
          // an all-time keyword graph is too noisy to be useful at first
          // sight; 'all' stays one click away. No onChange handler: the
          // explicit-apply host reads getRange() in reload() (Run button
          // applies the range; PBI 2026-09-24-11 contract).
          initialPreset: 'last7',
        });
        filterHost.appendChild(filterHandle.element);
      }

      runButton?.addEventListener('click', () => {
        void reload();
      });
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
      filterHost = null;
      runButton = null;
      truncatedNotice = null;
      rowCapNotice = null;
      excludedNotice = null;
      svg = null;
      notices.clear();
    },
  };
}
