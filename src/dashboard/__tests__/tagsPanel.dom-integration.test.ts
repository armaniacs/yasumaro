// @vitest-environment jsdom
/**
 * tagsPanel.dom-integration.test.ts
 * DOM integration tests for tagsPanel.ts
 * Tests initTagsPanel function with full DOM environment
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TagCategory } from '../../utils/types.js';

// Mock chrome global before importing modules
vi.stubGlobal('chrome', {
  i18n: {
    getMessage: vi.fn((key: string) => `i18n_${key}`),
    getUILanguage: vi.fn(() => 'en'),
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
});

// Mock i18n
vi.mock('../popup/i18n.js', () => ({
  getMessage: (key: string) => `i18n_${key}`,
}));

// Mock storage
vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined),
  StorageKeys: {
    TAG_SUMMARY_MODE: 'tagSummaryMode',
    TAG_CATEGORIES: 'tagCategories',
  },
}));

// Mock settingsUiHelper
vi.mock('../popup/settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

// Mock tagUtils
vi.mock('../../utils/tagUtils.js', () => ({
  DEFAULT_CATEGORIES: ['tech', 'news', 'shopping', 'social'],
}));

import { initTagsPanel } from '../tagsPanel.js';
import { getSettings, saveSettingsWithAllowedUrls } from '../../utils/storage.js';

describe('tagsPanel DOM Integration Tests', () => {
  const requiredDomElements = `
    <input id="tagSummaryMode" type="checkbox" />
    <div id="defaultCategoriesList"></div>
    <input id="newCategoryInput" />
    <button id="addCategoryBtn"></button>
    <button id="saveTagsBtn"></button>
    <div id="userCategoriesList"></div>
    <div id="noUserCategoriesMsg"></div>
  `;

  beforeEach(() => {
    document.body.innerHTML = requiredDomElements;
    vi.clearAllMocks();
    // Reset mock implementations
    (getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (saveSettingsWithAllowedUrls as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('initTagsPanel', () => {
    it('renders default categories on initialization', async () => {
      await initTagsPanel();
      const defaultCategoriesList = document.getElementById('defaultCategoriesList');
      expect(defaultCategoriesList?.children.length).toBeGreaterThan(0);
    });

    it('loads tag settings from storage', async () => {
      await initTagsPanel();
      expect(getSettings).toHaveBeenCalled();
    });

    it('loads user categories from settings', async () => {
      (getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tagCategories: [
          { name: 'custom1', isDefault: false, createdAt: Date.now() },
          { name: 'custom2', isDefault: false, createdAt: Date.now() },
        ],
      });
      await initTagsPanel();
      const userCategoriesList = document.getElementById('userCategoriesList');
      expect(userCategoriesList?.children.length).toBe(2);
    });

    it('shows no user categories message when list is empty', async () => {
      (getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
      await initTagsPanel();
      const noUserCategoriesMsg = document.getElementById('noUserCategoriesMsg');
      expect(noUserCategoriesMsg?.hidden).toBe(false);
    });

    it('hides no user categories message when categories exist', async () => {
      (getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tagCategories: [{ name: 'custom1', isDefault: false, createdAt: Date.now() }],
      });
      await initTagsPanel();
      const noUserCategoriesMsg = document.getElementById('noUserCategoriesMsg');
      expect(noUserCategoriesMsg?.hidden).toBe(true);
    });

    it('sets up add category button click handler', async () => {
      await initTagsPanel();
      const newCategoryInput = document.getElementById('newCategoryInput') as HTMLInputElement;
      const addCategoryBtn = document.getElementById('addCategoryBtn') as HTMLButtonElement;
      newCategoryInput.value = 'newCategory';
      addCategoryBtn.click();
      expect(newCategoryInput.value).toBe('');
    });

    it('adds category via Enter key in input', async () => {
      await initTagsPanel();
      const newCategoryInput = document.getElementById('newCategoryInput') as HTMLInputElement;
      newCategoryInput.value = 'enterCategory';
      newCategoryInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));
      expect(newCategoryInput.value).toBe('');
    });

    it('sets up save tags button click handler', async () => {
      await initTagsPanel();
      const saveTagsBtn = document.getElementById('saveTagsBtn') as HTMLButtonElement;
      saveTagsBtn.click();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(saveSettingsWithAllowedUrls).toHaveBeenCalled();
    });

    it('loads tag summary mode from settings', async () => {
      (getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tagSummaryMode: true,
      });
      await initTagsPanel();
      const tagSummaryModeInput = document.getElementById('tagSummaryMode') as HTMLInputElement;
      expect(tagSummaryModeInput.checked).toBe(true);
    });

    it('default tag summary mode is false', async () => {
      (getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
      await initTagsPanel();
      const tagSummaryModeInput = document.getElementById('tagSummaryMode') as HTMLInputElement;
      expect(tagSummaryModeInput.checked).toBe(false);
    });

    it('validates category name length (max 50 chars)', async () => {
      await initTagsPanel();
      const newCategoryInput = document.getElementById('newCategoryInput') as HTMLInputElement;
      const addCategoryBtn = document.getElementById('addCategoryBtn') as HTMLButtonElement;
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      newCategoryInput.value = 'a'.repeat(51);
      addCategoryBtn.click();
      expect(alertSpy).toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('validates category name for invalid characters', async () => {
      await initTagsPanel();
      const newCategoryInput = document.getElementById('newCategoryInput') as HTMLInputElement;
      const addCategoryBtn = document.getElementById('addCategoryBtn') as HTMLButtonElement;
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      newCategoryInput.value = 'category|with|pipe';
      addCategoryBtn.click();
      expect(alertSpy).toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('prevents duplicate category names', async () => {
      (getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
      await initTagsPanel();
      const newCategoryInput = document.getElementById('newCategoryInput') as HTMLInputElement;
      const addCategoryBtn = document.getElementById('addCategoryBtn') as HTMLButtonElement;
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      // Try to add 'tech' which is in DEFAULT_CATEGORIES
      newCategoryInput.value = 'tech';
      addCategoryBtn.click();
      expect(alertSpy).toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('clicking default category dispatches navigate-to-tag event', async () => {
      await initTagsPanel();
      const eventSpy = vi.fn();
      document.addEventListener('navigate-to-tag', eventSpy);
      const defaultCategoryBtn = document.querySelector('.default-category-item') as HTMLButtonElement;
      defaultCategoryBtn.click();
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.any(String),
        })
      );
    });

    it('clicking user category dispatches navigate-to-tag event', async () => {
      (getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tagCategories: [{ name: 'customTag', isDefault: false, createdAt: Date.now() }],
      });
      await initTagsPanel();
      const eventSpy = vi.fn();
      document.addEventListener('navigate-to-tag', eventSpy);
      const userCategoryBtn = document.querySelector('.user-category-name') as HTMLButtonElement;
      userCategoryBtn.click();
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: 'customTag',
        })
      );
    });

    it('can delete user category', async () => {
      (getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tagCategories: [{ name: 'toBeDeleted', isDefault: false, createdAt: Date.now() }],
      });
      await initTagsPanel();
      const userCategoriesList = document.getElementById('userCategoriesList');
      expect(userCategoriesList?.children.length).toBe(1);
      const deleteBtn = document.querySelector('.user-category-delete') as HTMLButtonElement;
      deleteBtn.click();
      expect(userCategoriesList?.children.length).toBe(0);
    });

    it('saves tag settings with correct data structure', async () => {
      (getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
      await initTagsPanel();

      // Add a category
      const newCategoryInput = document.getElementById('newCategoryInput') as HTMLInputElement;
      const addCategoryBtn = document.getElementById('addCategoryBtn') as HTMLButtonElement;
      newCategoryInput.value = 'myNewCategory';
      addCategoryBtn.click();

      // Save
      const saveTagsBtn = document.getElementById('saveTagsBtn') as HTMLButtonElement;
      saveTagsBtn.click();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(saveSettingsWithAllowedUrls).toHaveBeenCalledWith(
        expect.objectContaining({
          tagCategories: expect.arrayContaining([
            expect.objectContaining({
              name: 'myNewCategory',
              isDefault: false,
            }),
          ]),
        }),
      );
    });
  });
});