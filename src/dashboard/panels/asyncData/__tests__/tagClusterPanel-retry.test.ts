// @vitest-environment jsdom
/**
 * Guards the retry behaviour of the Tag Cluster panel's data load.
 *
 * retryWithExponentialBackoff only retries when its thunk returns null or
 * throws. The loader used to coerce a failed query to `[]`, which is not null,
 * so a real database failure "succeeded" on the first attempt and every
 * remaining attempt was skipped — the panel rendered an empty graph instead of
 * recovering from a transient error.
 *
 * Asserting on the returned rows cannot catch this (a retried failure and an
 * un-retried failure both end up empty), so these tests count invocations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
const mockGetSqliteStatus = vi.fn();

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: (...args: unknown[]) => mockQueryLogs(...args),
  getSqliteStatus: (...args: unknown[]) => mockGetSqliteStatus(...args),
  // Mirrors the real narrowing helper: the panel imports it alongside the
  // query functions to tell the failure side of ServiceResult apart.
  isServiceError: (result: object) => 'error' in result,
}));

// Keep the backoff instant so the retries do not slow the suite down.
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

const SVG_NS = 'http://www.w3.org/2000/svg';

function mountPanel() {
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
  return panel;
}

describe('tag cluster panel — query retry', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it('retries when the query reports an error', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'Database connection lost.' });

    const panel = mountPanel();
    await panel.load?.();

    // maxAttempts is 4; a non-retrying loader would call this exactly once.
    expect(mockQueryLogs.mock.calls.length).toBeGreaterThan(1);
  });

  it('shows the distinct tagClusterError state when the query keeps failing', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'Database connection lost.' });

    const panel = mountPanel();
    await panel.load?.();

    // The empty-state element carries the error message instead of silently
    // rendering an empty graph (timeHeatmapPanel error-state convention).
    const emptyState = document.getElementById('tagClusterEmptyState')!;
    expect(emptyState.hidden).toBe(false);
    expect(emptyState.getAttribute('data-i18n')).toBe('tagClusterError');
    expect(emptyState.textContent).toContain('Failed to load');
  });

  it('restores the normal empty-state binding after a failed load succeeds', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'down' });
    const panel = mountPanel();
    await panel.load?.();
    expect(document.getElementById('tagClusterEmptyState')!.getAttribute('data-i18n')).toBe(
      'tagClusterError',
    );

    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    await panel.load?.();
    // Reload start resets the empty-state message before the result renders,
    // so a recovered load cannot keep the error binding. This panel mounts
    // without a filter host, so the restored message is the generic one.
    expect(document.getElementById('tagClusterEmptyState')!.getAttribute('data-i18n')).toBe(
      'tagClusterEmptyState',
    );
    expect(document.getElementById('tagClusterEmptyState')!.hidden).toBe(false);
  });

  it('retries when the database is not initialized', async () => {
    mockGetSqliteStatus.mockResolvedValue({ initialized: false });

    const panel = mountPanel();
    await panel.load?.();

    // The not-initialized guard returns null before querying, so the backoff
    // must retry instead of treating the first null as success.
    expect(mockGetSqliteStatus.mock.calls.length).toBeGreaterThan(1);
    expect(mockQueryLogs).not.toHaveBeenCalled();
  });

  it('stops as soon as a query succeeds', async () => {
    mockQueryLogs
      .mockResolvedValueOnce({ error: 'transient' })
      .mockResolvedValueOnce({ data: { rows: [], total: 0 } });

    const panel = mountPanel();
    await panel.load?.();

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the first query succeeds', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

    const panel = mountPanel();
    await panel.load?.();

    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
  });
});
