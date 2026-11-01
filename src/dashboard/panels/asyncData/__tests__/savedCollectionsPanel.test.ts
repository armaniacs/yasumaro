// @vitest-environment jsdom
/**
 * savedCollectionsPanel.test.ts (PBI 2026-11-01-01)
 * New sibling panel `panel-saved-collections`: owns saved collections CRUD
 * and auto-tag rules with panel-local state (no history dependence).
 * Recall restores the stored conditions into the panel draft; save stores
 * the draft under a new name. Load failures render in-panel.
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
import {
  getAutoTagRules,
  removeAutoTagRuleById,
  upsertAutoTagRuleById,
} from '../../../../utils/storage/autoTagRulesRepository.js';
import {
  createSavedCollectionsPanel,
  SAVED_COLLECTIONS_EDITOR_REGION_ID,
  SAVED_COLLECTIONS_PANEL_REGION_ID,
} from '../savedCollectionsPanel.js';
import { tOrKey as t } from '../../../../utils/i18n.js';
import type { SavedCollection } from '../../../../utils/storage/savedCollections.js';
import type { AutoTagRule } from '../../../../utils/storage/autoTagRules.js';

const mockedGetSaved = getSavedCollections as unknown as ReturnType<typeof vi.fn>;
const mockedUpsertSaved = upsertSavedCollectionById as unknown as ReturnType<typeof vi.fn>;
const mockedGetRules = getAutoTagRules as unknown as ReturnType<typeof vi.fn>;
const mockedRuleUpsert = upsertAutoTagRuleById as unknown as ReturnType<typeof vi.fn>;
const mockedRuleRemove = removeAutoTagRuleById as unknown as ReturnType<typeof vi.fn>;

const COLLECTION: SavedCollection = {
  id: 'c1',
  name: 'Rust notes',
  query: { tag: 'rust' },
  createdAt: 1,
  updatedAt: 2,
};

const RULE: AutoTagRule = {
  id: 'r1',
  name: 'Docs',
  domainSuffix: 'example.com',
  tag: 'docs',
  priority: 10,
  enabled: true,
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

describe('savedCollectionsPanel — PanelLifecycle', () => {
  it('declares the new panel id and async-data category', () => {
    const panel = createSavedCollectionsPanel();
    expect(panel.id).toBe('panel-saved-collections');
    expect(panel.category).toBe('async-data');
  });

  it('mount → load → destroy succeeds with empty stores (BDD 空状態)', async () => {
    const panel = createSavedCollectionsPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();
    expect(section.querySelector('.saved-collections-empty')).not.toBeNull();
    expect(section.querySelector('.auto-tag-rules-empty')).not.toBeNull();
    expect(() => panel.destroy?.()).not.toThrow();
  });

  it('load without a prior mount resolves (registry safety)', async () => {
    const panel = createSavedCollectionsPanel();
    await expect(panel.load?.()).resolves.toBeUndefined();
  });
});

describe('savedCollectionsPanel — recall restores conditions (BDD 呼び出し)', () => {
  it('lists collections and recall restores the stored conditions into the draft', async () => {
    mockedGetSaved.mockResolvedValue({ c1: COLLECTION });
    mockedGetRules.mockResolvedValue({ r1: RULE });
    const panel = createSavedCollectionsPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();

    expect(section.querySelector('.saved-collection-name')?.textContent).toBe('Rust notes');

    section.querySelector<HTMLButtonElement>('[data-collection-action="apply"]')?.click();
    expect(section.querySelector('.saved-collections-draft')?.textContent).toContain('rust');

    // The restored draft is what a subsequent save stores (save-as flow).
    section.querySelector<HTMLInputElement>('.saved-collection-name-input')!.value = 'Rust copy';
    section.querySelector<HTMLButtonElement>('[data-collection-action="save"]')?.click();
    await vi.waitFor(() => {
      expect(mockedUpsertSaved).toHaveBeenCalledWith(
        expect.any(String),
        'Rust copy',
        { tag: 'rust' },
        expect.any(Number),
      );
    });
    panel.destroy?.();
  });
});

describe('savedCollectionsPanel — rule management (BDD 規則の管理)', () => {
  it('adds a rule from the form', async () => {
    const panel = createSavedCollectionsPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();

    section.querySelector<HTMLInputElement>('.auto-tag-rule-name')!.value = 'New rule';
    section.querySelector<HTMLInputElement>('.auto-tag-rule-domain')!.value = 'example.com';
    section.querySelector<HTMLInputElement>('.auto-tag-rule-tag')!.value = 'news';
    section.querySelector<HTMLButtonElement>('[data-rule-action="add"]')?.click();
    await vi.waitFor(() => {
      expect(mockedRuleUpsert).toHaveBeenCalledWith(expect.objectContaining({ name: 'New rule' }));
    });
    panel.destroy?.();
  });

  it('toggles a rule off and deletes a rule', async () => {
    mockedGetRules.mockResolvedValue({ r1: RULE });
    const panel = createSavedCollectionsPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();

    section.querySelector<HTMLInputElement>('[data-rule-action="toggle"]')?.click();
    await vi.waitFor(() => {
      expect(mockedRuleUpsert).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });

    section.querySelector<HTMLButtonElement>('[data-rule-action="delete"]')?.click();
    await vi.waitFor(() => {
      expect(mockedRuleRemove).toHaveBeenCalledWith('r1');
    });
    panel.destroy?.();
  });
});

describe('savedCollectionsPanel — load failure stays in-panel (BDD 読込失敗)', () => {
  it('renders the reason inside the panel and resolves instead of throwing', async () => {
    mockedGetSaved.mockRejectedValue(new Error('db down'));
    const panel = createSavedCollectionsPanel();
    const section = mountSection();
    panel.mount(section);
    await expect(panel.load?.()).resolves.toBeUndefined();

    const alert = section.querySelector('.saved-collections-load-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('db down');
    panel.destroy?.();
  });
});

describe('savedCollectionsPanel', () => {
  describe('clause editor region', () => {
    it('renders editor rows on load', async () => {
      document.body.innerHTML = '<div id="host"><div id="saved-collections-editor-region"></div><div id="saved-collections-panel-region"></div><p class="saved-collections-draft"></p></div>';
      const host = document.querySelector('#host') as HTMLElement;
      const { createSavedCollectionsPanel } = await import('../savedCollectionsPanel.js');
      const panel = createSavedCollectionsPanel();
      panel.mount(host);
      await panel.load();
      expect(host.querySelectorAll('.clause-row').length).toBeGreaterThan(0);
      panel.destroy();
    });
  });
});

describe('savedCollectionsPanel', () => {
  describe('clause draft handoff', () => {
    it('restores a multi-clause saved query into the editor', async () => {
      const { createClauseEditor } = await import('../collectionClauseEditor.js');
      const editor = createClauseEditor();
      editor.loadSaved({ version: 2, op: 'or', clauses: [{ search: 'AI' }, { search: '要約' }] });
      expect(editor.getClauses()).toHaveLength(2);
      expect(editor.getOp()).toBe('or');
    });
  });
});

describe('savedCollectionsPanel', () => {
  describe('preview generation guard', () => {
    it('ignores a stale refresh that resolves after a newer one', async () => {
      const resolvers: Array<(n: number) => void> = [];
      const { createSavedCollectionsPanel } = await import('../savedCollectionsPanel.js');
      const panel = createSavedCollectionsPanel({
        countForClause: () => new Promise<number>((resolve) => { resolvers.push(resolve); }),
      });
      const section = mountSection();
      panel.mount(section);
      await panel.load?.();

      const search = section.querySelector<HTMLInputElement>('.clause-search')!;
      search.value = 'AI';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      section.querySelector<HTMLButtonElement>('[data-clause-action="refresh"]')?.click();
      section.querySelector<HTMLButtonElement>('[data-clause-action="refresh"]')?.click();
      expect(resolvers).toHaveLength(2);

      resolvers[1]!(7);
      await vi.waitFor(() => {
        expect(section.querySelector('.clause-preview-text')?.textContent).toBe('7');
      });

      resolvers[0]!(100);
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(section.querySelector('.clause-count')?.textContent).toBe('7');
      expect(section.querySelector('.clause-preview-text')?.textContent).toBe('7');
      panel.destroy?.();
    });

    it('shows an alert and keeps old counts when preview counting fails', async () => {
      let shouldFail = false;
      let deferred: PromiseWithResolvers<number> | null = null;
      const { createSavedCollectionsPanel } = await import('../savedCollectionsPanel.js');
      const panel = createSavedCollectionsPanel({
        countForClause: () => {
          if (!shouldFail) return Promise.resolve(7);
          deferred = Promise.withResolvers<number>();
          return deferred.promise;
        },
      });
      const section = mountSection();
      panel.mount(section);
      await panel.load?.();

      const search = section.querySelector<HTMLInputElement>('.clause-search')!;
      search.value = 'AI';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      section.querySelector<HTMLButtonElement>('[data-clause-action="refresh"]')?.click();
      for (let i = 0; i < 10; i++) await Promise.resolve();
      const baselineRow = section.querySelector('.clause-count')?.textContent;
      const baselineTotal = section.querySelector('.clause-preview-text')?.textContent;
      expect(baselineRow).toBe('7');
      expect(baselineTotal).toBe('7');

      shouldFail = true;
      section.querySelector<HTMLButtonElement>('[data-clause-action="refresh"]')?.click();
      expect(deferred).not.toBeNull();
      deferred!.reject(new Error('count failed'));
      for (let i = 0; i < 10; i++) await Promise.resolve();

      const alert = section.querySelector('.saved-collections-preview-error');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(alert?.textContent).not.toBe('');
      expect(section.querySelector('.clause-count')?.textContent).toBe(baselineRow);
      expect(section.querySelector('.clause-preview-text')?.textContent).toBe(baselineTotal);
      panel.destroy?.();
    });
  });
});

describe('savedCollectionsPanel', () => {
  describe('empty save message', () => {
    it('uses the clause empty-save message key', async () => {
      // Empty editor + save click drives the panel-internal onSaveV2 path
      // through the public PanelLifecycle surface (mount/load only).
      const panel = createSavedCollectionsPanel();
      const section = mountSection();
      panel.mount(section);
      await panel.load?.();

      section.querySelector<HTMLInputElement>('.saved-collection-name-input')!.value = 'Empty attempt';
      section.querySelector<HTMLButtonElement>('[data-collection-action="save"]')?.click();
      await vi.waitFor(() => {
        expect(section.querySelector('.saved-collection-save-error')?.textContent).toBe(
          t('collectionClauseEmptySave'),
        );
      });
      expect(mockedUpsertSaved).not.toHaveBeenCalled();
      panel.destroy?.();
    });
  });
});
