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

import {
  createPeriodFilter,
  presetToRange,
  type PeriodFilterHandle,
} from '../../components/periodFilter.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { PanelNotices } from '../PanelNotices.js';
import { getMessageWithSubstitutions as msg } from '../../../utils/i18n.js';
import { isSecureUrl } from '../../../utils/urlUtils.js';
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
import { type PanelLifecycle } from '../types.js';

/** One record line: time, title link, domain, starred marker. */
function renderRecord(record: SessionInput): HTMLLIElement {
  const li = document.createElement('li');

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

  if (record.is_starred === 1) {
    const starred = document.createElement('span');
    starred.className = 'research-sessions-starred';
    starred.textContent = msg('researchSessions_starred', {}, 'Starred');
    li.appendChild(starred);
  }

  return li;
}

function renderSession(session: ResearchSession): HTMLLIElement {
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
  details.appendChild(summary);

  const records = document.createElement('ol');
  records.className = 'research-sessions-records';
  for (const record of session.records) records.appendChild(renderRecord(record));
  details.appendChild(records);

  item.appendChild(details);
  return item;
}

export function createResearchSessionsPanel(): PanelLifecycle {
  let filterHost: HTMLElement | null = null;
  let gapSelect: HTMLSelectElement | null = null;
  let emptyEl: HTMLElement | null = null;
  let rowCapEl: HTMLElement | null = null;
  let summaryEl: HTMLElement | null = null;
  let truncatedEl: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  let lastRows: SessionInput[] | null = null;
  let gapMinutes: number = DEFAULT_SESSION_GAP_MIN;
  const notices = new PanelNotices();
  let loadSeq = 0;

  /** Re-groups the cached rows. Never refetches — the gap is a different cut
   *  of the same records, not a different question. */
  function render(): void {
    if (!lastRows || !listEl || !summaryEl) return;
    // Re-aggregation reset: the row cap describes the FETCH, so it survives.
    notices.resetForReaggregate();

    const agg = groupResearchSessions(lastRows, gapMinutes);

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

    listEl.innerHTML = '';
    for (const session of agg.sessions) listEl.appendChild(renderSession(session));
  }

  async function reload(): Promise<void> {
    if (!listEl) return;
    const seq = ++loadSeq;
    const range = filterHandle ? filterHandle.getRange() : presetToRange('last7', Date.now());

    listEl.innerHTML = '';
    notices.reset();

    try {
      const res = await fetchPeriodRows({
        ...range,
        limit: MAX_RESEARCH_SESSION_ROWS,
        label: 'researchSessions',
      });
      if (seq !== loadSeq) return;
      lastRows = res.rows;

      if (res.capped) {
        notices.setMessage(
          'rowCap',
          msg(
            'researchSessions_rowCap',
            { shown: res.rows.length },
            'Grouped only the newest {shown} records. Shorten the period to include all records.',
          ),
        );
        notices.show('rowCap');
      }

      if (res.rows.length === 0) {
        listEl.innerHTML = '';
        notices.showEmpty();
        return;
      }
      render();
    } catch (error) {
      console.error('[researchSessionsPanel] error:', error);
      if (seq !== loadSeq) return;
      lastRows = null;
      notices.showError('researchSessionsError', 'Failed to load sessions.');
    }
  }

  return {
    id: 'panel-research-sessions',
    category: 'async-data',
    mount(container) {
      filterHost = container.querySelector('#researchSessionsFilter');
      gapSelect = container.querySelector('#researchSessionsGap');
      emptyEl = container.querySelector('#researchSessionsEmptyState');
      rowCapEl = container.querySelector('#researchSessionsRowCap');
      summaryEl = container.querySelector('#researchSessionsSummary');
      truncatedEl = container.querySelector('#researchSessionsTruncated');
      listEl = container.querySelector('#researchSessionsList');

      notices.register('empty', emptyEl, {
        i18nKey: 'researchSessions_empty',
        fallbackText: 'No records in this period.',
      });
      notices.register('rowCap', rowCapEl, { fetchScoped: true });
      notices.register('truncated', truncatedEl, { fetchScoped: true });

      if (filterHost) {
        // WHY: auto-apply here (unlike the explicit-apply domain-analysis
        // panel) — a period change is a cheap single-page fetch, so an
        // explicit Run button would only add a step.
        filterHandle = createPeriodFilter({
          initialPreset: 'last7',
          onChange: () => {
            void reload();
          },
        });
        filterHost.appendChild(filterHandle.element);
      }

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
      await reload();
    },
    destroy() {
      loadSeq += 1;
      filterHandle?.destroy();
      filterHandle = null;
      filterHost = null;
      gapSelect = null;
      emptyEl = null;
      rowCapEl = null;
      summaryEl = null;
      truncatedEl = null;
      listEl = null;
      lastRows = null;
      notices.clear();
    },
  };
}
