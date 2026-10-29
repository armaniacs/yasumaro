// @vitest-environment jsdom
/**
 * similarityClusterPanel.test.ts
 * PBI 2026-10-22-03: cluster display wiring (non-destructive, cancellable).
 */
import { describe, it, expect } from 'vitest';
import {
  buildClusterPanelModel,
  renderClusterPanel,
} from '../similarityClusterPanel.js';
import type { SimilarityRecord } from '../similarityClusterAggregate.js';

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
    renderClusterPanel({ list, emptyState }, { items: [], emptyReason: 'Dismissed.', emptyReasonKey: null });
    expect(list.querySelectorAll('section')).toHaveLength(0);
    expect(emptyState.textContent).toBe('Dismissed.');
    expect(records).toEqual(snapshot);
  });

  it('shows the empty reason when the model is empty', () => {
    const list = document.createElement('div');
    const emptyState = document.createElement('div');
    renderClusterPanel({ list, emptyState }, { items: [], emptyReason: 'No similar groups yet.', emptyReasonKey: null });
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
});
