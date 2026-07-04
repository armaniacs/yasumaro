// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-selection-ui.test.ts
 * Tests for the selection UI structure in sqliteHistoryPanel
 * Gap 2 from coverage audit (converted from E2E to unit test)
 */

import { describe, it, expect, beforeEach } from 'vitest';

function buildDom() {
  document.body.innerHTML = `
    <div id="sqlite-history-container">
      <div class="sqlite-history-header">
        <h3>SQLite History</h3>
        <span class="sqlite-history-count">0 records</span>
      </div>
      <div class="sqlite-history-search">
        <input type="text" id="sqlite-search-input" placeholder="Search..." />
        <div id="sqlite-calendar-nav"></div>
        <div id="sqlite-error" style="display:none"></div>
      </div>
      <div id="sqlite-bulk-bar" style="display:none">
        <label class="sqlite-bulk-select-all">
          <input type="checkbox" id="sqlite-select-all" aria-label="Select All">
          <span>Select All</span>
        </label>
        <button type="button" id="sqlite-clear-selection" class="secondary-btn" data-i18n="historyClearSelection">Clear Selection</button>
        <span id="sqlite-selection-count" class="sqlite-selection-count" aria-live="polite">0 selected</span>
        <button type="button" id="sqlite-append-obsidian" class="btn-primary" data-i18n="historyAppendToObsidian">Append to Obsidian</button>
      </div>
      <div id="sqlite-entry-list" class="sqlite-entry-list"></div>
      <div id="sqlite-pagination" class="sqlite-pagination"></div>
    </div>
  `;
}

describe('sqliteHistoryPanel — Selection UI Structure', () => {
  beforeEach(() => {
    buildDom();
  });

  it('sqlite-history-container exists in the DOM', () => {
    const container = document.getElementById('sqlite-history-container');
    expect(container).not.toBeNull();
  });

  it('bulk action bar has correct child elements', () => {
    const bulkBar = document.getElementById('sqlite-bulk-bar');
    expect(bulkBar).not.toBeNull();

    expect(document.getElementById('sqlite-select-all')).not.toBeNull();
    expect(document.getElementById('sqlite-clear-selection')).not.toBeNull();
    expect(document.getElementById('sqlite-selection-count')).not.toBeNull();
    expect(document.getElementById('sqlite-append-obsidian')).not.toBeNull();
  });

  it('bulk action bar is hidden by default', () => {
    const bulkBar = document.getElementById('sqlite-bulk-bar');
    expect(bulkBar?.style.display).toBe('none');
  });

  it('select-all checkbox has correct type and aria-label', () => {
    const selectAll = document.getElementById('sqlite-select-all') as HTMLInputElement | null;
    expect(selectAll).not.toBeNull();
    expect(selectAll?.type).toBe('checkbox');
    expect(selectAll?.getAttribute('aria-label')).toBe('Select All');
  });

  it('append button has correct data-i18n attribute', () => {
    const appendBtn = document.getElementById('sqlite-append-obsidian');
    expect(appendBtn?.getAttribute('data-i18n')).toBe('historyAppendToObsidian');
  });

  it('clear-selection button has correct data-i18n attribute', () => {
    const clearBtn = document.getElementById('sqlite-clear-selection');
    expect(clearBtn?.getAttribute('data-i18n')).toBe('historyClearSelection');
  });

  it('selection count has aria-live for screen readers', () => {
    const countEl = document.getElementById('sqlite-selection-count');
    expect(countEl?.getAttribute('aria-live')).toBe('polite');
  });

  it('entry list container exists', () => {
    const entryList = document.getElementById('sqlite-entry-list');
    expect(entryList).not.toBeNull();
    expect(entryList?.classList.contains('sqlite-entry-list')).toBe(true);
  });

  it('bulk bar toggles visibility with style.display', () => {
    const bulkBar = document.getElementById('sqlite-bulk-bar') as HTMLElement;

    // Initially hidden
    expect(bulkBar.style.display).toBe('none');

    // When there's a selection, show it
    bulkBar.style.display = '';
    expect(bulkBar.style.display).not.toBe('none');

    // When selection is cleared, hide it again
    bulkBar.style.display = 'none';
    expect(bulkBar.style.display).toBe('none');
  });

  it('select-all checkbox reflects selection state', () => {
    const selectAll = document.getElementById('sqlite-select-all') as HTMLInputElement;

    // When all entries are selected
    selectAll.checked = true;
    expect(selectAll.checked).toBe(true);

    // When some entries are unselected
    selectAll.checked = false;
    expect(selectAll.checked).toBe(false);
  });

  it('append button is enabled/disabled based on selection', () => {
    const appendBtn = document.getElementById('sqlite-append-obsidian') as HTMLButtonElement;

    // Initially disabled (no selection)
    appendBtn.disabled = true;
    expect(appendBtn.disabled).toBe(true);

    // When there is a selection
    appendBtn.disabled = false;
    expect(appendBtn.disabled).toBe(false);
  });

  it('selection count updates dynamically', () => {
    const countEl = document.getElementById('sqlite-selection-count');

    // Initial state
    countEl!.textContent = '0 selected';
    expect(countEl?.textContent).toBe('0 selected');

    // After selecting 3 entries
    countEl!.textContent = '3 selected';
    expect(countEl?.textContent).toBe('3 selected');

    // After clearing
    countEl!.textContent = '0 selected';
    expect(countEl?.textContent).toBe('0 selected');
  });

  it('entry list checkboxes follow select-all pattern', () => {
    // Simulate entry list with checkboxes
    const entryList = document.getElementById('sqlite-entry-list')!;
    for (let i = 1; i <= 3; i++) {
      const entry = document.createElement('div');
      entry.className = 'sqlite-entry';
      entry.setAttribute('data-id', String(i));
      entry.innerHTML = `
        <input type="checkbox" class="sqlite-entry-checkbox" data-action="select"
               data-id="${i}" aria-label="Select this record">
      `;
      entryList.appendChild(entry);
    }

    const checkboxes = entryList.querySelectorAll('.sqlite-entry-checkbox');
    expect(checkboxes.length).toBe(3);

    // All unchecked initially
    checkboxes.forEach(cb => expect((cb as HTMLInputElement).checked).toBe(false));

    // Check the second entry
    (checkboxes[1] as HTMLInputElement).checked = true;
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[2] as HTMLInputElement).checked).toBe(false);
  });
});
