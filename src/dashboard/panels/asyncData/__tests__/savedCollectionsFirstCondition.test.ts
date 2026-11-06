// @vitest-environment jsdom
/**
 * savedCollectionsFirstCondition.test.ts (PBI 2026-11-01-05)
 * First collection from the new panel alone: empty-state guide, failed
 * closed saves with an in-panel reason, and the recall-into-draft regression.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../utils/storage/savedCollectionsRepository.js', () => ({
  getSavedCollections: vi.fn().mockResolvedValue({}),
  duplicateSavedCollectionById: vi.fn().mockResolvedValue(undefined),
  removeSavedCollectionById: vi.fn().mockResolvedValue(undefined),
  upsertSavedCollectionById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../utils/storage/autoTagRulesRepository.js', () => ({
  getAutoTagApplications: vi.fn().mockResolvedValue([]),
  getAutoTagRules: vi.fn().mockResolvedValue({}),
  pruneAutoTagApplications: vi.fn().mockResolvedValue(undefined),
  removeAutoTagRuleById: vi.fn().mockResolvedValue(undefined),
  upsertAutoTagRuleById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn().mockResolvedValue(true),
}));

import {
  getSavedCollections,
  upsertSavedCollectionById,
} from '../../../../utils/storage/savedCollectionsRepository.js';
import { getAutoTagRules } from '../../../../utils/storage/autoTagRulesRepository.js';
import {
  createSavedCollectionsPanel,
  SAVED_COLLECTIONS_EDITOR_REGION_ID,
  SAVED_COLLECTIONS_PANEL_REGION_ID,
} from '../savedCollectionsPanel.js';
import { tOrKey as t } from '../../../../utils/i18n.js';
import { drainMacrotask } from '../../../../../testDir/waitPolicy.js';
import type { SavedCollection } from '../../../../utils/storage/savedCollections.js';

const mockedGetSaved = getSavedCollections as unknown as ReturnType<typeof vi.fn>;
const mockedUpsertSaved = upsertSavedCollectionById as unknown as ReturnType<typeof vi.fn>;
const mockedGetRules = getAutoTagRules as unknown as ReturnType<typeof vi.fn>;

const COLLECTION: SavedCollection = {
  id: 'c1',
  name: 'Rust notes',
  query: { tag: 'rust' },
  createdAt: 1,
  updatedAt: 2,
};

function mountSection(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'panel-saved-collections';
  section.innerHTML = `
    <h2 id="panel-saved-collections-title">Saved collections</h2>
    <p class="saved-collections-draft" role="status"></p>
    <div id="${SAVED_COLLECTIONS_EDITOR_REGION_ID}"></div>
    <div id="${SAVED_COLLECTIONS_PANEL_REGION_ID}"></div>`;
  document.body.appendChild(section);
  return section;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSaved.mockResolvedValue({});
  mockedGetRules.mockResolvedValue({});
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('savedCollectionsFirstCondition', () => {
  describe('empty state guide', () => {
    it('shows the first-save guide when no collections exist', async () => {
      const panel = createSavedCollectionsPanel();
      const section = mountSection();
      panel.mount(section);
      await panel.load?.();

      const guide = section.querySelector('.saved-collections-first-guide');
      expect(guide).not.toBeNull();
      expect(guide?.textContent).toBe(t('savedCollectionsFirstGuide'));
      expect(guide?.textContent?.length).toBeGreaterThan(0);
      panel.destroy?.();
    });

    it('hides the first-save guide once a collection exists', async () => {
      mockedGetSaved.mockResolvedValue({ c1: COLLECTION });
      const panel = createSavedCollectionsPanel();
      const section = mountSection();
      panel.mount(section);
      await panel.load?.();

      expect(section.querySelector('.saved-collection-name')?.textContent).toBe('Rust notes');
      expect(section.querySelector('.saved-collections-first-guide')).toBeNull();
      panel.destroy?.();
    });
  });

  describe('first save from the panel alone', () => {
    it('creates the first collection from a typed condition and a name', async () => {
      const panel = createSavedCollectionsPanel();
      const section = mountSection();
      panel.mount(section);
      await panel.load?.();

      const search = section.querySelector<HTMLInputElement>('.clause-search')!;
      search.value = 'AI';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      section.querySelector<HTMLInputElement>('.saved-collection-name-input')!.value = 'First one';
      section.querySelector<HTMLButtonElement>('[data-collection-action="save"]')?.click();

      await vi.waitFor(() => {
        expect(mockedUpsertSaved).toHaveBeenCalledWith(
          expect.any(String),
          'First one',
          { search: 'AI' },
          expect.any(Number),
        );
      });
      expect(section.querySelector('.saved-collection-save-error')?.textContent).toBe('');
      panel.destroy?.();
    });
  });

  describe('empty save fails closed', () => {
    it('shows a reason and saves nothing when the condition is empty', async () => {
      const panel = createSavedCollectionsPanel();
      const section = mountSection();
      panel.mount(section);
      await panel.load?.();

      section.querySelector<HTMLInputElement>('.saved-collection-name-input')!.value = 'No condition';
      section.querySelector<HTMLButtonElement>('[data-collection-action="save"]')?.click();

      await vi.waitFor(() => {
        expect(section.querySelector('.saved-collection-save-error')?.textContent).toBe(
          t('collectionClauseEmptySave'),
        );
      });
      await drainMacrotask();
      expect(mockedUpsertSaved).not.toHaveBeenCalled();
      panel.destroy?.();
    });

    it('shows a reason and saves nothing when the name is empty', async () => {
      const panel = createSavedCollectionsPanel();
      const section = mountSection();
      panel.mount(section);
      await panel.load?.();

      const search = section.querySelector<HTMLInputElement>('.clause-search')!;
      search.value = 'AI';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      section.querySelector<HTMLInputElement>('.saved-collection-name-input')!.value = '   ';
      section.querySelector<HTMLButtonElement>('[data-collection-action="save"]')?.click();

      await vi.waitFor(() => {
        expect(section.querySelector('.saved-collection-save-error')?.textContent).toBe(
          t('savedCollectionNameEmpty'),
        );
      });
      await drainMacrotask();
      expect(mockedUpsertSaved).not.toHaveBeenCalled();
      panel.destroy?.();
    });
  });

  describe('recall regression (PBI 01 contract)', () => {
    it('restores stored conditions into the panel draft only', async () => {
      mockedGetSaved.mockResolvedValue({ c1: COLLECTION });
      const panel = createSavedCollectionsPanel();
      const section = mountSection();
      panel.mount(section);
      await panel.load?.();

      section.querySelector<HTMLButtonElement>('[data-collection-action="apply"]')?.click();

      expect(section.querySelector('.saved-collections-draft')?.textContent).toContain('rust');
      await drainMacrotask();
      expect(mockedUpsertSaved).not.toHaveBeenCalled();
      panel.destroy?.();
    });
  });
});
