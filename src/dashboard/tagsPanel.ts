/**
 * tagsPanel.ts
 * Tag settings panel: categories + normalization dictionary management.
 */

import { saveSettingsAndRefreshDomainFilterCache } from '../utils/storage/domainFilterCache.js';
import { getMessageOr } from '../utils/i18n.js';
import { clearElement } from '../utils/domClear.js';
import { showStatus } from '../utils/ui/settingsUiHelper.js';
import { showAlertDialog } from '../utils/ui/confirmDialog.js';
import { StorageKeys } from '../utils/storage/types.js';
import { settingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { DEFAULT_CATEGORIES, foldTagForMatch } from '../utils/tagUtils.js';
import type { TagNormalizationEntry } from '../utils/types.js';
import { navigateToHistoryWithTag } from './panels/navigateToHistory.js';
import { createTagChip } from './tagChip.js';
import { buildTagNormalizationProposals, type TagNormalizationProposal } from './tagNormalizationProposals.js';
import { applyTagRename, undoTagRename, TagRenameError } from './tagRenameApplier.js';
import { wireProposalRow as wireSharedProposalRow } from './proposalRowWiring.js';
import { queryLogs, updateLog, isServiceError } from './dashboardSqliteService.js';
import { setElementHtml } from '../utils/htmlFragment.js';
import { escapeHtml } from '../utils/htmlEscape.js';
import { logError } from '../utils/logger/api.js';
import { ErrorCode } from '../utils/logger/types.js';
import { errorMessage } from '../utils/errorUtils.js';
import { MAX_BATCH_READ_RECORDS } from '../utils/limits.js';

/**
 * Initialize the tag settings panel.
 */
export async function initTagsPanel(repo: SettingsReader = settingsRepository): Promise<void> {
  // --- Category elements ---
  const tagSummaryModeInput = document.getElementById('tagSummaryMode') as HTMLInputElement | null;
  const defaultCategoriesList = document.getElementById('defaultCategoriesList') as HTMLElement | null;
  const newCategoryInput = document.getElementById('newCategoryInput') as HTMLInputElement | null;
  const addCategoryBtn = document.getElementById('addCategoryBtn') as HTMLButtonElement | null;
  const saveTagsBtn = document.getElementById('saveTagsBtn') as HTMLButtonElement | null;
  const userCategoriesListEl = document.getElementById('userCategoriesList') as HTMLElement | null;
  const noUserCategoriesMsg = document.getElementById('noUserCategoriesMsg') as HTMLElement | null;

  // --- Normalization dictionary elements ---
  const normFromInput = document.getElementById('normFromInput') as HTMLInputElement | null;
  const normToInput = document.getElementById('normToInput') as HTMLInputElement | null;
  const addNormEntryBtn = document.getElementById('addNormEntryBtn') as HTMLButtonElement | null;
  const normEntriesList = document.getElementById('normEntriesList') as HTMLElement | null;
  const noNormEntriesMsg = document.getElementById('noNormEntriesMsg') as HTMLElement | null;

  // --- Normalization proposal elements (PBI 2026-10-23-05) ---
  const refreshNormProposalsBtn = document.getElementById('refreshNormProposalsBtn') as HTMLButtonElement | null;
  const normProposalsEl = document.getElementById('tagNormProposals') as HTMLElement | null;

  // In-memory state
  let userCategories: string[] = [];
  let normalizationEntries: TagNormalizationEntry[] = [];

  // ========================================================================
  // Default categories display
  // ========================================================================

  function renderDefaultCategories(): void {
    if (!defaultCategoriesList) return;
    clearElement(defaultCategoriesList);
    DEFAULT_CATEGORIES.forEach((category) => {
      defaultCategoriesList.appendChild(
        createTagChip({
          label: `#${category}`,
          containerClass: 'default-category-item category-tag-btn',
          labelTitle: `「#${category}」の履歴を表示`,
          onLabelClick: () => navigateToHistoryWithTag(category),
        }),
      );
    });
  }

  // ========================================================================
  // User categories display
  // ========================================================================

  function renderUserCategories(): void {
    if (!userCategoriesListEl || !noUserCategoriesMsg) return;

    clearElement(userCategoriesListEl);

    if (userCategories.length === 0) {
      noUserCategoriesMsg.hidden = false;
      return;
    }

    noUserCategoriesMsg.hidden = true;

    userCategories.forEach((category, index) => {
      userCategoriesListEl.appendChild(
        createTagChip({
          label: `#${category}`,
          containerClass: 'user-category-item',
          labelClass: 'user-category-name category-tag-btn',
          labelTag: 'button',
          labelTitle: `「#${category}」の履歴を表示`,
          onLabelClick: () => navigateToHistoryWithTag(category),
          removeClass: 'user-category-delete',
          removeAriaLabel: `Delete ${category}`,
          onRemove: () => {
            userCategories.splice(index, 1);
            renderUserCategories();
          },
        }),
      );
    });
  }

  // ========================================================================
  // Category add logic
  // ========================================================================

  const MAX_CATEGORY_NAME_LENGTH = 50;
  const INVALID_CATEGORY_CHARS = /[|#\n\r]/;

  function addCategory(): void {
    if (!newCategoryInput) return;
    const categoryName = newCategoryInput.value.trim();

    if (!categoryName) return;

    if (categoryName.length > MAX_CATEGORY_NAME_LENGTH) {
      void showAlertDialog({
        message:
          getMessageOr('categoryNameTooLong', `カテゴリ名が長すぎます（${MAX_CATEGORY_NAME_LENGTH}文字以内）`),
      });
      return;
    }

    if (INVALID_CATEGORY_CHARS.test(categoryName)) {
      void showAlertDialog({
        message:
          getMessageOr('categoryNameInvalidChars', 'カテゴリ名に使用できない文字が含まれています（|、# は使用不可）'),
      });
      return;
    }

    const allCategories = [...DEFAULT_CATEGORIES, ...userCategories];
    if (allCategories.includes(categoryName)) {
      void showAlertDialog({ message: getMessageOr('duplicateCategoryError', 'このカテゴリ名は既に存在します')});
      return;
    }

    userCategories.push(categoryName);
    newCategoryInput.value = '';
    renderUserCategories();
  }

  // ========================================================================
  // Normalization dictionary display
  // ========================================================================

  function renderNormalizationEntries(): void {
    if (!normEntriesList || !noNormEntriesMsg) return;

    clearElement(normEntriesList);

    if (normalizationEntries.length === 0) {
      noNormEntriesMsg.hidden = false;
      return;
    }

    noNormEntriesMsg.hidden = true;

    normalizationEntries.forEach((entry, index) => {
      normEntriesList.appendChild(
        createTagChip({
          label: `${entry.from} → ${entry.to}`,
          containerClass: 'norm-entry-item',
          labelClass: 'norm-entry-label',
          removeClass: 'norm-entry-delete',
          removeAriaLabel: `Delete mapping ${entry.from}`,
          onRemove: () => {
            normalizationEntries.splice(index, 1);
            renderNormalizationEntries();
          },
        }),
      );
    });
  }

  // ========================================================================
  // Normalization entry add logic
  // ========================================================================

  function addNormalizationEntry(): void {
    if (!normFromInput || !normToInput) return;
    const from = normFromInput.value.trim();
    const to = normToInput.value.trim();

    if (!from || !to) return;

    // Check for duplicates (case-insensitive, matching normalizeTags behavior)
    const normalizedFrom = foldTagForMatch(from);
    if (normalizationEntries.some(e => foldTagForMatch(e.from) === normalizedFrom)) {
      void showAlertDialog({ message: getMessageOr('duplicateNormEntryError', 'このFrom値は既に登録されています')});
      return;
    }

    normalizationEntries.push({ from, to });
    normFromInput.value = '';
    normToInput.value = '';
    renderNormalizationEntries();

    // Focus back on the from input for quick entry
    normFromInput.focus();
  }

  // ========================================================================
  // Normalization proposals: show, apply, undo (PBI 2026-10-23-05)
  // ========================================================================

  // Bounded tag collection for proposals; shares the canonical batch
  // read cap with the research report (see limits.ts).

  async function collectStoredTags(): Promise<string[]> {
    const result = await queryLogs({ limit: MAX_BATCH_READ_RECORDS, orderBy: 'created_at', orderDir: 'DESC' });
    if (isServiceError(result)) return [];
    const tags = new Set<string>();
    for (const row of result.data.rows) {
      const csv = typeof row.tags === 'string' ? row.tags : '';
      for (const tag of csv.split(',')) {
        const trimmed = tag.trim();
        if (trimmed !== '') tags.add(trimmed);
      }
    }
    return [...tags];
  }

  function wireProposalRow(row: HTMLElement, proposal: TagNormalizationProposal): void {
    const deps = {
      queryByTag: async (tag: string) => {
        const result = await queryLogs({ tagFilter: tag, limit: MAX_BATCH_READ_RECORDS });
        if (isServiceError(result)) throw new Error(result.error);
        return result.data.rows
          .filter((r): r is typeof r & { id: number } => r.id !== undefined)
          .map((r) => ({ id: r.id, tags: typeof r.tags === 'string' ? r.tags : null }));
      },
      updateTags: async (id: number, tags: string) => {
        const result = await updateLog(id, { tags });
        if (isServiceError(result)) throw new Error(result.error);
      },
    };
    wireSharedProposalRow(
      row,
      {
        apply: async () => {
          const { updated } = await applyTagRename(deps, proposal.from, proposal.to);
          return getMessageOr('normProposalApplied', `${updated} 件のタグを書き換えました。`);
        },
        undo: async () => {
          await undoTagRename(deps, proposal.from, proposal.to);
          return getMessageOr('normProposalUndone', '取り消しました。');
        },
      },
      {
        formatApplyError: (error) => {
          const updated = error instanceof TagRenameError ? error.updated : 0;
          return `${errorMessage(error)} (${updated} 件適用済み)`;
        },
      },
    );
  }

  async function renderNormProposals(): Promise<void> {
    if (!normProposalsEl) return;
    normProposalsEl.hidden = false;
    clearElement(normProposalsEl);
    const storedTags = await collectStoredTags();
    const proposals = buildTagNormalizationProposals(storedTags, normalizationEntries);
    if (proposals.length === 0) {
      setElementHtml(normProposalsEl, `<p class="help-text">${escapeHtml(getMessageOr('normProposalsEmpty', '提案はありません。'))}</p>`);
      return;
    }
    setElementHtml(normProposalsEl, proposals.map((p) => `
      <div class="norm-proposal-row">
        <span class="norm-proposal-label">${escapeHtml(p.from)} → ${escapeHtml(p.to)}</span>
        <button type="button" class="secondary-btn" data-norm-action="apply">${escapeHtml(getMessageOr('normProposalApply', '適用'))}</button>
        <button type="button" class="secondary-btn" data-norm-action="undo" hidden>${escapeHtml(getMessageOr('normProposalUndo', '取消'))}</button>
        <div class="norm-proposal-status" role="status" aria-live="polite"></div>
      </div>`).join(''));
    const rows = normProposalsEl.querySelectorAll<HTMLElement>('.norm-proposal-row');
    proposals.forEach((proposal, index) => {
      const row = rows[index];
      if (row) wireProposalRow(row, proposal);
    });
  }

  // ========================================================================
  // Settings save
  // ========================================================================

  async function saveTagSettings(): Promise<void> {
    try {
      // Delta write (PBI 2026-09-17-17): this panel owns three keys, and the
      // literal is the payload. A getAll() snapshot would revert every key a
      // concurrent writer changed between that read and this write.
      await saveSettingsAndRefreshDomainFilterCache({
        // Tag summary mode
        [StorageKeys.TAG_SUMMARY_MODE]: tagSummaryModeInput?.checked || false,

        // User categories
        [StorageKeys.TAG_CATEGORIES]: userCategories.map((name) => ({
          name,
          isDefault: false,
          createdAt: Date.now(),
        })),

        // Normalization dictionary
        [StorageKeys.TAG_NORMALIZATION_DICT]: normalizationEntries,
      });
      showStatus(
        'exportImportStatus',
        getMessageOr('tagSettingsSaved', 'タグ設定を保存しました'),
        'success'
      );
    } catch (error) {
      void logError('[TagsPanel] Failed to save tag settings', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'tagsPanel');
      showStatus('exportImportStatus', getMessageOr('saveError', '保存エラー'), 'error');
    }
  }

  // ========================================================================
  // Settings load
  // ========================================================================

  async function loadTagSettings(repo: SettingsReader = settingsRepository): Promise<void> {
    const settings = await repo.getMany([
      StorageKeys.TAG_SUMMARY_MODE,
      StorageKeys.TAG_CATEGORIES,
      StorageKeys.TAG_NORMALIZATION_DICT,
    ]);

    // Tag summary mode
    if (tagSummaryModeInput) {
      tagSummaryModeInput.checked = settings[StorageKeys.TAG_SUMMARY_MODE] ?? false;
    }

    // User categories
    const savedUserCategories = settings[StorageKeys.TAG_CATEGORIES] ?? [];
    userCategories = savedUserCategories.filter((c) => !c.isDefault).map((c) => c.name);
    renderUserCategories();

    // Normalization dictionary
    const savedDict = settings[StorageKeys.TAG_NORMALIZATION_DICT] ?? [];
    normalizationEntries = savedDict.map(e => ({ from: e.from, to: e.to }));
    renderNormalizationEntries();
  }

  // ========================================================================
  // Initialization
  // ========================================================================

  renderDefaultCategories();
  await loadTagSettings(repo);

  // Category event handlers
  addCategoryBtn?.addEventListener('click', addCategory);
  newCategoryInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCategory();
    }
  });

  // Normalization dictionary event handlers
  addNormEntryBtn?.addEventListener('click', addNormalizationEntry);
  normFromInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // If "to" is empty and "from" is filled, move focus to "to"
      if (normFromInput.value.trim() && !normToInput?.value?.trim()) {
        normToInput?.focus();
      } else {
        addNormalizationEntry();
      }
    }
  });
  normToInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNormalizationEntry();
    }
  });

  // Main save button
  saveTagsBtn?.addEventListener('click', () => saveTagSettings());

  // Normalization proposals (PBI 2026-10-23-05): lazy load on demand so the
  // panel opens without a sqlite round-trip; dict edits refresh when shown.
  refreshNormProposalsBtn?.addEventListener('click', () => {
    refreshNormProposalsBtn.disabled = true;
    void renderNormProposals().finally(() => {
      refreshNormProposalsBtn.disabled = false;
    });
  });
}
