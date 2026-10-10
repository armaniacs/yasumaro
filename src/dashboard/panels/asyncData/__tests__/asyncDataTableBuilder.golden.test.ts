// @vitest-environment jsdom
/**
 * Golden DOM pins for the asyncData rank/heatmap table builders.
 *
 * These tests fix the generated DOM for domainAnalysisPanel (domain + URL
 * rankings) and timeHeatmapPanel (heatmap + numeric alternative): element
 * types, `th scope=row` / `scope=col`, attributes, text and child order. The
 * NN14 unification merges each near-duplicate builder pair into one builder
 * with a cell-render callback; these pins prove the refactor is DOM-identical.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
const mockGetSqliteStatus = vi.fn();
const mockTryNavigateTyped = vi.fn();

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: (...args: unknown[]) => mockQueryLogs(...args),
  getSqliteStatus: (...args: unknown[]) => mockGetSqliteStatus(...args),
  isServiceError: (result: object) => 'error' in result,
}));

vi.mock('../../../utils/retry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/retry.js')>();
  return {
    retryWithExponentialBackoff: (fn: () => Promise<unknown>, options: Record<string, unknown> = {}) =>
      actual.retryWithExponentialBackoff(fn as never, { ...options, baseDelayMs: 0, maxDelayMs: 0 }),
  };
});

vi.mock('../../registryContext.js', () => ({
  tryNavigateTyped: (...args: unknown[]) => mockTryNavigateTyped(...args),
}));

import { createDomainAnalysisPanel } from '../domainAnalysisPanel.js';
import { createTimeHeatmapPanel } from '../timeHeatmapPanel.js';
import { UNKNOWN_DOMAIN_LABEL } from '../../../domainAnalysisAggregate.js';
import { intensityLevel } from '../../../timeHeatmapAggregate.js';
import { getMessage, getMessageOr } from '../../../../utils/i18n.js';

function domainRow(id: number, domain: string | null, url: string): object {
  return { id, url, title: 't', created_at: Date.now(), domain, tags: null, visit_duration: null };
}

function mountDomainPanel() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="domainAnalysisFilter"></div>
    <label for="domainAnalysisTagInput">Tag</label>
    <input type="text" id="domainAnalysisTagInput">
    <button type="button" id="domainAnalysisRunBtn">Run</button>
    <div id="domainAnalysisEmptyState" hidden></div>
    <p id="domainAnalysisUnknownNotice" aria-live="polite" hidden></p>
    <div id="domainAnalysisRowCap" class="data-table-notice is-warning" hidden></div>
    <table><tbody id="domainAnalysisDomainBody"></tbody></table>
    <div id="domainAnalysisDomainTruncated" class="data-table-notice is-warning" hidden></div>
    <table><tbody id="domainAnalysisUrlBody"></tbody></table>
    <div id="domainAnalysisUrlTruncated" class="data-table-notice is-warning" hidden></div>
  `;
  document.body.appendChild(container);
  const panel = createDomainAnalysisPanel();
  panel.mount(container);
  return { panel, container };
}

/** Pins one `tr` = th[scope=row] + td, with the name cell as link or plain text. */
function expectRankRow(tr: Element, name: string, count: number, kind: 'link' | 'text'): void {
  expect(tr.tagName).toBe('TR');
  expect(tr.childElementCount).toBe(2);
  const th = tr.children[0] as HTMLElement;
  const td = tr.children[1] as HTMLElement;
  expect(th.tagName).toBe('TH');
  expect(th.getAttribute('scope')).toBe('row');
  expect(td.tagName).toBe('TD');
  expect(td.textContent).toBe(String(count));
  if (kind === 'link') {
    expect(th.childElementCount).toBe(1);
    const button = th.children[0] as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toBe('data-table-link-btn');
    expect(button.textContent).toBe(name);
    expect(th.textContent).toBe(name);
  } else {
    expect(th.childElementCount).toBe(0);
    expect(th.textContent).toBe(name);
  }
}

const WEEKDAY_KEYS = [
  'dashboardTimeHeatmapSun',
  'dashboardTimeHeatmapMon',
  'dashboardTimeHeatmapTue',
  'dashboardTimeHeatmapWed',
  'dashboardTimeHeatmapThu',
  'dashboardTimeHeatmapFri',
  'dashboardTimeHeatmapSat',
] as const;
const WEEKDAY_FALLBACK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function expectedWeekdayLabel(w: number): string {
  return getMessageOr(WEEKDAY_KEYS[w]!, WEEKDAY_FALLBACK[w]!);
}

function expectedCellLabel(w: number, h: number, count: number): string {
  const wl = expectedWeekdayLabel(w);
  const label = getMessage('dashboardTimeHeatmapCellLabel', { weekday: wl, hour: h, count });
  return label || `${wl} ${h}:00 \u2014 ${count} records`;
}

function heatmapRow(created_at: number): object {
  return { id: 1, url: 'https://example.com/', title: 't', created_at };
}

function mountHeatmapPanel() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="timeHeatmapFilter"></div>
    <div id="timeHeatmapEmptyState" hidden></div>
    <div id="timeHeatmapLimitNotice" hidden></div>
    <div id="timeHeatmapGrid"></div>
    <div id="timeHeatmapTableWrap"></div>
  `;
  document.body.appendChild(container);
  const panel = createTimeHeatmapPanel();
  panel.mount(container);
  return { panel, container };
}

describe('asyncData table builders — golden DOM', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockTryNavigateTyped.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  describe('domainAnalysisPanel', () => {
    it('pins the domain and URL ranking table DOM', async () => {
      mockQueryLogs.mockResolvedValue({
        data: {
          rows: [
            domainRow(1, 'a.com', 'https://a.com/1'),
            domainRow(2, 'a.com', 'https://a.com/2'),
            domainRow(3, 'b.com', 'https://b.com/1'),
            domainRow(4, 'b.com', 'https://b.com/2'),
            domainRow(5, 'b.com', 'https://b.com/3'),
          ],
          total: 5,
        },
      });
      const { panel, container } = mountDomainPanel();
      await panel.load?.();

      const domainRows = [...container.querySelectorAll('#domainAnalysisDomainBody tr')];
      expect(domainRows).toHaveLength(2);
      expectRankRow(domainRows[0]!, 'b.com', 3, 'link');
      expectRankRow(domainRows[1]!, 'a.com', 2, 'link');

      const urlRows = [...container.querySelectorAll('#domainAnalysisUrlBody tr')];
      expect(urlRows).toHaveLength(5);
      const expectedUrls = [
        'https://a.com/1',
        'https://a.com/2',
        'https://b.com/1',
        'https://b.com/2',
        'https://b.com/3',
      ];
      urlRows.forEach((tr, i) => expectRankRow(tr, expectedUrls[i]!, 1, 'text'));
    });

    it('pins the (unknown) bucket row as plain text', async () => {
      mockQueryLogs.mockResolvedValue({
        data: {
          rows: [
            domainRow(1, null, 'https://a.com/1'),
            domainRow(2, '  ', 'https://a.com/2'),
            domainRow(3, 'a.com', 'https://a.com/3'),
          ],
          total: 3,
        },
      });
      const { panel, container } = mountDomainPanel();
      await panel.load?.();

      const unknownText = getMessageOr('domainAnalysis_unknownDomain', UNKNOWN_DOMAIN_LABEL);
      const domainRows = [...container.querySelectorAll('#domainAnalysisDomainBody tr')];
      expect(domainRows).toHaveLength(2);
      expectRankRow(domainRows[0]!, unknownText, 2, 'text');
      expectRankRow(domainRows[1]!, 'a.com', 1, 'link');
    });
  });

  describe('timeHeatmapPanel', () => {
    it('pins the heatmap and numeric table DOM', async () => {
      const t1 = new Date(2026, 8, 21, 9).getTime();
      const t2 = new Date(2026, 8, 21, 9).getTime();
      const t3 = new Date(2026, 8, 22, 14).getTime();
      mockQueryLogs.mockResolvedValue({
        data: { rows: [heatmapRow(t1), heatmapRow(t2), heatmapRow(t3)], total: 3 },
      });
      const { panel, container } = mountHeatmapPanel();
      await panel.load?.();

      // Expected grid mirrors aggregateTimeHeatmap (local time, Sunday-first).
      const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
      for (const ts of [t1, t2, t3]) {
        const d = new Date(ts);
        grid[d.getDay()]![d.getHours()] = (grid[d.getDay()]![d.getHours()] ?? 0) + 1;
      }
      const max = Math.max(...grid.flat());

      const heatmap = container.querySelector(
        '#timeHeatmapGrid table.time-heatmap-grid',
      ) as HTMLTableElement | null;
      const numeric = container.querySelector(
        '#timeHeatmapTableWrap table.time-heatmap-numeric',
      ) as HTMLTableElement | null;
      expect(heatmap).not.toBeNull();
      expect(numeric).not.toBeNull();
      expect(heatmap!.tagName).toBe('TABLE');
      expect(numeric!.tagName).toBe('TABLE');

      expect(heatmap!.querySelector('caption')!.textContent).toBe(
        getMessageOr('dashboardTimeHeatmapTableCaption', 'Browsing records by weekday and hour'),
      );
      expect(numeric!.querySelector('caption')!.textContent).toBe(
        getMessageOr('dashboardTimeHeatmapNumericCaption', 'Browsing record counts by weekday and hour'),
      );

      const thead = heatmap!.querySelector('thead')!;
      expect(thead.childElementCount).toBe(1);
      const headRow = thead.children[0] as HTMLElement;
      expect(headRow.tagName).toBe('TR');
      expect(headRow.childElementCount).toBe(25);
      const corner = headRow.children[0] as HTMLElement;
      expect(corner.tagName).toBe('TH');
      expect(corner.getAttribute('scope')).toBeNull();
      expect(corner.textContent).toBe('');
      for (let h = 0; h < 24; h++) {
        const th = headRow.children[h + 1] as HTMLElement;
        expect(th.tagName).toBe('TH');
        expect(th.getAttribute('scope')).toBe('col');
        expect(th.textContent).toBe(`${h}:00`);
      }

      const tbody = heatmap!.querySelector('tbody')!;
      expect(tbody.childElementCount).toBe(7);
      for (let w = 0; w < 7; w++) {
        const tr = tbody.children[w] as HTMLElement;
        expect(tr.tagName).toBe('TR');
        expect(tr.childElementCount).toBe(25);
        const rowHeader = tr.children[0] as HTMLElement;
        expect(rowHeader.tagName).toBe('TH');
        expect(rowHeader.getAttribute('scope')).toBe('row');
        expect(rowHeader.textContent).toBe(expectedWeekdayLabel(w));
        for (let h = 0; h < 24; h++) {
          const count = grid[w]![h]!;
          const td = tr.children[h + 1] as HTMLElement;
          expect(td.tagName).toBe('TD');
          expect(td.className).toBe('time-heatmap-cell');
          expect(td.getAttribute('tabindex')).toBe('0');
          expect(td.dataset.intensity).toBe(String(intensityLevel(count, max)));
          const label = expectedCellLabel(w, h, count);
          expect(td.getAttribute('title')).toBe(label);
          expect(td.getAttribute('aria-label')).toBe(label);
        }
      }

      // Numeric alternative: same skeleton, plain-text counts.
      const ntbody = numeric!.querySelector('tbody')!;
      expect(ntbody.childElementCount).toBe(7);
      const nHead = numeric!.querySelector('thead')!.children[0] as HTMLElement;
      expect(nHead.childElementCount).toBe(25);
      expect(nHead.children[0]!.textContent).toBe('');
      for (let w = 0; w < 7; w++) {
        const tr = ntbody.children[w] as HTMLElement;
        expect(tr.childElementCount).toBe(25);
        const rowHeader = tr.children[0] as HTMLElement;
        expect(rowHeader.tagName).toBe('TH');
        expect(rowHeader.getAttribute('scope')).toBe('row');
        expect(rowHeader.textContent).toBe(expectedWeekdayLabel(w));
        for (let h = 0; h < 24; h++) {
          const td = tr.children[h + 1] as HTMLElement;
          expect(td.tagName).toBe('TD');
          expect(td.className).toBe('');
          expect(td.textContent).toBe(String(grid[w]![h]!));
        }
      }
    });
  });
});
