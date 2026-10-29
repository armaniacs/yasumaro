/**
 * sessionTimelinePlaybackPanel.test.ts
 * PBI 2026-10-22-04 O1 ― the catalog factory: fetch through the shared read
 * seam, labels from i18n with the pure module's English fallbacks, and the
 * open-record hook reaching the history panel (the registry owner's route).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../fetchPeriodRows.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../fetchPeriodRows.js')>();
  return {
    ...actual,
    fetchPeriodRows: vi.fn(actual.fetchPeriodRows),
  };
});

import { createSessionTimelinePanel } from '../sessionTimelinePlaybackPanel.js';
import { fetchPeriodRows } from '../../fetchPeriodRows.js';
import { setRegistry } from '../../registryContext.js';
import type { BrowsingLogEntry } from '../../../../utils/sqlite-types.js';

const mockFetchPeriodRows = vi.mocked(fetchPeriodRows);

function makeRow(overrides: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return {
    id: 1,
    url: 'https://example.com/p1',
    title: 'Page 1',
    created_at: 1000,
    domain: 'example.com',
    search_query: 'wasm',
    ...overrides,
  };
}

function makeRegistry() {
  const navigations: Array<{ panelId: string; init?: Record<string, unknown> }> = [];
  const registry = {
    navigate: vi.fn(async (panelId: string, init?: Record<string, unknown>) => {
      navigations.push({ panelId, init });
    }),
    navigateTyped: vi.fn(async (panelId: string, init?: Record<string, unknown>) => {
      navigations.push({ panelId, init });
    }),
  };
  setRegistry(registry as never);
  return { registry, navigations };
}

describe('createSessionTimelinePanel', () => {
  beforeEach(() => {
    mockFetchPeriodRows.mockReset();
  });

  afterEach(() => {
    setRegistry(null);
  });

  it('renders the fetched rows through the playback model with fallback labels', async () => {
    mockFetchPeriodRows.mockResolvedValue({
      rows: [
        makeRow({ id: 1, created_at: 1000, search_query: 'wasm' }),
        makeRow({ id: 2, created_at: 2000, search_query: 'wasm' }),
      ],
      total: 2,
      capped: false,
    });
    const container = document.createElement('div');
    const list = document.createElement('div');
    list.id = 'sessionPlaybackList';
    container.appendChild(list);

    const panel = createSessionTimelinePanel();
    panel.mount(container);
    await panel.load();

    expect(mockFetchPeriodRows).toHaveBeenCalledWith({ limit: expect.any(Number), label: 'sessionTimeline' });
    const headings = [...list.querySelectorAll('.session-playback-heading')];
    expect(headings).toHaveLength(1);
    // jsdom has no chrome.i18n: the labels degrade to the English fallbacks
    // (the pure module's DEFAULT_LABELS) — the same strings the i18n keys
    // carry.
    expect(headings[0]?.textContent).toBe('Session 1 (search query, 2 pages)');
    expect(list.querySelectorAll('.session-playback-open-record')).toHaveLength(2);
  });

  it('routes the open-record button to the history panel filtered by domain', async () => {
    mockFetchPeriodRows.mockResolvedValue({
      rows: [
        makeRow({ id: 1, created_at: 1000, search_query: 'wasm', domain: 'example.com' }),
        makeRow({ id: 2, created_at: 2000, search_query: 'wasm', domain: 'docs.example.com' }),
      ],
      total: 2,
      capped: false,
    });
    const container = document.createElement('div');
    const list = document.createElement('div');
    list.id = 'sessionPlaybackList';
    container.appendChild(list);
    const { navigations } = makeRegistry();

    const panel = createSessionTimelinePanel();
    panel.mount(container);
    await panel.load();

    const buttons = [...list.querySelectorAll<HTMLButtonElement>('.session-playback-open-record')];
    expect(buttons).toHaveLength(2);
    buttons[1]?.click();
    await Promise.resolve();
    expect(navigations).toEqual([{ panelId: 'panel-sqlite-history', init: { searchDomain: 'docs.example.com' } }]);
  });

  it('navigates plain when the record carries no domain', async () => {
    mockFetchPeriodRows.mockResolvedValue({
      rows: [
        makeRow({ id: 1, created_at: 1000, search_query: 'wasm', domain: null }),
        makeRow({ id: 2, created_at: 2000, search_query: 'wasm', domain: null }),
      ],
      total: 2,
      capped: false,
    });
    const container = document.createElement('div');
    const list = document.createElement('div');
    list.id = 'sessionPlaybackList';
    container.appendChild(list);
    const { navigations } = makeRegistry();

    const panel = createSessionTimelinePanel();
    panel.mount(container);
    await panel.load();

    const button = list.querySelector<HTMLButtonElement>('.session-playback-open-record');
    expect(button).not.toBeNull();
    button?.click();
    await Promise.resolve();
    expect(navigations).toEqual([{ panelId: 'panel-sqlite-history', init: undefined }]);
  });

  it('renders the empty reason and never crashes on an empty fetch', async () => {
    mockFetchPeriodRows.mockResolvedValue({ rows: [], total: 0, capped: false });
    const container = document.createElement('div');
    const list = document.createElement('div');
    list.id = 'sessionPlaybackList';
    container.appendChild(list);

    const panel = createSessionTimelinePanel();
    panel.mount(container);
    await panel.load();

    expect(list.querySelector('.session-playback-empty')?.textContent).toBe(
      'No sessions yet. Visit pages from one search or one link to build a trail.',
    );
  });
});
