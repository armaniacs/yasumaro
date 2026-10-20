/**
 * researchSessionsPanel.ts (PanelLifecycle)
 * "Research Sessions" (PBI 2026-09-26-02): records recorded close together in
 * time grouped into one `<details>` block, newest first.
 *
 * Two independent re-render paths, on purpose:
 * - changing the PERIOD refetches (a different window is a different question)
 * - changing the GAP re-groups the rows already in hand (a different cut of the
 *   same answer), so it never touches the database
 *
 * WHY the session duration is labelled as first-to-last rather than reading
 * time: the schema records when a page was saved, not how long it was open, so
 * the honest number is the span between the first and last record and the panel
 * description says so.
 *
 * MV3 CSP: values go in through textContent / setAttribute. `innerHTML` is
 * only ever used to clear the list before a re-render.
 */

import { createAsyncDataPanelLifecycle } from './asyncDataPanelLifecycle.js';
import { showRowCapNotice } from '../rowCapNotice.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { PanelNotices } from '../PanelNotices.js';
import { getMessageWithSubstitutions as msg } from '../../../utils/i18n.js';
import { isSecureUrl } from '../../../utils/urlUtils.js';
import { clearElement } from '../../../utils/domClear.js';
import { MAX_RESEARCH_SESSION_ROWS } from '../../../utils/computeLimits.js';
import {
  groupResearchSessions,
  sessionDurationMinutes,
  DEFAULT_SESSION_GAP_MIN,
  MAX_DISPLAY_SESSIONS,
  SESSION_GAP_OPTIONS_MIN,
  type ResearchSession,
  type SessionInput,
} from '../../researchSessionAggregate.js';
import { getNavTrailConsent, isNavTrailActive } from '../../../utils/storage/navTrailConsent.js';
import {
  buildSessionTree,
  computeSearchToGoal,
  hasNavTrail,
  UNTAGGED_KEY,
  type SessionTreeNode,
} from '../../sessionPathAggregate.js';
import { type PanelLifecycle } from '../types.js';
import { logError } from '../../../utils/logger/api.js';
import { ErrorCode } from '../../../utils/logger/types.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { deleteLog, isServiceError } from '../../dashboardSqliteService.js';
import { removeSavedUrl } from '../../../utils/storageUrls.js';
import {
  expandSelectedIds,
  summarizeSelection,
  type SessionSelection,
} from '../../researchSessionSelection.js';

/** Toggle hooks for the selection checkboxes (PBI-02). Task 3 wires the
 *  panel-local selection state below. */
export interface SelectionToggleHooks {
  toggleSession: (index: number, checked: boolean) => void;
  togglePage: (recordId: number, checked: boolean) => void;
  toggleSubtree: (recordId: number, checked: boolean) => void;
}

/** Fill a caller-owned <li> with one record line. */
function populateRecord(
  li: HTMLLIElement,
  record: SessionInput,
  options: { readonly showSearch: boolean },
  hooks: Pick<SelectionToggleHooks, 'togglePage'>,
): void {
  const pageCheck = document.createElement('input');
  pageCheck.type = 'checkbox';
  pageCheck.className = 'rsess-select-page';
  pageCheck.dataset.recordId = String(record.id);
  pageCheck.setAttribute('aria-label', `select page ${record.title || record.url}`);
  pageCheck.addEventListener('change', () => hooks.togglePage(record.id, pageCheck.checked));
  li.prepend(pageCheck);

  const time = document.createElement('time');
  time.textContent = new Date(record.created_at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  li.appendChild(time);

  const label = record.title || record.url;
  if (isSecureUrl(record.url)) {
    const anchor = document.createElement('a');
    anchor.href = record.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = label;
    li.appendChild(anchor);
  } else {
    const span = document.createElement('span');
    span.textContent = label;
    li.appendChild(span);
  }

  const domain = document.createElement('span');
  domain.className = 'research-sessions-domain';
  domain.textContent = record.domain ?? '';
  li.appendChild(domain);

  // PBI 03: the opt-in navigation trail. Only present when the user enabled
  // it, so these two are additive and absent for everyone else.
  if (record.search_query && options.showSearch) {
    const query = document.createElement('span');
    query.className = 'research-sessions-query';
    query.textContent = msg('researchSessions_searchQuery', { q: record.search_query }, 'Search: {q}');
    li.appendChild(query);
  }
  if (record.nav_source_url) {
    // A referrer the UI cannot parse is skipped rather than shown raw — the
    // column is data, and a bare string could read as a path.
    let host: string | null = null;
    try {
      host = new URL(record.nav_source_url).hostname;
    } catch {
      host = null;
    }
    if (host !== null) {
      const source = document.createElement('span');
      source.className = 'research-sessions-source';
      source.textContent = msg('researchSessions_source', { host }, 'From: {host}');
      li.appendChild(source);
    }
  }

  if (record.is_starred === 1) {
    const starred = document.createElement('span');
    starred.className = 'research-sessions-starred';
    starred.textContent = msg('researchSessions_starred', {}, 'Starred');
    li.appendChild(starred);
  }
}

function renderTree(nodes: SessionTreeNode[], hooks: SelectionToggleHooks): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'research-sessions-tree';
  for (const node of nodes) {
    const li = document.createElement('li');
    // PBI 04: the leading record's search term is shown once, above the tree,
    // so it is suppressed here to avoid printing it twice.
    populateRecord(li, node.record, { showSearch: node !== nodes[0] }, hooks);
    if (node.children.length > 0) {
      const subtreeCheck = document.createElement('input');
      subtreeCheck.type = 'checkbox';
      subtreeCheck.className = 'rsess-select-subtree';
      subtreeCheck.dataset.recordId = String(node.record.id);
      subtreeCheck.setAttribute('aria-label', 'select pages below this page');
      subtreeCheck.addEventListener('change', () =>
        hooks.toggleSubtree(node.record.id, subtreeCheck.checked),
      );
      li.prepend(subtreeCheck);
      li.appendChild(renderTree(node.children, hooks));
    }
    list.appendChild(li);
  }
  return list;
}

function renderSession(
  session: ResearchSession,
  index: number,
  hooks: SelectionToggleHooks,
): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'research-sessions-item';

  const details = document.createElement('details');
  const summary = document.createElement('summary');

  const parts: string[] = [
    new Date(session.startAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    msg('researchSessions_pages', { n: session.records.length }, '{n} pages'),
    msg(
      'researchSessions_minutes',
      { n: sessionDurationMinutes(session.durationMs) },
      '{n} min',
    ),
  ];
  // Tags name the topic directly; a tagged-off user still gets a domain hint.
  const theme =
    session.topTags.length > 0
      ? session.topTags.map((t) => t.name).join(', ')
      : session.topDomains.map((d) => d.name).join(', ');
  if (theme.length > 0) parts.push(theme);

  summary.textContent = parts.join(' · ');
  const sessionCheck = document.createElement('input');
  sessionCheck.type = 'checkbox';
  sessionCheck.className = 'rsess-select-session';
  sessionCheck.setAttribute('aria-label', `select session ${index + 1}`);
  sessionCheck.addEventListener('change', () => hooks.toggleSession(index, sessionCheck.checked));
  // The checkbox lives inside <summary>: without this its click bubbles to
  // the disclosure and toggles the <details> open/closed. No preventDefault —
  // that would cancel the checkbox's own default check action.
  sessionCheck.addEventListener('click', (event) => event.stopPropagation());
  summary.prepend(sessionCheck);
  details.appendChild(summary);

  if (hasNavTrail(session)) {
    // PBI 04: a session with a referrer renders as the path that was taken,
    // so a revisit hangs under the page it actually came from.
    const rootQuery = session.records[0]?.search_query;
    if (rootQuery) {
      const query = document.createElement('p');
      query.className = 'research-sessions-query-root';
      query.textContent = msg('researchSessions_searchQuery', { q: rootQuery }, 'Search: {q}');
      details.appendChild(query);
    }
    details.appendChild(renderTree(buildSessionTree(session), hooks));
  } else {
    const records = document.createElement('ol');
    records.className = 'research-sessions-records';
    for (const record of session.records) {
      const li = document.createElement('li');
      populateRecord(li, record, { showSearch: true }, hooks);
      records.appendChild(li);
    }
    details.appendChild(records);
  }

  item.appendChild(details);
  return item;
}

export function createResearchSessionsPanel(): PanelLifecycle {
  let gapSelect: HTMLSelectElement | null = null;
  let emptyEl: HTMLElement | null = null;
  let rowCapEl: HTMLElement | null = null;
  let summaryEl: HTMLElement | null = null;
  let truncatedEl: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let lastRows: SessionInput[] | null = null;
  let gapMinutes: number = DEFAULT_SESSION_GAP_MIN;
  const notices = new PanelNotices();
  let searchToGoalBody: HTMLElement | null = null;
  let searchToGoalTable: HTMLElement | null = null;
  let searchToGoalOff: HTMLElement | null = null;
  // PBI 04: the trail is opt-in, so the path tree and the metric table are
  // only meaningful — and only rendered — when consent is on.
  let navTrailActive = false;

  // --- Bulk delete selection (PBI-02 Task 3) -------------------------------
  // Panel-local state (NOT model state): the selected record ids live here,
  // next to lastRows, and are dropped on every re-render so a gap change or
  // refetch never keeps a stale selection.
  let selectedIds = new Set<number>();
  let lastSessions: ResearchSession[] = [];
  let bulkBar: HTMLElement | null = null;
  let selectionCountEl: HTMLElement | null = null;
  let deleteBtn: HTMLButtonElement | null = null;
  let deleteConfirm: HTMLElement | null = null;
  let confirmText: HTMLElement | null = null;
  let deleteConfirmYes: HTMLButtonElement | null = null;
  let deleteConfirmNo: HTMLButtonElement | null = null;

  function toSelection(ids: Set<number>): SessionSelection[] {
    return [...ids].map((recordId) => ({ kind: 'page', recordId }) as SessionSelection);
  }

  /** Drops the selection and repaints the bar (count 0, delete disabled,
   *  inline confirm closed). Called on every re-render AND on the load()
   *  paths that never reach render() (empty window, load failure), so a
   *  period change can never leave a live selection pointing at rows that
   *  are no longer on screen. */
  function resetSelection(): void {
    selectedIds = new Set<number>();
    refreshBulkBar();
  }

  /** Full inline-confirm detail: pages, date range, representative domains,
   *  and the regroup notice (i18n key researchSessions_deleteDetail). */
  function currentDeleteDetail(): string {
    const summary = summarizeSelection(lastSessions, toSelection(selectedIds));
    const domainCounts = new Map<string, number>();
    for (const row of lastRows ?? []) {
      if (!selectedIds.has(row.id) || !row.domain) continue;
      domainCounts.set(row.domain, (domainCounts.get(row.domain) ?? 0) + 1);
    }
    const domains = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([domain]) => domain)
      .join(', ');
    const range =
      summary.earliest !== null && summary.latest !== null
        ? `${new Date(summary.earliest).toLocaleString()} – ${new Date(summary.latest).toLocaleString()}`
        : '';
    return msg(
      'researchSessions_deleteDetail',
      { n: summary.pages, range, domains },
      `Delete ${summary.pages} pages (${range}) from ${domains}? The remaining pages will be regrouped.`,
    );
  }

  function refreshBulkBar(): void {
    if (!bulkBar || !selectionCountEl || !deleteBtn) return;
    bulkBar.hidden = false;
    // The count span doubles as the delete-error surface (registered as
    // 'deleteError' in mount): unhiding here clears a stale error/SR text on
    // every selection change or re-render.
    selectionCountEl.hidden = false;
    selectionCountEl.textContent = msg(
      'researchSessions_selectionCount',
      { n: selectedIds.size },
      `${selectedIds.size} selected`,
    );
    deleteBtn.disabled = selectedIds.size === 0;
    if (deleteConfirm) deleteConfirm.hidden = true;
  }

  function setRecordSelected(recordId: number, selected: boolean): void {
    if (selected) selectedIds.add(recordId);
    else selectedIds.delete(recordId);
  }

  const selectionHooks: SelectionToggleHooks = {
    toggleSession: (index, checked) => {
      const session = lastSessions[index];
      if (!session) return;
      for (const record of session.records) setRecordSelected(record.id, checked);
      refreshBulkBar();
    },
    togglePage: (recordId, checked) => {
      setRecordSelected(recordId, checked);
      refreshBulkBar();
    },
    toggleSubtree: (recordId, checked) => {
      // Rebuild the current trees (pure, cheap) and expand through the
      // shared selector so a subtree check selects the whole branch below it.
      const trees = lastSessions.map((session) => buildSessionTree(session));
      const ids = expandSelectedIds(lastSessions, [{ kind: 'subtree', recordId }], trees);
      for (const id of ids) setRecordSelected(id, checked);
      refreshBulkBar();
    },
  };

  // Step 1 (history-pattern 2-step): reveal the inline confirm with the
  // selection detail. Controller ruling: inline ONLY, no modal — a modal on
  // top would make it 3 steps.
  function handleDeleteSelected(): void {
    if (selectedIds.size === 0) return;
    if (confirmText) confirmText.textContent = currentDeleteDetail();
    if (deleteConfirm) deleteConfirm.hidden = false;
  }

  // Step 2: execute through the existing delete path only (deleteLog +
  // removeSavedUrl, same as sqliteHistoryModel). First-failure-stops like
  // history, then refetch so the remaining pages regroup.
  async function handleDeleteSelectedConfirm(): Promise<void> {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (deleteConfirm) deleteConfirm.hidden = true;
    let deletedCount = 0;
    let error: string | null = null;
    const urlById = new Map<number, string>();
    for (const row of lastRows ?? []) {
      if (selectedIds.has(row.id) && row.url) urlById.set(row.id, row.url);
    }
    for (const id of ids) {
      const result = await deleteLog(id);
      if (isServiceError(result)) {
        error = result.error;
        break; // 先行失敗で停止（履歴と同一政策）
      }
      const url = urlById.get(id);
      if (url) {
        try { await removeSavedUrl(url); } catch { /* best-effort（履歴と同一） */ }
      }
      deletedCount += 1;
    }
    selectedIds = new Set<number>();
    await lifecycle.reload(); // 対象期間を再fetch→再グループ化
    if (error !== null) {
      notices.setMessage(
        'deleteError',
        msg(
          'researchSessions_deleteError',
          { n: deletedCount },
          `Deleted ${deletedCount} pages. Failed partway.`,
        ),
      );
      notices.show('deleteError');
    }
  }

  /** Re-groups the cached rows. Never refetches — the gap is a different cut
   *  of the same records, not a different question. */
  function render(): void {
    // Gap change / refetch staleness: never keep a selection across a re-cut
    // of the rows. The bar refresh runs after the notice reset below so a
    // stale delete-error (shown on the count span) does not survive either.
    selectedIds = new Set<number>();
    if (!lastRows || !listEl || !summaryEl) return;
    // Re-aggregation reset: the row cap describes the FETCH, so it survives.
    notices.resetForReaggregate();
    resetSelection();

    const agg = groupResearchSessions(lastRows, gapMinutes);
    lastSessions = [...agg.sessions];

    summaryEl.textContent = msg(
      'researchSessions_summary',
      { sessions: agg.totalSessions, singles: agg.singleCount },
      '{sessions} sessions · {singles} single pages',
    );

    if (agg.truncated) {
      notices.setMessage(
        'truncated',
        msg(
          'researchSessions_truncated',
          { shown: MAX_DISPLAY_SESSIONS },
          'Showing the newest {shown} sessions.',
        ),
      );
      notices.show('truncated');
    }

    clearElement(listEl);
    const target = listEl;
    agg.sessions.forEach((session, index) => {
      target.appendChild(renderSession(session, index, selectionHooks));
    });

    renderSearchToGoal(agg.sessions);
  }

  /**
   * The search→resolution table. Fed the already-truncated session list, so it
   * covers the same window the truncation notice describes.
   */
  function renderSearchToGoal(sessions: readonly ResearchSession[]): void {
    if (!searchToGoalBody || !searchToGoalTable || !searchToGoalOff) return;
    clearElement(searchToGoalBody);

    if (!navTrailActive) {
      searchToGoalTable.hidden = true;
      searchToGoalOff.hidden = false;
      return;
    }
    searchToGoalOff.hidden = true;
    searchToGoalTable.hidden = false;

    const rows = computeSearchToGoal(sessions);
    if (rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = msg('researchSessions_searchToGoalEmpty', {}, 'No search-started sessions yet.');
      tr.appendChild(td);
      searchToGoalBody.appendChild(tr);
      return;
    }

    for (const row of rows) {
      const tr = document.createElement('tr');

      const tagCell = document.createElement('th');
      tagCell.scope = 'row';
      // An untagged resolution page still deserves a row, just not an empty
      // first cell.
      tagCell.textContent =
        row.tag === UNTAGGED_KEY
          ? msg('researchSessions_untagged', {}, '(untagged)')
          : row.tag;
      tr.appendChild(tagCell);

      for (const value of [String(row.sessions), row.avgPages.toFixed(1), String(row.avgMinutes)]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      searchToGoalBody.appendChild(tr);
    }
  }

  const lifecycle = createAsyncDataPanelLifecycle({
    label: 'researchSessionsPanel',
    notices: [notices],
    filterHostSelector: '#researchSessionsFilter',
    initialPreset: 'last7',
    // WHY: auto-apply here (unlike the explicit-apply domain-analysis panel)
    // — a period change is a cheap single-page fetch, so an explicit Run
    // button would only add a step.
    autoApply: true,
    isReady: () => listEl !== null,
    resetOutput: () => {
      if (listEl) clearElement(listEl);
    },
    // WHY: isReady() already gated this load; the check narrows the captured
    // host for the body.
    load: async ({ range, isStale }) => {
      if (!listEl) return;

      try {
        // PBI 04: read the opt-in alongside the rows so the panel can choose a
        // renderer. A consent read failure must not fail the panel load.
        const [res] = await Promise.all([
          fetchPeriodRows({
            ...range,
            limit: MAX_RESEARCH_SESSION_ROWS,
            label: 'researchSessions',
          }),
          getNavTrailConsent().then(
            (consent) => { navTrailActive = isNavTrailActive(consent); },
            () => { navTrailActive = false; },
          ),
        ]);
        if (isStale()) return;
        lastRows = res.rows;

        if (res.capped) {
          showRowCapNotice({
            notices,
            messageKey: 'researchSessions_rowCap',
            fallback: 'Grouped only the newest {shown} records. Shorten the period to include all records.',
            shown: res.rows.length,
            total: res.total,
            limit: MAX_RESEARCH_SESSION_ROWS,
          });
        }

        if (res.rows.length === 0) {
          clearElement(listEl);
          lastSessions = [];
          resetSelection();
          notices.showEmpty();
          return;
        }
        render();
      } catch (error) {
        // 構造化ログ移行 (ログ指摘 2026-10-15): console.error → 標準の logError セアム
        void logError('[researchSessionsPanel] load failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'researchSessionsPanel');
        if (isStale()) return;
        lastRows = null;
        lastSessions = [];
        resetSelection();
        notices.showError('researchSessionsError', 'Failed to load sessions.');
      }
    },
  });

  return {
    id: 'panel-research-sessions',
    category: 'async-data',
    mount(container) {
      gapSelect = container.querySelector('#researchSessionsGap');
      emptyEl = container.querySelector('#researchSessionsEmptyState');
      rowCapEl = container.querySelector('#researchSessionsRowCap');
      summaryEl = container.querySelector('#researchSessionsSummary');
      truncatedEl = container.querySelector('#researchSessionsTruncated');
      listEl = container.querySelector('#researchSessionsList');
      searchToGoalTable = container.querySelector('#researchSessionsSearchToGoalTable');
      searchToGoalBody = container.querySelector('#researchSessionsSearchToGoalBody');
      searchToGoalOff = container.querySelector('#researchSessionsSearchToGoalOff');
      bulkBar = container.querySelector('#researchSessionsBulkBar');
      selectionCountEl = container.querySelector('#researchSessionsSelectionCount');
      deleteBtn = container.querySelector('#researchSessionsDeleteSelected');
      deleteConfirm = container.querySelector('#researchSessionsDeleteConfirm');
      confirmText = deleteConfirm?.querySelector('span') ?? null;
      deleteConfirmYes = container.querySelector('#researchSessionsDeleteConfirmYes');
      deleteConfirmNo = container.querySelector('#researchSessionsDeleteConfirmNo');

      notices.register('empty', emptyEl, {
        i18nKey: 'researchSessions_empty',
        fallbackText: 'No records in this period.',
      });
      notices.register('rowCap', rowCapEl, { fetchScoped: true });
      notices.register('truncated', truncatedEl, { fetchScoped: true });
      // The count span doubles as the partial-delete error surface: a
      // dedicated error div is outside the brief's fixed bulk-bar markup.
      notices.register('deleteError', selectionCountEl);

      lifecycle.mount(container);

      deleteBtn?.addEventListener('click', () => handleDeleteSelected());
      deleteConfirmYes?.addEventListener('click', () => void handleDeleteSelectedConfirm());
      deleteConfirmNo?.addEventListener('click', () => {
        if (deleteConfirm) deleteConfirm.hidden = true;
      });

      if (gapSelect) {
        for (const minutes of SESSION_GAP_OPTIONS_MIN) {
          const option = document.createElement('option');
          option.value = String(minutes);
          option.textContent = msg('researchSessions_gapOption', { n: minutes }, '{n} min');
          gapSelect.appendChild(option);
        }
        gapSelect.value = String(DEFAULT_SESSION_GAP_MIN);
        gapSelect.addEventListener('change', () => {
          gapMinutes = Number(gapSelect?.value ?? DEFAULT_SESSION_GAP_MIN);
          // Re-group only: the rows for this period are already in hand.
          render();
        });
      }
    },
    async load() {
      await lifecycle.reload();
    },
    destroy() {
      lifecycle.destroy();
      gapSelect = null;
      emptyEl = null;
      rowCapEl = null;
      summaryEl = null;
      truncatedEl = null;
      listEl = null;
      searchToGoalTable = null;
      searchToGoalBody = null;
      searchToGoalOff = null;
      navTrailActive = false;
      lastRows = null;
      selectedIds = new Set<number>();
      lastSessions = [];
      bulkBar = null;
      selectionCountEl = null;
      deleteBtn = null;
      deleteConfirm = null;
      confirmText = null;
      deleteConfirmYes = null;
      deleteConfirmNo = null;
    },
  };
}
