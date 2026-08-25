// @vitest-environment jsdom
/**
 * tagsPanel-r2.test.ts
 * R2: Cover remaining branches — normalization dictionary add/remove,
 * save errors, empty-state messaging, Enter key focusing behavior,
 * duplicate norm entry detection, and renderDefaultCategories coverage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('../../utils/i18n.js', () => ({
  getMessage: (key: string) => `i18n_${key}`,
}));

const { mockGetAll, mockGetMany, mockSetAll } = vi.hoisted(() => ({
  mockGetAll: vi.fn().mockResolvedValue({}),
  mockGetMany: vi.fn().mockResolvedValue({}),
  mockSetAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    StorageKeys: {
      TAG_SUMMARY_MODE: 'tagSummaryMode',
      TAG_CATEGORIES: 'tagCategories',
      TAG_NORMALIZATION_DICT: 'tag_normalization_dict',
      ALLOWED_URLS: 'allowed_urls',
      ALLOWED_URLS_HASH: 'allowed_urls_hash',
    },
  };
});

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      getMany: mockGetMany,
      setAll: mockSetAll,
      get: vi.fn(),
      set: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      getMany = mockGetMany;
      setAll = mockSetAll;
      get = vi.fn();
      set = vi.fn();
    },
  };
});

vi.mock('../../utils/ui/settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

vi.mock('../../utils/tagUtils.js', () => ({
  DEFAULT_CATEGORIES: ['tech', 'news', 'shopping', 'social'],
}));

import { initTagsPanel } from '../tagsPanel.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';

function fullDom(): void {
  document.body.innerHTML = `
    <input id="tagSummaryMode" type="checkbox" />
    <div id="defaultCategoriesList"></div>
    <input id="newCategoryInput" />
    <button id="addCategoryBtn"></button>
    <button id="saveTagsBtn"></button>
    <div id="userCategoriesList"></div>
    <div id="noUserCategoriesMsg"></div>
    <input id="normFromInput" />
    <input id="normToInput" />
    <button id="addNormEntryBtn"></button>
    <div id="normEntriesList"></div>
    <div id="noNormEntriesMsg"></div>
    <div id="exportImportStatus"></div>
  `;
}

describe('tagsPanel-r2 — Normalization dictionary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll.mockResolvedValue({});
    mockGetMany.mockResolvedValue({});
    mockSetAll.mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows no entries message when normalization list is empty', async () => {
    fullDom();
    await initTagsPanel();
    const msg = document.getElementById('noNormEntriesMsg')!;
    expect(msg.hidden).toBe(false);
  });

  it('hides no entries message when normalization entries exist', async () => {
    fullDom();
    mockGetMany.mockResolvedValueOnce({
      tag_normalization_dict: [{ from: 'foo', to: 'bar' }],
    });
    mockGetAll.mockResolvedValueOnce({
      tag_normalization_dict: [{ from: 'foo', to: 'bar' }],
    });
    await initTagsPanel();
    const msg = document.getElementById('noNormEntriesMsg')!;
    expect(msg.hidden).toBe(true);
  });

  it('adds normalization entry via button click', async () => {
    fullDom();
    await initTagsPanel();
    const fromInput = document.getElementById('normFromInput') as HTMLInputElement;
    const toInput = document.getElementById('normToInput') as HTMLInputElement;
    const addBtn = document.getElementById('addNormEntryBtn') as HTMLButtonElement;

    fromInput.value = 'OldName';
    toInput.value = 'NewName';
    addBtn.click();

    const items = document.querySelectorAll('.norm-entry-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('OldName');
    expect(fromInput.value).toBe('');
    expect(toInput.value).toBe('');
  });

  it('prevents duplicate normalization entries (case-insensitive NFKC)', async () => {
    fullDom();
    mockGetMany.mockResolvedValueOnce({
      tag_normalization_dict: [{ from: 'Hello', to: 'World' }],
    });
    mockGetAll.mockResolvedValueOnce({
      tag_normalization_dict: [{ from: 'Hello', to: 'World' }],
    });
    await initTagsPanel();

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const fromInput = document.getElementById('normFromInput') as HTMLInputElement;
    const toInput = document.getElementById('normToInput') as HTMLInputElement;
    const addBtn = document.getElementById('addNormEntryBtn') as HTMLButtonElement;

    fromInput.value = 'hello'; // duplicate (case-insensitive)
    toInput.value = 'Earth';
    addBtn.click();
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('does not add entry when from or to is empty', async () => {
    fullDom();
    await initTagsPanel();
    const addBtn = document.getElementById('addNormEntryBtn') as HTMLButtonElement;

    // Empty from
    (document.getElementById('normFromInput') as HTMLInputElement).value = '';
    (document.getElementById('normToInput') as HTMLInputElement).value = 'bar';
    addBtn.click();
    expect(document.querySelectorAll('.norm-entry-item').length).toBe(0);

    // Empty to
    (document.getElementById('normFromInput') as HTMLInputElement).value = 'foo';
    (document.getElementById('normToInput') as HTMLInputElement).value = '';
    addBtn.click();
    expect(document.querySelectorAll('.norm-entry-item').length).toBe(0);
  });

  it('deletes normalization entry via delete button', async () => {
    fullDom();
    mockGetMany.mockResolvedValueOnce({
      tag_normalization_dict: [{ from: 'keep', to: 'keep' }],
    });
    mockGetAll.mockResolvedValueOnce({
      tag_normalization_dict: [{ from: 'keep', to: 'keep' }],
    });
    await initTagsPanel();

    // Add another entry
    const fromInput = document.getElementById('normFromInput') as HTMLInputElement;
    const toInput = document.getElementById('normToInput') as HTMLInputElement;
    const addBtn = document.getElementById('addNormEntryBtn') as HTMLButtonElement;
    fromInput.value = 'delete-me';
    toInput.value = 'deleted';
    addBtn.click();

    expect(document.querySelectorAll('.norm-entry-item').length).toBe(2);

    // Delete the first entry
    const deleteBtns = document.querySelectorAll('.norm-entry-delete');
    (deleteBtns[0] as HTMLButtonElement).click();
    expect(document.querySelectorAll('.norm-entry-item').length).toBe(1);
    expect(document.querySelector('.norm-entry-label')!.textContent).toContain('delete-me');
  });

  it('saves normalization entries with tag settings', async () => {
    fullDom();
    await initTagsPanel();
    const fromInput = document.getElementById('normFromInput') as HTMLInputElement;
    const toInput = document.getElementById('normToInput') as HTMLInputElement;
    const addBtn = document.getElementById('addNormEntryBtn') as HTMLButtonElement;

    fromInput.value = 'Old';
    toInput.value = 'New';
    addBtn.click();

    (document.getElementById('saveTagsBtn') as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 10));

    expect(mockSetAll).toHaveBeenCalledWith(
      expect.objectContaining({
        tag_normalization_dict: [{ from: 'Old', to: 'New' }],
      }),
    );
  });
});

describe('tagsPanel-r2 — Save error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMany.mockResolvedValue({});
    mockGetAll.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows error status when saveSettingsWithAllowedUrls throws', async () => {
    fullDom();
    mockSetAll.mockRejectedValue(new Error('save failed'));
    await initTagsPanel();

    (document.getElementById('saveTagsBtn') as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 10));

    expect(showStatus).toHaveBeenCalledWith('exportImportStatus', expect.any(String), 'error');
  });
});

describe('tagsPanel-r2 — Normalization Enter key behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMany.mockResolvedValue({});
    mockGetAll.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('normFromInput Enter key moves focus to normToInput when to is empty', async () => {
    fullDom();
    await initTagsPanel();
    const fromInput = document.getElementById('normFromInput') as HTMLInputElement;
    const toInput = document.getElementById('normToInput') as HTMLInputElement;
    const focusSpy = vi.spyOn(toInput, 'focus');

    fromInput.value = 'foo';
    toInput.value = '';
    fromInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));

    expect(focusSpy).toHaveBeenCalled();
  });

  it('normFromInput Enter key adds entry when both from and to are filled', async () => {
    fullDom();
    await initTagsPanel();
    const fromInput = document.getElementById('normFromInput') as HTMLInputElement;
    const toInput = document.getElementById('normToInput') as HTMLInputElement;

    fromInput.value = 'foo';
    toInput.value = 'bar';
    fromInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));

    expect(document.querySelectorAll('.norm-entry-item').length).toBe(1);
  });

  it('normToInput Enter key adds entry', async () => {
    fullDom();
    await initTagsPanel();
    const fromInput = document.getElementById('normFromInput') as HTMLInputElement;
    const toInput = document.getElementById('normToInput') as HTMLInputElement;

    fromInput.value = 'abc';
    toInput.value = 'xyz';
    toInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));

    expect(document.querySelectorAll('.norm-entry-item').length).toBe(1);
  });

  it('normFromInput Enter with empty from does nothing', async () => {
    fullDom();
    await initTagsPanel();
    const fromInput = document.getElementById('normFromInput') as HTMLInputElement;
    const toInput = document.getElementById('normToInput') as HTMLInputElement;

    fromInput.value = '';
    toInput.value = 'bar';
    fromInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));

    expect(document.querySelectorAll('.norm-entry-item').length).toBe(0);
  });
});

describe('tagsPanel-r2 — renderDefaultCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMany.mockResolvedValue({});
    mockGetAll.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders all default categories as buttons', async () => {
    fullDom();
    await initTagsPanel();
    const container = document.getElementById('defaultCategoriesList')!;
    const items = container.querySelectorAll('.default-category-item');
    expect(items.length).toBe(4);
    expect((items[0] as HTMLButtonElement).textContent).toBe('#tech');
  });

  it('clicking default category dispatches navigate-to-tag', async () => {
    fullDom();
    await initTagsPanel();
    const eventSpy = vi.fn();
    document.addEventListener('navigate-to-tag', eventSpy);
    (document.querySelector('.default-category-item') as HTMLButtonElement).click();
    expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ detail: 'tech' }));
  });
});
