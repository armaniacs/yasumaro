// @vitest-environment jsdom
/**
 * similarityClusterPanel.test.ts
 * PBI 2026-10-22-03: cluster display wiring (non-destructive, cancellable).
 * Third-party review follow-up: the compared-set cap (CLUSTER_RECORDS_CAP) is
 * the fetch boundary, a truncated read shows the row-cap notice, the cluster
 * heading is i18n keyed (formatPlaybackHeading pattern), and a persistent
 * fetch failure shows the error state instead of a blank panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildClusterPanelModel,
  renderClusterPanel,
  formatClusterHeading,
  formatClusterCapNotice,
  createSimilarityClusterPanel,
} from '../similarityClusterPanel.js';
import type { SimilarityRecord } from '../similarityClusterAggregate.js';
import { CLUSTER_RECORDS_CAP } from '../../utils/computeLimits.js';

const mockFetchPeriodRows = vi.fn();

vi.mock('../panels/fetchPeriodRows.js', () => ({
  fetchPeriodRows: (...args: unknown[]) => mockFetchPeriodRows(...args),
}));

function makeRecord(overrides: Partial<SimilarityRecord> = {}): SimilarityRecord {
  return {
    id: 1,
    title: 'WASM embedding ships in Chrome 140',
    url: 'https://a.example/p1',
    domain: 'a.example',
    createdAt: 1000,
    ...overrides,
  };
}

describe('buildClusterPanelModel', () => {
  it('bundles same-news records with freshness and media', () => {
    const model = buildClusterPanelModel([
      makeRecord({ id: 1, domain: 'a.example', createdAt: 2000 }),
      makeRecord({ id: 2, title: 'Chrome 140 ships WASM embedding support', domain: 'b.example', createdAt: 1000 }),
      makeRecord({ id: 3, title: 'Curry recipe with potatoes', domain: 'c.example', createdAt: 3000 }),
    ]);
    expect(model.items).toHaveLength(1);
    expect(model.items[0]?.memberCount).toBe(2);
    expect(model.items[0]?.freshestAt).toBe(2000);
    expect(model.items[0]?.domains).toEqual(['b.example', 'a.example']);
  });

  it('explains the degenerate set instead of rendering one-row clusters', () => {
    const solo = buildClusterPanelModel([makeRecord({ title: 'Solo story' })]);
    expect(solo.items).toEqual([]);
    expect(solo.emptyReason).not.toBe('');
    // The stable reason kind is the factory's i18n seam (PBI 2026-09-24-12
    // parity contract): a titled degenerate set and a title-less one map to
    // different locale messages.
    expect(solo.emptyReasonKey).toBe('noSimilarGroups');
    const untitled = buildClusterPanelModel([makeRecord({ title: '   ' })]);
    expect(untitled.items).toEqual([]);
    expect(untitled.emptyReason).not.toBe('');
    expect(untitled.emptyReasonKey).toBe('noTitles');
  });

  it('carries no empty-reason kind when clusters are rendered', () => {
    const model = buildClusterPanelModel([
      makeRecord({ id: 1, domain: 'a.example', createdAt: 2000 }),
      makeRecord({ id: 2, title: 'Chrome 140 ships WASM embedding support', domain: 'b.example', createdAt: 1000 }),
    ]);
    expect(model.items).toHaveLength(1);
    expect(model.emptyReason).toBe('');
    expect(model.emptyReasonKey).toBeNull();
  });

  it('never mutates the input records', () => {
    const records = [
      makeRecord({ id: 1, createdAt: 2000 }),
      makeRecord({ id: 2, title: 'Chrome 140 ships WASM embedding support', createdAt: 1000 }),
    ];
    const snapshot = records.map((record) => ({ ...record }));
    buildClusterPanelModel(records);
    expect(records).toEqual(snapshot);
  });

  it('carries no cap notice when the pure builder builds the model', () => {
    const model = buildClusterPanelModel([makeRecord(), makeRecord({ title: 'Chrome 140 ships WASM embedding support' })]);
    // The fetch truncation report is composed by the factory, never guessed
    // by the pure builder.
    expect(model.capNotice).toBeNull();
  });
});

describe('formatClusterHeading + formatClusterCapNotice', () => {
  it('substitutes every known placeholder and keeps unknown ones verbatim', () => {
    expect(formatClusterHeading('{count} articles - {domains} - {date}', {
      count: 2,
      domains: 'a.example, b.example',
      date: '2026/10/22',
    })).toBe('2 articles - a.example, b.example - 2026/10/22');
    // A locale's typo cannot crash the render: unknown placeholders stay.
    expect(formatClusterHeading('{count} pages {unknown}', { count: 3, domains: '', date: '' }))
      .toBe('3 pages {unknown}');

    expect(formatClusterCapNotice('newest {shown} of {total} ({max} cap)', {
      shown: 200,
      total: 5000,
      max: 200,
    })).toBe('newest 200 of 5000 (200 cap)');
  });
});

describe('renderClusterPanel', () => {
  it('renders headings with links and clears on dismiss without touching records', () => {
    const records = [
      makeRecord({ id: 1, domain: 'a.example', createdAt: 2000 }),
      makeRecord({ id: 2, title: 'Chrome 140 ships WASM embedding support', domain: 'b.example', createdAt: 1000 }),
    ];
    const snapshot = records.map((record) => ({ ...record }));
    const list = document.createElement('div');
    const emptyState = document.createElement('div');
    const model = buildClusterPanelModel(records);
    renderClusterPanel({ list, emptyState }, model);
    expect(list.querySelectorAll('section')).toHaveLength(1);
    expect(list.querySelectorAll('a')).toHaveLength(2);
    expect(list.textContent ?? '').toContain('a.example');
    // Dismiss (取り消し): clearing the render drops only DOM nodes.
    renderClusterPanel({ list, emptyState }, { items: [], emptyReason: 'Dismissed.', emptyReasonKey: null, capNotice: null });
    expect(list.querySelectorAll('section')).toHaveLength(0);
    expect(emptyState.textContent).toBe('Dismissed.');
    expect(records).toEqual(snapshot);
  });

  it('shows the empty reason when the model is empty', () => {
    const list = document.createElement('div');
    const emptyState = document.createElement('div');
    renderClusterPanel({ list, emptyState }, { items: [], emptyReason: 'No similar groups yet.', emptyReasonKey: null, capNotice: null });
    expect(emptyState.hidden).toBe(false);
    expect(list.hidden).toBe(true);
  });

  it('renders non-http(s) URLs as inert text (no scriptable href)', () => {
    const records = [
      makeRecord({ id: 1, domain: 'a.example', createdAt: 2000 }),
      makeRecord({ id: 2, title: 'Chrome 140 ships WASM embedding support', domain: 'b.example', createdAt: 1000, url: 'javascript:alert(1)' }),
    ];
    const list = document.createElement('div');
    const emptyState = document.createElement('div');
    renderClusterPanel({ list, emptyState }, buildClusterPanelModel(records));
    expect(list.querySelectorAll('a')).toHaveLength(1);
    expect(list.querySelectorAll('a')[0]?.getAttribute('href')).toBe('https://a.example/p1');
    expect(list.textContent ?? '').toContain('Chrome 140 ships WASM embedding support');
  });

  it('renders the row-cap notice above the clusters when the read was truncated', () => {
    const records = [
      makeRecord({ id: 1, domain: 'a.example', createdAt: 2000 }),
      makeRecord({ id: 2, title: 'Chrome 140 ships WASM embedding support', domain: 'b.example', createdAt: 1000 }),
    ];
    const list = document.createElement('div');
    const emptyState = document.createElement('div');
    const model = { ...buildClusterPanelModel(records), capNotice: { shown: 200, total: 5000 } };
    renderClusterPanel({ list, emptyState }, model);
    const notice = list.querySelector('p');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toBe('The comparison covers the newest 200 of 5000 records (200-record limit).');
    // The clusters still render below the notice.
    expect(list.querySelectorAll('section')).toHaveLength(1);
  });

  it('renders no cap notice when the read came back complete', () => {
    const records = [makeRecord({ id: 1 }), makeRecord({ id: 2, title: 'Chrome 140 ships WASM embedding support' })];
    const list = document.createElement('div');
    const emptyState = document.createElement('div');
    renderClusterPanel({ list, emptyState }, buildClusterPanelModel(records));
    expect(list.querySelector('p')).toBeNull();
  });

  it('renders the heading from the injectable labels template', () => {
    const records = [
      makeRecord({ id: 1, domain: 'a.example', createdAt: 2000 }),
      makeRecord({ id: 2, title: 'Chrome 140 ships WASM embedding support', domain: 'b.example', createdAt: 1000 }),
    ];
    const list = document.createElement('div');
    const emptyState = document.createElement('div');
    renderClusterPanel(
      { list, emptyState },
      buildClusterPanelModel(records),
      { clusterHeading: '{count} 件の記事 ({domains})', rowCapNotice: '{shown}/{total}' },
    );
    expect(list.querySelector('h3')?.textContent).toBe('2 件の記事 (b.example, a.example)');
  });
});

describe('createSimilarityClusterPanel — factory', () => {
  function mountFactoryPanel() {
    const container = document.createElement('div');
    container.innerHTML = `
      <div id="similarityClusterEmptyState" hidden></div>
      <div id="similarityClusterList"></div>
    `;
    document.body.appendChild(container);
    const panel = createSimilarityClusterPanel();
    panel.mount(container);
    return { panel, container };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    mockFetchPeriodRows.mockReset();
    // Mirrors production semantics (message || fallback): a missing locale key
    // rides the panel's English fallbacks.
    (globalThis as unknown as { chrome: unknown }).chrome = {
      i18n: { getMessage: vi.fn(() => '') },
    };
  });

  it('fetches at most CLUSTER_RECORDS_CAP rows and shows the capped notice', async () => {
    const rows = Array.from({ length: CLUSTER_RECORDS_CAP }, (_, i) => ({
      id: i + 1,
      title: i < 2 ? 'Shared headline text' : `Solo story ${i}`,
      url: 'https://a.example/p',
      domain: 'a.example',
      created_at: i,
    }));
    mockFetchPeriodRows.mockResolvedValue({ rows, total: CLUSTER_RECORDS_CAP + 7, capped: true });
    const { panel, container } = mountFactoryPanel();
    await panel.load?.();

    // Boundary control: the compared set is the capped read, nothing more.
    expect(mockFetchPeriodRows).toHaveBeenCalledWith({ limit: CLUSTER_RECORDS_CAP, label: 'similarityCluster' });
    const notice = container.querySelector<HTMLElement>('#similarityClusterList p');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toBe(`The comparison covers the newest ${CLUSTER_RECORDS_CAP} of ${CLUSTER_RECORDS_CAP + 7} records (${CLUSTER_RECORDS_CAP}-record limit).`);
  });

  it('shows the error state when the fetch fails persistently (no blank panel)', async () => {
    mockFetchPeriodRows.mockRejectedValue(new Error('similarityCluster: query failed after retries'));
    const { panel, container } = mountFactoryPanel();
    await panel.load?.();

    const empty = container.querySelector<HTMLElement>('#similarityClusterEmptyState');
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toBe('Failed to load similar stories. Try again.');
    expect(empty?.getAttribute('data-i18n')).toBe('similarityClusterError');
    expect(container.querySelector<HTMLElement>('#similarityClusterList')?.hidden).toBe(true);
  });
});
