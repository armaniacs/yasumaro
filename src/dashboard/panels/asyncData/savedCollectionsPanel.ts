import { tOrKey as t } from '../../../utils/i18n.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { type PanelLifecycle } from '../types.js';
import {
  describeCollectionQueryV2,
  parseCollectionQueryV2,
  serializeClausesQuery,
  newCollectionId,
  type CollectionQueryInput,
  type CollectionQueryLabels,
} from './savedCollectionQuery.js';
import {
  createSavedCollectionsActions,
  loadSavedCollectionsRegion,
  renderSavedCollectionsRegion,
} from './savedCollectionsPanelView.js';
import { upsertSavedCollectionById } from '../../../utils/storage/savedCollectionsRepository.js';
import type { SavedCollection } from '../../../utils/storage/savedCollections.js';
import type { AutoTagRule } from '../../../utils/storage/autoTagRules.js';
import { createClauseEditor } from './collectionClauseEditor.js';
import { renderClauseEditorView } from './collectionClauseEditorView.js';

/**
 * savedCollectionsPanel.ts (PBI 2026-11-01-01; Task 3: clause-editor wiring)
 *
 * Standalone sibling of the history panel: owns saved collections CRUD and
 * auto-tag rules with panel-local state. The region view
 * (savedCollectionsPanelView) and the storage repositories are reused
 * unchanged; only the deps supplier differs from the history wiring.
 *
 * No history dependence by design (backlog 2026-11-01-00): recall restores
 * the stored conditions into the panel's clause editor (visible in the draft
 * status line), and save stores the editor query under a new name. Applying
 * conditions to the history list stays out of scope until the history side
 * can receive a handoff (PBI 04 or a follow-up).
 */

export const SAVED_COLLECTIONS_PANEL_REGION_ID = 'saved-collections-panel-region';
export const SAVED_COLLECTIONS_EDITOR_REGION_ID = 'saved-collections-editor-region';

const CONDITION_LABELS: CollectionQueryLabels = {
  search: t('savedCollectionCondSearch'),
  tag: t('savedCollectionCondTag'),
  date: t('savedCollectionCondDate'),
};

export function createSavedCollectionsPanel(): PanelLifecycle {
  let container: HTMLElement | null = null;
  let savedCollections: Record<string, SavedCollection> = {};
  let savedTagRules: Record<string, AutoTagRule> = {};
  const editor = createClauseEditor();
  let loadedIds: number[] = [];

  function nonEmptyFirstInput(): CollectionQueryInput {
    const first = editor.getClauses().find((c) => c.search !== '' || c.tag !== null || c.date !== null);
    return {
      searchQuery: first?.search ?? '',
      activeTagFilter: first?.tag ?? null,
      selectedDate: first?.date ?? null,
    };
  }

  function renderDraft(): void {
    const draftEl = container?.querySelector('.saved-collections-draft');
    if (!(draftEl instanceof HTMLElement)) return;
    const summary = describeCollectionQueryV2(editor.toSavedQuery(), CONDITION_LABELS);
    draftEl.textContent = summary !== '' ? summary : t('savedCollectionNoCondition');
  }

  function clearLoadError(): void {
    container?.querySelector('.saved-collections-load-error')?.remove();
  }

  function renderLoadError(error: unknown): void {
    if (!container) return;
    clearLoadError();
    const alert = document.createElement('div');
    alert.className = 'saved-collections-load-error';
    alert.setAttribute('role', 'alert');
    alert.textContent = errorMessage(error);
    container.appendChild(alert);
  }

  function applyToDraft(query: Record<string, unknown>): void {
    const parsed = parseCollectionQueryV2(query);
    loadedIds = parsed.ids;
    editor.loadSaved(query);
    renderEditor();
    renderDraft();
  }

  function refreshPreview(): Promise<void> {
    return Promise.resolve();
  }

  function renderEditor(): void {
    if (!container) return;
    renderClauseEditorView(container, editor, {
      onDraftChange: () => renderDraft(),
      onStructureChange: (kind) => {
        renderEditor();
        renderDraft();
        if (kind !== 'draft') void refreshPreview();
      },
    }, SAVED_COLLECTIONS_EDITOR_REGION_ID);
  }

  async function onSaveV2(name: string): Promise<{ ok: boolean; error?: string }> {
    const nonEmpty = editor.getClauses().filter((c) => c.search !== '' || c.tag !== null || c.date !== null);
    if (nonEmpty.length === 0) {
      return { ok: false, error: t('savedCollectionNoCondition') };
    }
    const query =
      loadedIds.length > 0
        ? serializeClausesQuery(editor.getOp(), nonEmpty, loadedIds)
        : editor.toSavedQuery();
    try {
      await upsertSavedCollectionById(newCollectionId(), name, query, Date.now());
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
    const rawIds = query['ids'];
    loadedIds = Array.isArray(rawIds)
      ? rawIds.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      : [];
    await loadSaved();
    return { ok: true };
  }

  function createActions(): ReturnType<typeof createSavedCollectionsActions> {
    const base = createSavedCollectionsActions({
      // Adapter only: satisfies SavedCollectionsDeps — the live save path is onSaveV2.
      getQueryInput: () => ({ ...nonEmptyFirstInput() }),
      applyCollection: (query) => applyToDraft(query),
      getCollections: () => savedCollections,
      getRules: () => savedTagRules,
      reload: () => loadSaved(),
    });
    return { ...base, onSave: (name) => onSaveV2(name) };
  }

  function renderSaved(): void {
    if (!container) return;
    renderEditor();
    renderSavedCollectionsRegion(
      container,
      savedCollections,
      savedTagRules,
      createActions(),
      SAVED_COLLECTIONS_PANEL_REGION_ID,
    );
  }

  async function loadSaved(): Promise<void> {
    if (!container) return;
    const target = container;
    try {
      const loaded = await loadSavedCollectionsRegion(target, {
        getQueryInput: () => ({ ...nonEmptyFirstInput() }),
        applyCollection: (query) => applyToDraft(query),
        getCollections: () => savedCollections,
        getRules: () => savedTagRules,
        reload: () => loadSaved(),
        render: (collections, rules) => {
          savedCollections = collections;
          savedTagRules = rules;
          if (container === target) renderSaved();
        },
      });
      savedCollections = loaded.collections;
      savedTagRules = loaded.rules;
      if (container === target) {
        clearLoadError();
        renderSaved();
      }
    } catch (error) {
      if (container === target) renderLoadError(error);
    }
  }

  return {
    id: 'panel-saved-collections',
    category: 'async-data',
    mount(c: HTMLElement) {
      container = c;
    },
    async load() {
      if (!container) return;
      renderEditor();
      renderDraft();
      await loadSaved();
    },
    destroy() {
      container = null;
      savedCollections = {};
      savedTagRules = {};
      loadedIds = [];
      editor.loadSaved({ version: 2, op: 'and', clauses: [] });
    },
  };
}
