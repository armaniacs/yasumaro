// @vitest-environment jsdom
/**
 * sqliteHistoryPanelViewRegenerate.test.ts — header controls + wiring +
 * busy/error helpers (PBI 2026-09-22-04).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildEntryListHtml,
  wireEntryList,
  setEntryRegenerateBusy,
  showEntryRegenerateError,
  clearEntryRegenerateError,
  SQLITE_HISTORY_IDS,
  type SqliteHistoryViewCallbacks,
} from '../sqliteHistoryPanelView.js';
import type { BrowsingLogEntry } from '../../../../utils/sqlite-types.js';

const baseEntry: BrowsingLogEntry = {
  id: 1,
  url: 'https://example.com',
  title: 'Example',
  created_at: 1700000000000,
};

function noopCallbacks(overrides: Partial<SqliteHistoryViewCallbacks> = {}): SqliteHistoryViewCallbacks {
  return {
    onDateSelect: () => undefined,
    onRangeSelect: () => undefined,
    onClearFilters: () => undefined,
    onSearchInput: () => undefined,
    onSortChange: () => undefined,
    onPageChange: () => undefined,
    onToggleStar: () => undefined,
    onDelete: () => undefined,
    onSelectionChange: () => undefined,
    onTagFilterClick: () => undefined,
    onContentToggle: () => undefined,
    onSelectAll: () => undefined,
    onClearSelection: () => undefined,
    onAppend: () => undefined,
    onTagFilterClear: () => undefined,
    onRegenerate: () => undefined,
    translateError: (e) => e ?? '',
    createCopyButton: () => document.createElement('button'),
    ...overrides,
  };
}

function wiredContainer(entries: BrowsingLogEntry[], callbacks: SqliteHistoryViewCallbacks): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = `<div id="${SQLITE_HISTORY_IDS.entryList}"></div>`;
  wireEntryList(container, entries, new Set(), null, callbacks);
  return container;
}

describe('buildEntryListHtml — regenerate controls (CRITICAL)', () => {
  it('renders mode select with current/looser/loosest + regenerate button', () => {
    const html = buildEntryListHtml([baseEntry], new Set(), null);
    expect(html).toContain('regenerate-mode-select');
    expect(html).toContain('value="current"');
    expect(html).toContain('value="looser"');
    expect(html).toContain('value="loosest"');
    expect(html).toContain('sqlite-entry-regenerate');
    expect(html).toContain('data-action="regenerate"');
    // Controls sit between the title and the delete button (PBI layout).
    const titleAt = html.indexOf('sqlite-entry-title');
    const regenAt = html.indexOf('data-action="regenerate"');
    const deleteAt = html.indexOf('data-action="delete"');
    expect(titleAt).toBeGreaterThan(-1);
    expect(regenAt).toBeGreaterThan(titleAt);
    expect(deleteAt).toBeGreaterThan(regenAt);
  });
});

describe('wireEntryList — onRegenerate (CRITICAL: mode + default current)', () => {
  it("reads the select value, defaulting to 'current'", () => {
    const onRegenerate = vi.fn();
    const container = wiredContainer([baseEntry], noopCallbacks({ onRegenerate }));
    (container.querySelector('.sqlite-entry[data-id="1"] [data-action="regenerate"]') as HTMLButtonElement).click();
    expect(onRegenerate).toHaveBeenCalledWith(1, 'current', false);
  });

  it('forwards looser/loosest selections', () => {
    for (const mode of ['looser', 'loosest']) {
      const onRegenerate = vi.fn();
      const container = wiredContainer([baseEntry], noopCallbacks({ onRegenerate }));
      const select = container.querySelector('.regenerate-mode-select') as HTMLSelectElement;
      select.value = mode;
      (container.querySelector('[data-action="regenerate"]') as HTMLButtonElement).click();
      expect(onRegenerate).toHaveBeenCalledWith(1, mode, false);
    }
  });

  it('coerces an unknown select value back to current', () => {
    const onRegenerate = vi.fn();
    const container = wiredContainer([baseEntry], noopCallbacks({ onRegenerate }));
    const select = container.querySelector('.regenerate-mode-select') as HTMLSelectElement;
    select.value = 'bogus';
    (container.querySelector('[data-action="regenerate"]') as HTMLButtonElement).click();
    expect(onRegenerate).toHaveBeenCalledWith(1, 'current', false);
  });
});

describe('setEntryRegenerateBusy', () => {
  it('toggles disabled on both button and select, no-op when re-rendered away', () => {
    const container = wiredContainer([baseEntry], noopCallbacks());
    const btn = container.querySelector('[data-action="regenerate"]') as HTMLButtonElement;
    const select = container.querySelector('.regenerate-mode-select') as HTMLSelectElement;
    setEntryRegenerateBusy(container, 1, true);
    expect(btn.disabled).toBe(true);
    expect(select.disabled).toBe(true);
    setEntryRegenerateBusy(container, 1, false);
    expect(btn.disabled).toBe(false);
    expect(select.disabled).toBe(false);
    expect(() => setEntryRegenerateBusy(container, 999, true)).not.toThrow();
  });
});

describe('showEntryRegenerateError / clearEntryRegenerateError', () => {
  it('renders the error row and an optional force button invoking the callback', () => {
    const container = wiredContainer([baseEntry], noopCallbacks());
    const onForce = vi.fn();
    showEntryRegenerateError(container, 1, 'blocked', { forceLabel: 'Force', onForce });
    const row = container.querySelector('.sqlite-entry[data-id="1"] .record-error-message.regenerate-error-row');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('blocked');
    (row?.querySelector('.regenerate-force-btn') as HTMLButtonElement).click();
    expect(onForce).toHaveBeenCalledTimes(1);
  });

  it('omits the force button when no handler is given', () => {
    const container = wiredContainer([baseEntry], noopCallbacks());
    showEntryRegenerateError(container, 1, 'plain error');
    const row = container.querySelector('.regenerate-error-row');
    expect(row?.querySelector('.regenerate-force-btn')).toBeNull();
  });

  it('replaces the previous row instead of stacking', () => {
    const container = wiredContainer([baseEntry], noopCallbacks());
    showEntryRegenerateError(container, 1, 'first');
    showEntryRegenerateError(container, 1, 'second');
    const rows = container.querySelectorAll('.sqlite-entry[data-id="1"] .regenerate-error-row');
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain('second');
  });

  it('clearEntryRegenerateError removes the row', () => {
    const container = wiredContainer([baseEntry], noopCallbacks());
    showEntryRegenerateError(container, 1, 'blocked');
    clearEntryRegenerateError(container, 1);
    expect(container.querySelector('.regenerate-error-row')).toBeNull();
  });
});
