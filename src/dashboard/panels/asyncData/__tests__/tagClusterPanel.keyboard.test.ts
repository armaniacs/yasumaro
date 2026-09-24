// @vitest-environment jsdom
/**
 * Keyboard/AT access for the tag-cluster graph (ux-frontend High).
 * Rendered nodes must be focusable, operable by keyboard, and named;
 * the SVG itself must expose role + label like wordClusterSvg does.
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

import { createTagClusterPanel } from '../tagClusterPanel.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function mountPanel() {
  const container = document.createElement('div');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.id = 'tagClusterSvg';
  container.appendChild(svg);
  const emptyState = document.createElement('div');
  emptyState.id = 'tagClusterEmptyState';
  emptyState.hidden = true;
  container.appendChild(emptyState);
  const truncated = document.createElement('div');
  truncated.id = 'tagClusterTruncatedNotice';
  container.appendChild(truncated);
  document.body.appendChild(container);
  const panel = createTagClusterPanel();
  panel.mount(container);
  return { panel, svg };
}

describe('tagClusterPanel keyboard access', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockTryNavigateTyped.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
    mockQueryLogs.mockResolvedValue({
      data: { rows: [{ tags: '#ai #other' }, { tags: '#ai' }], total: 2 },
    });
    mockTryNavigateTyped.mockImplementation((_id: unknown, _args: unknown, fallback: () => void) => fallback());
  });

  it('renders focusable, named nodes operable by keyboard', async () => {
    const { panel, svg } = mountPanel();
    await panel.load?.();
    const circles = Array.from(svg.querySelectorAll('circle.tag-cluster-node'));
    expect(circles.length).toBeGreaterThan(0);
    for (const circle of circles) {
      expect(circle.getAttribute('tabindex')).toBe('0');
      expect(circle.getAttribute('role')).toBe('button');
      expect(circle.getAttribute('aria-label')).toContain('#');
    }
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toContain('#');
  });

  it('Enter on a node navigates to history (fallback event)', async () => {
    const { panel, svg } = mountPanel();
    const seen: unknown[] = [];
    document.addEventListener('navigate-to-tag', (e) => seen.push((e as CustomEvent).detail));
    await panel.load?.();
    const first = svg.querySelector('circle.tag-cluster-node');
    expect(first).not.toBeNull();
    first!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(seen.length).toBeGreaterThan(0);
  });
});
