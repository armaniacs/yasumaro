// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-generation.test.ts
 * Race-guard regression tests for the SQLite history panel's
 * requestGeneration counter (sqliteHistoryPanel.ts fetchData).
 *
 * Every fetchData call bumps requestGeneration and only the latest generation
 * is allowed to commit its result. This prevents a slow stale response from
 * overwriting a newer one, and guarantees loading always ends false.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: vi.fn(),
  searchLogs: vi.fn(),
  toggleStar: vi.fn(),
  deleteLog: vi.fn(),
  getSqliteStatus: vi.fn().mockResolvedValue({ initialized: true, fallback: false }),
  appendToLogs: vi.fn(),
  isServiceError: (result: object) => 'error' in result,
}));

vi.mock('../../../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn(),
}));

import { createSqliteHistoryPanel } from '../sqliteHistoryPanel.js';
import * as db from '../../../dashboardSqliteService.js';
import type { PanelLifecycle } from '../../types.js';

const mockedDb = db as unknown as {
  queryLogs: ReturnType<typeof vi.fn>;
  searchLogs: ReturnType<typeof vi.fn>;
};

/** Tag that matches the fixture rows so no full-text fallback interferes. */
const TAG = 'AI';

function makeRow(id: number, tags = TAG): object {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Example ${id}`,
    tags,
    created_at: 1700000000000 + id,
  };
}

function makePanel(container: HTMLElement): PanelLifecycle {
  const panel = createSqliteHistoryPanel();
  panel.mount(container);
  return panel;
}

async function settle(): Promise<void> {
  // Allow every promise chain in queryHistory → fetchData → refresh to run.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
  await new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  mockedDb.queryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
  mockedDb.searchLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createSqliteHistoryPanel — requestGeneration race guard', () => {
  it('shows the loading spinner while a request is pending', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    // One navigation issues two fetches (immediate tag fetch + retry fetch);
    // both stay pending so the spinner is observable.
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const first = new Promise(resolve => { resolveFirst = resolve; });
    const second = new Promise(resolve => { resolveSecond = resolve; });
    mockedDb.queryLogs
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);

    panel.init?.({ searchTag: TAG });
    const loadPromise = panel.load?.();
    await settle();

    expect(container.querySelector('.loading')).not.toBeNull();

    resolveFirst({ data: { rows: [makeRow(1)], total: 1 } });
    resolveSecond({ data: { rows: [makeRow(1)], total: 1 } });
    await loadPromise;
    await settle();

    expect(container.querySelector('.loading')).toBeNull();
    expect(document.body.textContent ?? '').toContain('Example 1');
  });

  it('ignores a stale response that resolves after a newer one', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    let resolveStale!: (value: unknown) => void;
    let resolveNewer!: (value: unknown) => void;
    let resolveRetryStale!: (value: unknown) => void;
    let resolveRetryNewer!: (value: unknown) => void;
    const stale = new Promise(resolve => { resolveStale = resolve; });
    const newer = new Promise(resolve => { resolveNewer = resolve; });
    const retryStale = new Promise(resolve => { resolveRetryStale = resolve; });
    const retryNewer = new Promise(resolve => { resolveRetryNewer = resolve; });

    mockedDb.queryLogs
      .mockImplementationOnce(() => stale)
      .mockImplementationOnce(() => newer)
      .mockImplementationOnce(() => retryStale)
      .mockImplementationOnce(() => retryNewer);

    // Two overlapping tag navigations: the second bumps requestGeneration.
    panel.init?.({ searchTag: TAG });
    const firstLoad = panel.load?.();
    panel.init?.({ searchTag: TAG });
    const secondLoad = panel.load?.();
    await settle();

    // The newest request (second navigation's retry fetch) resolves first…
    resolveRetryNewer({ data: { rows: [makeRow(2)], total: 1 } });
    await secondLoad;
    await settle();

    // …then every older generation resolves late and must be discarded.
    resolveStale({ data: { rows: [makeRow(1)], total: 1 } });
    resolveNewer({ data: { rows: [makeRow(1)], total: 1 } });
    resolveRetryStale({ data: { rows: [makeRow(1)], total: 1 } });
    await firstLoad;
    await settle();

    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('Example 2');
    expect(rendered).not.toContain('Example 1');
    // The stale generation's finally block is skipped, but the newest one
    // already cleared loading: the spinner must never stay visible.
    expect(container.querySelector('.loading')).toBeNull();
  });

  it('keeps the newest response when a stale one fails after a success', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    let resolveStale!: (value: unknown) => void;
    let resolveNewer!: (value: unknown) => void;
    const stale = new Promise(resolve => { resolveStale = resolve; });
    const newer = new Promise(resolve => { resolveNewer = resolve; });

    let resolveRetryStale!: (value: unknown) => void;
    let resolveRetryNewer!: (value: unknown) => void;
    const retryStale = new Promise(resolve => { resolveRetryStale = resolve; });
    const retryNewer = new Promise(resolve => { resolveRetryNewer = resolve; });

    mockedDb.queryLogs
      .mockImplementationOnce(() => stale)
      .mockImplementationOnce(() => newer)
      .mockImplementationOnce(() => retryStale)
      .mockImplementationOnce(() => retryNewer);

    panel.init?.({ searchTag: TAG });
    const firstLoad = panel.load?.();
    panel.init?.({ searchTag: TAG });
    const secondLoad = panel.load?.();
    await settle();

    resolveNewer({ data: { rows: [makeRow(2)], total: 1 } });
    resolveRetryNewer({ data: { rows: [makeRow(2)], total: 1 } });
    await secondLoad;
    await settle();

    // The stale request errors out late; it must not turn the panel into an
    // error state or clear the newer rows.
    resolveStale({ error: 'stale network failure' });
    resolveRetryStale({ error: 'stale network failure' });
    await firstLoad;
    await settle();

    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('Example 2');
    expect(container.querySelector('.loading')).toBeNull();
  });
});
