// @vitest-environment jsdom
/**
 * wordClusterPanel behavior (PBI 2026-09-24-07):
 * - explicit-apply: the period filter only records the range; the Run button
 *   triggers queryLogs with {since, until, limit: 10000} ('all' = no bounds);
 * - keyword nodes render from summary+title rows and navigate to history by
 *   keyword on click;
 * - the excluded-summary count notice appears;
 * - the two empty states are distinct: 0 usable rows vs 0 keywords;
 * - load failures surface the error state.
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
  getRegistry: () => ({ navigateTyped: vi.fn(), navigate: vi.fn() }),
  tryNavigateTyped: (...args: unknown[]) => mockTryNavigateTyped(...args),
}));

import { createWordClusterPanel } from '../wordClusterPanel.js';
import type { PanelLifecycle } from '../../types.js';
import { DAY_MS } from '../../../components/periodFilter.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface MockRow {
  id: number;
  title: string | null;
  summary: string | null;
  tags: string | null;
  created_at: number;
}

function makeRows(specs: Array<[string | null, string | null]>): MockRow[] {
  return specs.map(([title, summary], i) => ({
    id: i + 1,
    title,
    summary,
    tags: null,
    created_at: 1_700_000_000_000 + i,
  }));
}

function mountPanel() {
  const container = document.createElement('div');

  const filterHost = document.createElement('div');
  filterHost.id = 'wordClusterFilter';
  container.appendChild(filterHost);

  const runBtn = document.createElement('button');
  runBtn.id = 'wordClusterRunBtn';
  container.appendChild(runBtn);

  const excluded = document.createElement('div');
  excluded.id = 'wordClusterExcludedNotice';
  excluded.hidden = true;
  container.appendChild(excluded);

  const emptyState = document.createElement('div');
  emptyState.id = 'wordClusterEmptyState';
  emptyState.hidden = true;
  container.appendChild(emptyState);

  const truncated = document.createElement('div');
  truncated.id = 'wordClusterTruncatedNotice';
  truncated.hidden = true;
  container.appendChild(truncated);

  const rowCap = document.createElement('div');
  rowCap.id = 'wordClusterRowCapNotice';
  rowCap.hidden = true;
  container.appendChild(rowCap);

  const loadingStatus = document.createElement('div');
  loadingStatus.id = 'wordClusterLoadingStatus';
  loadingStatus.hidden = true;
  container.appendChild(loadingStatus);

  for (const suffix of ['ZoomIn', 'ZoomOut', 'ZoomReset']) {
    const button = document.createElement('button');
    button.id = `wordCluster${suffix}`;
    container.appendChild(button);
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.id = 'wordClusterSvg';
  svg.setAttribute('width', '800');
  svg.setAttribute('height', '600');
  container.appendChild(svg);

  document.body.appendChild(container);
  const panel: PanelLifecycle = createWordClusterPanel();
  panel.mount(container);
  return { panel, container, svg, emptyState, excluded, truncated, rowCap, runBtn };
}

function presetButton(container: HTMLElement, preset: string): HTMLButtonElement {
  const button = container.querySelector(`button[data-preset="${preset}"]`);
  if (!button) throw new Error(`preset button not found: ${preset}`);
  return button as HTMLButtonElement;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function lastQueryArgs(): Record<string, unknown> {
  const calls = mockQueryLogs.mock.calls;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

describe('wordClusterPanel — lifecycle (PBI 2026-09-24-07)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockTryNavigateTyped.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it('has correct id and category and a complete lifecycle', async () => {
    const panel = createWordClusterPanel();
    expect(panel.id).toBe('panel-word-cluster');
    expect(panel.category).toBe('async-data');
    expect(() => panel.destroy?.()).not.toThrow();
    await expect(panel.load?.()).resolves.toBeUndefined();
  });

  it("Run with the default 'last7' preset queries with ~7-day bounds and renders keyword nodes", async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: makeRows([['Rust ownership', 'Data races prevented at compile time'], ['TypeScript tips', 'Conditional types explained']]), total: 2 },
    });
    const before = Date.now();
    const { panel, runBtn, svg, excluded } = mountPanel();
    await panel.load?.();
    const after = Date.now();

    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    const args = lastQueryArgs();
    expect(args.limit).toBe(10000);
    expect(typeof args.since).toBe('number');
    expect(typeof args.until).toBe('number');
    expect(args.until as number).toBeGreaterThanOrEqual(before);
    expect(args.until as number).toBeLessThanOrEqual(after);
    const span = (args.until as number) - (args.since as number);
    expect(span).toBeGreaterThanOrEqual(7 * DAY_MS - 60_000);
    expect(span).toBeLessThanOrEqual(7 * DAY_MS + 60_000);
    const circles = svg.querySelectorAll('circle.tag-cluster-node');
    expect(circles.length).toBeGreaterThan(0);
    const texts = Array.from(svg.querySelectorAll('text.tag-cluster-text')).map((t) => t.textContent);
    expect(texts).toContain('rust');
    expect(texts).toContain('compile');
    expect(excluded.hidden).toBe(true);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toContain('rust');
  });

  it("selecting 'all' then Run queries without since/until", async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: makeRows([['Rust ownership', 'Borrow checker notes']]), total: 1 },
    });
    const { panel, container, runBtn } = mountPanel();
    await panel.load?.();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    presetButton(container, 'all').click();
    await flush();
    // Explicit-apply: the preset click alone does not refetch.
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    runBtn.click();
    await flush();
    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    // Byte-identical to the pre-filter call: no since/until keys at all.
    expect(lastQueryArgs()).toEqual({ limit: 10000 });
  });

  it('changing the preset does NOT refetch; only Run applies the range', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: makeRows([['Rust ownership', 'Borrow checker notes']]), total: 1 },
    });
    const { panel, container, runBtn } = mountPanel();
    await panel.load?.();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    presetButton(container, 'last30').click();
    await flush();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    runBtn.click();
    await flush();
    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    const args = lastQueryArgs();
    expect(args.limit).toBe(10000);
    expect(typeof args.since).toBe('number');
    expect(typeof args.until).toBe('number');
    const span = (args.until as number) - (args.since as number);
    expect(span).toBeGreaterThanOrEqual(30 * DAY_MS - 60_000);
    expect(span).toBeLessThanOrEqual(30 * DAY_MS + 60_000);
  });

  it('shows the excluded-summary count notice for null and fallback-literal summaries', async () => {
    mockQueryLogs.mockResolvedValue({
      data: {
        rows: makeRows([
          ['Rust tips', 'Ownership rules explained'],
          ['Fallback literal', 'Summary not available.'],
          ['Null summary', null],
          ['Cache notes', '  Summary not available.  '],
        ]),
        total: 4,
      },
    });
    const { panel, excluded, emptyState } = mountPanel();
    await panel.load?.();

    expect(excluded.hidden).toBe(false);
    expect(excluded.textContent).toContain('3');
    expect(emptyState.hidden).toBe(true);
    // Title-only rows still contribute keywords.
    const texts = Array.from(document.querySelectorAll('#wordClusterSvg text')).map((t) => t.textContent);
    expect(texts).toContain('fallback');
  });

  it('shows the no-usable-rows empty state when every row lacks usable text', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: makeRows([[null, null], ['', 'Summary not available.'], ['   ', null]]), total: 3 },
    });
    const { panel, svg, emptyState, excluded } = mountPanel();
    await panel.load?.();

    expect(emptyState.hidden).toBe(false);
    expect(emptyState.getAttribute('data-i18n')).toBe('wordClusterEmpty');
    expect(svg.querySelectorAll('circle.tag-cluster-node').length).toBe(0);
    // Fully skipped rows are NOT summary-excluded: the notice claims
    // "titles were still used", which would be false for them.
    expect(excluded.hidden).toBe(true);
  });

  it('shows the no-keywords empty state when rows exist but every keyword is filtered', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: makeRows([['...', 'the and of to in on at']]), total: 1 },
    });
    const { panel, svg, emptyState } = mountPanel();
    await panel.load?.();

    expect(emptyState.hidden).toBe(false);
    expect(emptyState.getAttribute('data-i18n')).toBe('wordClusterEmptyNoKeywords');
    expect(svg.querySelectorAll('circle.tag-cluster-node').length).toBe(0);
  });

  it('navigates to history with the keyword as searchTag on node click', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: makeRows([['Rust ownership', 'Borrow checker notes'], ['Rust lifetimes', 'Elision rules']]), total: 2 },
    });
    const { panel, svg } = mountPanel();
    await panel.load?.();

    const circle = svg.querySelector('circle.tag-cluster-node');
    expect(circle).not.toBeNull();
    (circle as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mockTryNavigateTyped).toHaveBeenCalledWith(
      'panel-sqlite-history',
      expect.objectContaining({ searchTag: expect.any(String) }),
      expect.any(Function),
    );
  });

  it('shows the row-cap notice when the period holds more rows than the fetch limit', async () => {
    // total exceeds the fetched rows → the analyzed set is a truncated prefix
    // and the notice must make that visible (PBI BDD: 上限 10000 行での期間フィルタ).
    mockQueryLogs.mockResolvedValue({
      data: { rows: makeRows([['Rust ownership', 'Borrow checker notes']]), total: 12_345 },
    });
    const { panel, rowCap, svg, truncated } = mountPanel();
    await panel.load?.();

    expect(rowCap.hidden).toBe(false);
    expect(rowCap.textContent).toContain('12345');
    expect(rowCap.textContent).toContain('10000');
    // The node-cap notice is a different condition and stays hidden here.
    expect(truncated.hidden).toBe(true);
    expect(svg.querySelectorAll('circle.tag-cluster-node').length).toBeGreaterThan(0);
  });

  it('hides the row-cap notice again on the next load when the period fits', async () => {
    mockQueryLogs.mockResolvedValueOnce({
      data: { rows: makeRows([['Rust ownership', 'Borrow checker notes']]), total: 20_000 },
    });
    mockQueryLogs.mockResolvedValue({
      data: { rows: makeRows([['Rust ownership', 'Borrow checker notes']]), total: 1 },
    });
    const { panel, rowCap, runBtn } = mountPanel();
    await panel.load?.();
    expect(rowCap.hidden).toBe(false);

    runBtn.click();
    await flush();
    expect(rowCap.hidden).toBe(true);
  });

  it('shows the error empty state when the query keeps failing', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'sqlite unavailable' });
    const { panel, emptyState, svg } = mountPanel();
    await panel.load?.();

    expect(emptyState.hidden).toBe(false);
    expect(emptyState.getAttribute('data-i18n')).toBe('wordClusterError');
    expect(svg.querySelectorAll('circle.tag-cluster-node').length).toBe(0);
  });

  it('shows the error empty state when sqlite is not initialized', async () => {
    mockGetSqliteStatus.mockResolvedValue({ initialized: false });
    const { panel, emptyState } = mountPanel();
    await panel.load?.();
    expect(emptyState.hidden).toBe(false);
    expect(emptyState.getAttribute('data-i18n')).toBe('wordClusterError');
  });

  it('destroy cleans up the filter and stays safe when called twice', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: makeRows([['Rust ownership', 'Borrow checker notes']]), total: 1 },
    });
    const { panel, container } = mountPanel();
    await panel.load?.();
    expect(() => panel.destroy?.()).not.toThrow();
    expect(() => panel.destroy?.()).not.toThrow();
    expect(container.querySelector('.period-filter')).toBeNull();
  });

  it('mount tolerates a missing filter host and run button', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: makeRows([['Rust ownership', 'Borrow checker notes']]), total: 1 },
    });
    const container = document.createElement('div');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.id = 'wordClusterSvg';
    svg.setAttribute('width', '800');
    svg.setAttribute('height', '600');
    container.appendChild(svg);
    const emptyState = document.createElement('div');
    emptyState.id = 'wordClusterEmptyState';
    container.appendChild(emptyState);
    const excluded = document.createElement('div');
    excluded.id = 'wordClusterExcludedNotice';
    container.appendChild(excluded);
    const truncated = document.createElement('div');
    truncated.id = 'wordClusterTruncatedNotice';
    container.appendChild(truncated);
    document.body.appendChild(container);

    const panel = createWordClusterPanel();
    panel.mount(container);
    await panel.load?.();
    expect(container.querySelector('.period-filter')).toBeNull();
    // No Run button and no filter, but load() still queries unbounded —
    // same behavior as the tag-cluster panel without a filter host.
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    expect(lastQueryArgs()).toEqual({ limit: 10000 });
  });
});
