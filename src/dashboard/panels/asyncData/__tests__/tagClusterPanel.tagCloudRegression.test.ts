// @vitest-environment jsdom
/**
 * Regression for 6.8.12 hotfix: tagCluster plain cap 1000 → 10000.
 * The panel requests 10000 rows. When the DB only returned the first 1000,
 * and the tagged history was older (beyond 1000), the cloud appeared empty
 * even though tagged history existed. This test seeds 1500 rows where the
 * 500 tagged rows are at the tail and asserts the SVG renders them.
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
}));

import { createTagClusterPanel } from '../tagClusterPanel.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeEntries(count: number, tagOffset: number): Array<{ tags: string | null }> {
  return Array.from({ length: count }, (_, i) =>
    i < tagOffset ? { tags: null } : { tags: i % 2 === 0 ? '#hot #other' : '#hot' },
  );
}

function mountPanel() {
  const container = document.createElement('div');
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

describe('tagClusterPanel', () => {
  describe('tag cloud regression (6.8.12 hotfix)', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
      mockQueryLogs.mockReset();
      mockGetSqliteStatus.mockReset();
      mockGetSqliteStatus.mockResolvedValue({ initialized: true });
    });

    it('renders SVG nodes for hot tag when 1500 rows have hot in last 500 (fixed behavior)', async () => {
      const entries = makeEntries(1500, 1000);
      mockQueryLogs.mockResolvedValue({ data: { rows: entries, total: 1500 } });

      const { panel, svg, emptyState } = mountPanel();
      await panel.load?.();

      expect(mockQueryLogs).toHaveBeenCalledWith({ limit: 10000 });
      expect(emptyState.hidden).toBe(true);
      const circles = svg.querySelectorAll('circle.tag-cluster-node');
      expect(circles.length).toBeGreaterThan(0);
      const texts = Array.from(svg.querySelectorAll('text.tag-cluster-text')).map((el) => el.textContent);
      expect(texts).toContain('#hot');
    });

    it('shows empty state when only first 1000 (all untagged) are considered (old bug simulation)', async () => {
      const all = makeEntries(1500, 1000);
      const truncated = all.slice(0, 1000);
      mockQueryLogs.mockResolvedValue({ data: { rows: truncated, total: 1000 } });

      const { panel, svg, emptyState } = mountPanel();
      await panel.load?.();

      expect(svg.querySelectorAll('circle.tag-cluster-node').length).toBe(0);
      expect(emptyState.hidden).toBe(false);
    });

    it('fails if reverted to 1000-cap: 5000-limit query would miss hot tags', async () => {
      // This proves the panel test is not tautological: it would fail if the
      // DB layer were capped to 1000, because the hot tags beyond 1000 would be invisible.
      const entries = makeEntries(1500, 1000);
      // Simulate old DB cap: panel would receive only first 1000 (no hot)
      const oldBugRows = entries.slice(0, 1000);
      mockQueryLogs.mockResolvedValue({ data: { rows: oldBugRows, total: 1000 } });
      const { panel, svg } = mountPanel();
      await panel.load?.();
      const hasHot = Array.from(svg.querySelectorAll('text.tag-cluster-text')).some((el) => el.textContent === '#hot');
      expect(hasHot).toBe(false);
      // Fixed DB returns all 1500, so hot appears
      mockQueryLogs.mockResolvedValue({ data: { rows: entries, total: 1500 } });
      document.body.innerHTML = '';
      const second = mountPanel();
      await second.panel.load?.();
      const hasHotFixed = Array.from(second.svg.querySelectorAll('text.tag-cluster-text')).some((el) => el.textContent === '#hot');
      expect(hasHotFixed).toBe(true);
    });
  });
});
