import { tOrKey as t } from '../../../utils/i18n.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { type PanelLifecycle } from '../types.js';
import {
  describeCollectionQuery,
  parseCollectionQuery,
  serializeCollectionQuery,
  type CollectionQueryInput,
  type CollectionQueryLabels,
} from './savedCollectionQuery.js';
import {
  createSavedCollectionsActions,
  loadSavedCollectionsRegion,
  renderSavedCollectionsRegion,
} from './savedCollectionsPanelView.js';
import type { SavedCollection } from '../../../utils/storage/savedCollections.js';
import type { AutoTagRule } from '../../../utils/storage/autoTagRules.js';

/**
 * savedCollectionsPanel.ts (PBI 2026-11-01-01)
 *
 * Standalone sibling of the history panel: owns saved collections CRUD and
 * auto-tag rules with panel-local state. The region view
 * (savedCollectionsPanelView) and the storage repositories are reused
 * unchanged; only the deps supplier differs from the history wiring.
 *
 * No history dependence by design (backlog 2026-11-01-00): recall restores
 * the stored conditions into the panel's own draft (visible in the draft
 * status line), and save stores that draft under a new name. Applying
 * conditions to the history list stays out of scope until the history side
 * can receive a handoff (PBI 04 or a follow-up) — the stored query round
 * trips losslessly through the draft in the meantime (search + tag + date).
 */

/** Placeholder id inside this panel's static section (the history shell keeps its own). */
export const SAVED_COLLECTIONS_PANEL_REGION_ID = 'saved-collections-panel-region';

/** Condition-summary labels (same target as the region's own labels). */
const CONDITION_LABELS: CollectionQueryLabels = {
  search: t('savedCollectionCondSearch'),
  tag: t('savedCollectionCondTag'),
  date: t('savedCollectionCondDate'),
};

const EMPTY_DRAFT: CollectionQueryInput = {
  searchQuery: '',
  activeTagFilter: null,
  selectedDate: null,
};

export function createSavedCollectionsPanel(): PanelLifecycle {
  let container: HTMLElement | null = null;
  let savedCollections: Record<string, SavedCollection> = {};
  let savedTagRules: Record<string, AutoTagRule> = {};
  let draft: CollectionQueryInput = { ...EMPTY_DRAFT };

  function renderDraft(): void {
    const draftEl = container?.querySelector('.saved-collections-draft');
    if (!(draftEl instanceof HTMLElement)) return;
    const summary = describeCollectionQuery(serializeCollectionQuery(draft), CONDITION_LABELS);
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
    const parsed = parseCollectionQuery(query);
    draft = {
      searchQuery: parsed.search,
      activeTagFilter: parsed.tag,
      selectedDate: parsed.date,
    };
    renderDraft();
  }

  function createActions(): ReturnType<typeof createSavedCollectionsActions> {
    return createSavedCollectionsActions({
      getQueryInput: () => ({ ...draft }),
      applyCollection: (query) => applyToDraft(query),
      getCollections: () => savedCollections,
      getRules: () => savedTagRules,
      reload: () => loadSaved(),
    });
  }

  function renderSaved(): void {
    if (!container) return;
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
        getQueryInput: () => ({ ...draft }),
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
      // Contained in-panel (BDD 読込失敗はパネル内で完結する): the failure
      // reason paints here and load() still resolves, so the history panel
      // and the registry banner stay out of it.
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
      renderDraft();
      await loadSaved();
    },
    destroy() {
      container = null;
      savedCollections = {};
      savedTagRules = {};
      draft = { ...EMPTY_DRAFT };
    },
  };
}
