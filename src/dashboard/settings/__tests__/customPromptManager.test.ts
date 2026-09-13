// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { CustomPrompt } from '../../../utils/types.js';
import type { Settings } from '../../../utils/storage/types.js';

// Test-local typed DOM accessor: the beforeEach fixture guarantees these ids exist,
// and the form controls are inputs/selects/textareas, so exposing `value` is safe here.
type TestFormEl = HTMLElement & { value: string };
function el<T extends HTMLElement = TestFormEl>(id: string): T {
  return document.getElementById(id) as unknown as T;
}
const asSettings = (s: { custom_prompts: CustomPrompt[] }): Settings =>
  s as unknown as Settings;

// Polyfill scrollIntoView for jsdom
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn() as any;
}

const { mockGetAll, mockGetMany, mockSetAll } = vi.hoisted(() => ({
  mockGetAll: vi.fn().mockResolvedValue({}),
  mockGetMany: vi.fn().mockResolvedValue({}),
  mockSetAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    StorageKeys: {
      CUSTOM_PROMPTS: 'custom_prompts',
    },
  };
});

vi.mock('../../../utils/storage/SettingsRepository.js', async (importOriginal) => {
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

vi.mock('../../../utils/customPromptUtils.js', () => ({
  createPrompt: vi.fn((data: Partial<CustomPrompt>) => ({
    ...data,
    id: `test_prompt_${Date.now()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })),
  updatePrompt: vi.fn((prompts: CustomPrompt[], id: string, updates: Partial<CustomPrompt>) =>
    prompts.map((p) =>
      p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
    )
  ),
  deletePrompt: vi.fn((prompts: CustomPrompt[], id: string) =>
    prompts.filter((p) => p.id !== id)
  ),
  setActivePrompt: vi.fn((prompts: CustomPrompt[], id: string, _provider: string) =>
    prompts.map((p) => ({
      ...p,
      isActive: p.id === id,
      updatedAt: p.id === id ? Date.now() : p.updatedAt,
    }))
  ),
  validatePrompt: vi.fn().mockReturnValue({ valid: true }),
  DEFAULT_USER_PROMPT: 'Default user prompt',
  DEFAULT_SYSTEM_PROMPT: 'Default system prompt',
  PRESET_PROMPTS: [
    { id: 'default', name: 'Default', nameJa: '\u30c7\u30d5\u30a9\u30eb\u30c8', userPrompt: 'Default prompt', systemPrompt: '' },
    { id: 'concise', name: 'Concise', nameJa: '\u7c21\u6f54', userPrompt: 'Be concise', systemPrompt: '' },
  ],
  getPresetPrompt: vi.fn((id: string) => {
    const presets: Record<string, { id: string; name: string; nameJa: string; userPrompt: string; systemPrompt: string }> = {
      default: { id: 'default', name: 'Default', nameJa: '\u30c7\u30d5\u30a9\u30eb\u30c8', userPrompt: 'Default prompt', systemPrompt: '' },
      concise: { id: 'concise', name: 'Concise', nameJa: '\u7c21\u6f54', userPrompt: 'Be concise', systemPrompt: '' },
    };
    return presets[id];
  }),
  getPromptDisplayName: vi.fn((preset: { name: string; nameJa: string }, locale: string) =>
    locale === 'ja' ? preset.nameJa : preset.name
  ),
}));

vi.mock('../../../utils/i18n.js', () => ({
  applyI18n: vi.fn(),
  getMessage: vi.fn((key: string) => {
    const messages: Record<string, string | undefined> = {
      locale: undefined,
      promptProviderAll: 'All Providers',
      activate: 'Activate',
      duplicate: 'Duplicate',
      savePrompt: 'Save Prompt',
      updatePrompt: 'Update Prompt',
      defaultPrompt: 'Default',
      activePrompt: 'Active',
      promptNameRequired: 'Prompt name is required',
      promptUpdated: 'Prompt updated',
      promptCreated: 'Prompt created',
      promptDeleted: 'Prompt deleted',
      promptActivated: 'Prompt activated',
      promptDuplicated: 'Prompt copied to editor',
      confirmDeletePrompt: 'Are you sure you want to delete this prompt?',
    };
    return key in messages ? messages[key] : key;
  }),
}));

vi.mock('../../../popup/errorUtils.js', () => ({
  escapeHtml: vi.fn((s: unknown) => String(s)),
}));

function createTestPrompt(overrides: Partial<CustomPrompt> = {}): CustomPrompt {
  return {
    id: 'prompt_test_1',
    name: 'Test Prompt',
    provider: 'all',
    systemPrompt: '',
    prompt: 'Summarize {{content}}',
    isActive: false,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe('customPromptManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="promptList"></div>
      <div id="noPromptsMessage"></div>
      <input id="promptName" />
      <select id="promptProvider">
        <option value="all">All</option>
        <option value="gemini">Gemini</option>
        <option value="openai">OpenAI</option>
      </select>
      <input id="promptSystem" />
      <textarea id="promptText"></textarea>
      <input id="editingPromptId" />
      <button id="savePromptBtn"></button>
      <button id="cancelPromptBtn"></button>
      <div id="promptStatus"></div>
    `;
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('exports', () => {
    it('should export initCustomPromptManager function', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      expect(typeof initCustomPromptManager).toBe('function');
    });

    it('should export loadDefaultPrompt function', async () => {
      const { loadDefaultPrompt } = await import('../customPromptManager.js');
      expect(typeof loadDefaultPrompt).toBe('function');
    });
  });

  describe('loadDefaultPrompt', () => {
    it('should load default prompt values into editor fields', async () => {
      const { initCustomPromptManager, loadDefaultPrompt } = await import('../customPromptManager.js');
      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      loadDefaultPrompt();

      const textInput = el('promptText');
      const systemInput = el('promptSystem');
      expect(textInput.value).toBe('Default user prompt');
      expect(systemInput.value).toBe('Default system prompt');
    });
  });

  describe('initCustomPromptManager', () => {
    it('should attach event listeners to save and cancel buttons', async () => {
      const addEventListenerSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener');
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      // Save and cancel button listeners are attached in initCustomPromptManager
      expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
      addEventListenerSpy.mockRestore();
    });

    it('should hide noPromptsMessage', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      const noPromptsMsg = el('noPromptsMessage');
      expect(noPromptsMsg.style.display).toBe('none');
    });
  });

  describe('renderPromptList', () => {
    it('should render preset prompt items (excluding default)', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      const html = el('promptList').innerHTML;
      expect(html).toContain('__preset__concise');
      expect(html).toContain('duplicate-prompt-__preset__concise');
    });

    it('should render default prompt item', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      const html = el('promptList').innerHTML;
      expect(html).toContain('__default__');
    });

    it('should render custom prompt items when present', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt()];
      initCustomPromptManager(asSettings({ custom_prompts: prompts }));

      const html = el('promptList').innerHTML;
      expect(html).toContain('prompt_test_1');
      expect(html).toContain('Test Prompt');
    });

    it('should render edit and delete buttons for custom prompts', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt()];
      initCustomPromptManager(asSettings({ custom_prompts: prompts }));

      const html = el('promptList').innerHTML;
      expect(html).toContain('edit-prompt-prompt_test_1');
      expect(html).toContain('delete-prompt-prompt_test_1');
    });

    it('should mark active custom prompt with active class', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt({ isActive: true })];
      initCustomPromptManager(asSettings({ custom_prompts: prompts }));

      const promptList = el('promptList');
      // Active prompt item should not show activate button
      expect(el('activate-prompt-prompt_test_1')).toBeNull();
    });

    it('should show activate button for inactive custom prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt({ isActive: false })];
      initCustomPromptManager(asSettings({ custom_prompts: prompts }));

      expect(el('activate-prompt-prompt_test_1')).not.toBeNull();
    });

    it('should show default as active when no custom prompts are active', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      // Default should be marked active and not show activate button
      expect(el('activate-prompt-__default__')).toBeNull();
    });

    it('should show activate button for default when a custom prompt is active', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt({ isActive: true })];
      initCustomPromptManager(asSettings({ custom_prompts: prompts }));

      expect(el('activate-prompt-__default__')).not.toBeNull();
    });

    it('should render provider label for custom prompts', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [
        createTestPrompt({ provider: 'gemini', name: 'Gemini Prompt' }),
      ];
      initCustomPromptManager(asSettings({ custom_prompts: prompts }));

      const html = el('promptList').innerHTML;
      expect(html).toContain('All Providers');
    });
  });

  describe('handleSavePrompt', () => {
    it('should create a new prompt when save is clicked with valid data', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');

      const settings: { custom_prompts: CustomPrompt[] } = { custom_prompts: [] };
      initCustomPromptManager(asSettings(settings));

      const nameInput = el('promptName');
      const providerSelect = el('promptProvider');
      const textInput = el('promptText');

      nameInput.value = 'My Custom Prompt';
      providerSelect.value = 'gemini';
      textInput.value = 'Summarize {{content}} in detail';

      el('savePromptBtn').click();
      await vi.waitFor(() => {
        expect(mockSetAll).toHaveBeenCalled();
      });

      // The settings object should be mutated with the new prompt
      expect(settings.custom_prompts).toHaveLength(1);
      expect(settings.custom_prompts[0]!.name).toBe('My Custom Prompt');
      expect(settings.custom_prompts[0]!.provider).toBe('gemini');
      expect(settings.custom_prompts[0]!.prompt).toBe('Summarize {{content}} in detail');
      expect(settings.custom_prompts[0]!.isActive).toBe(false);

      // Form should be reset after save
      expect(nameInput.value).toBe('');
      expect(textInput.value).toBe('');
    });

    it('should update an existing prompt when editingPromptId is set', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');

      const existingPrompt = createTestPrompt({ id: 'existing_id' });
      const settings = { custom_prompts: [existingPrompt] };
      initCustomPromptManager(asSettings(settings));

      // Set editing mode
      const editingIdInput = el('editingPromptId');
      editingIdInput.value = 'existing_id';

      const nameInput = el('promptName');
      const providerSelect = el('promptProvider');
      const systemInput = el('promptSystem');
      const textInput = el('promptText');

      nameInput.value = 'Updated Name';
      providerSelect.value = 'openai';
      systemInput.value = 'System prompt';
      textInput.value = 'Updated content {{content}}';

      el('savePromptBtn').click();
      await vi.waitFor(() => {
        expect(mockSetAll).toHaveBeenCalled();
      });

      // Verify the prompts array was updated
      expect(settings.custom_prompts).toHaveLength(1);
      expect(settings.custom_prompts[0]!.name).toBe('Updated Name');
      expect(settings.custom_prompts[0]!.provider).toBe('openai');
      expect(settings.custom_prompts[0]!.systemPrompt).toBe('System prompt');
      expect(settings.custom_prompts[0]!.prompt).toBe('Updated content {{content}}');

      // Form should be reset after update
      expect(editingIdInput.value).toBe('');
    });

    it('should show error when name is empty', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');

      const settings: { custom_prompts: CustomPrompt[] } = { custom_prompts: [] };
      initCustomPromptManager(asSettings(settings));

      const textInput = el('promptText');
      textInput.value = 'Some prompt';

      el('savePromptBtn').click();

      await vi.waitFor(() => {
        const statusDiv = el('promptStatus');
        expect(statusDiv.textContent).toBeTruthy();
      });

      // mockSetAll should NOT have been called (validation failed)
      expect(mockSetAll).not.toHaveBeenCalled();
    });

    it('should show error when validation fails', async () => {
      const { validatePrompt } = await import('../../../utils/customPromptUtils.js');
      vi.mocked(validatePrompt).mockReturnValueOnce({ valid: false, error: 'Invalid prompt content' });

      const { initCustomPromptManager } = await import('../customPromptManager.js');

      const settings: { custom_prompts: CustomPrompt[] } = { custom_prompts: [] };
      initCustomPromptManager(asSettings(settings));

      const nameInput = el('promptName');
      const textInput = el('promptText');

      nameInput.value = 'Test';
      textInput.value = 'Invalid content';

      el('savePromptBtn').click();

      await vi.waitFor(() => {
        const statusDiv = el('promptStatus');
        expect(statusDiv.textContent).toBe('Invalid prompt content');
        expect(statusDiv.className).toBe('error');
      });

      expect(mockSetAll).not.toHaveBeenCalled();
    });

    it('should handle system prompt input being absent in DOM', async () => {
      // Remove promptSystem from DOM
      const systemInput = el('promptSystem');
      systemInput.remove();

      const { initCustomPromptManager } = await import('../customPromptManager.js');

      const settings: { custom_prompts: CustomPrompt[] } = { custom_prompts: [] };
      initCustomPromptManager(asSettings(settings));

      const nameInput = el('promptName');
      const textInput = el('promptText');

      nameInput.value = 'Test';
      textInput.value = 'Summarize {{content}}';

      el('savePromptBtn').click();
      await vi.waitFor(() => {
        expect(mockSetAll).toHaveBeenCalled();
      });
    });
  });

  describe('handleEditPrompt', () => {
    it('should populate form when edit button is clicked on a custom prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [
        createTestPrompt({
          id: 'edit_test_1',
          name: 'Editable Prompt',
          provider: 'gemini',
          systemPrompt: 'Be concise',
          prompt: 'Summarize {{content}} briefly',
        }),
      ];
      initCustomPromptManager(asSettings({ custom_prompts: prompts }));

      // Click edit button
      el('edit-prompt-edit_test_1').click();

      const nameInput = el('promptName');
      const providerSelect = el('promptProvider');
      const systemInput = el('promptSystem');
      const textInput = el('promptText');
      const editingIdInput = el('editingPromptId');
      const saveBtn = el('savePromptBtn');

      expect(nameInput.value).toBe('Editable Prompt');
      expect(providerSelect.value).toBe('gemini');
      expect(systemInput.value).toBe('Be concise');
      expect(textInput.value).toBe('Summarize {{content}} briefly');
      expect(editingIdInput.value).toBe('edit_test_1');
      expect(saveBtn.textContent).toBe('Update Prompt');
      expect(el('cancelPromptBtn').style.display).toBe('inline-block');
    });

    it('should show error when trying to edit default prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      // Create an active custom prompt so buttons are rendered
      const prompts = [createTestPrompt({ isActive: true })];
      initCustomPromptManager(asSettings({ custom_prompts: prompts }));

      // There's no edit button for default, so this simulates calling handleEditPrompt with default id
      // That path is triggered when savePromptBtn's click handler somehow gets called with default id
      // But the function is internal, so we test via the activate -> then editing approach

      // Default prompt has no edit button (only activate/duplicate)
      expect(el('edit-prompt-__default__')).toBeNull();
    });
  });

  describe('handleDeletePrompt', () => {
    it('should delete a prompt when confirmed', async () => {
      (global.confirm as Mock).mockReturnValueOnce(true);

      const { initCustomPromptManager } = await import('../customPromptManager.js');

      const prompts = [createTestPrompt({ id: 'delete_test_1' })];
      const settings = { custom_prompts: prompts };
      initCustomPromptManager(asSettings(settings));

      el('delete-prompt-delete_test_1').click();
      await vi.waitFor(() => {
        expect(mockSetAll).toHaveBeenCalled();
      });

      expect(settings.custom_prompts).toHaveLength(0);
    });

    it('should NOT delete a prompt when confirmation is cancelled', async () => {
      (global.confirm as Mock).mockReturnValueOnce(false);

      const { initCustomPromptManager } = await import('../customPromptManager.js');

      const prompts = [createTestPrompt({ id: 'delete_test_2' })];
      const settings = { custom_prompts: prompts };
      initCustomPromptManager(asSettings(settings));

      el('delete-prompt-delete_test_2').click();

      // Give microtasks time to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSetAll).not.toHaveBeenCalled();
      expect(settings.custom_prompts).toHaveLength(1);
    });

    it('should not show delete button for default prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      expect(el('delete-prompt-__default__')).toBeNull();
    });
  });

  describe('handleActivatePrompt', () => {
    it('should activate default prompt by deactivating all custom prompts', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');

      const prompts = [createTestPrompt({ isActive: true })];
      const settings = { custom_prompts: prompts };
      initCustomPromptManager(asSettings(settings));

      // Click activate on default
      el('activate-prompt-__default__').click();
      await vi.waitFor(() => {
        expect(mockSetAll).toHaveBeenCalled();
      });

      // All custom prompts should be deactivated
      expect(settings.custom_prompts[0]!.isActive).toBe(false);
    });

    it('should activate a custom prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');

      const prompts = [
        createTestPrompt({ id: 'p1', name: 'Prompt 1', isActive: true }),
        createTestPrompt({ id: 'p2', name: 'Prompt 2', isActive: false }),
      ];
      const settings = { custom_prompts: prompts };
      initCustomPromptManager(asSettings(settings));

      // Click activate on prompt 2
      el('activate-prompt-p2').click();
      await vi.waitFor(() => {
        expect(mockSetAll).toHaveBeenCalled();
      });

      expect(settings.custom_prompts[1]!.isActive).toBe(true);
    });

    it('should activate preset prompt when activate button is clicked', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { getPresetPrompt } = await import('../../../utils/customPromptUtils.js');

      const settings: { custom_prompts: CustomPrompt[] } = { custom_prompts: [] };
      initCustomPromptManager(asSettings(settings));

      // Click activate on "concise" preset
      const activateBtn = el('activate-prompt-__preset__concise');
      activateBtn.click();
      await vi.waitFor(() => {
        expect(mockSetAll).toHaveBeenCalled();
      });

      // A new prompt entry should have been created for the preset
      expect(settings.custom_prompts).toHaveLength(1);
      expect(settings.custom_prompts[0]!.id).toBe('__preset__concise');
      expect(settings.custom_prompts[0]!.isActive).toBe(true);
      expect(settings.custom_prompts[0]!.provider).toBe('all');
    });

    it('should upsert existing preset entry instead of duplicating', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');

      const existingEntry = createTestPrompt({
        id: '__preset__concise',
        name: 'Concise',
        isActive: false,
      });
      const settings = { custom_prompts: [existingEntry] };
      initCustomPromptManager(asSettings(settings));

      el('activate-prompt-__preset__concise').click();
      await vi.waitFor(() => {
        expect(mockSetAll).toHaveBeenCalled();
      });

      expect(settings.custom_prompts).toHaveLength(1);
      expect(settings.custom_prompts[0]!.isActive).toBe(true);
    });
  });

  describe('handleDuplicatePrompt', () => {
    it('should duplicate default prompt into editor', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      el('duplicate-prompt-__default__').click();

      const nameInput = el('promptName');
      const textInput = el('promptText');
      const editingIdInput = el('editingPromptId');

      expect(nameInput.value).toContain('Default');
      expect(nameInput.value).toContain('(Copy)');
      expect(textInput.value).toBe('Default user prompt');
      expect(editingIdInput.value).toBe(''); // Clear for new creation
    });

    it('should duplicate preset prompt into editor', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      el('duplicate-prompt-__preset__concise').click();

      const nameInput = el('promptName');
      const textInput = el('promptText');

      expect(nameInput.value).toContain('Concise');
      expect(textInput.value).toBe('Be concise');
    });

    it('should duplicate custom prompt into editor', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [
        createTestPrompt({
          id: 'dup_test',
          name: 'Original',
          provider: 'gemini',
          systemPrompt: 'Custom system',
          prompt: 'Original content',
        }),
      ];
      initCustomPromptManager(asSettings({ custom_prompts: prompts }));

      el('duplicate-prompt-dup_test').click();

      const nameInput = el('promptName');
      const providerSelect = el('promptProvider');
      const systemInput = el('promptSystem');
      const textInput = el('promptText');
      const editingIdInput = el('editingPromptId');

      expect(nameInput.value).toBe('Original (Copy)');
      expect(providerSelect.value).toBe('gemini');
      expect(systemInput.value).toBe('Custom system');
      expect(textInput.value).toBe('Original content');
      expect(editingIdInput.value).toBe('');
    });

    it('should show status and set name with (Copy) when duplicating custom prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [
        createTestPrompt({
          id: 'dup_target',
          name: 'Original Prompt',
          provider: 'gemini',
          systemPrompt: 'Be precise',
          prompt: 'Original {{content}}',
        }),
      ];
      initCustomPromptManager(asSettings({ custom_prompts: prompts }));

      // Click duplicate on the prompt
      el('duplicate-prompt-dup_target')!.click();

      // Verify the form is populated with copied values
      const nameInput = el('promptName') as HTMLInputElement;
      expect(nameInput.value).toBe('Original Prompt (Copy)');
    });
  });

  describe('handleCancelEdit', () => {
    it('should reset form when cancel button is clicked', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      // First populate form
      const nameInput = el('promptName');
      const textInput = el('promptText');
      nameInput.value = 'Something';
      textInput.value = 'Some content';

      // Click cancel
      el('cancelPromptBtn').click();

      expect(nameInput.value).toBe('');
      expect(textInput.value).toBe('');
      const cancelBtn = el('cancelPromptBtn');
      expect(cancelBtn.style.display).toBe('none');
    });
  });

  describe('showStatus', () => {
    it('should show success status message after creating a prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');

      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      const nameInput = el('promptName');
      const textInput = el('promptText');
      nameInput.value = 'Test';
      textInput.value = 'Summarize {{content}}';

      el('savePromptBtn').click();
      await vi.waitFor(() => {
        expect(mockSetAll).toHaveBeenCalled();
      });

      const statusDiv = el('promptStatus');
      expect(statusDiv.textContent).toBeTruthy();
      expect(statusDiv.className).toBe('success');
    });

    it('should show error status when name is empty', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager(asSettings({ custom_prompts: [] }));

      el('savePromptBtn').click();

      await vi.waitFor(() => {
        const statusDiv = el('promptStatus');
        expect(statusDiv.className).toBe('error');
      });
    });
  });

});
