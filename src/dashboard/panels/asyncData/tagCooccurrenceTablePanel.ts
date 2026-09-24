/**
 * tagCooccurrenceTablePanel.ts (PanelLifecycle)
 * Ranked table of the top tag co-occurrence pairs (PBI 2026-09-24-06) —
 * the numeric-table counterpart of the tag-cluster graph, reusing its exact
 * pipeline: queryLogs({since, until, limit: 10000}) →
 * narrowEntriesToTopTagsHybrid(rows, MAX_TAG_CLUSTER_TAGS) →
 * computeTagCooccurrenceHybrid. The edges are the pairs; no graph layout.
 *
 * Fetch strategy follows the domain-analysis panel (explicit-apply): the
 * panel passes no onChange handler and the Run button applies the filter
 * selection read via getRange() ('all' default = no bounds) as the single
 * capped query (PBI 2026-09-24-11 contract). The tag select, in contrast,
 * is fed by the fetched node list and only re-ranks the cached graph —
 * re-ranking is an O(E) filter pass, far cheaper than a refetch, and partner
 * counts must come from the unfiltered graph anyway (個別出現数 = the tag's
 * total record count, not its co-occurrence with the selected tag).
 *
 * Row click navigates to the history panel by the pair's FIRST tag only —
 * the AND-filtered navigation is explicitly out of scope for v1.
 */

import {
  computeTagCooccurrenceHybrid,
  narrowEntriesToTopTagsHybrid,
} from '../../tagCooccurrenceHybrid.js';
import {
  buildCooccurrencePairRows,
  COOCCURRENCE_TABLE_TOP_N,
  type CooccurrenceGraph,
} from '../../tagCooccurrenceTable.js';
import { MAX_TAG_CLUSTER_TAGS } from '../../../utils/computeLimits.js';
import { parseTagsForDisplay } from '../../../utils/tagUtils.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { getMessage, getMessageOr } from '../../../utils/i18n.js';
import {
  createPeriodFilter,
  type PeriodFilterHandle,
} from '../../components/periodFilter.js';
import { type PanelLifecycle } from '../types.js';
import { tryNavigateTyped } from '../registryContext.js';

const MAX_QUERY_ROWS = 10000;

/** getMessage with {name} substitutions and an English fallback template. */
function msg(key: string, subs: Record<string, string | number>, fallback: string): string {
  const translated = getMessage(key, subs);
  if (translated) return translated;
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) =>
    subs[name] !== undefined ? String(subs[name]) : `{${name}}`,
  );
}

function navigateToHistoryWithTag(tag: string): void {
  const fallback = (): void => {
    document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: tag }));
  };
  tryNavigateTyped('panel-sqlite-history', { searchTag: tag }, fallback);
}

function countUniqueTags(rows: Array<{ tags?: string | null }>): number {
  const tags = new Set<string>();
  for (const row of rows) {
    for (const tag of parseTagsForDisplay(row.tags)) {
      tags.add(tag);
    }
  }
  return tags.size;
}

export function createTagCooccurrenceTablePanel(): PanelLifecycle {
  let filterHost: HTMLElement | null = null;
  let tagSelect: HTMLSelectElement | null = null;
  let runButton: HTMLButtonElement | null = null;
  let emptyState: HTMLElement | null = null;
  let tagsTruncatedNotice: HTMLElement | null = null;
  let topTruncatedNotice: HTMLElement | null = null;
  let tableWrap: HTMLElement | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  let cachedGraph: CooccurrenceGraph | null = null;
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
    if (tagsTruncatedNotice) tagsTruncatedNotice.hidden = true;
    if (topTruncatedNotice) topTruncatedNotice.hidden = true;
  }

  function clearOutput(): void {
    if (tableWrap) tableWrap.innerHTML = '';
  }

  /** Rebuilds the select from the fetched node list, preserving the selection when possible. */
  function populateTagSelect(graph: CooccurrenceGraph): void {
    if (!tagSelect) return;
    const previous = tagSelect.value;
    tagSelect.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = getMessageOr('cooccurrenceTableTagFilterAll', 'All tags');
    tagSelect.appendChild(allOption);
    const tags = graph.nodes.map((node) => node.tag).sort();
    for (const tag of tags) {
      const option = document.createElement('option');
      option.value = tag;
      option.textContent = `#${tag}`;
      tagSelect.appendChild(option);
    }
    // WHY: the tag universe changes on every fetch; a stale selection must
    // not silently rank nothing, so it resets to "all" instead.
    tagSelect.value = tags.includes(previous) ? previous : '';
  }

  function renderTable(graph: CooccurrenceGraph, selectedTag: string): void {
    if (!tableWrap) return;
    clearOutput();

    const ranking = buildCooccurrencePairRows(graph, {
      // WHY: exactOptionalPropertyTypes forbids an explicit undefined — an
      // empty selection passes no tag key (unfiltered ranking).
      ...(selectedTag ? { tag: selectedTag } : {}),
    });

    if (ranking.totalPairs === 0) {
      if (selectedTag) {
        setEmptyMessage(
          'cooccurrenceTableEmptyForTag',
          'No other tag co-occurs with the selected tag in this data.',
        );
      } else {
        setEmptyMessage(
          'cooccurrenceTableEmpty',
          'No co-occurring tag pairs — every record has a single tag.',
        );
      }
      if (emptyState) emptyState.hidden = false;
      return;
    }

    const table = document.createElement('table');
    table.className = 'tag-timeline-numeric';
    const caption = document.createElement('caption');
    caption.textContent = getMessageOr(
      'cooccurrenceTableCaption',
      'Top co-occurring tag pairs',
    );
    table.appendChild(caption);

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const headers: Array<[string, string]> = [
      ['cooccurrenceTableColPair', 'Pair'],
      ['cooccurrenceTableColCooccurCount', 'Co-occurrence'],
      ['cooccurrenceTableColCountA', '#A count'],
      ['cooccurrenceTableColCountB', '#B count'],
    ];
    for (const [key, fallback] of headers) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = getMessageOr(key, fallback);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of ranking.rows) {
      const tr = document.createElement('tr');
      // WHY: focusable rows + Enter/Space are the PBI's sanctioned keyboard
      // path for row click-through (a row is not a button, so no role=button).
      tr.tabIndex = 0;
      tr.addEventListener('click', () => navigateToHistoryWithTag(row.tagA));
      tr.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigateToHistoryWithTag(row.tagA);
        }
      });

      const pairCell = document.createElement('th');
      pairCell.scope = 'row';
      pairCell.textContent = row.label;
      tr.appendChild(pairCell);

      const weightCell = document.createElement('td');
      weightCell.textContent = String(row.weight);
      tr.appendChild(weightCell);

      const countACell = document.createElement('td');
      countACell.textContent = String(row.countA);
      tr.appendChild(countACell);

      const countBCell = document.createElement('td');
      countBCell.textContent = String(row.countB);
      tr.appendChild(countBCell);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    if (ranking.truncated && topTruncatedNotice) {
      topTruncatedNotice.textContent = msg(
        'cooccurrenceTableTruncatedTop20',
        { total: ranking.totalPairs, max: COOCCURRENCE_TABLE_TOP_N },
        'Showing the top 20 of {total} co-occurring pairs.',
      );
      topTruncatedNotice.hidden = false;
    }
  }

  /**
   * Re-renders from the cached graph (tag-select switch). The pre-narrowing
   * notice is fetch-scoped and survives re-ranking; only the empty state and
   * the top-20 notice belong to the render pass.
   */
  function renderFromCache(): void {
    if (!cachedGraph) return;
    if (emptyState) emptyState.hidden = true;
    if (topTruncatedNotice) topTruncatedNotice.hidden = true;
    renderTable(cachedGraph, tagSelect?.value ?? '');
  }

  async function reload(): Promise<void> {
    if (!tableWrap) return;
    const seq = ++loadSeq;

    clearOutput();
    hideNotices();

    try {
      // WHY: getRange() is the single source of truth (PBI 2026-09-24-11);
      // the snapshot lets retries reuse one consistent window even if the
      // user changes the filter mid-flight (stale loads bail via seq). No
      // filter host → unbounded ('all'): the tag-cluster panel default,
      // matching the pre-filter query shape ({ limit: 10000 }).
      const bounds = filterHandle ? filterHandle.getRange() : {};
      const fetched = await fetchPeriodRows({
        since: bounds.since,
        until: bounds.until,
        limit: MAX_QUERY_ROWS,
        label: 'tagCooccurrenceTable',
      });
      const rows = fetched.rows;
      if (seq !== loadSeq) return;

      if (rows.length === 0) {
        cachedGraph = null;
        setEmptyMessage(
          'cooccurrenceTableNoRecords',
          'No records in the selected period. Try a wider range.',
        );
        if (emptyState) emptyState.hidden = false;
        return;
      }

      const beforeTagCount = countUniqueTags(rows);
      const narrowedRows = await narrowEntriesToTopTagsHybrid(rows, MAX_TAG_CLUSTER_TAGS);
      const graph = await computeTagCooccurrenceHybrid(narrowedRows);
      if (seq !== loadSeq) return;
      cachedGraph = graph;

      populateTagSelect(graph);

      // WHY: narrowing dropped tags only when the ORIGINAL tag universe
      // exceeded the cap — a naturally small graph must not warn.
      if (beforeTagCount > MAX_TAG_CLUSTER_TAGS && tagsTruncatedNotice) {
        tagsTruncatedNotice.textContent = msg(
          'cooccurrenceTableTruncatedTags',
          { max: MAX_TAG_CLUSTER_TAGS },
          'More than {max} unique tags — ranking covers the top {max} tags only.',
        );
        tagsTruncatedNotice.hidden = false;
      }

      renderFromCache();
    } catch (error) {
      console.error('[tagCooccurrenceTablePanel] error:', error);
      if (seq !== loadSeq) return;
      cachedGraph = null;
      clearOutput();
      setEmptyMessage(
        'cooccurrenceTableNoRecords',
        'No records in the selected period. Try a wider range.',
      );
      if (emptyState) emptyState.hidden = false;
    }
  }

  return {
    id: 'panel-tag-cooccurrence-table',
    category: 'async-data',
    mount(container) {
      filterHost = container.querySelector('#coocTableFilter');
      tagSelect = container.querySelector('#coocTableTagSelect');
      runButton = container.querySelector('#coocTableRunBtn');
      emptyState = container.querySelector('#coocTableEmptyState');
      tagsTruncatedNotice = container.querySelector('#coocTableTagsTruncated');
      topTruncatedNotice = container.querySelector('#coocTableTop20Truncated');
      tableWrap = container.querySelector('#coocTableTableWrap');

      if (filterHost) {
        // WHY: no onChange handler — explicit-apply host (domain-analysis
        // precedent): Run reads getRange() instead of recording every
        // change (PBI 2026-09-24-11 contract).
        filterHandle = createPeriodFilter({ initialPreset: 'all' });
        filterHost.appendChild(filterHandle.element);
      }

      tagSelect?.addEventListener('change', () => {
        renderFromCache();
      });
      runButton?.addEventListener('click', () => {
        void reload();
      });
    },
    async load() {
      await reload();
    },
    destroy() {
      loadSeq += 1;
      cachedGraph = null;
      filterHandle?.destroy();
      filterHandle = null;
      filterHost = null;
      tagSelect = null;
      runButton = null;
      emptyState = null;
      tagsTruncatedNotice = null;
      topTruncatedNotice = null;
      tableWrap = null;
    },
  };
}
