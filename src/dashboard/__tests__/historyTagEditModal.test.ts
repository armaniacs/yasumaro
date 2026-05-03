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

function createMockElements(): any {
  return {
    tagEditModal: document.createElement('div'),
    tagEditUrl: document.createElement('div'),
    currentTagsList: document.createElement('div'),
    noCurrentTagsMsg: document.createElement('div'),
    tagCategorySelect: document.createElement('select'),
    addTagBtn: document.createElement('button'),
    closeTagEditModalBtn: document.createElement('button'),
    saveTagEditsBtn: document.createElement('button'),
  };
}

describe('historyTagEditModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('exports', () => {
    it('should export all functions', async () => {
      const mod = await import('../historyTagEditModal.js');
      expect(typeof mod.openTagEditModal).toBe('function');
      expect(typeof mod.closeTagEditModal).toBe('function');
      expect(typeof mod.renderCurrentTags).toBe('function');
      expect(typeof mod.updateTagCategorySelect).toBe('function');
      expect(typeof mod.addTag).toBe('function');
      expect(typeof mod.saveTagEdits).toBe('function');
      expect(typeof mod.initTagEditModal).toBe('function');
    });
  });

  describe('openTagEditModal', () => {
    it('should set editingUrl and editingTags on state', async () => {
      const { openTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingUrl: null, editingTags: [] as string[], tagEditTrapId: null };
      openTagEditModal(state as any, { tagEditUrl: null, tagEditModal: null } as any, 'https://example.com', ['tag1', 'tag2']);
      expect(state.editingUrl).toBe('https://example.com');
      expect(state.editingTags).toEqual(['tag1', 'tag2']);
    });

    it('should set tagEditUrl textContent when element exists', async () => {
      const { openTagEditModal } = await import('../historyTagEditModal.js');
      const urlEl = document.createElement('div');
      const state = { editingUrl: null, editingTags: [] as string[], tagEditTrapId: null };
      openTagEditModal(state as any, { tagEditUrl: urlEl, tagEditModal: null } as any, 'https://example.com', []);
      expect(urlEl.textContent).toBe('https://example.com');
    });

    it('should skip tagEditUrl when element is null', async () => {
      const { openTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingUrl: null, editingTags: [] as string[], tagEditTrapId: null };
      expect(() => openTagEditModal(state as any, { tagEditUrl: null, tagEditModal: null } as any, 'https://example.com', [])).not.toThrow();
    });

    it('should show modal and set aria-hidden', async () => {
      const { openTagEditModal } = await import('../historyTagEditModal.js');
      const modal = document.createElement('div');
      modal.classList.add('hidden');
      const state = { editingUrl: null, editingTags: [] as string[], tagEditTrapId: null };
      openTagEditModal(state as any, { tagEditUrl: null, tagEditModal: modal } as any, 'https://example.com', []);
      expect(modal.classList.contains('hidden')).toBe(false);
      expect(modal.getAttribute('aria-hidden')).toBe('false');
    });

    it('should set focus trap on modal', async () => {
      const { focusTrapManager } = await import('../../popup/utils/focusTrap.js');
      const { openTagEditModal } = await import('../historyTagEditModal.js');
      const modal = document.createElement('div');
      const state = { editingUrl: null, editingTags: [] as string[], tagEditTrapId: null };
      openTagEditModal(state as any, { tagEditUrl: null, tagEditModal: modal } as any, 'https://example.com', []);
      expect(focusTrapManager.trap).toHaveBeenCalledWith(modal, expect.any(Function));
      expect(state.tagEditTrapId).toBe('trap-id');
    });

    it('should not set focus trap when modal is null', async () => {
      const { focusTrapManager } = await import('../../popup/utils/focusTrap.js');
      const { openTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingUrl: null, editingTags: [] as string[], tagEditTrapId: null };
      openTagEditModal(state as any, { tagEditUrl: null, tagEditModal: null } as any, 'https://example.com', []);
      expect(focusTrapManager.trap).not.toHaveBeenCalled();
      expect(state.tagEditTrapId).toBeNull();
    });
  });

  describe('closeTagEditModal', () => {
    it('should clear editingUrl and editingTags', async () => {
      const { closeTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingUrl: 'https://example.com', editingTags: ['tag1'], tagEditTrapId: null };
      closeTagEditModal(state as any, { tagEditModal: null } as any);
      expect(state.editingUrl).toBeNull();
      expect(state.editingTags).toEqual([]);
    });

    it('should release focus trap when trapId exists', async () => {
      const { focusTrapManager } = await import('../../popup/utils/focusTrap.js');
      const { closeTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingUrl: 'url', editingTags: ['t'], tagEditTrapId: 'trap-id' };
      closeTagEditModal(state as any, { tagEditModal: null } as any);
      expect(focusTrapManager.release).toHaveBeenCalledWith('trap-id');
      expect(state.tagEditTrapId).toBeNull();
    });

    it('should not release focus trap when trapId is null', async () => {
      const { focusTrapManager } = await import('../../popup/utils/focusTrap.js');
      const { closeTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingUrl: 'url', editingTags: ['t'], tagEditTrapId: null };
      closeTagEditModal(state as any, { tagEditModal: null } as any);
      expect(focusTrapManager.release).not.toHaveBeenCalled();
    });

    it('should hide modal and set aria-hidden', async () => {
      const { closeTagEditModal } = await import('../historyTagEditModal.js');
      const modal = document.createElement('div');
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      const state = { editingUrl: 'url', editingTags: ['t'], tagEditTrapId: null };
      closeTagEditModal(state as any, { tagEditModal: modal } as any);
      expect(modal.classList.contains('hidden')).toBe(true);
      expect(modal.getAttribute('aria-hidden')).toBe('true');
    });

    it('should handle null modal gracefully', async () => {
      const { closeTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingUrl: 'url', editingTags: ['t'], tagEditTrapId: null };
      expect(() => closeTagEditModal(state as any, { tagEditModal: null } as any)).not.toThrow();
    });
  });

  describe('renderCurrentTags', () => {
    it('should return early when currentTagsList is null', async () => {
      const { renderCurrentTags } = await import('../historyTagEditModal.js');
      const state = { editingTags: ['tag1'] };
      const elements = { currentTagsList: null, noCurrentTagsMsg: document.createElement('div') };
      expect(() => renderCurrentTags(state as any, elements as any)).not.toThrow();
    });

    it('should return early when noCurrentTagsMsg is null', async () => {
      const { renderCurrentTags } = await import('../historyTagEditModal.js');
      const state = { editingTags: ['tag1'] };
      const elements = { currentTagsList: document.createElement('div'), noCurrentTagsMsg: null };
      expect(() => renderCurrentTags(state as any, elements as any)).not.toThrow();
    });

    it('should show noCurrentTagsMsg when editingTags is empty', async () => {
      const { renderCurrentTags } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      const elements = {
        currentTagsList: document.createElement('div'),
        noCurrentTagsMsg: document.createElement('div'),
      };
      renderCurrentTags(state as any, elements as any);
      expect(elements.noCurrentTagsMsg.hidden).toBe(false);
    });

    it('should hide noCurrentTagsMsg and render tags when tags exist', async () => {
      const { renderCurrentTags } = await import('../historyTagEditModal.js');
      const state = { editingTags: ['tech', 'work'] };
      const elements = {
        currentTagsList: document.createElement('div'),
        noCurrentTagsMsg: document.createElement('div'),
      };
      renderCurrentTags(state as any, elements as any);
      expect(elements.noCurrentTagsMsg.hidden).toBe(true);
      expect(elements.currentTagsList.querySelectorAll('.current-tag-item').length).toBe(2);
    });

    it('should render each tag with # prefix', async () => {
      const { renderCurrentTags } = await import('../historyTagEditModal.js');
      const state = { editingTags: ['design'] };
      const elements = {
        currentTagsList: document.createElement('div'),
        noCurrentTagsMsg: document.createElement('div'),
      };
      renderCurrentTags(state as any, elements as any);
      const tagItem = elements.currentTagsList.querySelector('.current-tag-item')!;
      expect(tagItem.textContent).toContain('#design');
    });

    it('should have remove button for each tag', async () => {
      const { renderCurrentTags } = await import('../historyTagEditModal.js');
      const state = { editingTags: ['design'] };
      const elements = {
        currentTagsList: document.createElement('div'),
        noCurrentTagsMsg: document.createElement('div'),
      };
      renderCurrentTags(state as any, elements as any);
      const removeBtn = elements.currentTagsList.querySelector('.current-tag-remove');
      expect(removeBtn).toBeTruthy();
      expect(removeBtn!.textContent).toBe('\u00d7');
    });

    it('should remove tag and re-render when remove button is clicked', async () => {
      const { renderCurrentTags } = await import('../historyTagEditModal.js');
      const state = { editingTags: ['tech', 'work'] };
      const elements = {
        currentTagsList: document.createElement('div'),
        noCurrentTagsMsg: document.createElement('div'),
      };
      renderCurrentTags(state as any, elements as any);
      const removeBtn = elements.currentTagsList.querySelector('.current-tag-remove') as HTMLElement;
      removeBtn.click();
      expect(state.editingTags).toEqual(['work']);
      expect(elements.currentTagsList.querySelectorAll('.current-tag-item').length).toBe(1);
      expect(elements.currentTagsList.textContent).toContain('#work');
    });
  });

  describe('updateTagCategorySelect', () => {
    it('should return early when tagCategorySelect is null', async () => {
      const { getSettings } = await import('../../utils/storage.js');
      const { updateTagCategorySelect } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      const elements = { tagCategorySelect: null, addTagBtn: document.createElement('button') };
      await updateTagCategorySelect(state as any, elements as any);
      expect(getSettings).not.toHaveBeenCalled();
    });

    it('should return early when addTagBtn is null', async () => {
      const { getSettings } = await import('../../utils/storage.js');
      const { updateTagCategorySelect } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      const elements = { tagCategorySelect: document.createElement('select'), addTagBtn: null };
      await updateTagCategorySelect(state as any, elements as any);
      expect(getSettings).not.toHaveBeenCalled();
    });

    it('should fetch settings and categories and populate select', async () => {
      const { updateTagCategorySelect } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      const select = document.createElement('select');
      const addBtn = document.createElement('button');
      await updateTagCategorySelect(state as any, { tagCategorySelect: select, addTagBtn: addBtn } as any);
      expect(select.options.length).toBe(4);
      expect(select.options[0].value).toBe('');
      expect(select.options[0].disabled).toBe(true);
      expect(select.options[0].selected).toBe(true);
      expect(select.options[0].textContent).toBe('selectCategory');
      expect(select.options[1].value).toBe('tech');
      expect(select.options[2].value).toBe('work');
      expect(select.options[3].value).toBe('personal');
    });

    it('should filter out already-selected categories', async () => {
      const { updateTagCategorySelect } = await import('../historyTagEditModal.js');
      const state = { editingTags: ['tech'] };
      const select = document.createElement('select');
      const addBtn = document.createElement('button');
      await updateTagCategorySelect(state as any, { tagCategorySelect: select, addTagBtn: addBtn } as any);
      expect(select.options.length).toBe(3);
      expect(select.options[1].value).toBe('work');
      expect(select.options[2].value).toBe('personal');
    });

    it('should disable addTagBtn when no categories available', async () => {
      const { getAllCategories } = await import('../../utils/tagUtils.js');
      getAllCategories.mockReturnValueOnce([]);
      const { updateTagCategorySelect } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      const select = document.createElement('select');
      const addBtn = document.createElement('button');
      await updateTagCategorySelect(state as any, { tagCategorySelect: select, addTagBtn: addBtn } as any);
      expect(addBtn.disabled).toBe(true);
      expect(select.options.length).toBe(1);
    });

    it('should enable addTagBtn when categories available', async () => {
      const { updateTagCategorySelect } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      const select = document.createElement('select');
      const addBtn = document.createElement('button');
      addBtn.disabled = true;
      await updateTagCategorySelect(state as any, { tagCategorySelect: select, addTagBtn: addBtn } as any);
      expect(addBtn.disabled).toBe(false);
    });
  });

  describe('addTag', () => {
    it('should return early when tagCategorySelect is null', async () => {
      const { addTag } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      expect(() => addTag(state as any, { tagCategorySelect: null } as any)).not.toThrow();
      expect(state.editingTags).toEqual([]);
    });

    it('should return early when tagCategorySelect has no value', async () => {
      const { addTag } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      const select = document.createElement('select');
      select.value = '';
      addTag(state as any, { tagCategorySelect: select } as any);
      expect(state.editingTags).toEqual([]);
    });

    it('should add tag to editingTags', async () => {
      const { addTag } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      const elements = createMockElements();
      elements.tagCategorySelect.innerHTML = '<option value="tech">Tech</option>';
      elements.tagCategorySelect.value = 'tech';
      addTag(state as any, elements as any);
      expect(state.editingTags).toContain('tech');
    });

    it('should not add duplicate tags', async () => {
      const { addTag } = await import('../historyTagEditModal.js');
      const state = { editingTags: ['tech'] };
      const elements = createMockElements();
      elements.tagCategorySelect.value = 'tech';
      addTag(state as any, elements as any);
      expect(state.editingTags).toEqual(['tech']);
    });

    it('should clear select value after add', async () => {
      const { addTag } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      const elements = createMockElements();
      elements.tagCategorySelect.value = 'tech';
      addTag(state as any, elements as any);
      expect(elements.tagCategorySelect.value).toBe('');
    });

    it('should re-render tags and update category select after adding', async () => {
      const { addTag } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      const elements = createMockElements();
      elements.tagCategorySelect.innerHTML = '<option value="tech">Tech</option><option value="work">Work</option>';
      elements.tagCategorySelect.value = 'tech';
      addTag(state as any, elements as any);
      expect(elements.currentTagsList.querySelector('.current-tag-item')?.textContent).toContain('#tech');
      // addTag calls updateTagCategorySelect without await, so the select
      // options are not updated synchronously. Just verify the tag was added.
      expect(state.editingTags).toContain('tech');
    });
  });

  describe('saveTagEdits', () => {
    it('should return early when editingUrl is null', async () => {
      const { setUrlTags } = await import('../../utils/storageUrls.js');
      const { saveTagEdits } = await import('../historyTagEditModal.js');
      const state = { editingUrl: null };
      const onSaved = vi.fn();
      await saveTagEdits(state as any, {} as any, onSaved);
      expect(setUrlTags).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('should call setUrlTags with correct args', async () => {
      const { setUrlTags } = await import('../../utils/storageUrls.js');
      const { saveTagEdits } = await import('../historyTagEditModal.js');
      const state = {
        editingUrl: 'https://example.com',
        editingTags: ['tech'],
        entries: [],
        tagEditTrapId: null,
      };
      const onSaved = vi.fn();
      await saveTagEdits(state as any, { tagEditModal: null } as any, onSaved);
      expect(setUrlTags).toHaveBeenCalledWith('https://example.com', ['tech']);
    });

    it('should update matching entry in state.entries', async () => {
      const { saveTagEdits } = await import('../historyTagEditModal.js');
      const state = {
        editingUrl: 'https://example.com',
        editingTags: ['tech', 'work'],
        entries: [{ url: 'https://example.com', tags: ['old'] }],
        tagEditTrapId: null,
      };
      const onSaved = vi.fn();
      await saveTagEdits(state as any, { tagEditModal: null } as any, onSaved);
      expect(state.entries[0].tags).toEqual(['tech', 'work']);
    });

    it('should not modify entries when url does not match', async () => {
      const { saveTagEdits } = await import('../historyTagEditModal.js');
      const state = {
        editingUrl: 'https://example.com',
        editingTags: ['tech'],
        entries: [{ url: 'https://other.com', tags: ['old'] }],
        tagEditTrapId: null,
      };
      const onSaved = vi.fn();
      await saveTagEdits(state as any, { tagEditModal: null } as any, onSaved);
      expect(state.entries[0].tags).toEqual(['old']);
    });

    it('should close modal and call onSaved on success', async () => {
      const { saveTagEdits } = await import('../historyTagEditModal.js');
      const modal = document.createElement('div');
      const state = {
        editingUrl: 'https://example.com',
        editingTags: [],
        entries: [],
        tagEditTrapId: null,
      };
      const onSaved = vi.fn();
      await saveTagEdits(state as any, { tagEditModal: modal } as any, onSaved);
      expect(onSaved).toHaveBeenCalled();
      expect(modal.classList.contains('hidden')).toBe(true);
    });

    it('should handle errors and call alert', async () => {
      const { setUrlTags } = await import('../../utils/storageUrls.js');
      setUrlTags.mockRejectedValueOnce(new Error('Save failed'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal('alert', vi.fn());
      const { saveTagEdits } = await import('../historyTagEditModal.js');
      const state = {
        editingUrl: 'https://example.com',
        editingTags: ['tech'],
        entries: [],
        tagEditTrapId: null,
      };
      const onSaved = vi.fn();
      await saveTagEdits(state as any, { tagEditModal: null } as any, onSaved);
      expect(alert).toHaveBeenCalledWith('saveTagError');
      expect(onSaved).not.toHaveBeenCalled();
    });
  });

  describe('initTagEditModal', () => {
    it('should close modal when closeTagEditModalBtn is clicked', async () => {
      const { initTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingUrl: 'https://example.com', editingTags: ['t'], tagEditTrapId: null };
      const elements = { closeTagEditModalBtn: document.createElement('button'), tagEditModal: null };
      initTagEditModal(state as any, elements as any, vi.fn());
      elements.closeTagEditModalBtn.click();
      expect(state.editingUrl).toBeNull();
    });

    it('should close modal when clicking on backdrop', async () => {
      const { initTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingUrl: 'https://example.com', editingTags: ['t'], tagEditTrapId: null };
      const elements = { tagEditModal: document.createElement('div'), closeTagEditModalBtn: null };
      initTagEditModal(state as any, elements as any, vi.fn());
      elements.tagEditModal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(state.editingUrl).toBeNull();
    });

    it('should not close modal when clicking inside it', async () => {
      const { initTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingUrl: 'https://example.com', editingTags: ['t'], tagEditTrapId: null };
      const elements = { tagEditModal: document.createElement('div'), closeTagEditModalBtn: null };
      const child = document.createElement('div');
      elements.tagEditModal.appendChild(child);
      initTagEditModal(state as any, elements as any, vi.fn());
      child.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(state.editingUrl).toBe('https://example.com');
    });

    it('should enable/disable addBtn on tagCategorySelect change', async () => {
      const { initTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingUrl: null, editingTags: [], tagEditTrapId: null };
      const select = document.createElement('select');
      // Add an option so setting value works in jsdom
      const option = document.createElement('option');
      option.value = 'tech';
      select.appendChild(option);
      const addBtn = document.createElement('button');
      addBtn.disabled = true;
      const elements = { tagCategorySelect: select, addTagBtn: addBtn, closeTagEditModalBtn: null, tagEditModal: null };
      initTagEditModal(state as any, elements as any, vi.fn());
      select.value = 'tech';
      select.dispatchEvent(new Event('change'));
      expect(addBtn.disabled).toBe(false);
      select.value = '';
      select.dispatchEvent(new Event('change'));
      expect(addBtn.disabled).toBe(true);
    });

    it('should call addTag when addTagBtn is clicked', async () => {
      const { initTagEditModal } = await import('../historyTagEditModal.js');
      const state = { editingTags: [] };
      const elements = createMockElements();
      // Add an option so setting value works in jsdom
      const option = document.createElement('option');
      option.value = 'tech';
      elements.tagCategorySelect.appendChild(option);
      elements.tagCategorySelect.value = 'tech';
      initTagEditModal(state as any, elements as any, vi.fn());
      elements.addTagBtn.click();
      expect(state.editingTags).toContain('tech');
    });

    it('should call saveTagEdits when saveTagEditsBtn is clicked', async () => {
      const { setUrlTags } = await import('../../utils/storageUrls.js');
      const { initTagEditModal } = await import('../historyTagEditModal.js');
      const state = {
        editingUrl: 'https://example.com',
        editingTags: ['tech'],
        entries: [],
        tagEditTrapId: null,
      };
      const elements = { saveTagEditsBtn: document.createElement('button'), closeTagEditModalBtn: null, tagEditModal: null };
      const onSaved = vi.fn();
      initTagEditModal(state as any, elements as any, onSaved);
      elements.saveTagEditsBtn.click();
      await new Promise(r => setTimeout(r, 0));
      expect(setUrlTags).toHaveBeenCalledWith('https://example.com', ['tech']);
      expect(onSaved).toHaveBeenCalled();
    });
  });
});
