// @vitest-environment jsdom
/**
 * timeHeatmapPanel lifecycle tests: grid rendering, empty state,
 * limit notice, and the shared period-filter wiring (default 'last90',
 * auto-apply on preset change, 'all' = unbounded query).
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

import { createTimeHeatmapPanel } from '../timeHeatmapPanel.js';
import { MAX_TIME_HEATMAP_ROWS } from '../../../../utils/computeLimits.js';
import { DAY_MS } from '../../../components/periodFilter.js';

function localTs(year: number, month1: number, day: number, hour: number): number {
  return new Date(year, month1 - 1, day, hour).getTime();
}

function mountPanel() {
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

function row(created_at: number) {
  return { id: 1, url: 'https://example.com/', title: 't', created_at };
}

describe('timeHeatmapPanel — PanelLifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it('has correct id and category', () => {
    const { panel } = mountPanel();
    expect(panel.id).toBe('panel-time-heatmap');
    expect(panel.category).toBe('async-data');
  });

  it('load without mount is safe', async () => {
    const p = createTimeHeatmapPanel();
    await expect(p.load?.()).resolves.toBeUndefined();
  });

  it('renders a 7x24 grid with intensity cells on load', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: [row(localTs(2026, 9, 21, 9)), row(localTs(2026, 9, 22, 14))], total: 2 },
    });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const grid = container.querySelector('#timeHeatmapGrid table.time-heatmap-grid');
    expect(grid).not.toBeNull();
    expect(grid!.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(grid!.querySelectorAll('tbody tr:first-child td')).toHaveLength(24);
    const cells = grid!.querySelectorAll('td.time-heatmap-cell');
    expect(cells.length).toBe(7 * 24);
    for (const cell of cells) {
      expect(cell.getAttribute('aria-label')).toBeTruthy();
      expect(cell.getAttribute('title')).toBeTruthy();
      expect(cell.getAttribute('data-intensity')).toMatch(/^[0-4]$/);
    }
    // Numeric alternative table carries the same counts as text.
    const numeric = container.querySelector('#timeHeatmapTableWrap table.time-heatmap-numeric');
    expect(numeric).not.toBeNull();
    expect(numeric!.textContent).toContain('1');
    expect(container.querySelector('#timeHeatmapEmptyState')!.hidden).toBe(true);
    expect(container.querySelector('#timeHeatmapLimitNotice')!.hidden).toBe(true);
  });

  it('shows the empty state when 0 rows are returned', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(container.querySelector('#timeHeatmapEmptyState')!.hidden).toBe(false);
    expect(container.querySelector('#timeHeatmapGrid table')).toBeNull();
    expect(container.querySelector('#timeHeatmapLimitNotice')!.hidden).toBe(true);
  });

  it('shows the limit notice only when total exceeds the fetched rows', async () => {
    const rows = Array.from({ length: MAX_TIME_HEATMAP_ROWS }, (_, i) => row(localTs(2026, 1, 2, i % 24)));
    // Exactly the cap: the fetch is complete, so claiming a partial set
    // would be false.
    mockQueryLogs.mockResolvedValueOnce({ data: { rows, total: MAX_TIME_HEATMAP_ROWS } });
    const first = mountPanel();
    await first.panel.load?.();
    expect(first.container.querySelector('#timeHeatmapLimitNotice')!.hidden).toBe(true);

    // Total beyond the fetched rows proves truncation.
    mockQueryLogs.mockResolvedValue({ data: { rows, total: 15000 } });
    const second = mountPanel();
    await second.panel.load?.();
    expect(second.container.querySelector('#timeHeatmapLimitNotice')!.hidden).toBe(false);
    expect(second.container.querySelector('#timeHeatmapEmptyState')!.hidden).toBe(true);
  });

  it('shows a distinct error message when the query keeps failing', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'sqlite unavailable' });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const emptyState = container.querySelector('#timeHeatmapEmptyState')!;
    expect(emptyState.hidden).toBe(false);
    expect(emptyState.getAttribute('data-i18n')).toBe('dashboardTimeHeatmapError');
    expect(emptyState.textContent).toContain('Failed to load');
  });

  it("queries with the default 'last90' bounds and the row cap", async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const before = Date.now();
    const { panel } = mountPanel();
    await panel.load?.();
    const after = Date.now();

    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    const args = mockQueryLogs.mock.calls[0]![0] as { since: number; until: number; limit: number };
    expect(args.limit).toBe(MAX_TIME_HEATMAP_ROWS);
    expect(typeof args.since).toBe('number');
    expect(args.until as number).toBeGreaterThanOrEqual(before);
    expect(args.until as number).toBeLessThanOrEqual(after);
    const span = (args.until as number) - (args.since as number);
    expect(span).toBeGreaterThanOrEqual(90 * DAY_MS - 60_000);
    expect(span).toBeLessThanOrEqual(90 * DAY_MS + 60_000);
  });

  it('auto-applies a preset change with a refetch and new bounds', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container } = mountPanel();
    await panel.load?.();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    const preset = container.querySelector<HTMLButtonElement>('button[data-preset="last7"]');
    expect(preset).not.toBeNull();
    preset!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Auto-apply: no explicit Run button — the selection refetches.
    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    const args = mockQueryLogs.mock.calls[1]![0] as { since: number; until: number; limit: number };
    const span = (args.until as number) - (args.since as number);
    expect(span).toBeGreaterThanOrEqual(7 * DAY_MS - 60_000);
    expect(span).toBeLessThanOrEqual(7 * DAY_MS + 60_000);
  });

  it("queries without since/until when 'all' is selected", async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const preset = container.querySelector<HTMLButtonElement>('button[data-preset="all"]');
    expect(preset).not.toBeNull();
    preset!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    // Byte-identical to the pre-filter call: no since/until keys at all.
    expect(mockQueryLogs.mock.calls[1]![0]).toEqual({ limit: MAX_TIME_HEATMAP_ROWS });
  });

  it('destroy cleans up the filter and stays safe when called twice', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container } = mountPanel();
    await panel.load?.();
    expect(container.querySelector('.period-filter')).not.toBeNull();
    expect(() => panel.destroy?.()).not.toThrow();
    expect(() => panel.destroy?.()).not.toThrow();
    expect(container.querySelector('.period-filter')).toBeNull();
  });
});
