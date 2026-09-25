// @vitest-environment jsdom
/**
 * PanelNotices unit tests: named registration, show/hide/hideAll
 * idempotency, the empty/error surface swap on one element, reset()
 * restoring the normal binding, and the fetch-scoped re-aggregation rule.
 *
 * Like the panel lifecycle tests, assertions use real en/_locales keys —
 * the chrome.i18n test mock resolves unknown keys to the key string.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PanelNotices } from '../PanelNotices.js';

function el(id: string, text = ''): HTMLElement {
  const element = document.createElement('div');
  element.id = id;
  element.textContent = text;
  document.body.appendChild(element);
  return element;
}

describe('PanelNotices', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('show/hide/hideAll are idempotent', () => {
    const empty = el('n-empty');
    const cap = el('n-cap');
    const notices = new PanelNotices();
    notices.register('empty', empty);
    notices.register('cap', cap);

    notices.show('empty');
    notices.show('empty');
    expect(empty.hidden).toBe(false);

    notices.hide('empty');
    notices.hide('empty');
    expect(empty.hidden).toBe(true);

    notices.show('cap');
    notices.hideAll();
    notices.hideAll();
    expect(empty.hidden).toBe(true);
    expect(cap.hidden).toBe(true);
  });

  it('register with a null element is a no-op and never throws', () => {
    const notices = new PanelNotices();
    expect(() => notices.register('empty', null)).not.toThrow();
    expect(() => notices.show('empty')).not.toThrow();
    expect(() => notices.hide('empty')).not.toThrow();
    expect(() => notices.hideAll()).not.toThrow();
    expect(() => notices.showEmpty()).not.toThrow();
    expect(() => notices.showError('wordClusterError', 'fallback')).not.toThrow();
    expect(() => notices.reset()).not.toThrow();
    expect(() => notices.resetForReaggregate()).not.toThrow();
  });

  it('showEmpty applies the registered normal binding and shows the element', () => {
    const empty = el('n-empty', 'initial');
    empty.setAttribute('data-i18n', 'staleKey');
    const notices = new PanelNotices();
    notices.register('empty', empty, {
      i18nKey: 'cooccurrenceTableNoRecords',
      fallbackText: 'No records in the selected period. Try a wider range.',
    });

    notices.showEmpty();

    expect(empty.hidden).toBe(false);
    expect(empty.getAttribute('data-i18n')).toBe('cooccurrenceTableNoRecords');
    expect(empty.textContent).toBe('No records in the selected period. Try a wider range.');
  });

  it('showEmpty accepts an explicit key override for wording variants', () => {
    const empty = el('n-empty');
    const notices = new PanelNotices();
    notices.register('empty', empty, { i18nKey: 'cooccurrenceTableNoRecords', fallbackText: 'no records' });

    notices.showEmpty('cooccurrenceTableEmpty', 'no pairs');

    expect(empty.getAttribute('data-i18n')).toBe('cooccurrenceTableEmpty');
    expect(empty.textContent).toBe('No co-occurring tag pairs — every record has a single tag.');
    expect(empty.hidden).toBe(false);
  });

  it('showError swaps the same element to the error wording and shows it', () => {
    const empty = el('n-empty');
    empty.hidden = true;
    const notices = new PanelNotices();
    notices.register('empty', empty, { i18nKey: 'wordClusterEmpty', fallbackText: 'normal text' });

    notices.showError('wordClusterError', 'Failed to load the word cluster. Try again.');

    expect(empty.hidden).toBe(false);
    expect(empty.getAttribute('data-i18n')).toBe('wordClusterError');
    expect(empty.textContent).toBe('Failed to load the word cluster. Try again.');
  });

  it('reset() restores the normal binding and hides everything', () => {
    const empty = el('n-empty');
    const cap = el('n-cap');
    const other = el('n-other');
    const notices = new PanelNotices();
    notices.register('empty', empty, { i18nKey: 'dashboardTimeHeatmapEmpty', fallbackText: 'empty' });
    notices.register('cap', cap, { fetchScoped: true });
    notices.register('other', other);

    notices.showError('dashboardTimeHeatmapError', 'error text');
    notices.show('cap');
    notices.show('other');
    notices.reset();

    expect(empty.hidden).toBe(true);
    expect(empty.getAttribute('data-i18n')).toBe('dashboardTimeHeatmapEmpty');
    expect(empty.textContent).toBe('No browsing records in the selected period.');
    expect(cap.hidden).toBe(true);
    expect(other.hidden).toBe(true);
  });

  it('reset() is idempotent (safe to call twice)', () => {
    const empty = el('n-empty', 'seed');
    const notices = new PanelNotices();
    notices.register('empty', empty, { i18nKey: 'domainAnalysis_empty', fallbackText: 'empty fallback' });

    notices.reset();
    notices.reset();

    expect(empty.getAttribute('data-i18n')).toBe('domainAnalysis_empty');
    expect(empty.textContent).toBe('No browsing records match the selected period and tag.');
    expect(empty.hidden).toBe(true);
  });

  it('resetForReaggregate() keeps fetch-scoped notices and hides the rest', () => {
    const empty = el('n-empty');
    const cap = el('n-cap');
    const tagsTruncated = el('n-tags');
    const topTruncated = el('n-top');
    const notices = new PanelNotices();
    notices.register('empty', empty, { i18nKey: 'dashboardTagTimelineEmpty', fallbackText: 'empty' });
    notices.register('cap', cap, { fetchScoped: true });
    notices.register('tagsTruncated', tagsTruncated, { fetchScoped: true });
    notices.register('topTruncated', topTruncated);

    notices.show('cap');
    notices.show('tagsTruncated');
    notices.showError('dashboardTagTimelineError', 'error text');
    notices.resetForReaggregate();

    // Fetch-scoped notices describe the fetch and survive re-aggregation.
    expect(cap.hidden).toBe(false);
    expect(tagsTruncated.hidden).toBe(false);
    // Render-scoped surfaces are hidden, and the empty element is restored
    // to its normal binding (not the error wording).
    expect(topTruncated.hidden).toBe(true);
    expect(empty.hidden).toBe(true);
    expect(empty.getAttribute('data-i18n')).toBe('dashboardTagTimelineEmpty');
    expect(empty.textContent).toBe('No tagged records in this period.');
  });

  it('setEmptyMessage syncs the binding without changing visibility', () => {
    const empty = el('n-empty');
    empty.hidden = true;
    const notices = new PanelNotices();
    notices.register('empty', empty, { i18nKey: 'tagClusterEmptyState', fallbackText: 'generic' });

    notices.setEmptyMessage('tagCluster_empty_period', 'No records in the selected period.');

    expect(empty.hidden).toBe(true);
    expect(empty.getAttribute('data-i18n')).toBe('tagCluster_empty_period');
    expect(empty.textContent).toBe('No records in the selected period. Try a wider range.');
  });

  it('re-registering a name replaces the entry (mount is idempotent)', () => {
    const first = el('n-first');
    const second = el('n-second');
    first.hidden = true;
    second.hidden = true;
    const notices = new PanelNotices();
    notices.register('empty', first, { i18nKey: 'cooccurrenceTableNoRecords', fallbackText: 'first' });
    notices.register('empty', second, { i18nKey: 'cooccurrenceTableEmpty', fallbackText: 'second' });

    notices.showEmpty();

    expect(first.hidden).toBe(true);
    expect(second.hidden).toBe(false);
    expect(second.getAttribute('data-i18n')).toBe('cooccurrenceTableEmpty');
  });

  it('clear() drops every registration so later calls are no-ops', () => {
    const empty = el('n-empty');
    const notices = new PanelNotices();
    notices.register('empty', empty, { i18nKey: 'wordClusterEmpty', fallbackText: 'text' });
    notices.hide('empty');

    notices.clear();
    notices.showEmpty();
    notices.showError('wordClusterError', 'fallback');
    notices.reset();

    expect(empty.hidden).toBe(true);
    expect(empty.getAttribute('data-i18n')).toBeNull();
    expect(empty.textContent).toBe('');
  });
});
