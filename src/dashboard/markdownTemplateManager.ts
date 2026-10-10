/**
 * markdownTemplateManager.ts
 * Markdown 書き出しテンプレート管理パネルの UI ロジック
 * customPromptManager.ts の DOM 操作パターン(一覧描画・エディタ表示切替・保存/削除ハンドラ)を踏襲する。
 *
 * WHY a factory: the panel's element references, its settings snapshot and the
 * id it is editing were module-level `let`s, so a test that reuses the same
 * document kept the previous mount's nodes alive. The state now lives in the
 * instance returned by createMarkdownTemplateManager() and `destroy()` releases
 * it, so a panel can be torn down and mounted again without stale references.
 * The module-level functions below stay for existing callers and delegate to
 * one default instance.
 */

import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { Settings, StorageKeys } from '../utils/storage/types.js';
import {
  DEFAULT_MARKDOWN_TEMPLATE,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  renderFileTemplate,
  validateTemplate,
} from '../utils/markdownTemplateUtils.js';
import type { MarkdownExportTemplate, MarkdownTemplateEntryData } from '../utils/types.js';
import { getMessageOr } from '../utils/i18n.js';
import { applyI18n } from '../utils/i18n-dom.js';
import { buildPromptItemRow } from './settings/customPromptManager.js';
import { setElementHtml } from '../utils/htmlFragment.js';
import { showStatus } from '../utils/ui/settingsUiHelper.js';
import { showConfirmDialog } from '../utils/ui/confirmDialog.js';

/** ライブプレビュー用のサンプルエントリ */
const SAMPLE_ENTRIES: MarkdownTemplateEntryData[] = [
  {
    timestamp: '09:15',
    title: 'Sample Article',
    url: 'https://example.com/article',
    summary: 'This is a sample summary for preview.',
    tags: '#sample',
    domain: 'example.com',
  },
  {
    timestamp: '14:30',
    title: 'Another Page',
    url: 'https://example.org/page',
    summary: 'Another preview summary.',
    tags: '',
    domain: 'example.org',
  },
];

/** プレビュー日付(固定値でよい: 実データに依存しない表示のため) */
const PREVIEW_DATE = '2026-08-07';

export interface MarkdownTemplateManager {
  /**
   * (Re-)mount the panel. Re-queries every element reference and (re-)attaches
   * the listeners, so it is correct whether mount() happens once (current
   * reality) or the panel's DOM is torn down and rebuilt.
   *
   * @param settings Current settings snapshot
   */
  init(settings: Settings): void;
  /**
   * Detach the listeners this instance attached and drop every element
   * reference. A later init() re-resolves from the document, so a re-mount
   * after destroy() works.
   */
  destroy(): void;
}

export function createMarkdownTemplateManager(): MarkdownTemplateManager {
  let dom: {
    listEl: HTMLElement | null;
    editorEl: HTMLElement | null;
    nameInput: HTMLInputElement | null;
    fileInput: HTMLTextAreaElement | null;
    entryInput: HTMLTextAreaElement | null;
    previewEl: HTMLElement | null;
    errorEl: HTMLElement | null;
    statusEl: HTMLElement | null;
    createBtn: HTMLButtonElement | null;
    saveBtn: HTMLButtonElement | null;
    cancelBtn: HTMLButtonElement | null;
  } | null = null;

  // Current settings (kept in sync with chrome.storage.local via saveSettings/reload)
  let currentSettings: Settings | null = null;

  // Editing state: null = creating a new template, otherwise the id of the template being edited
  let editingTemplateId: string | null = null;

  function resolveDom(): void {
    dom = {
      listEl: document.getElementById('markdownTemplateList'),
      editorEl: document.getElementById('markdownTemplateEditor'),
      nameInput: document.getElementById('markdownTemplateName') as HTMLInputElement | null,
      fileInput: document.getElementById('markdownTemplateFileInput') as HTMLTextAreaElement | null,
      entryInput: document.getElementById('markdownTemplateEntryInput') as HTMLTextAreaElement | null,
      previewEl: document.getElementById('markdownTemplatePreview'),
      errorEl: document.getElementById('markdownTemplateEditorError'),
      statusEl: document.getElementById('markdownTemplateStatus'),
      createBtn: document.getElementById('markdownTemplateCreateBtn') as HTMLButtonElement | null,
      saveBtn: document.getElementById('markdownTemplateSaveBtn') as HTMLButtonElement | null,
      cancelBtn: document.getElementById('markdownTemplateCancelBtn') as HTMLButtonElement | null,
    };
  }

  /**
   * Get the full template list: built-in default first, then user-defined templates.
   */
  function getTemplates(): MarkdownExportTemplate[] {
    const stored = currentSettings?.[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] ?? [];
    return [DEFAULT_MARKDOWN_TEMPLATE, ...stored];
  }

  /**
   * Get the currently active template id (falls back to the default template id).
   */
  function getActiveTemplateId(): string {
    return currentSettings?.[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID] ?? DEFAULT_MARKDOWN_TEMPLATE.id;
  }

  /**
   * Render the list of templates (default + custom), with Activate/Edit/Delete/Duplicate actions.
   */
  function renderTemplateList(): void {
    const listEl = dom?.listEl;
    if (!listEl) return;

    const templates = getTemplates();
    const activeId = getActiveTemplateId();

    setElementHtml(listEl, templates.map(t => createTemplateListItem(t, t.id === activeId)).join(''));

    templates.forEach(template => {
      const activateBtn = document.getElementById(`markdown-template-activate-${template.id}`);
      const duplicateBtn = document.getElementById(`markdown-template-duplicate-${template.id}`);
      const editBtn = document.getElementById(`markdown-template-edit-${template.id}`);
      const deleteBtn = document.getElementById(`markdown-template-delete-${template.id}`);

      activateBtn?.addEventListener('click', () => handleActivateClick(template.id));
      duplicateBtn?.addEventListener('click', () => handleDuplicateClick(template));
      editBtn?.addEventListener('click', () => handleEditClick(template));
      deleteBtn?.addEventListener('click', () => handleDeleteClick(template.id));
    });

    applyI18n(listEl);
  }

  /**
   * Build the HTML for a single template list row.
   * @param template Template to render
   * @param isActive Whether this template is currently active
   */
  function createTemplateListItem(template: MarkdownExportTemplate, isActive: boolean): string {
    const displayName = template.isDefault
      ? (getMessageOr('markdownTemplateDefaultName', template.name))
      : template.name;
    const showEditDelete = !template.isDefault;

    return buildPromptItemRow({
      indentUnit: 2,
      idAttribute: 'data-template-id',
      buttonIdPrefix: 'markdown-template-',
      buttonIdSuffix: '',
      id: template.id,
      displayName,
      isActive,
      badgeI18nKey: 'markdownTemplateActiveLabel',
      badgeText: 'Active',
      labels: {
        activate: 'Activate',
        duplicate: 'Duplicate',
        edit: 'Edit',
        delete: 'Delete',
      },
      showEditDelete,
      editDeleteLevel: 3,
      editDeleteBlankBeforeLevel: showEditDelete ? 4 : undefined,
      actionsBlankAfterLevel: showEditDelete ? 2 : 4,
    });
  }

  /**
   * Activate a template as the one used for local Markdown export.
   * @param id Template id to activate
   */
  async function handleActivateClick(id: string): Promise<void> {
    if (!currentSettings) return;

    // Delta write (PBI 2026-09-17-17) — only the active-template id enters the
    // payload so the panel snapshot cannot revert unrelated keys.
    currentSettings[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID] = id;
    await settingsRepository.set(StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID, id);

    showStatus(dom?.statusEl ?? 'markdownTemplateStatus', getMessageOr('markdownTemplateActivated', 'Template activated'), 'success');
    renderTemplateList();
  }

  /**
   * Delete a custom template (default template cannot be deleted; button is not rendered for it).
   * @param id Template id to delete
   */
  async function handleDeleteClick(id: string): Promise<void> {
    if (!currentSettings) return;

    // Accessible dialog seam (PBI 2026-09-17-19) replaces native confirm().
    const confirmed = await showConfirmDialog({
      message: getMessageOr('markdownTemplateConfirmDelete', 'Are you sure you want to delete this template?'),
      dangerous: true,
    });
    if (!confirmed) {
      return;
    }

    const stored = currentSettings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] ?? [];
    const updated = deleteTemplate(stored, id);
    currentSettings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] = updated;

    // Delta write (PBI 2026-09-17-17) — only the keys this action owns.
    const delta: Partial<Settings> = { [StorageKeys.MARKDOWN_EXPORT_TEMPLATES]: updated };
    // If the deleted template was active, fall back to the default template.
    if (getActiveTemplateId() === id) {
      currentSettings[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID] = DEFAULT_MARKDOWN_TEMPLATE.id;
      delta[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID] = DEFAULT_MARKDOWN_TEMPLATE.id;
    }

    await settingsRepository.setAll(delta);

    showStatus(dom?.statusEl ?? 'markdownTemplateStatus', getMessageOr('markdownTemplateDeleted', 'Template deleted'), 'success');
    renderTemplateList();
  }

  /**
   * Open the editor pre-filled with a copy of an existing template (name gets a "Copy" suffix).
   * The duplicate is not saved until the user presses Save.
   * @param template Template to duplicate
   */
  function handleDuplicateClick(template: MarkdownExportTemplate): void {
    const copySuffix = getMessageOr('markdownTemplateCopySuffix', 'Copy');
    openEditor(null, {
      name: `${template.name} ${copySuffix}`,
      fileTemplate: template.fileTemplate,
      entryTemplate: template.entryTemplate,
    });
  }

  /**
   * Open the editor pre-filled with an existing custom template's data for editing.
   * @param template Template to edit
   */
  function handleEditClick(template: MarkdownExportTemplate): void {
    if (template.isDefault) return;
    openEditor(template.id, {
      name: template.name,
      fileTemplate: template.fileTemplate,
      entryTemplate: template.entryTemplate,
    });
  }

  /**
   * Open the editor pre-filled with blank/default-derived values for creating a brand-new template.
   */
  function handleCreateClick(): void {
    openEditor(null, {
      name: getMessageOr('markdownTemplateNewName', 'New Template'),
      fileTemplate: DEFAULT_MARKDOWN_TEMPLATE.fileTemplate,
      entryTemplate: DEFAULT_MARKDOWN_TEMPLATE.entryTemplate,
    });
  }

  /**
   * Show the editor form populated with the given draft values.
   * @param id Template id being edited, or null when creating/duplicating
   * @param draft Values to populate the form with
   */
  function openEditor(
    id: string | null,
    draft: { name: string; fileTemplate: string; entryTemplate: string }
  ): void {
    const { editorEl, nameInput, fileInput, entryInput } = dom ?? {};
    if (!editorEl || !nameInput || !fileInput || !entryInput) return;

    editingTemplateId = id;

    nameInput.value = draft.name;
    fileInput.value = draft.fileTemplate;
    entryInput.value = draft.entryTemplate;
    clearError();

    editorEl.classList.remove('hidden');
    updatePreview();
    nameInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Hide and reset the editor form.
   */
  function closeEditor(): void {
    editingTemplateId = null;
    if (dom?.nameInput) dom.nameInput.value = '';
    if (dom?.fileInput) dom.fileInput.value = '';
    if (dom?.entryInput) dom.entryInput.value = '';
    clearError();
    dom?.editorEl?.classList.add('hidden');
  }

  /**
   * Handle the Cancel button: discard edits and hide the editor.
   */
  function handleCancelClick(): void {
    closeEditor();
  }

  /**
   * Build a draft template from the current editor field values.
   * @param id Placeholder id (not persisted for previews/drafts)
   * @param name Template name
   */
  function createDraftTemplate(id: string, name: string): MarkdownExportTemplate {
    return {
      id,
      name,
      fileTemplate: dom?.fileInput?.value ?? '',
      entryTemplate: dom?.entryInput?.value ?? '',
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  /**
   * Recompute the live preview from the current editor field values.
   * Shows a validation error message instead of a preview when the draft is invalid.
   */
  function updatePreview(): void {
    const { fileInput, entryInput, previewEl } = dom ?? {};
    if (!fileInput || !entryInput || !previewEl) return;

    const draft = createDraftTemplate('preview', 'preview');

    const validation = validateTemplate(draft);
    if (!validation.valid) {
      const prefix = getMessageOr('markdownTemplateInvalidPrefix', 'Invalid template:');
      previewEl.textContent = `${prefix} ${validation.errors.join(', ')}`;
      return;
    }

    previewEl.textContent = renderFileTemplate(draft, SAMPLE_ENTRIES, PREVIEW_DATE);
  }

  /**
   * Validate and persist the current editor draft (create or update depending on editingTemplateId).
   */
  async function handleSaveClick(): Promise<void> {
    const { nameInput, fileInput, entryInput } = dom ?? {};
    if (!nameInput || !fileInput || !entryInput || !currentSettings) return;

    const name = nameInput.value.trim();
    if (!name) {
      showFieldError(getMessageOr('markdownTemplateNameRequired', 'Template name is required'));
      return;
    }

    const draft = createDraftTemplate(editingTemplateId ?? 'draft', name);

    const validation = validateTemplate(draft);
    if (!validation.valid) {
      const prefix = getMessageOr('markdownTemplateInvalidPrefix', 'Invalid template:');
      showFieldError(`${prefix} ${validation.errors.join(', ')}`);
      return;
    }

    const stored = currentSettings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] ?? [];

    let updated: MarkdownExportTemplate[];
    if (editingTemplateId) {
      updated = updateTemplate(stored, editingTemplateId, {
        name: draft.name,
        fileTemplate: draft.fileTemplate,
        entryTemplate: draft.entryTemplate,
      });
    } else {
      updated = [
        ...stored,
        createTemplate({
          name: draft.name,
          fileTemplate: draft.fileTemplate,
          entryTemplate: draft.entryTemplate,
        }),
      ];
    }

    // Delta write (PBI 2026-09-17-17) — only the template list enters the payload.
    currentSettings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] = updated;
    await settingsRepository.set(StorageKeys.MARKDOWN_EXPORT_TEMPLATES, updated);

    showStatus(dom?.statusEl ?? 'markdownTemplateStatus',
      getMessageOr(editingTemplateId ? 'markdownTemplateUpdated' : 'markdownTemplateCreated', (editingTemplateId ? 'Template updated' : 'Template created')),
      'success'
    );

    closeEditor();
    renderTemplateList();
  }

  /**
   * Show an inline validation error inside the editor.
   * @param message Error message to display
   */
  function showFieldError(message: string): void {
    const errorEl = dom?.errorEl;
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.add('visible');
  }

  /**
   * Clear the inline validation error.
   */
  function clearError(): void {
    const errorEl = dom?.errorEl;
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.classList.remove('visible');
  }

  function init(settings: Settings): void {
    currentSettings = settings;
    resolveDom();

    const { createBtn, saveBtn, cancelBtn, fileInput, entryInput } = dom!;
    createBtn?.removeEventListener('click', handleCreateClick);
    createBtn?.addEventListener('click', handleCreateClick);
    saveBtn?.removeEventListener('click', handleSaveClick);
    saveBtn?.addEventListener('click', handleSaveClick);
    cancelBtn?.removeEventListener('click', handleCancelClick);
    cancelBtn?.addEventListener('click', handleCancelClick);
    fileInput?.removeEventListener('input', updatePreview);
    fileInput?.addEventListener('input', updatePreview);
    entryInput?.removeEventListener('input', updatePreview);
    entryInput?.addEventListener('input', updatePreview);

    renderTemplateList();
  }

  function destroy(): void {
    const { createBtn, saveBtn, cancelBtn, fileInput, entryInput } = dom ?? {};
    createBtn?.removeEventListener('click', handleCreateClick);
    saveBtn?.removeEventListener('click', handleSaveClick);
    cancelBtn?.removeEventListener('click', handleCancelClick);
    fileInput?.removeEventListener('input', updatePreview);
    entryInput?.removeEventListener('input', updatePreview);
    dom = null;
    currentSettings = null;
    editingTemplateId = null;
  }

  return { init, destroy };
}

/**
 * The instance the module-level functions below delegate to. One per page is
 * the whole reason the panel is a singleton today; `createMarkdownTemplateManager`
 * exists so a test (or a second mount) can hold an isolated one instead.
 */
const sharedManager = createMarkdownTemplateManager();

export function initMarkdownTemplateManager(settings: Settings): void {
  sharedManager.init(settings);
}

export function destroyMarkdownTemplateManager(): void {
  sharedManager.destroy();
}
