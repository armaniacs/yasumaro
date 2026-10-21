// @vitest-environment jsdom
/**
 * markdownTemplateSave.test.ts
 * PBI 03: the markdown template save path must never fail silently and never
 * show a fake success.
 *
 * Failure path (new): a rejected repository write shows the inline field
 * error and keeps the editor open (closeEditor/renderTemplateList previously
 * never ran, and the rejection surfaced only as an unhandled rejection).
 * Success path (pin): a settled write closes the editor and re-renders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';
import { StorageKeys, type Settings } from '../../utils/storage/types.js';

const {
  mockRepoSet,
  mockRepoSetAll,
  mockRepoGetAll,
  mockRepoGetMany,
  mockShowStatus,
} = vi.hoisted(() => ({
  mockRepoSet: vi.fn(() => Promise.resolve()),
  mockRepoSetAll: vi.fn(() => Promise.resolve()),
  mockRepoGetAll: vi.fn(() => Promise.resolve({})),
  mockRepoGetMany: vi.fn(() => Promise.resolve({})),
  mockShowStatus: vi.fn(),
}));

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockRepoGetAll,
      getMany: mockRepoGetMany,
      get: vi.fn(),
      set: mockRepoSet,
      setAll: mockRepoSetAll,
    },
  };
});

// PBI 13 mock shape: unknown keys return '', so the module's fallbacks are
// exercised and the assertions read the real fallback text.
vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const messages: Record<string, string> = {
    saveError: 'Save error',
    markdownTemplateNewName: 'New Template',
    markdownTemplateNameRequired: 'Template name is required',
    markdownTemplateInvalidPrefix: 'Invalid template:',
    markdownTemplateCreated: 'Template created',
    markdownTemplateUpdated: 'Template updated',
    markdownTemplateDefaultName: 'Default',
  };
  return i18nMock(vi.fn((key: string) => messages[key] ?? ''));
});

vi.mock('../../utils/i18n-dom.js', () => ({ applyI18n: vi.fn() }));
vi.mock('../../utils/ui/settingsUiHelper.js', () => ({ showStatus: mockShowStatus }));
vi.mock('../../utils/ui/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn(() => Promise.resolve(true)),
  showAlertDialog: vi.fn(() => Promise.resolve(undefined)),
}));

// Light prompt utils: markdownTemplateManager only renders list rows through
// customPromptManager's buildPromptItemRow, which reads these constants.
vi.mock('../../utils/customPromptUtils.js', () => ({
  createPrompt: vi.fn((data: Record<string, unknown>) => ({ id: 'created-1', createdAt: 1, updatedAt: 1, ...data })),
  updatePrompt: vi.fn((prompts: unknown[]) => prompts),
  deletePrompt: vi.fn((prompts: unknown[]) => prompts),
  setActivePrompt: vi.fn((prompts: unknown[]) => prompts),
  validatePrompt: vi.fn(() => ({ valid: true })),
  DEFAULT_USER_PROMPT: 'Default user prompt',
  DEFAULT_SYSTEM_PROMPT: 'Default system prompt',
  PRESET_PROMPTS: [],
  getPresetPrompt: vi.fn(() => undefined),
  getPromptDisplayName: vi.fn(() => 'Default'),
}));

import { createMarkdownTemplateManager } from '../markdownTemplateManager.js';

// jsdom implements no layout, so scrollIntoView is absent; the editor calls it.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
}

function templateDom(): void {
  document.body.innerHTML = `
    <div id="markdownTemplateList"></div>
    <div id="markdownTemplateEditor" class="hidden"></div>
    <input id="markdownTemplateName" />
    <textarea id="markdownTemplateFileInput"></textarea>
    <textarea id="markdownTemplateEntryInput"></textarea>
    <div id="markdownTemplatePreview"></div>
    <div id="markdownTemplateEditorError"></div>
    <div id="markdownTemplateStatus"></div>
    <button id="markdownTemplateCreateBtn"></button>
    <button id="markdownTemplateSaveBtn"></button>
    <button id="markdownTemplateCancelBtn"></button>
  `;
}

const asSettings = (s: Record<string, unknown>): Settings => s as unknown as Settings;

function click(id: string): void {
  document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('markdownTemplateManager handleSaveClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    templateDom();
  });

  afterEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('shows the field error and keeps the editor open when the write rejects', async () => {
    mockRepoSet.mockRejectedValueOnce(new Error('quota exceeded'));
    const manager = createMarkdownTemplateManager();
    manager.init(asSettings({ [StorageKeys.MARKDOWN_EXPORT_TEMPLATES]: [] }));

    click('markdownTemplateCreateBtn');
    const nameInput = document.getElementById('markdownTemplateName') as HTMLInputElement;
    nameInput.value = 'My Template';

    // The save listener is fire-and-forget, so anchor on the repository call.
    click('markdownTemplateSaveBtn');
    await waitForMock(() => expect(mockRepoSet).toHaveBeenCalled());

    // The failure is visible inline instead of a silent rejection
    const errorEl = document.getElementById('markdownTemplateEditorError')!;
    expect(errorEl.textContent).toBe('Save error');
    expect(errorEl.classList.contains('visible')).toBe(true);

    // No success status for a rejected write
    expect(mockShowStatus).not.toHaveBeenCalled();

    // The editor stays open so the draft survives for a retry
    expect(document.getElementById('markdownTemplateEditor')!.classList.contains('hidden')).toBe(false);
  });

  it('closes the editor and re-renders the list after a successful save', async () => {
    const manager = createMarkdownTemplateManager();
    manager.init(asSettings({ [StorageKeys.MARKDOWN_EXPORT_TEMPLATES]: [] }));

    click('markdownTemplateCreateBtn');
    const nameInput = document.getElementById('markdownTemplateName') as HTMLInputElement;
    nameInput.value = 'My Template';

    click('markdownTemplateSaveBtn');
    await waitForMock(() => {
      expect(document.getElementById('markdownTemplateEditor')!.classList.contains('hidden')).toBe(true);
    });

    // The template list was re-rendered with the new entry
    const list = document.getElementById('markdownTemplateList')!;
    expect(list.textContent).toContain('My Template');
    expect(mockShowStatus).toHaveBeenCalledWith(
      expect.anything(),
      'Template created',
      'success',
    );
  });
});
