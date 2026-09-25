// @vitest-environment jsdom
/**
 * researchSessionsPanel lifecycle tests: the default 7-day fetch, session
 * rendering, and the deliberate split between the two re-render paths — a
 * period change refetches, a gap change re-groups the rows already in hand.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
const mockGetSqliteStatus = vi.fn();

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

  it('is safe to destroy twice', async () => {
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    expect(() => {
      panel.destroy();
      panel.destroy();
    }).not.toThrow();
  });
});
