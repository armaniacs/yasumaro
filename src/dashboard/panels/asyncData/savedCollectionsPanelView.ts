/**
 * savedCollectionsPanelView.ts
 *
 * Saved-collections region of the SQLite history panel (PBI 2026-10-23-06).
 * Region-scoped render entry — same contract as renderPendingRegion: the
 * shell placeholder `<div id="sqlite-saved-collections">` is owned by
 * buildPanelShellHtml (its id lives in SQLITE_HISTORY_IDS, the sole owner of
 * every panel DOM id); this module fills it. The Panel owns data + repository
 * calls; this module owns markup, labels and in-row wiring.
 *
 * Re-rendered wholesale on data change — per-render button wiring is safe
 * because the region's innerHTML is replaced.
 */

import { tOrKey as t } from '../../../utils/i18n.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { setElementHtml } from '../../../utils/htmlFragment.js';
import { SQLITE_HISTORY_IDS, formatTimestamp } from './sqliteHistoryPanelView.js';
import {
  describeCollectionQuery,
  type CollectionQueryLabels,
} from './savedCollectionQuery.js';
import type { SavedCollection } from '../../../utils/storage/savedCollections.js';

/** Event bundle the Panel builds once and hands to the region renderer. */
export interface SavedCollectionsRegionActions {
  /** Save the current conditions under the typed name; returns the in-row failure text. */
  onSave: (name: string) => Promise<{ ok: boolean; error?: string }>;
  /** Recall the stored conditions (no confirm needed — applying is not destructive). */
  onApply: (id: string) => void;
  /** Delete after the panel-side confirm dialog resolves. */
  onDelete: (id: string) => Promise<void>;
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
  const region = container.querySelector(`#${SQLITE_HISTORY_IDS.savedCollections}`);
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
        const label = saveButton.textContent;
        saveButton.disabled = true;
        saveButton.textContent = t('processing') || '処理中...';
        const fail = (message: string): void => {
          saveButton.disabled = false;
          saveButton.textContent = label;
          if (errorSpan) errorSpan.textContent = message;
        };
        try {
          const result = await actions.onSave(name);
          if (result.ok) return;
          fail(result.error ?? t('savedCollectionSaveError'));
        } catch (error) {
          fail(error instanceof Error ? error.message : t('savedCollectionSaveError'));
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
