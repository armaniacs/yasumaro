// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../popup/i18n.js', () => ({
  getMessage: vi.fn((key) => key),
}));

vi.mock('../../popup/utils/focusTrap.js', () => ({
  focusTrapManager: {
    trap: vi.fn().mockReturnValue('trap-id'),
    release: vi.fn(),
  },
}));

vi.mock('../../utils/tagUtils.js', () => ({
  getAllCategories: vi.fn().mockReturnValue(['tech', 'work', 'personal']),
}));

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/storageUrls.js', () => ({
  setUrlTags: vi.fn().mockResolvedValue(undefined),
}));

describe('historyTagEditModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('should export all functions', async () => {
    const { openTagEditModal, closeTagEditModal, renderCurrentTags, updateTagCategorySelect, addTag, saveTagEdits, initTagEditModal } = await import('../historyTagEditModal.js');
    expect(typeof openTagEditModal).toBe('function');
    expect(typeof closeTagEditModal).toBe('function');
    expect(typeof renderCurrentTags).toBe('function');
    expect(typeof updateTagCategorySelect).toBe('function');
    expect(typeof addTag).toBe('function');
    expect(typeof saveTagEdits).toBe('function');
    expect(typeof initTagEditModal).toBe('function');
  });

  it('should render empty tags state', async () => {
    document.body.innerHTML = `
      <div id="currentTagsList"></div>
      <div id="noCurrentTagsMsg"></div>
    `;
    
    const { renderCurrentTags } = await import('../historyTagEditModal.js');
    
    const state = { editingTags: [] };
    const elements = {
      currentTagsList: document.getElementById('currentTagsList'),
      noCurrentTagsMsg: document.getElementById('noCurrentTagsMsg'),
    };

    renderCurrentTags(state as any, elements as any);
    expect(elements.noCurrentTagsMsg?.hidden).toBe(false);
  });

  it('should render existing tags', async () => {
    document.body.innerHTML = `
      <div id="currentTagsList"></div>
      <div id="noCurrentTagsMsg"></div>
    `;
    
    const { renderCurrentTags } = await import('../historyTagEditModal.js');
    
    const state = { editingTags: ['tech', 'work'] };
    const elements = {
      currentTagsList: document.getElementById('currentTagsList'),
      noCurrentTagsMsg: document.getElementById('noCurrentTagsMsg'),
    };

    renderCurrentTags(state as any, elements as any);
    expect(elements.noCurrentTagsMsg?.hidden).toBe(true);
    expect(elements.currentTagsList?.querySelectorAll('.current-tag-item').length).toBe(2);
  });

  it('should return early from addTag when no selection', async () => {
    document.body.innerHTML = `
      <select id="tagCategorySelect"><option value="">Select...</option></select>
    `;
    
    const { addTag } = await import('../historyTagEditModal.js');
    
    const state = { editingTags: [] };
    const select = document.getElementById('tagCategorySelect') as HTMLSelectElement;
    select.value = '';
    const elements = { tagCategorySelect: select };

    addTag(state as any, elements as any);
    expect(state.editingTags).toEqual([]);
  });

  it('should add tag when value selected', async () => {
    document.body.innerHTML = `
      <select id="tagCategorySelect"><option value="tech">Tech</option></select>
    `;
    
    const { addTag } = await import('../historyTagEditModal.js');
    
    const state = { editingTags: [] };
    const select = document.getElementById('tagCategorySelect') as HTMLSelectElement;
    select.value = 'tech';
    const elements = { tagCategorySelect: select };

    addTag(state as any, elements as any);
    expect(state.editingTags).toContain('tech');
  });
});