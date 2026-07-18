/**
 * tagsPanel.ts
 * Tag settings panel: categories + normalization dictionary management.
 */

import { getMessage } from '../utils/i18n.js';
import { showStatus } from '../popup/settingsUiHelper.js';
import { getSettings, saveSettingsWithAllowedUrls, StorageKeys } from '../utils/storage.js';
import { DEFAULT_CATEGORIES } from '../utils/tagUtils.js';
import type { TagCategory, TagNormalizationEntry } from '../utils/types.js';

/**
 * Initialize the tag settings panel.
 */
export async function initTagsPanel(): Promise<void> {
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

  // In-memory state
  let userCategories: string[] = [];
  let normalizationEntries: TagNormalizationEntry[] = [];

  // ========================================================================
  // Default categories display
  // ========================================================================

  function renderDefaultCategories(): void {
    if (!defaultCategoriesList) return;
    defaultCategoriesList.innerHTML = '';
    DEFAULT_CATEGORIES.forEach((category) => {
      const item = document.createElement('button');
      item.className = 'default-category-item category-tag-btn';
      item.textContent = `#${category}`;
      item.title = `「#${category}」の履歴を表示`;
      item.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: category }));
      });
      defaultCategoriesList.appendChild(item);
    });
  }

  // ========================================================================
  // User categories display
  // ========================================================================

  function renderUserCategories(): void {
    if (!userCategoriesListEl || !noUserCategoriesMsg) return;

    userCategoriesListEl.innerHTML = '';

    if (userCategories.length === 0) {
      noUserCategoriesMsg.hidden = false;
      return;
    }

    noUserCategoriesMsg.hidden = true;

    userCategories.forEach((category, index) => {
      const item = document.createElement('div');
      item.className = 'user-category-item';

      const nameEl = document.createElement('button');
      nameEl.className = 'user-category-name category-tag-btn';
      nameEl.textContent = `#${category}`;
      nameEl.title = `「#${category}」の履歴を表示`;
      nameEl.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: category }));
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'user-category-delete';
      deleteBtn.textContent = '×';
      deleteBtn.setAttribute('aria-label', `Delete ${category}`);
      deleteBtn.addEventListener('click', () => {
        userCategories.splice(index, 1);
        renderUserCategories();
      });

      item.appendChild(nameEl);
      item.appendChild(deleteBtn);
      userCategoriesListEl.appendChild(item);
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
      alert(
        getMessage('categoryNameTooLong') ||
          `カテゴリ名が長すぎます（${MAX_CATEGORY_NAME_LENGTH}文字以内）`
      );
      return;
    }

    if (INVALID_CATEGORY_CHARS.test(categoryName)) {
      alert(
        getMessage('categoryNameInvalidChars') ||
          'カテゴリ名に使用できない文字が含まれています（|、# は使用不可）'
      );
      return;
    }

    const allCategories = [...DEFAULT_CATEGORIES, ...userCategories];
    if (allCategories.includes(categoryName)) {
      alert(getMessage('duplicateCategoryError') || 'このカテゴリ名は既に存在します');
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

    normEntriesList.innerHTML = '';

    if (normalizationEntries.length === 0) {
      noNormEntriesMsg.hidden = false;
      return;
    }

    noNormEntriesMsg.hidden = true;

    normalizationEntries.forEach((entry, index) => {
      const item = document.createElement('div');
      item.className = 'norm-entry-item';

      const label = document.createElement('span');
      label.className = 'norm-entry-label';
      label.textContent = `${entry.from} → ${entry.to}`;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'norm-entry-delete';
      deleteBtn.textContent = '×';
      deleteBtn.setAttribute('aria-label', `Delete mapping ${entry.from}`);
      deleteBtn.addEventListener('click', () => {
        normalizationEntries.splice(index, 1);
        renderNormalizationEntries();
      });

      item.appendChild(label);
      item.appendChild(deleteBtn);
      normEntriesList.appendChild(item);
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
    const normalizedFrom = from.trim().normalize('NFKC').toLowerCase();
    if (normalizationEntries.some(e => e.from.trim().normalize('NFKC').toLowerCase() === normalizedFrom)) {
      alert(getMessage('duplicateNormEntryError') || 'このFrom値は既に登録されています');
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
  // Settings save
  // ========================================================================

  async function saveTagSettings(): Promise<void> {
    const settings = await getSettings();

    // Tag summary mode
    settings[StorageKeys.TAG_SUMMARY_MODE] = tagSummaryModeInput?.checked || false;

    // User categories
    settings[StorageKeys.TAG_CATEGORIES] = userCategories.map((name) => ({
      name,
      isDefault: false,
      createdAt: Date.now(),
    }));

    // Normalization dictionary
    settings[StorageKeys.TAG_NORMALIZATION_DICT] = normalizationEntries;

    try {
      await saveSettingsWithAllowedUrls(settings);
      showStatus(
        'exportImportStatus',
        getMessage('tagSettingsSaved') || 'タグ設定を保存しました',
        'success'
      );
    } catch (error) {
      console.error('[TagsPanel] Failed to save tag settings:', error);
      showStatus('exportImportStatus', getMessage('saveError') || '保存エラー', 'error');
    }
  }

  // ========================================================================
  // Settings load
  // ========================================================================

  async function loadTagSettings(): Promise<void> {
    const settings = await getSettings();

    // Tag summary mode
    if (tagSummaryModeInput) {
      tagSummaryModeInput.checked = (settings[StorageKeys.TAG_SUMMARY_MODE] as boolean) || false;
    }

    // User categories
    const savedUserCategories =
      (settings[StorageKeys.TAG_CATEGORIES] as TagCategory[] | undefined) || [];
    userCategories = savedUserCategories.filter((c) => !c.isDefault).map((c) => c.name);
    renderUserCategories();

    // Normalization dictionary
    const savedDict =
      (settings[StorageKeys.TAG_NORMALIZATION_DICT] as TagNormalizationEntry[] | undefined) || [];
    normalizationEntries = savedDict.map(e => ({ from: e.from, to: e.to }));
    renderNormalizationEntries();
  }

  // ========================================================================
  // Initialization
  // ========================================================================

  renderDefaultCategories();
  await loadTagSettings();

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
  saveTagsBtn?.addEventListener('click', saveTagSettings);
}
