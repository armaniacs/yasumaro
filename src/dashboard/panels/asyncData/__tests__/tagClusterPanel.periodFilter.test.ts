// @vitest-environment jsdom
/**
 * tagClusterPanel period-filter wiring (PBI 2026-09-24-04; default preset
 * changed to 'last7' by user decision 2026-09-24):
 * (a) the default 'last7' preset queries with ~7-day epoch-ms bounds;
 * (b) selecting a preset refetches immediately with the preset's epoch-ms
 *     bounds and re-renders the cluster; selecting 'all' restores the
 *     unbounded query (byte-identical to the pre-filter { limit: 10000 });
 * (c) 0 rows under bounds shows the period-aware empty state, and returning
 *     to 'all' restores the generic message.
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

vi.mock('../../registryContext.js', () => ({
  getRegistry: () => ({ navigateTyped: vi.fn(), navigate: vi.fn() }),
  tryNavigateTyped: vi.fn(),
}));

import { createTagClusterPanel } from '../tagClusterPanel.js';
import { DAY_MS } from '../../../components/periodFilter.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeEntries(count: number): Array<{ tags: string | null }> {
  return Array.from({ length: count }, (_, i) => ({ tags: i % 2 === 0 ? '#hot #other' : '#hot' }));
}

function mountPanel() {
  const container = document.createElement('div');
  const filterHost = document.createElement('div');
  filterHost.id = 'tagClusterFilter';
  container.appendChild(filterHost);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.id = 'tagClusterSvg';
  svg.setAttribute('width', '800');
  svg.setAttribute('height', '600');
  container.appendChild(svg);

  const emptyState = document.createElement('div');
  emptyState.id = 'tagClusterEmptyState';
  emptyState.hidden = true;
  container.appendChild(emptyState);

  const truncated = document.createElement('div');
  truncated.id = 'tagClusterTruncatedNotice';
  container.appendChild(truncated);

  const zoomIn = document.createElement('button');
  zoomIn.id = 'tagClusterZoomIn';
  container.appendChild(zoomIn);
  const zoomOut = document.createElement('button');
  zoomOut.id = 'tagClusterZoomOut';
  container.appendChild(zoomOut);
  const zoomReset = document.createElement('button');
  zoomReset.id = 'tagClusterZoomReset';
  container.appendChild(zoomReset);

  document.body.appendChild(container);
  const panel = createTagClusterPanel();
  panel.mount(container);
  return { panel, container, svg, emptyState };
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

describe('tagClusterPanel — period filter (PBI 2026-09-24-04)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it("default 'last7' queries with ~7-day bounds and renders", async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: makeEntries(20), total: 20 } });
    const before = Date.now();
    const { panel, svg } = mountPanel();
    await panel.load?.();
    const after = Date.now();

    // PBI 2026-09-24-11: fresh mount + single load() issues exactly ONE
    // query — construction emits nothing, so no duplicate fetch is possible.
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
    expect(svg.querySelectorAll('circle.tag-cluster-node').length).toBeGreaterThan(0);
  });

  it('a fresh mount plus a single load() issues exactly one query (no construction emit)', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: makeEntries(20), total: 20 } });
    const { panel } = mountPanel();
    // Mount alone must not fetch; load() fetches exactly once.
    expect(mockQueryLogs).not.toHaveBeenCalled();
    await panel.load?.();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
  });

  it("selecting 'all' restores the unbounded pre-filter query", async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: makeEntries(20), total: 20 } });
    const { panel, container, svg } = mountPanel();
    await panel.load?.();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    presetButton(container, 'all').click();
    await flush();

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    // Byte-identical to the pre-filter call: no since/until keys at all.
    expect(lastQueryArgs()).toEqual({ limit: 10000 });
    expect(svg.querySelectorAll('circle.tag-cluster-node').length).toBeGreaterThan(0);
  });

  it('selecting a preset refetches with since/until epoch ms and re-renders', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: makeEntries(20), total: 20 } });
    const { panel, container, svg } = mountPanel();
    await panel.load?.();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    presetButton(container, 'last30').click();
    await flush();

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    const args = lastQueryArgs();
    expect(args.limit).toBe(10000);
    expect(typeof args.since).toBe('number');
    expect(typeof args.until).toBe('number');
    const span = (args.until as number) - (args.since as number);
    const thirtyDays = 30 * DAY_MS;
    expect(span).toBeGreaterThanOrEqual(thirtyDays - 60_000);
    expect(span).toBeLessThanOrEqual(thirtyDays + 60_000);
    // The reload ran to completion: loading overlay cleaned up, nodes rendered.
    expect(svg.querySelector('.tag-cluster-loading-overlay')).toBeNull();
    expect(svg.querySelectorAll('circle.tag-cluster-node').length).toBeGreaterThan(0);
  });

  it('shows the period-aware empty state when a bounded period has 0 rows', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container, svg, emptyState } = mountPanel();
    await panel.load?.();
    // 0 rows under the default 'last7' bounds already shows the
    // period-aware empty state.
    expect(emptyState.hidden).toBe(false);
    expect(emptyState.getAttribute('data-i18n')).toBe('tagCluster_empty_period');
    expect(emptyState.textContent).toBe('No records in the selected period. Try a wider range.');

    presetButton(container, 'last30').click();
    await flush();

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    expect(lastQueryArgs().limit).toBe(10000);
    expect(emptyState.hidden).toBe(false);
    expect(emptyState.getAttribute('data-i18n')).toBe('tagCluster_empty_period');
    expect(svg.querySelectorAll('circle.tag-cluster-node').length).toBe(0);
  });

  it("returning to 'all' restores the generic empty state and the unbounded query", async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container, emptyState } = mountPanel();
    await panel.load?.();
    presetButton(container, 'last30').click();
    await flush();
    presetButton(container, 'all').click();
    await flush();

    expect(lastQueryArgs()).toEqual({ limit: 10000 });
    expect(emptyState.getAttribute('data-i18n')).toBe('tagClusterEmptyState');
    expect(emptyState.textContent).toBe('No tagged history yet.');
  });

  it('mounts without a filter host unchanged (no filter, no bounds)', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: makeEntries(20), total: 20 } });
    const container = document.createElement('div');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.id = 'tagClusterSvg';
    container.appendChild(svg);
    const emptyState = document.createElement('div');
    emptyState.id = 'tagClusterEmptyState';
    container.appendChild(emptyState);
    const truncated = document.createElement('div');
    truncated.id = 'tagClusterTruncatedNotice';
    container.appendChild(truncated);
    document.body.appendChild(container);

    const panel = createTagClusterPanel();
    panel.mount(container);
    await panel.load?.();

    expect(container.querySelector('#tagClusterFilter')).toBeNull();
    expect(container.querySelector('.period-filter')).toBeNull();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    expect(lastQueryArgs()).toEqual({ limit: 10000 });
  });
});
