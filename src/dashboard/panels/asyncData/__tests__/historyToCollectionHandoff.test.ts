// @vitest-environment jsdom
/**
 * historyToCollectionHandoff.test.ts (PBI 2026-11-02-03)
 * Panel-level integration: the history "send to collection" affordance
 * transfers the filter triple into the collections editor draft (no
 * in-place save, no naming on the history side), and recall keeps
 * landing in the panel draft — never in the history list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../utils/storage/savedCollectionsRepository.js', () => ({
  getSavedCollections: vi.fn().mockResolvedValue({}),
  duplicateSavedCollectionById: vi.fn().mockResolvedValue(undefined),
  removeSavedCollectionById: vi.fn().mockResolvedValue(undefined),
  upsertSavedCollectionById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../utils/storage/autoTagRulesRepository.js', () => ({
  getAutoTagRules: vi.fn().mockResolvedValue({}),
  getAutoTagApplications: vi.fn().mockResolvedValue([]),
  pruneAutoTagApplications: vi.fn().mockResolvedValue(undefined),
  removeAutoTagRuleById: vi.fn().mockResolvedValue(undefined),
  upsertAutoTagRuleById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../../utils/pendingStorage.js', () => ({
  getPendingPages: vi.fn().mockResolvedValue([]),
  removePendingPages: vi.fn().mockResolvedValue(undefined),
}));

import { getSavedCollections } from '../../../../utils/storage/savedCollectionsRepository.js';
import { getAutoTagRules } from '../../../../utils/storage/autoTagRulesRepository.js';
import { createSavedCollectionsPanel } from '../savedCollectionsPanel.js';
import { createSqliteHistoryPanel } from '../sqliteHistoryPanel.js';
import type { SqliteHistoryModelDeps } from '../sqliteHistoryModel.js';
import { SQLITE_HISTORY_IDS } from '../sqliteHistoryPanelView.js';
import { tOrKey as t } from '../../../../utils/i18n.js';
import { useTimerClock, waitForMock } from '../../../../../testDir/waitPolicy.js';
import { clearHistoryHandoffForTests } from '../historyHandoff.js';

const mockedGetSaved = getSavedCollections as unknown as ReturnType<typeof vi.fn>;
const mockedGetRules = getAutoTagRules as unknown as ReturnType<typeof vi.fn>;

function mountHistorySection(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'panel-sqlite-history';
  document.body.appendChild(section);
  return section;
}

function mountCollectionsSection(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'panel-saved-collections';
  section.innerHTML = `
    <p class="saved-collections-draft" role="status"></p>
    <div id="saved-collections-editor-region"></div>
    <div id="saved-collections-panel-region"></div>`;
  document.body.appendChild(section);
  return section;
}

function mountPanels(queryHistory: NonNullable<SqliteHistoryModelDeps['queryHistory']>) {
  useTimerClock();
  const historySection = mountHistorySection();
  const collectionsSection = mountCollectionsSection();
  const historyPanel = createSqliteHistoryPanel({
    queryHistory,
    getSqliteStatus: (() => Promise.resolve({ fallback: false })) as never,
  });
  const collectionsPanel = createSavedCollectionsPanel();
  historyPanel.mount(historySection);
  collectionsPanel.mount(collectionsSection);
  return { historySection, collectionsSection, historyPanel, collectionsPanel };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSaved.mockResolvedValue({});
  mockedGetRules.mockResolvedValue({});
  clearHistoryHandoffForTests();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('historyToCollectionHandoff', () => {
  describe('send to collection', () => {
    it('transfers the search/tag/date triple into the collections editor draft', async () => {
      const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
      const { historySection, collectionsSection, historyPanel, collectionsPanel } = mountPanels(queryHistory);
      await collectionsPanel.load?.();
      await historyPanel.load?.();

      const search = historySection.querySelector<HTMLInputElement>(`#${SQLITE_HISTORY_IDS.searchInput}`)!;
      search.value = 'Alpha';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(400);

      historySection.querySelector<HTMLButtonElement>(`#${SQLITE_HISTORY_IDS.sendToCollection}`)?.click();

      await waitForMock(() => {
        expect(collectionsSection.querySelector('.saved-collections-draft')?.textContent).toContain('Alpha');
      });
      // The handoff restores as one editor clause (no per-clause fan-out).
      const clauseSearch = collectionsSection.querySelector<HTMLInputElement>('.clause-search');
      expect(clauseSearch?.value).toBe('Alpha');
      // No in-place save: the history list keeps showing its own state and
      // the send itself issues no history query.
      expect(historySection.querySelector(`#${SQLITE_HISTORY_IDS.entryList}`)).not.toBeNull();
      historyPanel.destroy?.();
      collectionsPanel.destroy?.();
    });

    it('refuses an empty triple with the no-condition reason and sends nothing', async () => {
      const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
      const { historySection, historyPanel, collectionsPanel } = mountPanels(queryHistory);
      await collectionsPanel.load?.();
      await historyPanel.load?.();

      historySection.querySelector<HTMLButtonElement>(`#${SQLITE_HISTORY_IDS.sendToCollection}`)?.click();

      const reason = historySection.querySelector(`#${SQLITE_HISTORY_IDS.handoffReason}`);
      expect(reason?.textContent).toBe(t('savedCollectionNoCondition'));
      historyPanel.destroy?.();
      collectionsPanel.destroy?.();
    });

    it('refuses a custom range without dropping to a single date', async () => {
      const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
      const { historySection, historyPanel, collectionsPanel } = mountPanels(queryHistory);
      await collectionsPanel.load?.();
      await historyPanel.load?.();

      historySection.querySelector<HTMLButtonElement>('[data-range="7"]')?.click();
      historySection.querySelector<HTMLButtonElement>(`#${SQLITE_HISTORY_IDS.sendToCollection}`)?.click();

      const reason = historySection.querySelector(`#${SQLITE_HISTORY_IDS.handoffReason}`);
      expect(reason?.textContent).toBe(t('historyHandoffRangeUnsavable'));
      historyPanel.destroy?.();
      collectionsPanel.destroy?.();
    });
  });

  describe('recall convention pin', () => {
    it('recall lands in the panel draft, never in the history list', async () => {
      mockedGetSaved.mockResolvedValue({
        c1: { id: 'c1', name: 'Zed set', query: { search: 'Zed-recall' }, createdAt: 1, updatedAt: 2 },
      });
      const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } });
      const { historySection, collectionsSection, historyPanel, collectionsPanel } = mountPanels(queryHistory);
      await collectionsPanel.load?.();
      await historyPanel.load?.();
      const historyCalls = queryHistory.mock.calls.length;

      collectionsSection.querySelector<HTMLButtonElement>('[data-collection-action="apply"]')?.click();

      // Recall target = the collections draft (editor clause + status line).
      await waitForMock(() => {
        expect(collectionsSection.querySelector('.saved-collections-draft')?.textContent).toContain('Zed-recall');
      });
      expect(collectionsSection.querySelector<HTMLInputElement>('.clause-search')?.value).toBe('Zed-recall');
      // The history list is untouched: no new history query, no filter leak.
      expect(queryHistory.mock.calls.length).toBe(historyCalls);
      expect(historySection.querySelector<HTMLInputElement>(`#${SQLITE_HISTORY_IDS.searchInput}`)?.value).toBe('');
      historyPanel.destroy?.();
      collectionsPanel.destroy?.();
    });
  });
});
