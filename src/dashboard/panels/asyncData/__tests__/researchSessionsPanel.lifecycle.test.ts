// @vitest-environment jsdom
/**
 * researchSessionsPanel lifecycle tests: the default 7-day fetch, session
 * rendering, and the deliberate split between the two re-render paths — a
 * period change refetches, a gap change re-groups the rows already in hand.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
const mockGetSqliteStatus = vi.fn();
const mockGetNavTrailConsent = vi.fn();

// navTrailConsent lives under src/utils, so the specifier needs one more
// level than the src/dashboard/* mocks above.
vi.mock('../../../../utils/storage/navTrailConsent.js', () => ({
  getNavTrailConsent: (...args: unknown[]) => mockGetNavTrailConsent(...args),
  isNavTrailActive: (c: { enabled: boolean; consentedAt: number | null }) =>
    c.enabled && c.consentedAt !== null,
}));

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

import { createResearchSessionsPanel } from '../researchSessionsPanel.js';

const MINUTE_MS = 60_000;

function mountPanel() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="researchSessionsFilter"></div>
    <label for="researchSessionsGap">Session gap</label>
    <select id="researchSessionsGap"></select>
    <div id="researchSessionsEmptyState" hidden></div>
    <div id="researchSessionsRowCap" class="data-table-notice is-warning" hidden></div>
    <p id="researchSessionsSummary" aria-live="polite"></p>
    <div id="researchSessionsTruncated" class="data-table-notice is-warning" hidden></div>
    <ol id="researchSessionsList" class="research-sessions-list"></ol>
    <p id="researchSessionsSearchToGoalOff" hidden></p>
    <table id="researchSessionsSearchToGoalTable" hidden>
      <tbody id="researchSessionsSearchToGoalBody"></tbody>
    </table>
  `;
  document.body.appendChild(container);
  const panel = createResearchSessionsPanel();
  panel.mount(container);
  return { panel, container };
}

/** Rows at 0/10/20 minutes form one 30-minute session; +200 starts a single. */
function sampleRows() {
  const base = Date.now() - 60 * MINUTE_MS;
  return [
    { id: 1, url: 'https://a.dev/1', title: 'A1', domain: 'a.dev', tags: '#x', is_starred: 1, created_at: base },
    { id: 2, url: 'https://a.dev/2', title: 'A2', domain: 'a.dev', tags: '#x', is_starred: null, created_at: base + 10 * MINUTE_MS },
    { id: 3, url: 'https://a.dev/3', title: 'A3', domain: 'a.dev', tags: null, is_starred: null, created_at: base + 20 * MINUTE_MS },
    { id: 4, url: 'https://b.dev/1', title: 'B1', domain: 'b.dev', tags: null, is_starred: null, created_at: base + 200 * MINUTE_MS },
  ];
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('researchSessionsPanel — PanelLifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
    mockGetNavTrailConsent.mockReset();
    mockGetNavTrailConsent.mockResolvedValue({ enabled: false, consentedAt: null });
    mockQueryLogs.mockResolvedValue({ data: { rows: sampleRows(), total: 4 } });
  });

  it('exposes the expected id and category', () => {
    const panel = createResearchSessionsPanel();
    expect(panel.id).toBe('panel-research-sessions');
    expect(panel.category).toBe('async-data');
  });

  it('does not throw when load runs before mount', async () => {
    const panel = createResearchSessionsPanel();
    await expect(panel.load()).resolves.toBeUndefined();
  });

  it('requests the default 7-day window with the page limit', async () => {
    const before = Date.now();
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    const args = mockQueryLogs.mock.calls[0]![0] as Record<string, number>;
    expect(args.limit).toBe(10000);
    // since lands on the 7-day preset window. The filter reads its own clock,
    // so allow a small drift from the `before` captured here.
    const weekAgo = before - 7 * 86_400_000;
    expect(args.since).toBeGreaterThanOrEqual(weekAgo - 1000);
    expect(args.since).toBeLessThanOrEqual(weekAgo + 1000);
  });

  it('renders one collapsible session and a summary', async () => {
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    const details = document.querySelectorAll('#researchSessionsList details');
    expect(details).toHaveLength(1);
    const summary = document.querySelector('#researchSessionsList summary')!;
    // Start time, page count, minutes and the tag theme.
    expect(summary.textContent).toContain('3 pages');
    expect(summary.textContent).toContain('20 min');
    expect(summary.textContent).toContain('x');
    expect(document.querySelector('#researchSessionsSummary')!.textContent).toContain('1 sessions');
  });

  it('re-groups without refetching when the gap changes', async () => {
    const { panel } = mountPanel();

    await panel.load();
    await flush();
    expect(document.querySelectorAll('#researchSessionsList details')).toHaveLength(1);

    const select = document.querySelector('#researchSessionsGap') as HTMLSelectElement;
    expect(select.value).toBe('30');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['5', '15', '30', '60']);

    select.value = '5';
    select.dispatchEvent(new Event('change'));

    // Same query count — the gap only re-cuts the rows already in hand.
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    // At a 5-minute gap nothing groups, so the list empties.
    expect(document.querySelectorAll('#researchSessionsList details')).toHaveLength(0);
  });

  it('refetches when the period preset changes', async () => {
    const { panel } = mountPanel();

    await panel.load();
    await flush();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    const preset = document.querySelector<HTMLButtonElement>('button[data-preset="last30"]');
    expect(preset).not.toBeNull();
    preset!.click();
    await flush();

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state for zero rows', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    const empty = document.querySelector('#researchSessionsEmptyState') as HTMLElement;
    expect(empty.hidden).toBe(false);
    expect(document.querySelectorAll('#researchSessionsList details')).toHaveLength(0);
  });

  it('shows an error when sqlite is unavailable', async () => {
    mockGetSqliteStatus.mockResolvedValue({ initialized: false });
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    const empty = document.querySelector('#researchSessionsEmptyState') as HTMLElement;
    expect(empty.hidden).toBe(false);
    // Must not read as "no records".
    expect(empty.getAttribute('data-i18n')).toBe('researchSessionsError');
  });

  describe('navigation path and search-to-goal (PBI 04)', () => {
    const base = Date.now() - 90 * MINUTE_MS;

    /** One 30-minute session: search engine -> a -> b, b ending on tag #t. */
    function trailSession() {
      return [
        {
          id: 10, url: 'https://www.google.com/search?q=wasm', title: 'search', domain: 'www.google.com',
          tags: null, is_starred: null, created_at: base, search_query: 'wasm',
        },
        {
          id: 11, url: 'https://a.dev/x', title: 'A', domain: 'a.dev', tags: null, is_starred: null,
          created_at: base + 10 * MINUTE_MS, nav_source_url: 'https://www.google.com/search?q=wasm',
        },
        {
          id: 12, url: 'https://b.dev/y', title: 'B', domain: 'b.dev', tags: '#t', is_starred: null,
          created_at: base + 20 * MINUTE_MS, nav_source_url: 'https://a.dev/x',
        },
      ];
    }

    /** The same burst repeated 3h later, so it groups as a second session. */
    function twoIdenticalSearchSessions() {
      const shift = 3 * 60 * MINUTE_MS;
      const second = trailSession().map((r, i) => ({
        ...r,
        id: r.id + 100 + i,
        created_at: r.created_at + shift,
      }));
      return [...trailSession(), ...second];
    }

    it('renders a nested tree when the trail is available', async () => {
      mockGetNavTrailConsent.mockResolvedValue({ enabled: true, consentedAt: 1 });
      mockQueryLogs.mockResolvedValue({ data: { rows: trailSession(), total: 3 } });
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      // One <ul> per level: search page -> a.dev -> b.dev.
      const trees = document.querySelectorAll('#researchSessionsList .research-sessions-tree');
      expect(trees).toHaveLength(3);
      const roots = trees[0]!.querySelectorAll(':scope > li');
      expect(roots).toHaveLength(1);
      expect(roots[0]!.textContent).toContain('search');
      const level2 = trees[1]!.querySelectorAll(':scope > li');
      expect(level2[0]?.textContent).toContain('A');
      const level3 = trees[2]!.querySelectorAll(':scope > li');
      expect(level3[0]?.textContent).toContain('B');
      // The flat list must not also be rendered.
      expect(document.querySelectorAll('.research-sessions-records')).toHaveLength(0);
    });

    it('shows the leading search term once, above the tree', async () => {
      mockGetNavTrailConsent.mockResolvedValue({ enabled: true, consentedAt: 1 });
      mockQueryLogs.mockResolvedValue({ data: { rows: trailSession(), total: 3 } });
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      expect(document.querySelectorAll('.research-sessions-query-root')).toHaveLength(1);
      // The first record's inline "Search:" is suppressed to avoid a duplicate.
      expect(document.querySelectorAll('.research-sessions-query')).toHaveLength(0);
    });

    it('falls back to the flat list when the trail is off', async () => {
      mockGetNavTrailConsent.mockResolvedValue({ enabled: false, consentedAt: null });
      mockQueryLogs.mockResolvedValue({ data: { rows: sampleRows(), total: 4 } });
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      expect(document.querySelectorAll('.research-sessions-tree')).toHaveLength(0);
      expect(document.querySelectorAll('.research-sessions-records')).toHaveLength(1);
    });

    it('hides the metric table and shows the hint while the trail is off', async () => {
      mockGetNavTrailConsent.mockResolvedValue({ enabled: false, consentedAt: null });
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      const table = document.querySelector('#researchSessionsSearchToGoalTable') as HTMLElement;
      const off = document.querySelector('#researchSessionsSearchToGoalOff') as HTMLElement;
      expect(table.hidden).toBe(true);
      expect(off.hidden).toBe(false);
    });

    it('renders a metric row per tag once the trail is on', async () => {
      mockGetNavTrailConsent.mockResolvedValue({ enabled: true, consentedAt: 1 });
      mockQueryLogs.mockResolvedValue({ data: { rows: twoIdenticalSearchSessions(), total: 6 } });
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      const table = document.querySelector('#researchSessionsSearchToGoalTable') as HTMLElement;
      expect(table.hidden).toBe(false);
      const rows = document.querySelectorAll('#researchSessionsSearchToGoalBody tr');
      expect(rows).toHaveLength(1);
      // Tag, 2 sessions, 3.0 avg pages, 20 avg minutes.
      expect(rows[0]!.textContent).toContain('t');
      expect(rows[0]!.querySelectorAll('td')[0]?.textContent).toBe('2');
      expect(rows[0]!.querySelectorAll('td')[1]?.textContent).toBe('3.0');
    });

    it('labels an untagged resolution page instead of leaving the cell blank', async () => {
      mockGetNavTrailConsent.mockResolvedValue({ enabled: true, consentedAt: 1 });
      const untagged = twoIdenticalSearchSessions().map((r) => ({ ...r, tags: null }));
      mockQueryLogs.mockResolvedValue({ data: { rows: untagged, total: 6 } });
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      const head = document.querySelector('#researchSessionsSearchToGoalBody th');
      expect(head?.textContent).toBe('(untagged)');
    });

    it('shows the empty row when nothing started from a search', async () => {
      mockGetNavTrailConsent.mockResolvedValue({ enabled: true, consentedAt: 1 });
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      const cells = document.querySelectorAll('#researchSessionsSearchToGoalBody td');
      expect(cells).toHaveLength(1);
      expect(cells[0]!.getAttribute('colspan')).toBe('4');
    });

    it('still renders sessions when the consent read fails', async () => {
      mockGetNavTrailConsent.mockRejectedValue(new Error('storage down'));
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      expect(document.querySelectorAll('#researchSessionsList details').length).toBeGreaterThan(0);
      const table = document.querySelector('#researchSessionsSearchToGoalTable') as HTMLElement;
      expect(table.hidden).toBe(true);
    });
  });

  it('is safe to destroy twice', async () => {
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    expect(() => {
      panel.destroy();
      panel.destroy();
    }).not.toThrow();
  });

  describe('navigation trail display (PBI 03)', () => {
    const base = Date.now() - 60 * MINUTE_MS;

    function trailRows(over: { nav_source_url?: string | null; search_query?: string | null }) {
      return [
        {
          id: 1, url: 'https://a.dev/1', title: 'A1', domain: 'a.dev', tags: null, is_starred: null,
          created_at: base, ...over,
        },
        {
          id: 2, url: 'https://a.dev/2', title: 'A2', domain: 'a.dev', tags: null, is_starred: null,
          created_at: base + 10 * MINUTE_MS,
        },
      ];
    }

    it('shows the search term and the referrer host', async () => {
      mockQueryLogs.mockResolvedValue({
        data: {
          rows: trailRows({ nav_source_url: 'https://www.google.com/search?q=x', search_query: 'wasm sqlite' }),
          total: 2,
        },
      });
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      const list = document.querySelector('#researchSessionsList')!;
      // This session carries a referrer, so it renders as a tree and the
      // leading term is hoisted to the query-root line (PBI 04).
      expect(list.querySelector('.research-sessions-query-root')?.textContent).toBe(
        'Search: wasm sqlite',
      );
      // Host only — the full referrer path stays in storage, not on screen.
      expect(list.querySelector('.research-sessions-source')?.textContent).toBe(
        'From: www.google.com',
      );
    });

    it('shows the search term inline when there is no trail', async () => {
      mockQueryLogs.mockResolvedValue({
        data: { rows: trailRows({ search_query: 'wasm sqlite' }), total: 2 },
      });
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      const list = document.querySelector('#researchSessionsList')!;
      expect(list.querySelector('.research-sessions-records')).not.toBeNull();
      expect(list.querySelector('.research-sessions-query')?.textContent).toBe(
        'Search: wasm sqlite',
      );
    });

    it('omits both spans when the feature was off', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: trailRows({}), total: 2 } });
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      const list = document.querySelector('#researchSessionsList')!;
      expect(list.querySelector('.research-sessions-query')).toBeNull();
      expect(list.querySelector('.research-sessions-source')).toBeNull();
    });

    it('skips a referrer it cannot parse rather than printing it raw', async () => {
      mockQueryLogs.mockResolvedValue({
        data: { rows: trailRows({ nav_source_url: 'not a url' }), total: 2 },
      });
      const { panel } = mountPanel();

      await panel.load();
      await flush();

      const list = document.querySelector('#researchSessionsList')!;
      expect(list.querySelector('.research-sessions-source')).toBeNull();
      expect(list.textContent).not.toContain('not a url');
    });
  });
});
