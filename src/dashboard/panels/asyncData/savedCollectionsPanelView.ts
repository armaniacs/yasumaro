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
  duplicateSavedCollectionById,
  removeSavedCollectionById,
  upsertSavedCollectionById,
} from '../../../utils/storage/savedCollectionsRepository.js';
import type { SavedCollection } from '../../../utils/storage/savedCollections.js';
import {
  getAutoTagApplications,
  getAutoTagRules,
  pruneAutoTagApplications,
  removeAutoTagRuleById,
  upsertAutoTagRuleById,
} from '../../../utils/storage/autoTagRulesRepository.js';
import {
  normalizeAutoTagRules,
  type AutoTagRule,
} from '../../../utils/storage/autoTagRules.js';
import { undoAutoTagRule } from '../../autoTagUndo.js';
import { isServiceError, queryLogs, updateLog } from '../../dashboardSqliteService.js';

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
  /** Rename in place (same id, query kept, updatedAt stamped). */
  onRename: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  /** Duplicate under a fresh id with the caller's display name. */
  onDuplicate: (id: string, name: string) => Promise<void>;
  /** Add one auto-tag rule from the rule form; returns the in-row failure text. */
  onAddRule: (input: {
    name: string;
    domainSuffix: string;
    urlContains: string;
    titleContains: string;
    tag: string;
    priority: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Flip one rule's enabled flag. */
  onToggleRule: (id: string, enabled: boolean) => Promise<void>;
  /** Delete one rule after the confirm dialog resolves. */
  onDeleteRule: (id: string) => Promise<void>;
  /** Undo one rule: remove its tag from the logged records, prune the log. */
  onUndoRule: (id: string) => Promise<{ ok: boolean; message: string }>;
}

/**
 * Narrow inputs the region needs from the Panel side. The region owns the
 * save/apply/delete/rename/duplicate behavior (PBI 2026-10-23-06,
 * 2026-10-24-05) and the auto-tag rule CRUD + undo; the Panel only supplies
 * the current query input, the recall dispatch, live data, and a reload hook
 * that repaints the region after a mutation.
 */
export interface SavedCollectionsDeps {
  getQueryInput: () => CollectionQueryInput;
  applyCollection: (query: Record<string, unknown>) => void;
  getCollections: () => Record<string, SavedCollection>;
  getRules: () => Record<string, AutoTagRule>;
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

  async function renameSavedCollection(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
    const collection = deps.getCollections()[id];
    if (!collection) return { ok: false, error: t('savedCollectionSaveError') };
    const trimmed = name.trim();
    if (trimmed === '') return { ok: false, error: t('savedCollectionNameEmpty') };
    try {
      // Same-id upsert keeps the query and createdAt, stamps updatedAt.
      await upsertSavedCollectionById(id, trimmed, collection.query, Date.now());
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
    await deps.reload();
    return { ok: true };
  }

  async function duplicateSavedCollectionAction(id: string, name: string): Promise<void> {
    const trimmed = name.trim() === '' ? t('savedCollectionCopyName', [deps.getCollections()[id]?.name ?? '']) : name.trim();
    try {
      await duplicateSavedCollectionById(id, newCollectionId(), trimmed, Date.now());
    } catch {
      // Degraded exit: a failed duplicate keeps the list as-is instead of throwing.
      return;
    }
    await deps.reload();
  }

  async function addAutoTagRule(input: {
    name: string;
    domainSuffix: string;
    urlContains: string;
    titleContains: string;
    tag: string;
    priority: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const name = input.name.trim();
    const tag = input.tag.trim();
    if (name === '' || tag === '') return { ok: false, error: t('autoTagRuleNameTagRequired') };
    const priority = input.priority.trim() === '' ? 100 : Number(input.priority);
    if (!Number.isFinite(priority)) return { ok: false, error: t('autoTagRuleBadPriority') };
    const rule = normalizeAutoTagRules({
      [newCollectionId()]: {
        name,
        domainSuffix: input.domainSuffix.trim(),
        urlContains: input.urlContains.trim(),
        titleContains: input.titleContains.trim(),
        tag,
        priority,
        enabled: true,
      },
    });
    const id = Object.keys(rule)[0];
    // A rule with no conditions (or a bad tag shape) fails closed here so the
    // store never holds a match-everything rule.
    if (id === undefined || !rule[id]) return { ok: false, error: t('autoTagRuleNoCondition') };
    try {
      await upsertAutoTagRuleById(rule[id] as AutoTagRule);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
    await deps.reload();
    return { ok: true };
  }

  async function toggleAutoTagRule(id: string, enabled: boolean): Promise<void> {
    const rule = deps.getRules()[id];
    if (!rule) return;
    try {
      await upsertAutoTagRuleById({ ...rule, enabled });
    } catch {
      return;
    }
    await deps.reload();
  }

  async function deleteAutoTagRule(id: string): Promise<void> {
    const rule = deps.getRules()[id];
    if (!rule) return;
    const confirmed = await showConfirmDialog({
      title: t('autoTagRulesLabel'),
      message: t('autoTagRuleDeleteConfirm', [rule.name]),
      confirmLabel: t('autoTagRuleDeleteBtn'),
      cancelLabel: t('cancel'),
      dangerous: true,
    });
    if (!confirmed) return;
    try {
      await removeAutoTagRuleById(id);
    } catch {
      return;
    }
    await deps.reload();
  }

  async function undoAutoTagRuleAction(id: string): Promise<{ ok: boolean; message: string }> {
    const rule = deps.getRules()[id];
    if (!rule) return { ok: false, message: t('savedCollectionSaveError') };
    const confirmed = await showConfirmDialog({
      title: t('autoTagRulesLabel'),
      message: t('autoTagRuleUndoConfirm', [rule.name, rule.tag]),
      confirmLabel: t('autoTagRuleUndoBtn'),
      cancelLabel: t('cancel'),
      dangerous: false,
    });
    if (!confirmed) return { ok: false, message: '' };
    try {
      const applications = await getAutoTagApplications();
      const { removed, pruned } = await undoAutoTagRule(
        {
          queryByTag: async (tag: string) => {
            const result = await queryLogs({ tagFilter: tag, limit: 1000 });
            if (isServiceError(result)) throw new Error(result.error);
            return result.data.rows
              .filter((r): r is typeof r & { id: number } => r.id !== undefined)
              .map((r) => ({ id: r.id, tags: typeof r.tags === 'string' ? r.tags : null, url: r.url }));
          },
          updateTags: async (rowId: number, tags: string) => {
            const result = await updateLog(rowId, { tags });
            if (isServiceError(result)) throw new Error(result.error);
          },
        },
        id,
        rule.tag,
        applications,
      );
      await pruneAutoTagApplications((entry) => !pruned.some(
        (p) => p.ruleId === entry.ruleId && p.url === entry.url && p.at === entry.at,
      ));
      return { ok: true, message: t('autoTagRuleUndoDone', [String(removed)]) };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  return {
    onSave: (name) => saveCollection(name),
    onApply: (id) => applySavedCollection(id),
    onDelete: (id) => deleteSavedCollection(id),
    onRename: (id, name) => renameSavedCollection(id, name),
    onDuplicate: (id, name) => duplicateSavedCollectionAction(id, name),
    onAddRule: (input) => addAutoTagRule(input),
    onToggleRule: (id, enabled) => toggleAutoTagRule(id, enabled),
    onDeleteRule: (id) => deleteAutoTagRule(id),
    onUndoRule: (id) => undoAutoTagRuleAction(id),
  };
}

/**
 * Region-owned load entry: fetch the stored collections and rules, paint the
 * region. The Panel calls this from load() and from the reload hook above, so
 * the fetch + render pairing lives next to the actions that trigger it.
 */
export async function loadSavedCollectionsRegion(
  container: HTMLElement,
  deps: SavedCollectionsDeps & { render: (collections: Record<string, SavedCollection>, rules: Record<string, AutoTagRule>) => void },
): Promise<{ collections: Record<string, SavedCollection>; rules: Record<string, AutoTagRule> }> {
  const [collections, rules] = await Promise.all([getSavedCollections(), getAutoTagRules()]);
  deps.render(collections, rules);
  return { collections, rules };
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
    <div class="saved-collection-rename hidden">
      <input type="text" class="saved-collection-rename-input" value="${escapeHtml(collection.name)}"
        aria-label="${escapeHtml(t('savedCollectionRenameBtn'))}" />
      <button type="button" class="secondary-btn" data-collection-action="rename-save"
        data-collection-id="${escapeHtml(collection.id)}">${escapeHtml(t('savedCollectionRenameSaveBtn'))}</button>
      <button type="button" class="secondary-btn" data-collection-action="rename-cancel"
        data-collection-id="${escapeHtml(collection.id)}">${escapeHtml(t('cancel'))}</button>
      <span class="saved-collection-rename-error" role="alert"></span>
    </div>
    <div class="saved-collection-actions">
      <button type="button" class="secondary-btn" data-collection-action="apply"
        data-collection-id="${escapeHtml(collection.id)}">${escapeHtml(t('savedCollectionApplyBtn'))}</button>
      <button type="button" class="secondary-btn" data-collection-action="rename"
        data-collection-id="${escapeHtml(collection.id)}">${escapeHtml(t('savedCollectionRenameBtn'))}</button>
      <button type="button" class="secondary-btn" data-collection-action="duplicate"
        data-collection-id="${escapeHtml(collection.id)}">${escapeHtml(t('savedCollectionDuplicateBtn'))}</button>
      <button type="button" class="secondary-btn" data-collection-action="delete"
        data-collection-id="${escapeHtml(collection.id)}" aria-label="${escapeHtml(t('savedCollectionDeleteBtn'))}">${escapeHtml(t('savedCollectionDeleteBtn'))}</button>
    </div>
  </div>`;
}

function describeRuleConditions(rule: AutoTagRule): string {
  const parts: string[] = [];
  if (rule.domainSuffix !== undefined) parts.push(`domain:${rule.domainSuffix}`);
  if (rule.urlContains !== undefined) parts.push(`url:${rule.urlContains}`);
  if (rule.titleContains !== undefined) parts.push(`title:${rule.titleContains}`);
  return parts.join(' + ');
}

function buildRuleRowHtml(rule: AutoTagRule): string {
  return `<div class="auto-tag-rule-row" data-rule-id="${escapeHtml(rule.id)}">
    <div class="auto-tag-rule-info">
      <span class="auto-tag-rule-name">${escapeHtml(rule.name)}</span>
      <div class="auto-tag-rule-meta">${escapeHtml(describeRuleConditions(rule))} → #${escapeHtml(rule.tag)} · ${escapeHtml(t('autoTagRulePriority', [String(rule.priority)]))}</div>
    </div>
    <div class="auto-tag-rule-actions">
      <label class="auto-tag-rule-enabled">
        <input type="checkbox" data-rule-action="toggle" data-rule-id="${escapeHtml(rule.id)}"${rule.enabled ? ' checked' : ''}
          aria-label="${escapeHtml(t('autoTagRuleEnableLabel'))}" />
      </label>
      <button type="button" class="secondary-btn" data-rule-action="undo"
        data-rule-id="${escapeHtml(rule.id)}">${escapeHtml(t('autoTagRuleUndoBtn'))}</button>
      <button type="button" class="secondary-btn" data-rule-action="delete"
        data-rule-id="${escapeHtml(rule.id)}" aria-label="${escapeHtml(t('autoTagRuleDeleteBtn'))}">${escapeHtml(t('autoTagRuleDeleteBtn'))}</button>
    </div>
    <span class="auto-tag-rule-message" role="status"></span>
  </div>`;
}

function buildRulesSectionHtml(rules: Record<string, AutoTagRule>): string {
  const entries = Object.values(rules).sort((a, b) =>
    (a.priority === b.priority ? (a.id < b.id ? -1 : 1) : a.priority - b.priority));
  const list = entries.length > 0
    ? entries.map((r) => buildRuleRowHtml(r)).join('')
    : `<div class="auto-tag-rules-empty">${escapeHtml(t('autoTagRulesEmpty'))}</div>`;
  return `<div class="auto-tag-rules-section">
    <h4 data-i18n="autoTagRulesLabel">${escapeHtml(t('autoTagRulesLabel'))}</h4>
    <p class="auto-tag-rules-help" data-i18n="autoTagRulesHelp">${escapeHtml(t('autoTagRulesHelp'))}</p>
    <div class="auto-tag-rule-form">
      <input type="text" class="auto-tag-rule-name" placeholder="${escapeHtml(t('autoTagRuleNamePlaceholder'))}"
        aria-label="${escapeHtml(t('autoTagRuleNamePlaceholder'))}" />
      <input type="text" class="auto-tag-rule-domain" placeholder="${escapeHtml(t('autoTagRuleDomainPlaceholder'))}"
        aria-label="${escapeHtml(t('autoTagRuleDomainPlaceholder'))}" />
      <input type="text" class="auto-tag-rule-url" placeholder="${escapeHtml(t('autoTagRuleUrlPlaceholder'))}"
        aria-label="${escapeHtml(t('autoTagRuleUrlPlaceholder'))}" />
      <input type="text" class="auto-tag-rule-title" placeholder="${escapeHtml(t('autoTagRuleTitlePlaceholder'))}"
        aria-label="${escapeHtml(t('autoTagRuleTitlePlaceholder'))}" />
      <input type="text" class="auto-tag-rule-tag" placeholder="${escapeHtml(t('autoTagRuleTagPlaceholder'))}"
        aria-label="${escapeHtml(t('autoTagRuleTagPlaceholder'))}" />
      <input type="text" class="auto-tag-rule-priority" placeholder="${escapeHtml(t('autoTagRulePriorityPlaceholder'))}"
        aria-label="${escapeHtml(t('autoTagRulePriorityPlaceholder'))}" inputmode="numeric" />
      <button type="button" class="secondary-btn" data-rule-action="add">${escapeHtml(t('autoTagRuleAddBtn'))}</button>
      <span class="auto-tag-rule-form-error" role="alert"></span>
    </div>
    <div class="auto-tag-rules-list">${list}</div>
  </div>`;
}

function buildRegionInnerHtml(
  collections: Record<string, SavedCollection>,
  rules: Record<string, AutoTagRule>,
): string {
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
    ${buildRulesSectionHtml(rules)}
  </div>`;
}

/**
 * Region-scoped render entry for saved collections and auto-tag rules. The
 * shell placeholder is owned by buildPanelShellHtml; this function fills it
 * and wires the save / apply / delete / rename / duplicate / rule controls.
 * In-row failure text survives until the next wholesale re-render (a
 * successful mutation replaces the region).
 */
export function renderSavedCollectionsRegion(
  container: HTMLElement,
  collections: Record<string, SavedCollection>,
  rules: Record<string, AutoTagRule>,
  actions: SavedCollectionsRegionActions,
): void {
  const region = container.querySelector(`#${SAVED_COLLECTIONS_REGION_ID}`);
  if (!(region instanceof HTMLElement)) return;

  setElementHtml(region, buildRegionInnerHtml(collections, rules));

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
      '[data-collection-action="apply"], [data-collection-action="delete"], [data-collection-action="rename"], [data-collection-action="duplicate"], [data-collection-action="rename-save"], [data-collection-action="rename-cancel"]',
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
      const row = button.closest('.saved-collection-row');
      if (action === 'rename') {
        // Inline edit swaps inside the row — no region re-render, so the
        // input keeps focus while the rename editor is open.
        row?.querySelector('.saved-collection-info')?.classList.add('hidden');
        row?.querySelector('.saved-collection-actions')?.classList.add('hidden');
        row?.querySelector('.saved-collection-rename')?.classList.remove('hidden');
        row?.querySelector<HTMLInputElement>('.saved-collection-rename-input')?.focus();
        return;
      }
      if (action === 'rename-cancel') {
        row?.querySelector('.saved-collection-info')?.classList.remove('hidden');
        row?.querySelector('.saved-collection-actions')?.classList.remove('hidden');
        row?.querySelector('.saved-collection-rename')?.classList.add('hidden');
        return;
      }
      if (action === 'rename-save') {
        const input = row?.querySelector<HTMLInputElement>('.saved-collection-rename-input');
        const error = row?.querySelector<HTMLElement>('.saved-collection-rename-error');
        void (async () => {
          const result = await actions.onRename(id, input?.value ?? '');
          if (!result.ok && error) error.textContent = result.error ?? t('savedCollectionSaveError');
        })();
        return;
      }
      if (action === 'duplicate') {
        void (async () => {
          button.disabled = true;
          try {
            // The display name is resolved panel-side (copy suffix i18n).
            await actions.onDuplicate(id, '');
          } finally {
            button.disabled = false;
          }
        })();
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

  wireRuleControls(region, actions);
}

function queryRuleInput(region: HTMLElement, cls: string): string {
  return region.querySelector<HTMLInputElement>(`.${cls}`)?.value.trim() ?? '';
}

function wireRuleControls(region: HTMLElement, actions: SavedCollectionsRegionActions): void {
  const addButton = region.querySelector<HTMLButtonElement>('[data-rule-action="add"]');
  const formError = region.querySelector<HTMLElement>('.auto-tag-rule-form-error');
  addButton?.addEventListener('click', () => {
    void (async () => {
      addButton.disabled = true;
      try {
        const result = await actions.onAddRule({
          name: queryRuleInput(region, 'auto-tag-rule-name'),
          domainSuffix: queryRuleInput(region, 'auto-tag-rule-domain'),
          urlContains: queryRuleInput(region, 'auto-tag-rule-url'),
          titleContains: queryRuleInput(region, 'auto-tag-rule-title'),
          tag: queryRuleInput(region, 'auto-tag-rule-tag'),
          priority: queryRuleInput(region, 'auto-tag-rule-priority'),
        });
        if (!result.ok && formError) formError.textContent = result.error ?? t('savedCollectionSaveError');
      } finally {
        // Success replaces the region wholesale; failure keeps it clickable.
        addButton.disabled = false;
      }
    })();
  });

  for (const toggle of Array.from(region.querySelectorAll<HTMLInputElement>('[data-rule-action="toggle"]'))) {
    const id = toggle.dataset.ruleId ?? '';
    toggle.addEventListener('change', () => {
      if (id === '') return;
      void actions.onToggleRule(id, toggle.checked);
    });
  }

  for (const button of Array.from(region.querySelectorAll<HTMLButtonElement>('[data-rule-action="delete"], [data-rule-action="undo"]'))) {
    const id = button.dataset.ruleId ?? '';
    const action = button.dataset.ruleAction;
    button.addEventListener('click', () => {
      if (id === '') return;
      void (async () => {
        button.disabled = true;
        try {
          if (action === 'undo') {
            const message = button.closest('.auto-tag-rule-row')?.querySelector<HTMLElement>('.auto-tag-rule-message');
            const result = await actions.onUndoRule(id);
            if (message) message.textContent = result.message;
          } else {
            await actions.onDeleteRule(id);
          }
        } finally {
          button.disabled = false;
        }
      })();
    });
  }
}
