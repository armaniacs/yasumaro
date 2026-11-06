// @vitest-environment jsdom
/**
 * historyPanelSlimming.test.ts (PBI 2026-11-01-04)
 *
 * The history shell keeps only record list / search operations: the three
 * region wirings (saved-collections, ask-history, research-report) live in
 * their standalone panels now. This pins the shell without the regions, the
 * catalog order history → saved-collections → ask-history → research-report
 * → archive, and the deep-link mapping (?tab=history stays history, the new
 * panels resolve to their own ids).
 */

import { describe, it, expect } from 'vitest';
import { PANEL_CATALOG, resolvePanelIdForTab } from '../../panelCatalog.js';
import {
  SQLITE_HISTORY_IDS,
  buildPanelShellHtml,
} from '../sqliteHistoryPanelView.js';
import { SAVED_COLLECTIONS_REGION_ID } from '../savedCollectionsPanelView.js';
import { ASK_HISTORY_REGION_ID } from '../askHistoryPanelView.js';
import { RESEARCH_REPORT_REGION_ID } from '../researchReportPanelView.js';
import { createInitialHistoryState } from '../sqliteHistoryPanelState.js';

describe('history shell without regions (PBI 2026-11-01-04)', () => {
  it('exposes no region placeholder ids on SQLITE_HISTORY_IDS', () => {
    const ids = SQLITE_HISTORY_IDS as Record<string, string>;
    expect(ids).not.toHaveProperty('savedCollections');
    expect(ids).not.toHaveProperty('askHistory');
    expect(ids).not.toHaveProperty('researchReport');
  });

  it('renders no region placeholder divs in the panel shell', () => {
    const html = buildPanelShellHtml(createInitialHistoryState(), () => '');
    expect(html).not.toContain(SAVED_COLLECTIONS_REGION_ID);
    expect(html).not.toContain(ASK_HISTORY_REGION_ID);
    expect(html).not.toContain(RESEARCH_REPORT_REGION_ID);
    expect(html).not.toContain('sqlite-saved-collections');
    expect(html).not.toContain('sqlite-ask-history');
    expect(html).not.toContain('sqlite-research-report');
  });

  it('still renders the record list / search shell', () => {
    const html = buildPanelShellHtml(createInitialHistoryState(), () => '');
    expect(html).toContain(SQLITE_HISTORY_IDS.entryList);
    expect(html).toContain(SQLITE_HISTORY_IDS.searchInput);
    expect(html).toContain(SQLITE_HISTORY_IDS.pendingRegion);
  });
});

describe('catalog order after the split (PBI 2026-11-01-04)', () => {
  it('orders history -> archive ... with the trio grouped at the experimental end', () => {
    const ids = PANEL_CATALOG.map((entry) => entry.id);
    const history = ids.indexOf('panel-sqlite-history');
    const archive = ids.indexOf('panel-archive');
    const saved = ids.indexOf('panel-saved-collections');
    const ask = ids.indexOf('panel-ask-history');
    const report = ids.indexOf('panel-research-report');
    expect(history).toBeGreaterThanOrEqual(0);
    expect(archive).toBe(history + 1);
    expect(saved).toBe(ids.length - 3);
    expect(ask).toBe(ids.length - 2);
    expect(report).toBe(ids.length - 1);
  });
});

describe('deep-link mapping after the split (PBI 2026-11-01-04)', () => {
  it('keeps ?tab=history on the history panel', () => {
    expect(resolvePanelIdForTab('history')).toBe('panel-sqlite-history');
  });

  it('resolves each new panel deep-link to its own panel', () => {
    expect(resolvePanelIdForTab('collections')).toBe('panel-saved-collections');
    expect(resolvePanelIdForTab('ask-history')).toBe('panel-ask-history');
    expect(resolvePanelIdForTab('research-report')).toBe('panel-research-report');
  });
});
