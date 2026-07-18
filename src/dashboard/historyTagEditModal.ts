import { getMessage } from '../utils/i18n.js';
import { focusTrapManager } from '../popup/utils/focusTrap.js';
import { getAllCategories } from '../utils/tagUtils.js';
import { getSettings } from '../utils/storage.js';
import { setUrlTags } from '../utils/storageUrls.js';
import type { HistoryPanelState, TagEditElements } from './historyState.js';

export function openTagEditModal(
  state: HistoryPanelState,
  elements: TagEditElements,
  url: string,
  currentTags: string[],
): void {
  state.editingUrl = url;
  state.editingTags = [...currentTags];

  if (elements.tagEditUrl) elements.tagEditUrl.textContent = url;
  renderCurrentTags(state, elements);
  updateTagCategorySelect(state, elements);

  if (elements.tagEditModal) {
    elements.tagEditModal.classList.remove('hidden');
    elements.tagEditModal.setAttribute('aria-hidden', 'false');
    state.tagEditTrapId = focusTrapManager.trap(
      elements.tagEditModal,
      () => closeTagEditModal(state, elements),
    );
  }
}

export function closeTagEditModal(state: HistoryPanelState, elements: TagEditElements): void {
  state.editingUrl = null;
  state.editingTags = [];
  if (state.tagEditTrapId) {
    focusTrapManager.release(state.tagEditTrapId);
    state.tagEditTrapId = null;
  }
  if (elements.tagEditModal) {
    elements.tagEditModal.classList.add('hidden');
    elements.tagEditModal.setAttribute('aria-hidden', 'true');
  }
}

export function renderCurrentTags(state: HistoryPanelState, elements: TagEditElements): void {
  if (!elements.currentTagsList || !elements.noCurrentTagsMsg) return;

  elements.currentTagsList.innerHTML = '';

  if (state.editingTags.length === 0) {
    elements.noCurrentTagsMsg.hidden = false;
    return;
  }

  elements.noCurrentTagsMsg.hidden = true;

  state.editingTags.forEach(tag => {
    const tagItem = document.createElement('span');
    tagItem.className = 'current-tag-item';
    tagItem.textContent = `#${tag}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'current-tag-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      state.editingTags = state.editingTags.filter(t => t !== tag);
      renderCurrentTags(state, elements);
      updateTagCategorySelect(state, elements);
    });

    tagItem.appendChild(removeBtn);
    elements.currentTagsList!.appendChild(tagItem);
  });
}

export async function updateTagCategorySelect(
  state: HistoryPanelState,
  elements: TagEditElements,
): Promise<void> {
  if (!elements.tagCategorySelect || !elements.addTagBtn) return;

  const settings = await getSettings();
  const categories = getAllCategories(settings);
  const availableCategories = categories.filter(c => !state.editingTags.includes(c));

  elements.tagCategorySelect.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = getMessage('selectCategory') || 'カテゴリを選択...';
  defaultOption.disabled = true;
  defaultOption.selected = true;
  elements.tagCategorySelect.appendChild(defaultOption);

  availableCategories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    elements.tagCategorySelect!.appendChild(option);
  });

  elements.addTagBtn.disabled = availableCategories.length === 0;
}

export function addTag(state: HistoryPanelState, elements: TagEditElements): void {
  if (!elements.tagCategorySelect || !elements.tagCategorySelect.value) return;
  const newTag = elements.tagCategorySelect.value;
  if (!state.editingTags.includes(newTag)) {
    state.editingTags.push(newTag);
    renderCurrentTags(state, elements);
    updateTagCategorySelect(state, elements);
  }
  elements.tagCategorySelect.value = '';
}

export async function saveTagEdits(
  state: HistoryPanelState,
  elements: TagEditElements,
  onSaved: () => void,
): Promise<void> {
  if (!state.editingUrl) return;

  try {
    await setUrlTags(state.editingUrl, state.editingTags);

    const entryIndex = state.entries.findIndex(e => e.url === state.editingUrl);
    if (entryIndex !== -1) {
      state.entries[entryIndex].tags = state.editingTags;
    }

    closeTagEditModal(state, elements);
    onSaved();
  } catch (error) {
    console.error('[Dashboard] Failed to save tags:', error);
    alert(getMessage('saveTagError') || 'タグの保存に失敗しました');
  }
}

export function initTagEditModal(
  state: HistoryPanelState,
  elements: TagEditElements,
  onSaved: () => void,
): void {
  elements.closeTagEditModalBtn?.addEventListener('click', () =>
    closeTagEditModal(state, elements),
  );

  elements.tagEditModal?.addEventListener('click', e => {
    if (e.target === elements.tagEditModal) {
      closeTagEditModal(state, elements);
    }
  });

  elements.tagCategorySelect?.addEventListener('change', () => {
    if (elements.addTagBtn) {
      elements.addTagBtn.disabled = !elements.tagCategorySelect!.value;
    }
  });

  elements.addTagBtn?.addEventListener('click', () => addTag(state, elements));

  elements.saveTagEditsBtn?.addEventListener('click', () =>
    saveTagEdits(state, elements, onSaved),
  );
}
