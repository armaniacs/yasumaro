/**
 * tagsPanel.ts
 * タグ設定パネルの機能を提供するモジュール
 */

import { getMessage } from '../popup/i18n.js';
import { showStatus } from '../popup/settingsUiHelper.js';
import { getSettings, saveSettingsWithAllowedUrls, StorageKeys } from '../utils/storage.js';
import { DEFAULT_CATEGORIES } from '../utils/tagUtils.js';
import type { TagCategory } from '../utils/types.js';

/**
 * タグ設定パネルを初期化
 */
export async function initTagsPanel(): Promise<void> {
  const tagSummaryModeInput = document.getElementById('tagSummaryMode') as HTMLInputElement | null;
  const defaultCategoriesList = document.getElementById('defaultCategoriesList') as HTMLElement | null;
  const newCategoryInput = document.getElementById('newCategoryInput') as HTMLInputElement | null;
  const addCategoryBtn = document.getElementById('addCategoryBtn') as HTMLButtonElement | null;
  const saveTagsBtn = document.getElementById('saveTagsBtn') as HTMLButtonElement | null;
  const userCategoriesListEl = document.getElementById('userCategoriesList') as HTMLElement | null;
  const noUserCategoriesMsg = document.getElementById('noUserCategoriesMsg') as HTMLElement | null;

  // ユーザーが追加したカテゴリの状態（一時保存）
  let userCategories: string[] = [];

  /**
   * デフォルトカテゴリを表示
   */
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

  /**
   * ユーザーカテゴリを表示
   */
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

  /**
   * カテゴリを追加
   */
  const MAX_CATEGORY_NAME_LENGTH = 50;
  // タグパース形式（`# tag | summary`）を壊す可能性のある文字を禁止
  const INVALID_CATEGORY_CHARS = /[|#\n\r]/;

  function addCategory(): void {
    if (!newCategoryInput) return;
    const categoryName = newCategoryInput.value.trim();

    if (!categoryName) return;

    // 最大長チェック
    if (categoryName.length > MAX_CATEGORY_NAME_LENGTH) {
      alert(
        getMessage('categoryNameTooLong') ||
          `カテゴリ名が長すぎます（${MAX_CATEGORY_NAME_LENGTH}文字以内）`
      );
      return;
    }

    // 禁止文字チェック（|や#はタグパース形式を壊す可能性があるため禁止）
    if (INVALID_CATEGORY_CHARS.test(categoryName)) {
      alert(
        getMessage('categoryNameInvalidChars') ||
          'カテゴリ名に使用できない文字が含まれています（|、# は使用不可）'
      );
      return;
    }

    // 重複チェック
    const allCategories = [...DEFAULT_CATEGORIES, ...userCategories];
    if (allCategories.includes(categoryName)) {
      alert(getMessage('duplicateCategoryError') || 'このカテゴリ名は既に存在します');
      return;
    }

    userCategories.push(categoryName);
    newCategoryInput.value = '';
    renderUserCategories();
  }

  /**
   * 設定を保存
   */
  async function saveTagSettings(): Promise<void> {
    const settings = await getSettings();

    // タグ付き要約モード
    settings[StorageKeys.TAG_SUMMARY_MODE] = tagSummaryModeInput?.checked || false;

    // ユーザーカテゴリ
    settings[StorageKeys.TAG_CATEGORIES] = userCategories.map((name) => ({
      name,
      isDefault: false,
      createdAt: Date.now(),
    }));

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

  /**
   * 設定をロード
   */
  async function loadTagSettings(): Promise<void> {
    const settings = await getSettings();

    // タグ付き要約モード
    if (tagSummaryModeInput) {
      tagSummaryModeInput.checked = (settings[StorageKeys.TAG_SUMMARY_MODE] as boolean) || false;
    }

    // ユーザーカテゴリ
    const savedUserCategories =
      (settings[StorageKeys.TAG_CATEGORIES] as TagCategory[] | undefined) || [];
    userCategories = savedUserCategories.filter((c) => !c.isDefault).map((c) => c.name);
    renderUserCategories();
  }

  // 初期化
  renderDefaultCategories();
  await loadTagSettings();

  // イベントハンドラ
  addCategoryBtn?.addEventListener('click', addCategory);

  newCategoryInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCategory();
    }
  });

  saveTagsBtn?.addEventListener('click', saveTagSettings);
}
