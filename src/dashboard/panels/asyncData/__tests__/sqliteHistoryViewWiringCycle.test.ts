// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { formatDate, SQLITE_HISTORY_IDS, buildPanelShellHtml } from '../sqliteHistoryPanelView.js';
import { formatLocalDate } from '../../../../utils/localDate.js';
import { buildCalendarDaysHtml, buildCalendarNavHtml } from '../sqliteHistoryChromeWiring.js';
import { createInitialHistoryState } from '../sqliteHistoryPanelState.js';

const here = dirname(fileURLToPath(import.meta.url));
function readSibling(name: string): string {
  return readFileSync(join(here, '..', name), 'utf8');
}

describe('view-wiring cycle parity (PBI 2026-11-11-02)', () => {
  it('pins date display: formatDate stays a thin wrapper over formatLocalDate', () => {
    expect(formatDate(new Date(2026, 0, 15))).toBe('2026-01-15');
    expect(formatDate(new Date(2026, 0, 15))).toBe(formatLocalDate(new Date(2026, 0, 15)));
    expect(formatDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('pins ID drawing: shell html contains its owned ids', () => {
    const state = { ...createInitialHistoryState(), total: 2 };
    const html = buildPanelShellHtml(state, (e) => e ?? '');
    // Shell-owned ids (sub-regions render their own: sortSelect via
    // wireSortControl, calendarDays/clearAllFilters/sendToCollection/
    // handoffReason via buildCalendarNavHtml, tagFilterBar lazily).
    const shellOwned = [
      'searchInput', 'sortControl', 'calendarNav', 'pendingRegion',
      'entryList', 'pagination', 'error', 'bulkBar', 'selectAll',
      'clearSelection', 'selectionCount', 'appendObsidian',
      'regenerateSelected', 'deleteSelected', 'starSelected',
      'starConfirm', 'starConfirmAll', 'starConfirmExclude',
      'starConfirmCancel', 'starUndo', 'starUndoBtn',
      'deleteConfirm', 'deleteConfirmYes', 'deleteConfirmNo',
    ] as const;
    for (const key of shellOwned) {
      expect(html).toContain(SQLITE_HISTORY_IDS[key]);
    }
  });

  it('pins calendar day grid for a fixed month', () => {
    const html = buildCalendarDaysHtml(2026, 0, '2026-01-15');
    expect(html).toContain('data-date="2026-01-15"');
    expect(html).toContain('data-date="2026-01-01"');
    expect(html).toContain('data-date="2026-01-31"');
    // Selected + today markers render through the same date formatter.
    expect(html).toContain('selected');
  });

  it('pins calendar nav shell ids', () => {
    const { html } = buildCalendarNavHtml(null, { searchQuery: '', activeTagFilter: null });
    expect(html).toContain(SQLITE_HISTORY_IDS.clearAllFilters === '' ? '__never__' : SQLITE_HISTORY_IDS.calendarDays);
    expect(html).toContain(SQLITE_HISTORY_IDS.handoffReason);
    expect(html).toContain(SQLITE_HISTORY_IDS.sendToCollection);
  });

  it('has no value import of the View from wiring/dialog modules', () => {
    for (const name of ['sqliteHistoryChromeWiring.ts', 'sqliteHistoryConfirmDialogs.ts']) {
      const src = readSibling(name);
      const lines = src.split('\n');
      const offenders = lines.filter(
        (l) => /from\s+['"]\.\/sqliteHistoryPanelView\.js['"]/.test(l) && !/^\s*import\s+type\b/.test(l),
      );
      expect(offenders, `${name} must not value-import the View`).toEqual([]);
    }
  });

  it('keeps SQLITE_HISTORY_IDS identical across View and the shared module', async () => {
    const shared = await import('../sqliteHistoryIds.js');
    expect(shared.SQLITE_HISTORY_IDS).toEqual(SQLITE_HISTORY_IDS);
  });
});
