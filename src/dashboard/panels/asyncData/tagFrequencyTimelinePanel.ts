/**
 * tagFrequencyTimelinePanel.ts (PanelLifecycle)
 * Stacked weekly/monthly record counts for the top tags in a period
 * (PBI 2026-09-24-05), rendered as hand-drawn SVG plus an equal-value
 * numeric table (WCAG 2.1 AA alternative, timeHeatmapPanel precedent).
 *
 * Fetch strategy follows the domain-analysis panel: the panel passes no
 * onChange handler and the Run button applies the filter selection read via
 * getRange() with a single capped queryLogs({since, until, limit: 10000}) —
 * no auto-query per preset click (explicit-apply contract,
 * PBI 2026-09-24-11). Enter in the top-N input re-aggregates from cache only
 * (top-N does not change the query). Granularity and top-N changes, in
 * contrast, re-aggregate the already-fetched rows client-side: recomputing
 * buckets is an O(n) pass over cached rows, far cheaper than a refetch,
 * while still satisfying "切替のたびに再集計される".
 *
 * Aggregation lives in tagFrequencyTimeline.ts (pure); this file owns DOM,
 * SVG geometry, legend navigation, and notices only.
 */

import { MAX_TAG_TIMELINE_ROWS } from '../../../utils/computeLimits.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { PanelNotices } from '../PanelNotices.js';
import { getMessageOr, getMessageWithSubstitutions as msg } from '../../../utils/i18n.js';
import {
  createPeriodFilter,
  presetToRange,
  type PeriodFilterHandle,
} from '../../components/periodFilter.js';
import {
  computeTagFrequencyTimeline,
  formatBucketDate,
  TIMELINE_DEFAULT_TOP_N,
  type TagFrequencyTimeline,
  type TimelineGranularity,
} from '../../tagFrequencyTimeline.js';
import type { BrowsingLogEntry } from '../../dashboardSqliteService.js';
import { type PanelLifecycle } from '../types.js';
import { navigateToHistoryWithTag } from '../navigateToHistory.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Number of token-based series color classes cycled through in CSS. */
const SERIES_COLOR_SLOTS = 8;

const CHART_WIDTH = 800;
const CHART_HEIGHT = 340;
const MARGIN = { top: 24, right: 16, bottom: 44, left: 48 };
const MAX_X_LABELS = 8;

function otherLabel(): string {
  return getMessageOr('dashboardTagTimelineSeriesOther', 'Other');
}

/** Smallest 2/4/6/8/10 × 10^k value ≥ v, so the midpoint tick stays integral. */
function niceCeil(v: number): number {
  const exp = Math.floor(Math.log10(Math.max(v, 1)));
  const base = Math.pow(10, exp);
  for (const m of [2, 4, 6, 8, 10]) {
    if (m * base >= v) return m * base;
  }
  return 20 * base;
}

function svgEl(name: string): SVGElement {
  return document.createElementNS(SVG_NS, name);
}

function cellLabel(date: string, seriesName: string, count: number): string {
  return msg(
    'dashboardTagTimelineCellLabel',
    { date, tag: seriesName, count },
    '{date} {tag}: {count} records',
  );
}

function seriesClass(index: number): string {
  return `tag-timeline-series-${index % SERIES_COLOR_SLOTS}`;
}

export function createTagFrequencyTimelinePanel(): PanelLifecycle {
  let filterHost: HTMLElement | null = null;
  let weekButton: HTMLButtonElement | null = null;
  let monthButton: HTMLButtonElement | null = null;
  let topNInput: HTMLInputElement | null = null;
  let runButton: HTMLButtonElement | null = null;
  let capNotice: HTMLElement | null = null;
  let chartWrap: HTMLElement | null = null;
  let tableWrap: HTMLElement | null = null;
  let legendWrap: HTMLElement | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  let granularity: TimelineGranularity = 'week';
  let cachedRows: BrowsingLogEntry[] | null = null;
  // WHY: the cap notice describes the FETCH, not the current re-aggregation —
  // granularity/top-N switches keep the capped prefix as-is, so the notice
  // must survive re-aggregation (the fetchScoped registration below +
  // resetForReaggregate express this without a panel-side flag).
  // WHY: the empty-state element doubles as the error surface (one element,
  // two modes) — the unified failure policy swaps in the error wording.
  const notices = new PanelNotices();
  let loadSeq = 0;
  function parseTopN(): number {
    if (!topNInput) return TIMELINE_DEFAULT_TOP_N;
    const n = Number.parseInt(topNInput.value, 10);
    return Number.isFinite(n) ? n : TIMELINE_DEFAULT_TOP_N;
  }

  function setGranularityButtons(): void {
    weekButton?.setAttribute('aria-pressed', String(granularity === 'week'));
    monthButton?.setAttribute('aria-pressed', String(granularity === 'month'));
  }

  function clearOutput(): void {
    if (chartWrap) chartWrap.innerHTML = '';
    if (tableWrap) tableWrap.innerHTML = '';
    if (legendWrap) legendWrap.innerHTML = '';
  }

  /** Re-aggregates cached rows (granularity/top-N switch) without a refetch. */
  function reaggregateFromCache(): void {
    if (!cachedRows || !chartWrap) return;
    // WHY: re-aggregation reset — the fetch-scoped cap notice survives while
    // the cached rows remain a capped prefix (tagCooccurrenceTablePanel keeps
    // fetch-scoped notices the same way); only the empty state is hidden.
    notices.resetForReaggregate();
    clearOutput();
    if (cachedRows.length === 0) {
      notices.showEmpty();
      return;
    }
    const timeline = computeTagFrequencyTimeline(cachedRows, {
      granularity,
      topN: parseTopN(),
    });
    renderTimeline(timeline);
  }

  function renderLegend(timeline: TagFrequencyTimeline): void {
    if (!legendWrap) return;
    timeline.tags.forEach((tag, index) => {
      const item = document.createElement('span');
      item.className = 'tag-timeline-legend-item';
      const swatch = document.createElement('span');
      swatch.className = `tag-timeline-swatch ${seriesClass(index)}`;
      swatch.setAttribute('aria-hidden', 'true');
      item.appendChild(swatch);
      // WHY: top tags navigate to the history panel (tagClusterPanel
      // convention); "other" is an aggregate, so it stays plain text.
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'data-table-link-btn';
      button.textContent = `#${tag}`;
      button.addEventListener('click', () => navigateToHistoryWithTag(tag));
      item.appendChild(button);
      legendWrap!.appendChild(item);
    });
    if (timeline.hasOther) {
      const item = document.createElement('span');
      item.className = 'tag-timeline-legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'tag-timeline-swatch tag-timeline-series-other';
      swatch.setAttribute('aria-hidden', 'true');
      item.appendChild(swatch);
      const label = document.createElement('span');
      label.textContent = otherLabel();
      item.appendChild(label);
      legendWrap!.appendChild(item);
    }
  }

  function renderTable(timeline: TagFrequencyTimeline): void {
    if (!tableWrap) return;
    const table = document.createElement('table');
    table.className = 'tag-timeline-numeric';
    const caption = document.createElement('caption');
    caption.textContent =
      getMessageOr('dashboardTagTimelineTableCaption', 'Record counts by bucket and tag');
    table.appendChild(caption);

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.scope = 'col';
    headRow.appendChild(corner);
    timeline.tags.forEach((tag) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = tag;
      headRow.appendChild(th);
    });
    if (timeline.hasOther) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = otherLabel();
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const bucket of timeline.buckets) {
      const tr = document.createElement('tr');
      const rowHeader = document.createElement('th');
      rowHeader.scope = 'row';
      rowHeader.textContent = formatBucketDate(bucket.start);
      tr.appendChild(rowHeader);
      for (const tag of timeline.tags) {
        const td = document.createElement('td');
        td.textContent = String(bucket.counts[tag] ?? 0);
        tr.appendChild(td);
      }
      if (timeline.hasOther) {
        const td = document.createElement('td');
        td.textContent = String(bucket.otherCount);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  function renderChart(timeline: TagFrequencyTimeline): void {
    if (!chartWrap) return;
    const seriesCount = timeline.tags.length + (timeline.hasOther ? 1 : 0);
    if (seriesCount === 0 || timeline.buckets.length === 0) return;

    const svg = svgEl('svg');
    svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
    svg.setAttribute('class', 'tag-timeline-svg');
    svg.setAttribute('role', 'group');
    svg.setAttribute(
      'aria-label',
      getMessageOr('dashboardTagTimelineChartTitle', 'Stacked tag record counts over time'),
    );
    const title = svgEl('title');
    title.textContent = getMessageOr(
      'dashboardTagTimelineChartTitle',
      'Stacked tag record counts over time',
    );
    const desc = svgEl('desc');
    desc.textContent = getMessageOr(
      'dashboardTagTimelineChartDesc',
      'One stacked series per top tag; the same numbers are available in the table below.',
    );
    svg.appendChild(title);
    svg.appendChild(desc);

    const n = timeline.buckets.length;
    const innerW = CHART_WIDTH - MARGIN.left - MARGIN.right;
    const innerH = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = (i: number): number => MARGIN.left + ((i + 0.5) * innerW) / n;

    let maxTotal = 0;
    for (const bucket of timeline.buckets) {
      let total = bucket.otherCount;
      for (const tag of timeline.tags) total += bucket.counts[tag] ?? 0;
      if (total > maxTotal) maxTotal = total;
    }
    const yMax = niceCeil(maxTotal);
    const y = (v: number): number => MARGIN.top + innerH * (1 - v / yMax);
    const baseline = y(0);

    // Gridlines + y ticks at 0 / mid / max (midpoint is integral by niceCeil).
    for (const value of [0, yMax / 2, yMax]) {
      const line = svgEl('line');
      line.setAttribute('x1', String(MARGIN.left));
      line.setAttribute('x2', String(CHART_WIDTH - MARGIN.right));
      line.setAttribute('y1', String(y(value)));
      line.setAttribute('y2', String(y(value)));
      line.setAttribute('class', 'tag-timeline-grid');
      svg.appendChild(line);
      const tick = svgEl('text');
      tick.setAttribute('x', String(MARGIN.left - 6));
      tick.setAttribute('y', String(y(value)));
      tick.setAttribute('dy', '0.35em');
      tick.setAttribute('text-anchor', 'end');
      tick.setAttribute('class', 'tag-timeline-tick');
      tick.textContent = String(value);
      svg.appendChild(tick);
    }

    // X labels: first, last, and an evenly stepped subset in between.
    const step = Math.max(1, Math.ceil(n / MAX_X_LABELS));
    for (let i = 0; i < n; i++) {
      if (i % step !== 0 && i !== n - 1) continue;
      const label = svgEl('text');
      label.setAttribute('x', String(x(i)));
      label.setAttribute('y', String(CHART_HEIGHT - MARGIN.bottom + 16));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'tag-timeline-tick');
      label.textContent = formatBucketDate(timeline.buckets[i]!.start);
      svg.appendChild(label);
    }

    // Baseline axis line.
    const axis = svgEl('line');
    axis.setAttribute('x1', String(MARGIN.left));
    axis.setAttribute('x2', String(CHART_WIDTH - MARGIN.right));
    axis.setAttribute('y1', String(baseline));
    axis.setAttribute('y2', String(baseline));
    axis.setAttribute('class', 'tag-timeline-axis');
    svg.appendChild(axis);

    // Stacked bands: cumulative boundaries per series in stack order.
    const lower = timeline.buckets.map(() => 0);
    const seriesNames = timeline.hasOther
      ? [...timeline.tags, otherLabel()]
      : [...timeline.tags];
    for (let s = 0; s < seriesNames.length; s++) {
      const isOther = timeline.hasOther && s === seriesNames.length - 1;
      const value = (i: number): number =>
        isOther
          ? timeline.buckets[i]!.otherCount
          : timeline.buckets[i]!.counts[timeline.tags[s]!] ?? 0;
      const upper = lower.map((v, i) => v + value(i));
      const cls = isOther ? 'tag-timeline-series-other' : seriesClass(s);

      const points = (arr: number[]): string =>
        arr.map((v, i) => `${x(i)},${y(v)}`).join(' ');

      // Area between the lower and upper boundaries (reversed lower path).
      const polygon = svgEl('polygon');
      polygon.setAttribute(
        'points',
        `${points(upper)} ${[...lower].reverse().map((v, ri) => `${x(n - 1 - ri)},${y(v)}`).join(' ')}`,
      );
      polygon.setAttribute('class', `tag-timeline-area ${cls}`);
      polygon.setAttribute('fill-opacity', '0.35');
      svg.appendChild(polygon);

      // Upper boundary line — the "stacked line" proper.
      const polyLine = svgEl('polyline');
      polyLine.setAttribute('points', points(upper));
      polyLine.setAttribute('class', `tag-timeline-line ${cls}`);
      svg.appendChild(polyLine);

      // Focusable data points on the band top where the series is non-zero.
      for (let i = 0; i < n; i++) {
        const count = value(i);
        if (count <= 0) continue;
        const circle = svgEl('circle');
        circle.setAttribute('cx', String(x(i)));
        circle.setAttribute('cy', String(y(upper[i]!)));
        circle.setAttribute('r', '4');
        circle.setAttribute('class', `tag-timeline-point ${cls}`);
        circle.setAttribute('tabindex', '0');
        const label = cellLabel(
          formatBucketDate(timeline.buckets[i]!.start),
          seriesNames[s]!,
          count,
        );
        circle.setAttribute('aria-label', label);
        const pointTitle = svgEl('title');
        pointTitle.textContent = label;
        circle.appendChild(pointTitle);
        svg.appendChild(circle);
      }

      for (let i = 0; i < n; i++) lower[i] = upper[i]!;
    }

    chartWrap.appendChild(svg);
  }

  function renderTimeline(timeline: TagFrequencyTimeline): void {
    renderLegend(timeline);
    renderChart(timeline);
    renderTable(timeline);
  }

  async function reload(): Promise<void> {
    if (!chartWrap || !tableWrap) return;
    const seq = ++loadSeq;

    clearOutput();
    // Fresh-fetch reset: restores the normal empty binding in case a previous
    // load failed and swapped in the error message, and hides the cap notice
    // until this fetch's own results decide visibility.
    notices.reset();

    try {
      // WHY: getRange() is the single source of truth (PBI 2026-09-24-11);
      // the snapshot lets retries reuse one consistent window even if the
      // user changes the filter mid-flight (stale loads bail via seq). The
      // presetToRange fallback preserves the pre-filter last30 default when
      // the panel mounts without a filter host.
      const bounds = filterHandle
        ? filterHandle.getRange()
        : presetToRange('last30', Date.now());
      const fetched = await fetchPeriodRows({
        since: bounds.since,
        until: bounds.until,
        limit: MAX_TAG_TIMELINE_ROWS,
        label: 'tagFrequencyTimeline',
      });
      const rows = fetched.rows;
      if (seq !== loadSeq) return;

      cachedRows = rows;
      if (rows.length === 0) {
        notices.showEmpty();
        return;
      }

      if (fetched.capped && capNotice) {
        capNotice.textContent = msg(
          'dashboardTagTimelineCapNote',
          { max: MAX_TAG_TIMELINE_ROWS },
          'Reached the {max}-record query limit — showing a partial aggregation.',
        );
        notices.show('cap');
      }

      const timeline = computeTagFrequencyTimeline(rows, {
        granularity,
        topN: parseTopN(),
      });
      renderTimeline(timeline);
    } catch (error) {
      console.error('[tagFrequencyTimelinePanel] error:', error);
      if (seq !== loadSeq) return;
      notices.showError(
        'dashboardTagTimelineError',
        'Failed to load the tag frequency timeline. Try again.',
      );
    }
  }

  return {
    id: 'panel-tag-frequency-timeline',
    category: 'async-data',
    mount(container) {
      filterHost = container.querySelector('#tagTimelineFilter');
      weekButton = container.querySelector('#tagTimelineWeekBtn');
      monthButton = container.querySelector('#tagTimelineMonthBtn');
      topNInput = container.querySelector('#tagTimelineTopN');
      runButton = container.querySelector('#tagTimelineRunBtn');
      capNotice = container.querySelector('#tagTimelineCapNotice');
      chartWrap = container.querySelector('#tagTimelineChartWrap');
      tableWrap = container.querySelector('#tagTimelineTableWrap');
      legendWrap = container.querySelector('#tagTimelineLegend');
      notices.register('empty', container.querySelector('#tagTimelineEmptyState'), {
        i18nKey: 'dashboardTagTimelineEmpty',
        fallbackText: 'No tagged records in this period.',
      });
      notices.register('cap', capNotice, { fetchScoped: true });
      setGranularityButtons();

      if (filterHost) {
        // WHY: no onChange handler — explicit-apply host (domain-analysis
        // precedent): Run reads getRange() instead of recording every
        // change (PBI 2026-09-24-11 contract).
        filterHandle = createPeriodFilter({ initialPreset: 'last30' });
        filterHost.appendChild(filterHandle.element);
      }

      // WHY: explicit apply — a full fetch is disproportionate per preset
      // click (domain-analysis precedent); granularity/top-N changes instead
      // re-aggregate the cached rows locally without a refetch.
      runButton?.addEventListener('click', () => {
        void reload();
      });
      topNInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          // WHY: re-aggregate from cache only — top-N does not change the
          // query, and a refetch here would overlap the browser-fired
          // change event (keydown + change both firing on Enter), double-
          // rendering with a stale-data flash. Run refetches explicitly.
          reaggregateFromCache();
        }
      });
      topNInput?.addEventListener('change', () => {
        reaggregateFromCache();
      });
      weekButton?.addEventListener('click', () => {
        granularity = 'week';
        setGranularityButtons();
        reaggregateFromCache();
      });
      monthButton?.addEventListener('click', () => {
        granularity = 'month';
        setGranularityButtons();
        reaggregateFromCache();
      });
    },
    async load() {
      await reload();
    },
    destroy() {
      loadSeq += 1;
      cachedRows = null;
      filterHandle?.destroy();
      filterHandle = null;
      filterHost = null;
      weekButton = null;
      monthButton = null;
      topNInput = null;
      runButton = null;
      capNotice = null;
      chartWrap = null;
      tableWrap = null;
      legendWrap = null;
      notices.clear();
    },
  };
}
