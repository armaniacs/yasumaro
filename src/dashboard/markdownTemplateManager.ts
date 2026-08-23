/**
 * markdownTemplateManager.ts
 * Markdown 書き出しテンプレート管理パネルの UI ロジック
 * customPromptManager.ts の DOM 操作パターン(一覧描画・エディタ表示切替・保存/削除ハンドラ)を踏襲する。
 */

import { SettingsRepository } from '../utils/storage/SettingsRepository.js';
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
import { getMessage } from '../utils/i18n.js';
import { applyI18n } from '../utils/i18n-dom.js';
import { escapeHtml } from '../popup/errorUtils.js';
import { showStatus } from '../utils/ui/settingsUiHelper.js';

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

// DOM Elements
let listEl: HTMLElement | null = null;
let editorEl: HTMLElement | null = null;
let nameInput: HTMLInputElement | null = null;
let fileInput: HTMLTextAreaElement | null = null;
let entryInput: HTMLTextAreaElement | null = null;
let previewEl: HTMLElement | null = null;
let errorEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let createBtn: HTMLButtonElement | null = null;
let saveBtn: HTMLButtonElement | null = null;
let cancelBtn: HTMLButtonElement | null = null;

// Current settings (kept in sync with chrome.storage.local via saveSettings/reload)
let currentSettings: Settings | null = null;

// Editing state: null = creating a new template, otherwise the id of the template being edited
let editingTemplateId: string | null = null;

/**
 * Initialize the Markdown template manager panel.
 *
 * Re-queries all DOM element refs and (re-)attaches listeners on every call,
 * so this is correct whether mount() happens once (current reality) or the
 * panel's DOM is ever torn down and rebuilt (hypothetical future re-mount).
 * Listeners are removed before being re-attached so that calling this twice
 * without the DOM actually changing (same element nodes) cannot result in
 * duplicate registrations; removeEventListener is a harmless no-op when the
 * nodes are freshly created.
 *
 * @param settings Current settings snapshot
 */
export function initMarkdownTemplateManager(settings: Settings): void {
  currentSettings = settings;

  listEl = document.getElementById('markdownTemplateList');
  editorEl = document.getElementById('markdownTemplateEditor');
  nameInput = document.getElementById('markdownTemplateName') as HTMLInputElement | null;
  fileInput = document.getElementById('markdownTemplateFileInput') as HTMLTextAreaElement | null;
  entryInput = document.getElementById('markdownTemplateEntryInput') as HTMLTextAreaElement | null;
  previewEl = document.getElementById('markdownTemplatePreview');
  errorEl = document.getElementById('markdownTemplateEditorError');
  statusEl = document.getElementById('markdownTemplateStatus');
  createBtn = document.getElementById('markdownTemplateCreateBtn') as HTMLButtonElement | null;
  saveBtn = document.getElementById('markdownTemplateSaveBtn') as HTMLButtonElement | null;
  cancelBtn = document.getElementById('markdownTemplateCancelBtn') as HTMLButtonElement | null;

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
  if (!listEl) return;

  const templates = getTemplates();
  const activeId = getActiveTemplateId();

  listEl.innerHTML = templates.map(t => createTemplateListItem(t, t.id === activeId)).join('');

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
    ? (getMessage('markdownTemplateDefaultName') || template.name)
    : template.name;
  const activeBadge = isActive
    ? `<span class="badge badge-active" data-i18n="markdownTemplateActiveLabel">Active</span>`
    : '';

  const editDeleteButtons = template.isDefault
    ? ''
    : `
      <button id="markdown-template-edit-${template.id}" class="btn-sm btn-edit" data-i18n="edit">Edit</button>
      <button id="markdown-template-delete-${template.id}" class="btn-sm btn-delete" data-i18n="delete">Delete</button>
    `;

  return `
    <div class="prompt-item ${isActive ? 'active' : ''}" data-template-id="${template.id}">
      <div class="prompt-item-header">
        <span class="prompt-name">${escapeHtml(displayName)}</span>
        ${activeBadge}
      </div>
      <div class="prompt-item-actions">
        ${!isActive ? `<button id="markdown-template-activate-${template.id}" class="btn-sm btn-activate" data-i18n="activate">Activate</button>` : ''}
        <button id="markdown-template-duplicate-${template.id}" class="btn-sm btn-duplicate" data-i18n="duplicate">Duplicate</button>
        ${editDeleteButtons}
      </div>
    </div>
  `;
}

/**
 * Activate a template as the one used for local Markdown export.
 * @param id Template id to activate
 */
async function handleActivateClick(id: string): Promise<void> {
  if (!currentSettings) return;

  currentSettings[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID] = id;
  await new SettingsRepository().setAll(currentSettings);

  showStatus(statusEl ?? 'markdownTemplateStatus', getMessage('markdownTemplateActivated') || 'Template activated', 'success');
  renderTemplateList();
}

/**
 * Delete a custom template (default template cannot be deleted; button is not rendered for it).
 * @param id Template id to delete
 */
async function handleDeleteClick(id: string): Promise<void> {
  if (!currentSettings) return;

  if (!confirm(getMessage('markdownTemplateConfirmDelete') || 'Are you sure you want to delete this template?')) {
    return;
  }

  const stored = currentSettings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] ?? [];
  const updated = deleteTemplate(stored, id);
  currentSettings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] = updated;

  // If the deleted template was active, fall back to the default template.
  if (getActiveTemplateId() === id) {
    currentSettings[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID] = DEFAULT_MARKDOWN_TEMPLATE.id;
  }

  await new SettingsRepository().setAll(currentSettings);

  showStatus(statusEl ?? 'markdownTemplateStatus', getMessage('markdownTemplateDeleted') || 'Template deleted', 'success');
  renderTemplateList();
}

/**
 * Open the editor pre-filled with a copy of an existing template (name gets a "Copy" suffix).
 * The duplicate is not saved until the user presses Save.
 * @param template Template to duplicate
 */
function handleDuplicateClick(template: MarkdownExportTemplate): void {
  const copySuffix = getMessage('markdownTemplateCopySuffix') || 'Copy';
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
    name: getMessage('markdownTemplateNewName') || 'New Template',
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
  if (nameInput) nameInput.value = '';
  if (fileInput) fileInput.value = '';
  if (entryInput) entryInput.value = '';
  clearError();
  editorEl?.classList.add('hidden');
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
    fileTemplate: fileInput?.value ?? '',
    entryTemplate: entryInput?.value ?? '',
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
  if (!fileInput || !entryInput || !previewEl) return;

  const draft = createDraftTemplate('preview', 'preview');

  const validation = validateTemplate(draft);
  if (!validation.valid) {
    const prefix = getMessage('markdownTemplateInvalidPrefix') || 'Invalid template:';
    previewEl.textContent = `${prefix} ${validation.errors.join(', ')}`;
    return;
  }

  previewEl.textContent = renderFileTemplate(draft, SAMPLE_ENTRIES, PREVIEW_DATE);
}

/**
 * Validate and persist the current editor draft (create or update depending on editingTemplateId).
 */
async function handleSaveClick(): Promise<void> {
  if (!nameInput || !fileInput || !entryInput || !currentSettings) return;

  const name = nameInput.value.trim();
  if (!name) {
    showFieldError(getMessage('markdownTemplateNameRequired') || 'Template name is required');
    return;
  }

  const draft = createDraftTemplate(editingTemplateId ?? 'draft', name);

  const validation = validateTemplate(draft);
  if (!validation.valid) {
    const prefix = getMessage('markdownTemplateInvalidPrefix') || 'Invalid template:';
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

  currentSettings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] = updated;
  await new SettingsRepository().setAll(currentSettings);

  showStatus(statusEl ?? 'markdownTemplateStatus', 
    getMessage(editingTemplateId ? 'markdownTemplateUpdated' : 'markdownTemplateCreated')
      || (editingTemplateId ? 'Template updated' : 'Template created'),
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
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.add('visible');
}

/**
 * Clear the inline validation error.
 */
function clearError(): void {
  if (!errorEl) return;
  errorEl.textContent = '';
  errorEl.classList.remove('visible');
}

