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

  it('sets a viewBox attribute sized to the dynamic canvas size after rendering', async () => {
    vi.spyOn(dashboardSqliteService, 'getSqliteStatus').mockResolvedValue({
      initialized: true, path: '', fallback: false, fts5: true,
    } as never);
    vi.spyOn(dashboardSqliteService, 'queryLogs').mockResolvedValue({
      rows: [{ id: 1, tags: '#tech #ai' } as never],
      total: 1,
    });

    await initTagClusterPanel();

    const svg = document.getElementById('tagClusterSvg')!;
    const viewBox = svg.getAttribute('viewBox');
    expect(viewBox).toBe('0 0 800 600'); // base canvas size for a small node count
  });

  it('does not throw and cleans up the previous controller when called twice in a row', async () => {
    vi.spyOn(dashboardSqliteService, 'getSqliteStatus').mockResolvedValue({
      initialized: true, path: '', fallback: false, fts5: true,
    } as never);
    vi.spyOn(dashboardSqliteService, 'queryLogs').mockResolvedValue({
      rows: [{ id: 1, tags: '#tech' } as never],
      total: 1,
    });

    await initTagClusterPanel();
    await expect(initTagClusterPanel()).resolves.not.toThrow();

    const svg = document.getElementById('tagClusterSvg')!;
    expect(svg.querySelectorAll('circle').length).toBe(1);
  });

  it('does not fire navigate-to-tag when the click follows a drag beyond the threshold', async () => {
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

    const svg = document.getElementById('tagClusterSvg')!;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, toJSON: () => ({}),
    } as DOMRect);

    svg.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 50, clientY: 50, bubbles: true }));

    const circle = document.querySelector('circle') as SVGCircleElement;
    circle.dispatchEvent(new Event('click', { bubbles: true }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('still fires navigate-to-tag on a plain click with no preceding drag', async () => {
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
  });
});
