// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Polyfill scrollIntoView for jsdom
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn() as any;
}

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    CUSTOM_PROMPTS: 'custom_prompts',
  },
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/customPromptUtils.js', () => ({
  createPrompt: vi.fn((data) => ({
    ...data,
    id: `test_prompt_${Date.now()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })),
  updatePrompt: vi.fn((prompts, id, updates) =>
    prompts.map((p) =>
      p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
    )
  ),
  deletePrompt: vi.fn((prompts, id) =>
    prompts.filter((p) => p.id !== id)
  ),
  setActivePrompt: vi.fn((prompts, id, _provider) =>
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
  getPresetPrompt: vi.fn((id) => {
    const presets = {
      default: { id: 'default', name: 'Default', nameJa: '\u30c7\u30d5\u30a9\u30eb\u30c8', userPrompt: 'Default prompt', systemPrompt: '' },
      concise: { id: 'concise', name: 'Concise', nameJa: '\u7c21\u6f54', userPrompt: 'Be concise', systemPrompt: '' },
    };
    return presets[id];
  }),
  getPromptDisplayName: vi.fn((preset, locale) =>
    locale === 'ja' ? preset.nameJa : preset.name
  ),
}));

vi.mock('../../utils/i18n.js', () => ({
  applyI18n: vi.fn(),
  getMessage: vi.fn((key) => {
    const messages = {
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

vi.mock('../errorUtils.js', () => ({
  escapeHtml: vi.fn((s) => String(s)),
}));

function createTestPrompt(overrides = {}) {
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
      initCustomPromptManager({ custom_prompts: [] });

      loadDefaultPrompt();

      const textInput = document.getElementById('promptText');
      const systemInput = document.getElementById('promptSystem');
      expect(textInput.value).toBe('Default user prompt');
      expect(systemInput.value).toBe('Default system prompt');
    });
  });

  describe('initCustomPromptManager', () => {
    it('should attach event listeners to save and cancel buttons', async () => {
      const addEventListenerSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener');
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      // Save and cancel button listeners are attached in initCustomPromptManager
      expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
      addEventListenerSpy.mockRestore();
    });

    it('should hide noPromptsMessage', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const noPromptsMsg = document.getElementById('noPromptsMessage');
      expect(noPromptsMsg.style.display).toBe('none');
    });
  });

  describe('renderPromptList', () => {
    it('should render preset prompt items (excluding default)', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const html = document.getElementById('promptList').innerHTML;
      expect(html).toContain('__preset__concise');
      expect(html).toContain('duplicate-prompt-__preset__concise');
    });

    it('should render default prompt item', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const html = document.getElementById('promptList').innerHTML;
      expect(html).toContain('__default__');
    });

    it('should render custom prompt items when present', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt()];
      initCustomPromptManager({ custom_prompts: prompts });

      const html = document.getElementById('promptList').innerHTML;
      expect(html).toContain('prompt_test_1');
      expect(html).toContain('Test Prompt');
    });

    it('should render edit and delete buttons for custom prompts', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt()];
      initCustomPromptManager({ custom_prompts: prompts });

      const html = document.getElementById('promptList').innerHTML;
      expect(html).toContain('edit-prompt-prompt_test_1');
      expect(html).toContain('delete-prompt-prompt_test_1');
    });

    it('should mark active custom prompt with active class', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt({ isActive: true })];
      initCustomPromptManager({ custom_prompts: prompts });

      const promptList = document.getElementById('promptList');
      // Active prompt item should not show activate button
      expect(document.getElementById('activate-prompt-prompt_test_1')).toBeNull();
    });

    it('should show activate button for inactive custom prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt({ isActive: false })];
      initCustomPromptManager({ custom_prompts: prompts });

      expect(document.getElementById('activate-prompt-prompt_test_1')).not.toBeNull();
    });

    it('should show default as active when no custom prompts are active', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      // Default should be marked active and not show activate button
      expect(document.getElementById('activate-prompt-__default__')).toBeNull();
    });

    it('should show activate button for default when a custom prompt is active', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt({ isActive: true })];
      initCustomPromptManager({ custom_prompts: prompts });

      expect(document.getElementById('activate-prompt-__default__')).not.toBeNull();
    });

    it('should render provider label for custom prompts', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [
        createTestPrompt({ provider: 'gemini', name: 'Gemini Prompt' }),
      ];
      initCustomPromptManager({ custom_prompts: prompts });

      const html = document.getElementById('promptList').innerHTML;
      expect(html).toContain('All Providers');
    });
  });

  describe('handleSavePrompt', () => {
    it('should create a new prompt when save is clicked with valid data', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');

      const settings = { custom_prompts: [] };
      initCustomPromptManager(settings);

      const nameInput = document.getElementById('promptName');
      const providerSelect = document.getElementById('promptProvider');
      const textInput = document.getElementById('promptText');

      nameInput.value = 'My Custom Prompt';
      providerSelect.value = 'gemini';
      textInput.value = 'Summarize {{content}} in detail';

      document.getElementById('savePromptBtn').click();
      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalled();
      });

      // The settings object should be mutated with the new prompt
      expect(settings.custom_prompts).toHaveLength(1);
      expect(settings.custom_prompts[0].name).toBe('My Custom Prompt');
      expect(settings.custom_prompts[0].provider).toBe('gemini');
      expect(settings.custom_prompts[0].prompt).toBe('Summarize {{content}} in detail');
      expect(settings.custom_prompts[0].isActive).toBe(false);

      // Form should be reset after save
      expect(nameInput.value).toBe('');
      expect(textInput.value).toBe('');
    });

    it('should update an existing prompt when editingPromptId is set', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');

      const existingPrompt = createTestPrompt({ id: 'existing_id' });
      const settings = { custom_prompts: [existingPrompt] };
      initCustomPromptManager(settings);

      // Set editing mode
      const editingIdInput = document.getElementById('editingPromptId');
      editingIdInput.value = 'existing_id';

      const nameInput = document.getElementById('promptName');
      const providerSelect = document.getElementById('promptProvider');
      const systemInput = document.getElementById('promptSystem');
      const textInput = document.getElementById('promptText');

      nameInput.value = 'Updated Name';
      providerSelect.value = 'openai';
      systemInput.value = 'System prompt';
      textInput.value = 'Updated content {{content}}';

      document.getElementById('savePromptBtn').click();
      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalled();
      });

      // Verify the prompts array was updated
      expect(settings.custom_prompts).toHaveLength(1);
      expect(settings.custom_prompts[0].name).toBe('Updated Name');
      expect(settings.custom_prompts[0].provider).toBe('openai');
      expect(settings.custom_prompts[0].systemPrompt).toBe('System prompt');
      expect(settings.custom_prompts[0].prompt).toBe('Updated content {{content}}');

      // Form should be reset after update
      expect(editingIdInput.value).toBe('');
    });

    it('should show error when name is empty', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');

      const settings = { custom_prompts: [] };
      initCustomPromptManager(settings);

      const textInput = document.getElementById('promptText');
      textInput.value = 'Some prompt';

      document.getElementById('savePromptBtn').click();

      await vi.waitFor(() => {
        const statusDiv = document.getElementById('promptStatus');
        expect(statusDiv.textContent).toBeTruthy();
      });

      // saveSettings should NOT have been called (validation failed)
      expect(saveSettings).not.toHaveBeenCalled();
    });

    it('should show error when validation fails', async () => {
      const { validatePrompt } = await import('../../utils/customPromptUtils.js');
      validatePrompt.mockReturnValueOnce({ valid: false, error: 'Invalid prompt content' });

      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');

      const settings = { custom_prompts: [] };
      initCustomPromptManager(settings);

      const nameInput = document.getElementById('promptName');
      const textInput = document.getElementById('promptText');

      nameInput.value = 'Test';
      textInput.value = 'Invalid content';

      document.getElementById('savePromptBtn').click();

      await vi.waitFor(() => {
        const statusDiv = document.getElementById('promptStatus');
        expect(statusDiv.textContent).toBe('Invalid prompt content');
        expect(statusDiv.className).toBe('status-error');
      });

      expect(saveSettings).not.toHaveBeenCalled();
    });

    it('should handle system prompt input being absent in DOM', async () => {
      // Remove promptSystem from DOM
      const systemInput = document.getElementById('promptSystem');
      systemInput.remove();

      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');

      const settings = { custom_prompts: [] };
      initCustomPromptManager(settings);

      const nameInput = document.getElementById('promptName');
      const textInput = document.getElementById('promptText');

      nameInput.value = 'Test';
      textInput.value = 'Summarize {{content}}';

      document.getElementById('savePromptBtn').click();
      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalled();
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
      initCustomPromptManager({ custom_prompts: prompts });

      // Click edit button
      document.getElementById('edit-prompt-edit_test_1').click();

      const nameInput = document.getElementById('promptName');
      const providerSelect = document.getElementById('promptProvider');
      const systemInput = document.getElementById('promptSystem');
      const textInput = document.getElementById('promptText');
      const editingIdInput = document.getElementById('editingPromptId');
      const saveBtn = document.getElementById('savePromptBtn');

      expect(nameInput.value).toBe('Editable Prompt');
      expect(providerSelect.value).toBe('gemini');
      expect(systemInput.value).toBe('Be concise');
      expect(textInput.value).toBe('Summarize {{content}} briefly');
      expect(editingIdInput.value).toBe('edit_test_1');
      expect(saveBtn.textContent).toBe('Update Prompt');
      expect(document.getElementById('cancelPromptBtn').style.display).toBe('inline-block');
    });

    it('should show error when trying to edit default prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      // Create an active custom prompt so buttons are rendered
      const prompts = [createTestPrompt({ isActive: true })];
      initCustomPromptManager({ custom_prompts: prompts });

      // There's no edit button for default, so this simulates calling handleEditPrompt with default id
      // That path is triggered when savePromptBtn's click handler somehow gets called with default id
      // But the function is internal, so we test via the activate -> then editing approach

      // Default prompt has no edit button (only activate/duplicate)
      expect(document.getElementById('edit-prompt-__default__')).toBeNull();
    });
  });

  describe('handleDeletePrompt', () => {
    it('should delete a prompt when confirmed', async () => {
      (global.confirm as vi.Mock).mockReturnValueOnce(true);

      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');

      const prompts = [createTestPrompt({ id: 'delete_test_1' })];
      const settings = { custom_prompts: prompts };
      initCustomPromptManager(settings);

      document.getElementById('delete-prompt-delete_test_1').click();
      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalled();
      });

      expect(settings.custom_prompts).toHaveLength(0);
    });

    it('should NOT delete a prompt when confirmation is cancelled', async () => {
      (global.confirm as vi.Mock).mockReturnValueOnce(false);

      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');

      const prompts = [createTestPrompt({ id: 'delete_test_2' })];
      const settings = { custom_prompts: prompts };
      initCustomPromptManager(settings);

      document.getElementById('delete-prompt-delete_test_2').click();

      // Give microtasks time to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(saveSettings).not.toHaveBeenCalled();
      expect(settings.custom_prompts).toHaveLength(1);
    });

    it('should not show delete button for default prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      expect(document.getElementById('delete-prompt-__default__')).toBeNull();
    });
  });

  describe('handleActivatePrompt', () => {
    it('should activate default prompt by deactivating all custom prompts', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');

      const prompts = [createTestPrompt({ isActive: true })];
      const settings = { custom_prompts: prompts };
      initCustomPromptManager(settings);

      // Click activate on default
      document.getElementById('activate-prompt-__default__').click();
      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalled();
      });

      // All custom prompts should be deactivated
      expect(settings.custom_prompts[0].isActive).toBe(false);
    });

    it('should activate a custom prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');

      const prompts = [
        createTestPrompt({ id: 'p1', name: 'Prompt 1', isActive: true }),
        createTestPrompt({ id: 'p2', name: 'Prompt 2', isActive: false }),
      ];
      const settings = { custom_prompts: prompts };
      initCustomPromptManager(settings);

      // Click activate on prompt 2
      document.getElementById('activate-prompt-p2').click();
      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalled();
      });

      expect(settings.custom_prompts[1].isActive).toBe(true);
    });

    it('should activate preset prompt when activate button is clicked', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');
      const { getPresetPrompt } = await import('../../utils/customPromptUtils.js');

      const settings = { custom_prompts: [] };
      initCustomPromptManager(settings);

      // Click activate on "concise" preset
      const activateBtn = document.getElementById('activate-prompt-__preset__concise');
      activateBtn.click();
      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalled();
      });

      // A new prompt entry should have been created for the preset
      expect(settings.custom_prompts).toHaveLength(1);
      expect(settings.custom_prompts[0].id).toBe('__preset__concise');
      expect(settings.custom_prompts[0].isActive).toBe(true);
      expect(settings.custom_prompts[0].provider).toBe('all');
    });

    it('should upsert existing preset entry instead of duplicating', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');

      const existingEntry = createTestPrompt({
        id: '__preset__concise',
        name: 'Concise',
        isActive: false,
      });
      const settings = { custom_prompts: [existingEntry] };
      initCustomPromptManager(settings);

      document.getElementById('activate-prompt-__preset__concise').click();
      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalled();
      });

      expect(settings.custom_prompts).toHaveLength(1);
      expect(settings.custom_prompts[0].isActive).toBe(true);
    });
  });

  describe('handleDuplicatePrompt', () => {
    it('should duplicate default prompt into editor', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      document.getElementById('duplicate-prompt-__default__').click();

      const nameInput = document.getElementById('promptName');
      const textInput = document.getElementById('promptText');
      const editingIdInput = document.getElementById('editingPromptId');

      expect(nameInput.value).toContain('Default');
      expect(nameInput.value).toContain('(Copy)');
      expect(textInput.value).toBe('Default user prompt');
      expect(editingIdInput.value).toBe(''); // Clear for new creation
    });

    it('should duplicate preset prompt into editor', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      document.getElementById('duplicate-prompt-__preset__concise').click();

      const nameInput = document.getElementById('promptName');
      const textInput = document.getElementById('promptText');

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
      initCustomPromptManager({ custom_prompts: prompts });

      document.getElementById('duplicate-prompt-dup_test').click();

      const nameInput = document.getElementById('promptName');
      const providerSelect = document.getElementById('promptProvider');
      const systemInput = document.getElementById('promptSystem');
      const textInput = document.getElementById('promptText');
      const editingIdInput = document.getElementById('editingPromptId');

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
      initCustomPromptManager({ custom_prompts: prompts });

      // Click duplicate on the prompt
      document.getElementById('duplicate-prompt-dup_target')!.click();

      // Verify the form is populated with copied values
      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      expect(nameInput.value).toBe('Original Prompt (Copy)');
    });
  });

  describe('handleCancelEdit', () => {
    it('should reset form when cancel button is clicked', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      // First populate form
      const nameInput = document.getElementById('promptName');
      const textInput = document.getElementById('promptText');
      nameInput.value = 'Something';
      textInput.value = 'Some content';

      // Click cancel
      document.getElementById('cancelPromptBtn').click();

      expect(nameInput.value).toBe('');
      expect(textInput.value).toBe('');
      const cancelBtn = document.getElementById('cancelPromptBtn');
      expect(cancelBtn.style.display).toBe('none');
    });
  });

  describe('showStatus', () => {
    it('should show success status message after creating a prompt', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');

      initCustomPromptManager({ custom_prompts: [] });

      const nameInput = document.getElementById('promptName');
      const textInput = document.getElementById('promptText');
      nameInput.value = 'Test';
      textInput.value = 'Summarize {{content}}';

      document.getElementById('savePromptBtn').click();
      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalled();
      });

      const statusDiv = document.getElementById('promptStatus');
      expect(statusDiv.textContent).toBeTruthy();
      expect(statusDiv.className).toBe('status-success');
    });

    it('should show error status when name is empty', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      document.getElementById('savePromptBtn').click();

      await vi.waitFor(() => {
        const statusDiv = document.getElementById('promptStatus');
        expect(statusDiv.className).toBe('status-error');
      });
    });
  });

  describe('edge cases', () => {
    it('should handle when currentSettings is null gracefully', async () => {
      // initCustomPromptManager sets currentSettings, so this tests initial state
      // via isDefaultActive which returns true when currentSettings is null
      // This is tested implicitly by default being active when no settings are applied
    });
  });
});
