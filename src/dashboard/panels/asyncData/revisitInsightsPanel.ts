/**
 * revisitInsightsPanel.ts (PanelLifecycle)
 * "Revisits & Time Capsule" (PBI 2026-09-26-01): loops, frequently revisited
 * pages, dormant topics, and the same local week one year ago — one panel over
 * a fixed lookback window.
 *
 * WHY: no period filter. Every bucket is defined relative to `now` (a 30-day
 * "recent" edge, a 90-day "past" edge, a 60–120-day dormant window, a
 * 364-day capsule week), so a user-chosen range would make the thresholds
 * mean something different on every load. The panel is a single fixed-window
 * read, not a query the user tunes.
 *
 * The copy-Markdown action exists because the recorder already streams every
 * row into a daily Obsidian note: a topic revisited across weeks ends up
 * scattered across many notes, and one clipboard action is the whole fix. The
 * Markdown is produced by the pure aggregate, so link text and targets are
 * sanitized before they can reach a note.
 *
 * MV3 CSP: every value is written with textContent / setAttribute. `innerHTML`
 * appears only to clear a container before a fresh render.
 */

import {
  MAX_REVISIT_INSIGHTS_ROWS,
  REVISIT_INSIGHTS_PAGE_SIZE,
} from '../../../utils/computeLimits.js';
import { DAY_MS } from '../../components/periodFilter.js';
import { fetchAllPeriodRows } from '../fetchPeriodRows.js';
import { PanelNotices } from '../PanelNotices.js';
import { getMessageWithSubstitutions as msg } from '../../../utils/i18n.js';
import { copyTextToClipboard } from '../../../utils/clipboard.js';
import { COPY_FEEDBACK_RESET_MS } from '../../../utils/copyMarkdownButton.js';
import { isSecureUrl } from '../../../utils/urlUtils.js';
import { tryNavigateTyped } from '../registryContext.js';
import { navigateToHistoryWithTag } from '../navigateToHistory.js';
import {
  aggregateRevisitInsights,
  formatLoopVisitsMarkdown,
  REVISIT_CONFIG,
  type DormantItem,
  type LoopItem,
  type NameCount,
  type RevisitInsights,
  type RevisitRankItem,
  type RevisitVisit,
} from '../../revisitInsightsAggregate.js';
import { type PanelLifecycle } from '../types.js';

const SECTION_EMPTY_COLSPAN = 5;

const KIND_LABEL_KEYS = {
  url: 'revisitInsights_kindUrl',
  domain: 'revisitInsights_kindDomain',
  tag: 'revisitInsights_kindTag',
} as const;

interface CopyButtonState {
  button: HTMLButtonElement;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createRevisitInsightsPanel(): PanelLifecycle {
  let emptyEl: HTMLElement | null = null;
  let rowCapEl: HTMLElement | null = null;
  let loopsBody: HTMLElement | null = null;
  let rankingBody: HTMLElement | null = null;
  let dormantBody: HTMLElement | null = null;
  let capsuleEl: HTMLElement | null = null;
  const copyStates: CopyButtonState[] = [];
  const notices = new PanelNotices();
  let loadSeq = 0;

  function label(key: string, fallback: string): string {
    return msg(key, {}, fallback);
  }

  function sectionEmptyRow(columns: number, scopeHost: HTMLElement): HTMLTableRowElement {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = columns;
    td.textContent = label('revisitInsights_sectionEmpty', 'None');
    tr.appendChild(td);
    scopeHost.appendChild(tr);
    return tr;
  }

  /** A target cell: a real link for http(s), plain text for anything else. */
  function targetCell(text: string, href: string | null): HTMLTableCellElement {
    const cell = document.createElement('th');
    cell.scope = 'row';
    if (href !== null && isSecureUrl(href)) {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = text;
      cell.appendChild(anchor);
    } else {
      cell.textContent = text;
    }
    return cell;
  }

  function historyButton(onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'data-table-link-btn';
    button.textContent = label('revisitInsights_openHistory', 'View in history');
    button.addEventListener('click', onClick);
    return button;
  }

  function copyButton(item: LoopItem): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'data-table-link-btn';
    const idle = label('revisitInsights_copyMarkdown', 'Copy as Markdown');
    button.textContent = idle;
    const state: CopyButtonState = { button, timer: null };
    copyStates.push(state);
    button.addEventListener('click', () => {
      void copyTextToClipboard(formatLoopVisitsMarkdown(item)).then(
        () => {
          button.textContent = label('revisitInsights_copied', 'Copied');
        },
        () => {
          button.textContent = label('revisitInsights_copyFailed', 'Copy failed');
        },
      );
      // WHY: the feedback label is transient, so a later click on the same
      // button must not stack timers — the pending one is cancelled first.
      if (state.timer !== null) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        button.textContent = idle;
        state.timer = null;
      }, COPY_FEEDBACK_RESET_MS);
    });
    return button;
  }

  function renderLoops(loops: LoopItem[]): void {
    if (!loopsBody) return;
    loopsBody.innerHTML = '';
    if (loops.length === 0) {
      sectionEmptyRow(SECTION_EMPTY_COLSPAN, loopsBody);
      return;
    }
    for (const item of loops) {
      const tr = document.createElement('tr');

      const kindCell = document.createElement('td');
      kindCell.textContent = label(KIND_LABEL_KEYS[item.kind], item.kind);
      tr.appendChild(kindCell);

      // A url loop links its own target; domain/tag rows navigate instead.
      tr.appendChild(targetCell(item.key, item.kind === 'url' ? item.key : null));

      const recentCell = document.createElement('td');
      recentCell.textContent = String(item.recentDays);
      tr.appendChild(recentCell);

      const pastCell = document.createElement('td');
      pastCell.textContent = String(item.pastCount);
      tr.appendChild(pastCell);

      const actions = document.createElement('div');
      actions.className = 'revisit-insights-actions';
      actions.appendChild(copyButton(item));
      if (item.kind === 'domain') {
        actions.appendChild(historyButton(() => tryNavigateTyped('panel-sqlite-history', { searchDomain: item.key })));
      } else if (item.kind === 'tag') {
        actions.appendChild(historyButton(() => navigateToHistoryWithTag(item.key)));
      }
      const actionsCell = document.createElement('td');
      actionsCell.appendChild(actions);
      tr.appendChild(actionsCell);

      loopsBody.appendChild(tr);
    }
  }

  function renderRanking(ranking: RevisitRankItem[]): void {
    if (!rankingBody) return;
    rankingBody.innerHTML = '';
    if (ranking.length === 0) {
      sectionEmptyRow(3, rankingBody);
      return;
    }
    for (const item of ranking) {
      const tr = document.createElement('tr');
      tr.appendChild(targetCell(item.title || item.url, item.url));

      const daysCell = document.createElement('td');
      daysCell.textContent = String(item.distinctDays);
      tr.appendChild(daysCell);

      const lastCell = document.createElement('td');
      lastCell.textContent = new Date(item.lastAt).toLocaleDateString();
      tr.appendChild(lastCell);

      rankingBody.appendChild(tr);
    }
  }

  function renderDormant(dormant: DormantItem[]): void {
    if (!dormantBody) return;
    dormantBody.innerHTML = '';
    if (dormant.length === 0) {
      sectionEmptyRow(SECTION_EMPTY_COLSPAN, dormantBody);
      return;
    }
    for (const item of dormant) {
      const tr = document.createElement('tr');

      const kindCell = document.createElement('td');
      kindCell.textContent = label(KIND_LABEL_KEYS[item.kind], item.kind);
      tr.appendChild(kindCell);

      tr.appendChild(targetCell(item.key, null));

      const countCell = document.createElement('td');
      countCell.textContent = String(item.windowCount);
      tr.appendChild(countCell);

      const lastCell = document.createElement('td');
      lastCell.textContent = new Date(item.lastAt).toLocaleDateString();
      tr.appendChild(lastCell);

      const actionsCell = document.createElement('td');
      if (item.kind === 'domain') {
        actionsCell.appendChild(
          historyButton(() => tryNavigateTyped('panel-sqlite-history', { searchDomain: item.key })),
        );
      } else {
        actionsCell.appendChild(historyButton(() => navigateToHistoryWithTag(item.key)));
      }
      tr.appendChild(actionsCell);

      dormantBody.appendChild(tr);
    }
  }

  function nameCountTable(captionKey: string, items: NameCount[]): HTMLTableElement {
    const table = document.createElement('table');
    table.className = 'data-table';
    const caption = document.createElement('caption');
    caption.textContent = label(captionKey, '');
    table.appendChild(caption);
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const text of [label('revisitInsights_targetColumn', 'Target'), label('revisitInsights_countColumn', 'Count')]) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = text;
      headRow.appendChild(th);
    }
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement('tbody');
    for (const item of items) {
      const tr = document.createElement('tr');
      const nameCell = document.createElement('th');
      nameCell.scope = 'row';
      nameCell.textContent = item.name;
      tr.appendChild(nameCell);
      const countCell = document.createElement('td');
      countCell.textContent = String(item.count);
      tr.appendChild(countCell);
      body.appendChild(tr);
    }
    table.appendChild(body);
    return table;
  }

  function renderVisits(visits: RevisitVisit[]): HTMLUListElement {
    const list = document.createElement('ul');
    for (const visit of visits) {
      const li = document.createElement('li');
      const date = new Date(visit.created_at).toLocaleDateString();
      if (isSecureUrl(visit.url)) {
        const anchor = document.createElement('a');
        anchor.href = visit.url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = `${date} ${visit.title || visit.url}`;
        li.appendChild(anchor);
      } else {
        li.textContent = `${date} ${visit.title || visit.url}`;
      }
      list.appendChild(li);
    }
    return list;
  }

  function renderCapsule(insights: RevisitInsights): void {
    if (!capsuleEl) return;
    capsuleEl.innerHTML = '';
    const { capsule } = insights;
    const isEmpty =
      capsule.topTags.length === 0 && capsule.topDomains.length === 0 && capsule.visits.length === 0;

    const range = document.createElement('p');
    range.textContent = msg(
      'revisitInsights_capsuleRange',
      {
        start: new Date(capsule.rangeStart).toLocaleDateString(),
        // The end is exclusive, so the last day of the week is end - 1ms.
        end: new Date(capsule.rangeEnd - 1).toLocaleDateString(),
      },
      '{start} – {end}',
    );
    capsuleEl.appendChild(range);

    if (isEmpty) {
      const p = document.createElement('p');
      p.textContent = label('revisitInsights_sectionEmpty', 'None');
      capsuleEl.appendChild(p);
      return;
    }
    if (capsule.topTags.length > 0) {
      capsuleEl.appendChild(nameCountTable('revisitInsights_targetColumn', capsule.topTags));
    }
    if (capsule.topDomains.length > 0) {
      capsuleEl.appendChild(nameCountTable('revisitInsights_targetColumn', capsule.topDomains));
    }
    if (capsule.visits.length > 0) {
      capsuleEl.appendChild(renderVisits(capsule.visits));
    }
  }

  async function reload(): Promise<void> {
    if (!loopsBody || !rankingBody || !dormantBody || !capsuleEl) return;
    const seq = ++loadSeq;
    const now = Date.now();

    loopsBody.innerHTML = '';
    rankingBody.innerHTML = '';
    dormantBody.innerHTML = '';
    capsuleEl.innerHTML = '';
    notices.reset();

    try {
      const { rows, capped } = await fetchAllPeriodRows({
        since: now - REVISIT_CONFIG.fetchLookbackDays * DAY_MS,
        pageSize: REVISIT_INSIGHTS_PAGE_SIZE,
        maxRows: MAX_REVISIT_INSIGHTS_ROWS,
        label: 'revisitInsights',
      });
      if (seq !== loadSeq) return;

      if (rows.length === 0) {
        notices.showEmpty();
        return;
      }

      const insights = aggregateRevisitInsights(rows, now);
      renderLoops(insights.loops);
      renderRanking(insights.ranking);
      renderDormant(insights.dormant);
      renderCapsule(insights);

      if (capped) {
        notices.setMessage(
          'rowCap',
          msg(
            'revisitInsights_rowCap',
            { shown: rows.length },
            'Aggregated only the newest {shown} records; older counts may be understated.',
          ),
        );
        notices.show('rowCap');
      }
    } catch (error) {
      console.error('[revisitInsightsPanel] error:', error);
      if (seq !== loadSeq) return;
      notices.showError('revisitInsightsError', 'Failed to load revisit data.');
    }
  }

  return {
    id: 'panel-revisit-insights',
    category: 'async-data',
    mount(container) {
      emptyEl = container.querySelector('#revisitInsightsEmptyState');
      rowCapEl = container.querySelector('#revisitInsightsRowCap');
      loopsBody = container.querySelector('#revisitInsightsLoopsBody');
      rankingBody = container.querySelector('#revisitInsightsRankingBody');
      dormantBody = container.querySelector('#revisitInsightsDormantBody');
      capsuleEl = container.querySelector('#revisitInsightsCapsule');
      notices.register('empty', emptyEl, {
        i18nKey: 'revisitInsights_empty',
        fallbackText: 'No records.',
      });
      notices.register('rowCap', rowCapEl, { fetchScoped: true });
    },
    async load() {
      await reload();
    },
    destroy() {
      loadSeq += 1;
      for (const state of copyStates) {
        if (state.timer !== null) clearTimeout(state.timer);
        state.timer = null;
      }
      copyStates.length = 0;
      emptyEl = null;
      rowCapEl = null;
      loopsBody = null;
      rankingBody = null;
      dormantBody = null;
      capsuleEl = null;
      notices.clear();
    },
  };
}
