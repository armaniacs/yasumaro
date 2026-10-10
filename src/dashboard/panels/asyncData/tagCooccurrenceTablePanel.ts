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
import {
  MAX_QUERY_ROWS,
  MAX_TAG_CLUSTER_TAGS,
} from '../../../utils/computeLimits.js';
import { parseTagsForDisplay } from '../../../utils/tagUtils.js';
import { clearElement } from '../../../utils/domClear.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { PanelNotices } from '../PanelNotices.js';
import { getMessageOr, getMessageWithSubstitutions as msg } from '../../../utils/i18n.js';
import { createAsyncDataPanelLifecycle } from './asyncDataPanelLifecycle.js';
import { type PanelLifecycle } from '../types.js';
import { navigateToHistoryWithTag } from '../navigateToHistory.js';

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
  let tagSelect: HTMLSelectElement | null = null;
  let runButton: HTMLButtonElement | null = null;
  let tagsTruncatedNotice: HTMLElement | null = null;
  let topTruncatedNotice: HTMLElement | null = null;
  let tableWrap: HTMLElement | null = null;
  let cachedGraph: CooccurrenceGraph | null = null;
  // WHY: the empty-state element doubles as the error surface (one element,
  // two modes) with per-render empty wordings swapped via setEmptyMessage.
  // The pre-narrowing notice describes the FETCHED tag universe, so it is
  // fetch-scoped: tag-select re-ranking keeps it while it applies.
  const notices = new PanelNotices();

  function clearOutput(): void {
    if (tableWrap) clearElement(tableWrap);
  }

  /** Rebuilds the select from the fetched node list, preserving the selection when possible. */
  function populateTagSelect(graph: CooccurrenceGraph): void {
    if (!tagSelect) return;
    const previous = tagSelect.value;
    clearElement(tagSelect);
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
      notices.setEmptyMessage(
        selectedTag ? 'cooccurrenceTableEmptyForTag' : 'cooccurrenceTableEmpty',
        selectedTag
          ? 'No other tag co-occurs with the selected tag in this data.'
          : 'No co-occurring tag pairs — every record has a single tag.',
      );
      notices.show('empty');
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
      notices.show('topTruncated');
    }
  }

  /**
   * Re-renders from the cached graph (tag-select switch). The pre-narrowing
   * notice is fetch-scoped and survives re-ranking; only the empty state and
   * the top-20 notice belong to the render pass.
   */
  function renderFromCache(): void {
    if (!cachedGraph) return;
    notices.resetForReaggregate();
    renderTable(cachedGraph, tagSelect?.value ?? '');
  }

  const lifecycle = createAsyncDataPanelLifecycle({
    label: 'tagCooccurrenceTablePanel',
    notices: [notices],
    filterHostSelector: '#coocTableFilter',
    // WHY: no auto-apply — explicit-apply host (domain-analysis precedent):
    // Run reads getRange() instead of recording every change
    // (PBI 2026-09-24-11 contract).
    initialPreset: 'all',
    isReady: () => tableWrap !== null,
    resetOutput: clearOutput,
    // WHY: isReady() already gated this load; the check narrows the captured
    // host for the body.
    load: async ({ range, isStale }) => {
      if (!tableWrap) return;

      try {
        const fetched = await fetchPeriodRows({
          since: range.since,
          until: range.until,
          limit: MAX_QUERY_ROWS,
          label: 'tagCooccurrenceTable',
        });
        const rows = fetched.rows;
        if (isStale()) return;

        if (rows.length === 0) {
          cachedGraph = null;
          notices.showEmpty();
          return;
        }

        const beforeTagCount = countUniqueTags(rows);
        const narrowedRows = await narrowEntriesToTopTagsHybrid(rows, MAX_TAG_CLUSTER_TAGS);
        const graph = await computeTagCooccurrenceHybrid(narrowedRows);
        if (isStale()) return;
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
          notices.show('tagsTruncated');
        }

        renderFromCache();
      } catch (error) {
        console.error('[tagCooccurrenceTablePanel] error:', error);
        if (isStale()) return;
        cachedGraph = null;
        clearOutput();
        notices.showError(
          'cooccurrenceTableError',
          'Failed to load the tag co-occurrence pairs. Try again.',
        );
      }
    },
  });

  return {
    id: 'panel-tag-cooccurrence-table',
    category: 'async-data',
    mount(container) {
      tagSelect = container.querySelector('#coocTableTagSelect');
      runButton = container.querySelector('#coocTableRunBtn');
      tagsTruncatedNotice = container.querySelector('#coocTableTagsTruncated');
      topTruncatedNotice = container.querySelector('#coocTableTop20Truncated');
      tableWrap = container.querySelector('#coocTableTableWrap');

      notices.register('empty', container.querySelector('#coocTableEmptyState'), {
        i18nKey: 'cooccurrenceTableNoRecords',
        fallbackText: 'No records in the selected period. Try a wider range.',
      });
      notices.register('tagsTruncated', tagsTruncatedNotice, { fetchScoped: true });
      notices.register('topTruncated', topTruncatedNotice);

      lifecycle.mount(container);

      tagSelect?.addEventListener('change', () => {
        renderFromCache();
      });
      runButton?.addEventListener('click', () => {
        void lifecycle.reload();
      });
    },
    async load() {
      await lifecycle.reload();
    },
    destroy() {
      lifecycle.destroy();
      cachedGraph = null;
      tagSelect = null;
      runButton = null;
      tagsTruncatedNotice = null;
      topTruncatedNotice = null;
      tableWrap = null;
    },
  };
}
