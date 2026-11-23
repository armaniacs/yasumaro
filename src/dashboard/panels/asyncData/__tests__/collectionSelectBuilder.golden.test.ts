// @vitest-environment wasm-quickjs-dom
/**
 * collectionSelectBuilder.golden.test.ts (PBI 2026-11-11-04)
 * Golden: 3箇所の collection/sort select 描画が共通ビルダー委譲の前後で
 * 不変であることを pin する。先に現行 View の出力を固定し、委譲後に
 * 同じ期待値で検証する (描画内容不変)。
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  ASK_HISTORY_REGION_ID,
  createAskHistoryActions,
  renderAskHistoryRegion,
} from '../askHistoryPanelView.js';
import {
  createResearchReportPanelActions,
  renderResearchReportPanelRegion,
} from '../researchReportPanelView.js';
import { buildSortControlHtml } from '../sqliteHistoryChromeWiring.js';
import {
  buildCollectionOptionsHtml,
  buildSelectHtml,
  buildSelectOptionsHtml,
} from '../collectionSelectBuilder.js';
import type { SavedCollection } from '../../../../utils/storage/savedCollections.js';

function collection(id: string, name: string, updatedAt: number): SavedCollection {
  return { id, name, query: {}, createdAt: updatedAt, updatedAt };
}

const COLLECTIONS = {
  c1: collection('c1', 'Rust notes', 2),
  c2: collection('c2', 'Wasm lab', 1),
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('collection select golden (pre/post refactor invariant)', () => {
  it('ask-history target select HTML is pinned', () => {
    const container = document.createElement('div');
    container.innerHTML = `<div id="${ASK_HISTORY_REGION_ID}"></div>`;
    document.body.appendChild(container);
    renderAskHistoryRegion(container, COLLECTIONS, createAskHistoryActions((error) => error));

    expect(container.querySelector('select')?.outerHTML).toBe(
      '<select class="ask-history-target" aria-label="Target collection">' +
        '<option value="">All records</option>' +
        '<option value="c1">Rust notes</option>' +
        '<option value="c2">Wasm lab</option></select>',
    );
  });

  it('research-report target select HTML is pinned', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div id="research-report-panel-region"></div>';
    document.body.appendChild(container);
    renderResearchReportPanelRegion(
      container,
      COLLECTIONS,
      createResearchReportPanelActions(() => ({})),
      'research-report-panel-region',
    );

    expect(container.querySelector('select')?.outerHTML).toBe(
      '<select class="research-report-target" aria-label="Target collection">' +
        '<option value="">All records</option>' +
        '<option value="c1">Rust notes</option>' +
        '<option value="c2">Wasm lab</option></select>',
    );
  });

  it('sort control HTML is pinned (no search: newest selected, no relevance)', () => {
    expect(buildSortControlHtml('created_at', 'DESC', false)).toBe(
      '\n    <label class="sqlite-sort-label" for="sqlite-sort-select">Sort</label>\n' +
        '    <select id="sqlite-sort-select" aria-label="Sort">\n' +
        '      <option value="created_at:DESC" selected>Newest first</option>' +
        '<option value="created_at:ASC">Oldest first</option>\n' +
        '    </select>\n  ',
    );
  });

  it('sort control HTML is pinned (active search: relevance selected)', () => {
    expect(buildSortControlHtml('relevance', 'DESC', true)).toBe(
      '\n    <label class="sqlite-sort-label" for="sqlite-sort-select">Sort</label>\n' +
        '    <select id="sqlite-sort-select" aria-label="Sort">\n' +
        '      <option value="created_at:DESC">Newest first</option>' +
        '<option value="created_at:ASC">Oldest first</option>' +
        '<option value="relevance:DESC" selected>Relevance</option>\n' +
        '    </select>\n  ',
    );
  });
});

describe('collectionSelectBuilder unit (escape + selected)', () => {
  it('sorts newest-first and escapes every value/label through escapeHtml', () => {
    const html = buildCollectionOptionsHtml(
      {
        old: collection('c-old', 'Old', 1),
        xss: {
          id: 'x"><script>alert(1)</script>',
          name: 'A&B<C>"\'/end',
          query: {},
          createdAt: 3,
          updatedAt: 3,
        },
        fresh: collection('c-new', 'New', 2),
      },
      'All & records',
    );
    expect(html).toBe(
      '<option value="">All &amp; records</option>' +
        '<option value="x&quot;&gt;&lt;script&gt;alert(1)&lt;&#x2F;script&gt;">' +
        'A&amp;B&lt;C&gt;&quot;&#039;&#x2F;end</option>' +
        '<option value="c-new">New</option>' +
        '<option value="c-old">Old</option>',
    );
  });

  it('renders only the all-records option for empty collections', () => {
    expect(buildCollectionOptionsHtml({}, 'All records')).toBe('<option value="">All records</option>');
  });

  it('creates no executable markup when the options are mounted (XSS)', () => {
    const html = buildCollectionOptionsHtml(
      { x: { id: '"><script>alert(1)</script>', name: '<img src=x onerror=alert(1)>', query: {}, createdAt: 1, updatedAt: 1 } },
      'All',
    );
    const host = document.createElement('div');
    host.innerHTML = buildSelectHtml(html, { cssClass: 'ask-history-target', ariaLabel: 't' });
    document.body.appendChild(host);
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
    const option = host.querySelectorAll('option')[1] as HTMLOptionElement;
    expect(option.value).toBe('"><script>alert(1)</script>');
    expect(option.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('marks only the flagged option as selected', () => {
    expect(
      buildSelectOptionsHtml([
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', selected: true },
        { value: 'c', label: 'C', selected: false },
      ]),
    ).toBe('<option value="a">A</option><option value="b" selected>B</option><option value="c">C</option>');
  });

  it('wraps options in a select with escaped attributes', () => {
    expect(buildSelectHtml('<option value="">All</option>', { cssClass: 'c', id: 'i', ariaLabel: 'a"b' })).toBe(
      '<select class="c" id="i" aria-label="a&quot;b"><option value="">All</option></select>',
    );
    expect(buildSelectHtml('<option value="">All</option>')).toBe('<select><option value="">All</option></select>');
  });
});
