/**
 * wordClusterPanel.ts (PanelLifecycle)
 * Keyword cooccurrence cluster graph (PBI 2026-09-24-07). Extracts keywords
 * from each row's summary+title (keywordExtractor), fakes them as "#kw"
 * pseudo-tags (wordClusterAdapter), then reuses the tag-cluster pipeline
 * unchanged: narrowEntriesToTopTagsHybrid → computeTagCooccurrenceHybrid →
 * limitToTopNodes → computeLayout → SVG with pan/zoom.
 *
 * Fetch strategy follows the domain-analysis panel (explicit-apply): the
 * shared period filter only records the selection and the Run button triggers
 * the single capped query — keyword extraction reruns client-side over the
 * whole fetch, so a reload per preset click is disproportionate.
 *
 * Click-through on keyword nodes reuses the tag navigate-to-history pattern;
 * keywords are not stored tags, so the history search may be empty —
 * accepted for v1 (PBI acceptance criteria: click-through is unified on
 * search navigation).
 */

import { queryLogs, getSqliteStatus, isServiceError } from '../../dashboardSqliteService.js';
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
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { getMessage, getMessageOr } from '../../../utils/i18n.js';
import {
  createPeriodFilter,
  type PeriodFilterHandle,
  type PeriodRange,
} from '../../components/periodFilter.js';
import type { BrowsingLogEntry } from '../../dashboardSqliteService.js';
import { type PanelLifecycle } from '../types.js';
import { tryNavigateTyped } from '../registryContext.js';

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

function navigateToHistoryWithTag(keyword: string): void {
  const fallback = (): void => {
    document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: keyword }));
  };
  tryNavigateTyped('panel-sqlite-history', { searchTag: keyword }, fallback);
}

export function createWordClusterPanel(): PanelLifecycle {
  let svg: SVGSVGElement | null = null;
  let emptyState: HTMLElement | null = null;
  let truncatedNotice: HTMLElement | null = null;
  let rowCapNotice: HTMLElement | null = null;
  let excludedNotice: HTMLElement | null = null;
  let loadingStatus: HTMLElement | null = null;
  let filterHost: HTMLElement | null = null;
  let runButton: HTMLButtonElement | null = null;
  let panZoomController: TagClusterPanZoomController | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  // 'all' = no bounds: the tag-cluster panel default, matching the
  // pre-filter query shape ({ limit: 10000 }).
  let currentRange: PeriodRange = {};
  let loadSeq = 0;

  function setEmptyMessage(key: string, fallback: string): void {
    if (!emptyState) return;
    // WHY: keep the data-i18n binding in sync so a later language switch
    // re-applies the same message instead of a stale generic one
    // (tagClusterPanel convention).
    emptyState.setAttribute('data-i18n', key);
    emptyState.textContent = getMessageOr(key, fallback);
  }

  function hideNotices(): void {
    if (emptyState) emptyState.hidden = true;
    if (truncatedNotice) truncatedNotice.hidden = true;
    if (rowCapNotice) rowCapNotice.hidden = true;
    if (excludedNotice) excludedNotice.hidden = true;
    if (loadingStatus) loadingStatus.hidden = true;
  }

  async function reload(): Promise<void> {
    if (!svg) return;
    const seq = ++loadSeq;

    panZoomController?.cleanup();
    panZoomController = null;

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.removeAttribute('viewBox');
    hideNotices();
    if (loadingStatus) loadingStatus.hidden = false;

    const loadingManager = new TagClusterLoadingManager(svg);
    loadingManager.show();

    try {
      // WHY: snapshot the range so retries reuse one consistent window even
      // if the user changes the filter mid-flight (stale loads bail via seq).
      const bounds = currentRange;
      const fetched = await loadRowsWithRetry(bounds);
      const rows = fetched.rows;
      if (seq !== loadSeq) {
        loadingManager.cleanup();
        return;
      }
      loadingManager.updateStep(0);

      // WHY: queryLogs caps the fetch at MAX_QUERY_ROWS, so when the period
      // holds more rows the analyzed set is a prefix — the PBI requires the
      // truncation to be visible (BDD "上限 10000 行での期間フィルタ").
      if (fetched.total > rows.length && rowCapNotice) {
        rowCapNotice.textContent = msg(
          'wordClusterRowCapNotice',
          { max: MAX_QUERY_ROWS, shown: rows.length, total: fetched.total },
          `The query hit the ${MAX_QUERY_ROWS}-row limit — aggregating the most recent ${rows.length} of ${fetched.total} records.`,
        );
        rowCapNotice.hidden = false;
      }

      const adapter = buildWordClusterRows(rows);
      if (adapter.summaryExcludedCount > 0 && excludedNotice) {
        excludedNotice.textContent = msg(
          'wordClusterExcludedCount',
          { count: adapter.summaryExcludedCount },
          'Excluded {count} rows without a usable summary (AI failure or fallback text); titles were still used.',
        );
        excludedNotice.hidden = false;
      }

      if (adapter.rows.length === 0) {
        loadingManager.cleanup();
        if (loadingStatus) loadingStatus.hidden = true;
        // Every fetched row was skipped (no usable text) → the no-usable-rows
        // empty state; rows existed but zero keywords survived filtering →
        // the no-keywords empty state (PBI empty-state distinction).
        const noUsableRows = adapter.skippedRows === rows.length;
        setEmptyMessage(
          noUsableRows ? 'wordClusterEmpty' : 'wordClusterEmptyNoKeywords',
          noUsableRows
            ? 'No records with usable text in the selected period. Try a wider range.'
            : 'Records were found, but no keywords remained after filtering.',
        );
        if (emptyState) emptyState.hidden = false;
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
        if (loadingStatus) loadingStatus.hidden = true;
        setEmptyMessage(
          'wordClusterEmptyNoKeywords',
          'Records were found, but no keywords remained after filtering.',
        );
        if (emptyState) emptyState.hidden = false;
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
      if (loadingStatus) loadingStatus.hidden = true;

      panZoomController = new TagClusterPanZoomController(svg, canvasSize, {
        zoomInBtn: document.getElementById('wordClusterZoomIn'),
        zoomOutBtn: document.getElementById('wordClusterZoomOut'),
        resetBtn: document.getElementById('wordClusterZoomReset'),
      });
      panZoomController.attach();
    } catch (error) {
      loadingManager.cleanup();
      if (loadingStatus) loadingStatus.hidden = true;
      console.error('[wordClusterPanel] error:', error);
      if (seq !== loadSeq) return;
      setEmptyMessage('wordClusterError', 'Failed to load the word cluster. Try again.');
      if (emptyState) emptyState.hidden = false;
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
      emptyState = container.querySelector('#wordClusterEmptyState');
      truncatedNotice = container.querySelector('#wordClusterTruncatedNotice');
      rowCapNotice = container.querySelector('#wordClusterRowCapNotice');
      excludedNotice = container.querySelector('#wordClusterExcludedNotice');
      loadingStatus = container.querySelector('#wordClusterLoadingStatus');
      filterHost = container.querySelector('#wordClusterFilter');
      runButton = container.querySelector('#wordClusterRunBtn');

      if (filterHost) {
        filterHandle = createPeriodFilter({
          initialPreset: 'all',
          onChange: (range) => {
            // WHY: explicit apply (domain-analysis precedent) — keyword
            // extraction reruns client-side over the whole fetch, so a full
            // reload per preset click is disproportionate; the Run button
            // applies the range.
            currentRange = range;
          },
        });
        filterHost.appendChild(filterHandle.element);
        currentRange = filterHandle.getRange();
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
      emptyState = null;
      truncatedNotice = null;
      rowCapNotice = null;
      excludedNotice = null;
      loadingStatus = null;
      svg = null;
    },
  };
}

async function loadRowsWithRetry(bounds: PeriodRange): Promise<{ rows: BrowsingLogEntry[]; total: number }> {
  const result = await retryWithExponentialBackoff<{ rows: BrowsingLogEntry[]; total: number }>(
    async () => {
      const status = await getSqliteStatus();
      if (!status?.initialized) {
        return null;
      }
      // WHY: exactOptionalPropertyTypes forbids explicit undefined — unset
      // bounds pass no since/until key (tagClusterPanel convention), so the
      // all-time query stays byte-identical to the pre-filter { limit } call.
      const qRes = await queryLogs({
        ...(bounds.since !== undefined ? { since: bounds.since } : {}),
        ...(bounds.until !== undefined ? { until: bounds.until } : {}),
        limit: MAX_QUERY_ROWS,
      });
      // Return null (not []) on failure: retryWithExponentialBackoff only
      // retries when the thunk yields null or throws, so coercing an error to
      // an empty array would surface a silent "no data" render.
      if (isServiceError(qRes)) {
        return null;
      }
      return qRes.data;
    },
    { label: 'wordCluster', maxAttempts: 4 }
  );
  if (result === null) {
    throw new Error('wordCluster: query failed after retries');
  }
  return result;
}
