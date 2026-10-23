/**
 * savedCollectionsPanelView.ts
 *
 * Saved-collections region of the SQLite history panel (PBI 2026-10-23-06).
 * Region-scoped render entry — same contract as renderPendingRegion: the
 * shell placeholder `<div id="sqlite-saved-collections">` is owned by
 * buildPanelShellHtml, but the id string itself is owned here
 * (SAVED_COLLECTIONS_REGION_ID); the view only re-exports it for the shell.
 * This module fills it. The Panel owns data + repository
 * calls; this module owns markup, labels and in-row wiring.
 *
 * Re-rendered wholesale on data change — per-render button wiring is safe
 * because the region's innerHTML is replaced.
 */

import { tOrKey as t } from '../../../utils/i18n.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { setElementHtml } from '../../../utils/htmlFragment.js';
import { withBusyButton } from './busyButton.js';
import { formatTimestamp } from './sqliteHistoryPanelView.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import {
  describeCollectionQuery,
  hasCollectionCondition,
  newCollectionId,
  serializeCollectionQuery,
  type CollectionQueryInput,
  type CollectionQueryLabels,
} from './savedCollectionQuery.js';
import {
  getSavedCollections,
  removeSavedCollectionById,
  upsertSavedCollectionById,
} from '../../../utils/storage/savedCollectionsRepository.js';
import type { SavedCollection } from '../../../utils/storage/savedCollections.js';

/**
 * Canonical owner of the saved-collections region placeholder id. The view
 * keeps a compatibility entry in SQLITE_HISTORY_IDS that references this
 * constant, so the string has a single source without moving the shell markup.
 */
export const SAVED_COLLECTIONS_REGION_ID = 'sqlite-saved-collections';

/** Event bundle the Panel builds once and hands to the region renderer. */
export interface SavedCollectionsRegionActions {
  /** Save the current conditions under the typed name; returns the in-row failure text. */
  onSave: (name: string) => Promise<{ ok: boolean; error?: string }>;
  /** Recall the stored conditions (no confirm needed — applying is not destructive). */
  onApply: (id: string) => void;
  /** Delete after the panel-side confirm dialog resolves. */
  onDelete: (id: string) => Promise<void>;
}

/**
 * Narrow inputs the region needs from the Panel side. The region owns the
 * save/apply/delete behavior (PBI 2026-10-24-05); the Panel only supplies
 * the current query input, the recall dispatch, the live collections, and a
 * reload hook that repaints the region after a mutation.
 */
export interface SavedCollectionsDeps {
  getQueryInput: () => CollectionQueryInput;
  applyCollection: (query: Record<string, unknown>) => void;
  getCollections: () => Record<string, SavedCollection>;
  reload: () => Promise<void>;
}

/**
 * Region-owned action bundle for saved collections. Moves the save/apply/
 * delete implementations out of the panel closure so a new region no longer
 * grows the panel body; the panel only wires mount/load with narrow inputs.
 */
export function createSavedCollectionsActions(deps: SavedCollectionsDeps): SavedCollectionsRegionActions {
  async function saveCollection(name: string): Promise<{ ok: boolean; error?: string }> {
    // The save captures exactly what panel state holds (search/tag/selected
    // day); an empty condition fails closed instead of saving a no-op recall.
    const query = serializeCollectionQuery(deps.getQueryInput());
    if (!hasCollectionCondition(query)) {
      return { ok: false, error: t('savedCollectionNoCondition') };
    }
    try {
      await upsertSavedCollectionById(newCollectionId(), name, query, Date.now());
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
    await deps.reload();
    return { ok: true };
  }

  function applySavedCollection(id: string): void {
    const collection = deps.getCollections()[id];
    if (!collection) return;
    deps.applyCollection(collection.query);
  }

  async function deleteSavedCollection(id: string): Promise<void> {
    const collection = deps.getCollections()[id];
    if (!collection) return;
    const confirmed = await showConfirmDialog({
      title: t('savedCollectionsLabel'),
      message: t('savedCollectionDeleteConfirm', [collection.name]),
      confirmLabel: t('savedCollectionDeleteBtn'),
      cancelLabel: t('cancel'),
      dangerous: true,
    });
    if (!confirmed) return;
    try {
      await removeSavedCollectionById(id);
    } catch {
      // Degraded exit: a failed remove keeps the list as-is instead of throwing.
      return;
    }
    await deps.reload();
  }

  return {
    onSave: (name) => saveCollection(name),
    onApply: (id) => applySavedCollection(id),
    onDelete: (id) => deleteSavedCollection(id),
  };
}

/**
 * Region-owned load entry: fetch the stored collections and paint the region.
 * The Panel calls this from load() and from the reload hook above, so the
 * fetch + render pairing lives next to the actions that trigger it.
 */
export async function loadSavedCollectionsRegion(
  container: HTMLElement,
  deps: SavedCollectionsDeps & { render: (collections: Record<string, SavedCollection>) => void },
): Promise<Record<string, SavedCollection>> {
  const collections = await getSavedCollections();
  deps.render(collections);
  return collections;
}

/** Condition-summary labels resolved once (pure describe target, chrome-free module). */
const CONDITION_LABELS: CollectionQueryLabels = {
  search: t('savedCollectionCondSearch'),
  tag: t('savedCollectionCondTag'),
  date: t('savedCollectionCondDate'),
};

function buildSavedRowHtml(collection: SavedCollection): string {
  const summary = describeCollectionQuery(collection.query, CONDITION_LABELS);
  const meta = summary !== ''
    ? `${escapeHtml(summary)} — ${escapeHtml(formatTimestamp(collection.updatedAt))}`
    : escapeHtml(formatTimestamp(collection.updatedAt));
  return `<div class="saved-collection-row" data-collection-id="${escapeHtml(collection.id)}">
    <div class="saved-collection-info">
      <span class="saved-collection-name">${escapeHtml(collection.name)}</span>
      <div class="saved-collection-meta">${meta}</div>
    </div>
    <div class="saved-collection-actions">
      <button type="button" class="secondary-btn" data-collection-action="apply"
        data-collection-id="${escapeHtml(collection.id)}">${escapeHtml(t('savedCollectionApplyBtn'))}</button>
      <button type="button" class="secondary-btn" data-collection-action="delete"
        data-collection-id="${escapeHtml(collection.id)}" aria-label="${escapeHtml(t('savedCollectionDeleteBtn'))}">${escapeHtml(t('savedCollectionDeleteBtn'))}</button>
    </div>
  </div>`;
}

function buildRegionInnerHtml(collections: Record<string, SavedCollection>): string {
  const entries = Object.values(collections).sort((a, b) => b.updatedAt - a.updatedAt);
  const list = entries.length > 0
    ? entries.map((c) => buildSavedRowHtml(c)).join('')
    : `<div class="saved-collections-empty">${escapeHtml(t('savedCollectionsEmpty'))}</div>`;
  return `<div class="saved-collections-section">
    <h4 data-i18n="savedCollectionsLabel">${escapeHtml(t('savedCollectionsLabel'))}</h4>
    <p class="saved-collections-help" data-i18n="savedCollectionsHelp">${escapeHtml(t('savedCollectionsHelp'))}</p>
    <div class="saved-collections-save">
      <input type="text" class="saved-collection-name-input"
        placeholder="${escapeHtml(t('savedCollectionNamePlaceholder'))}"
        aria-label="${escapeHtml(t('savedCollectionNamePlaceholder'))}" />
      <button type="button" class="secondary-btn" data-collection-action="save">${escapeHtml(t('savedCollectionSaveBtn'))}</button>
      <span class="saved-collection-save-error" role="alert"></span>
    </div>
    <div class="saved-collections-list">${list}</div>
  </div>`;
}

/**
 * Region-scoped render entry for saved collections. The shell placeholder is
 * owned by buildPanelShellHtml; this function fills it and wires the save /
 * apply / delete controls. In-row failure text survives until the next
 * wholesale re-render (a successful save or delete replaces the region).
 */
export function renderSavedCollectionsRegion(
  container: HTMLElement,
  collections: Record<string, SavedCollection>,
  actions: SavedCollectionsRegionActions,
): void {
  const region = container.querySelector(`#${SAVED_COLLECTIONS_REGION_ID}`);
  if (!(region instanceof HTMLElement)) return;

  setElementHtml(region, buildRegionInnerHtml(collections));

  const saveButton = region.querySelector<HTMLButtonElement>('[data-collection-action="save"]');
  const nameInput = region.querySelector<HTMLInputElement>('.saved-collection-name-input');
  const errorSpan = region.querySelector<HTMLElement>('.saved-collection-save-error');
  if (saveButton && nameInput) {
    saveButton.addEventListener('click', () => {
      void (async () => {
        const name = nameInput.value.trim();
        if (name === '') return;
        // Success replaces the region wholesale, so the button intentionally
        // stays busy; failure restores it via the seam before painting.
        try {
          await withBusyButton(
            saveButton,
            async () => {
              const result = await actions.onSave(name);
              if (!result.ok) {
                throw new Error(result.error ?? t('savedCollectionSaveError'));
              }
            },
            { restoreOnSuccess: false },
          );
        } catch (error) {
          if (errorSpan) {
            errorSpan.textContent = error instanceof Error ? error.message : t('savedCollectionSaveError');
          }
        }
      })();
    });
  }

  for (const button of Array.from(
    region.querySelectorAll<HTMLButtonElement>(
      '[data-collection-action="apply"], [data-collection-action="delete"]',
    ),
  )) {
    const id = button.dataset.collectionId ?? '';
    const action = button.dataset.collectionAction;
    button.addEventListener('click', () => {
      if (id === '') return;
      if (action === 'apply') {
        actions.onApply(id);
        return;
      }
      void (async () => {
        button.disabled = true;
        try {
          await actions.onDelete(id);
        } finally {
          // The wholesale re-render after a successful delete replaces this
          // button; restoring it here keeps a failed run clickable again.
          button.disabled = false;
        }
      })();
    });
  }
}
