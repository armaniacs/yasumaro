/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTagClusterPanel } from '../tagClusterPanel.js';
import * as dashboardSqliteService from '../dashboardSqliteService.js';

vi.mock('../dashboardSqliteService.js');

describe('tagClusterPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <svg id="tagClusterSvg" width="400" height="300"></svg>
      <div id="tagClusterEmptyState" hidden></div>
      <div id="tagClusterTruncatedNotice" hidden></div>
    `;
  });

  it('renders nodes as SVG circles when tagged entries exist', async () => {
    vi.spyOn(dashboardSqliteService, 'getSqliteStatus').mockResolvedValue({
      initialized: true, path: '', fallback: false, fts5: true,
    } as never);
    vi.spyOn(dashboardSqliteService, 'queryLogs').mockResolvedValue({
      rows: [{ id: 1, tags: '#tech #ai' } as never],
      total: 1,
    });

    await initTagClusterPanel();

    const svg = document.getElementById('tagClusterSvg')!;
    const circles = svg.querySelectorAll('circle');
    expect(circles.length).toBe(2);
  });

  it('shows empty state and does not throw when no tags exist', async () => {
    vi.spyOn(dashboardSqliteService, 'getSqliteStatus').mockResolvedValue({
      initialized: true, path: '', fallback: false, fts5: true,
    } as never);
    vi.spyOn(dashboardSqliteService, 'queryLogs').mockResolvedValue({ rows: [], total: 0 });

    await expect(initTagClusterPanel()).resolves.not.toThrow();

    const emptyState = document.getElementById('tagClusterEmptyState') as HTMLElement;
    expect(emptyState.hidden).toBe(false);
  });

  it('dispatches navigate-to-tag when a node is clicked', async () => {
    vi.spyOn(dashboardSqliteService, 'getSqliteStatus').mockResolvedValue({
      initialized: true, path: '', fallback: false, fts5: true,
    } as never);
    vi.spyOn(dashboardSqliteService, 'queryLogs').mockResolvedValue({
      rows: [{ id: 1, tags: '#tech' } as never],
      total: 1,
    });

    const handler = vi.fn();
    document.addEventListener('navigate-to-tag', handler);

    await initTagClusterPanel();

    const circle = document.querySelector('circle') as SVGCircleElement;
    circle.dispatchEvent(new Event('click', { bubbles: true }));

    expect(handler).toHaveBeenCalled();
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toBe('tech');
  });

  it('retries when SQLite is not yet initialized, then succeeds', async () => {
    const statusSpy = vi.spyOn(dashboardSqliteService, 'getSqliteStatus')
      .mockResolvedValueOnce({ initialized: false, path: '', fallback: false, fts5: true } as never)
      .mockResolvedValue({ initialized: true, path: '', fallback: false, fts5: true } as never);
    vi.spyOn(dashboardSqliteService, 'queryLogs').mockResolvedValue({
      rows: [{ id: 1, tags: '#tech' } as never],
      total: 1,
    });

    await initTagClusterPanel();

    expect(statusSpy).toHaveBeenCalledTimes(2);
    const svg = document.getElementById('tagClusterSvg')!;
    expect(svg.querySelectorAll('circle').length).toBe(1);
  }, 15000);
});
