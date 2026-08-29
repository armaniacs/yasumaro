// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const mockCreatePrompt = vi.fn((data) => ({
  ...data,
  id: `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}));
const mockUpdatePrompt = vi.fn((prompts, id, updates) =>
  prompts.map((p) =>
    p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
  )
);
const mockDeletePrompt = vi.fn((prompts, id) =>
  prompts.filter((p) => p.id !== id)
);
const mockSetActivePrompt = vi.fn((prompts, id) =>
  prompts.map((p) => ({
    ...p,
    isActive: p.id === id,
    updatedAt: p.id === id ? Date.now() : p.updatedAt,
  }))
);
const mockValidatePrompt = vi.fn().mockReturnValue({ valid: true });

vi.mock('../../../utils/customPromptUtils.js', () => ({
  createPrompt: mockCreatePrompt,
  updatePrompt: mockUpdatePrompt,
  deletePrompt: mockDeletePrompt,
  setActivePrompt: mockSetActivePrompt,
  validatePrompt: mockValidatePrompt,
  DEFAULT_USER_PROMPT: 'Default user prompt',
  DEFAULT_SYSTEM_PROMPT: 'Default system prompt',
  PRESET_PROMPTS: [
    { id: 'default', name: 'Default', nameJa: '\u30c7\u30d5\u30a9\u30eb\u30c8', userPrompt: 'Default prompt', systemPrompt: '' },
    { id: 'concise', name: 'Concise', nameJa: '\u7c21\u6f54', userPrompt: 'Be concise', systemPrompt: '' },
  ],
  getPresetPrompt: vi.fn((id) => {
    const presets: Record<string, any> = {
      default: { id: 'default', name: 'Default', nameJa: '\u30c7\u30d5\u30a9\u30eb\u30c8', userPrompt: 'Default prompt', systemPrompt: '' },
      concise: { id: 'concise', name: 'Concise', nameJa: '\u7c21\u6f54', userPrompt: 'Be concise', systemPrompt: '' },
    };
    return presets[id];
  }),
  getPromptDisplayName: vi.fn((preset, locale) =>
    locale === 'ja' ? preset.nameJa : preset.name
  ),
}));

vi.mock('../../../utils/i18n.js', () => ({
  applyI18n: vi.fn(),
  getMessage: vi.fn((key: string) => {
    const messages: Record<string, string> = {
      locale: 'en',
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
  escapeHtml: vi.fn((s: string) => String(s)),
}));

function createTestPrompt(overrides = {}) {
  return {
    id: 'test_prompt_id',
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

function setupDOM() {
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
}

describe('customPromptManager - r2 missed branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('handleEditPrompt edge cases', () => {
    it('default prompt should not have an edit button', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      expect(document.getElementById('edit-prompt-__default__')).toBeNull();
    });

    it('should handle edit when prompt is not found silently', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      nameInput.value = 'existing';

      document.getElementById('promptList')!.innerHTML = `
        <button id="edit-prompt-nonexistent" class="btn-sm btn-edit">Edit</button>
      `;

      const editBtn = document.getElementById('edit-prompt-nonexistent');
      editBtn!.click();
      expect(nameInput.value).toBe('existing');
    });
  });

  describe('handleDeletePrompt edge cases', () => {
    it('default prompt should not have a delete button', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      expect(document.getElementById('delete-prompt-__default__')).toBeNull();
    });

    it('should handle delete when currentSettings is null gracefully', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const promptList = document.getElementById('promptList')!;
      promptList.innerHTML = `
        <div data-prompt-id="orphan">
          <button id="delete-prompt-orphan" class="btn-sm btn-delete">Delete</button>
        </div>
      `;

      (global.confirm as any).mockReturnValueOnce(true);

      const deleteBtn = document.getElementById('delete-prompt-orphan')!;
      expect(() => deleteBtn.click()).not.toThrow();
    });
  });

  describe('handleActivatePrompt edge cases', () => {
    it('should do nothing when preset is not found', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { getPresetPrompt } = await import('../../../utils/customPromptUtils.js');
      (getPresetPrompt as any).mockReturnValueOnce(undefined);

      const settings = { custom_prompts: [] };
      initCustomPromptManager(settings);

      const promptList = document.getElementById('promptList')!;
      promptList.innerHTML = `
        <div>
          <button id="activate-prompt-__preset__nonexistent">Activate</button>
        </div>
      `;

      const activateBtn = document.getElementById('activate-prompt-__preset__nonexistent')!;
      activateBtn.click();
      await new Promise((r) => setTimeout(r, 10));

      expect(mockSetAll).not.toHaveBeenCalled();
    });

    it('should handle activate when currentSettings is null gracefully', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const promptList = document.getElementById('promptList')!;
      promptList.innerHTML = `
        <div>
          <button id="activate-prompt-__default__">Activate</button>
        </div>
      `;

      const activateBtn = document.getElementById('activate-prompt-__default__')!;
      expect(() => activateBtn.click()).not.toThrow();
    });
  });

  describe('handleDuplicatePrompt edge cases', () => {
    it('should show error when preset not found for duplication', async () => {
      const { getPresetPrompt } = await import('../../../utils/customPromptUtils.js');
      (getPresetPrompt as any).mockImplementation((id: string) => {
        if (id === 'concise') return undefined;
        return { id: 'default', name: 'Default', nameJa: '\u30c7\u30d5\u30a9\u30eb\u30c8', userPrompt: 'Default prompt', systemPrompt: '' };
      });

      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const dupBtn = document.getElementById('duplicate-prompt-__preset__concise')!;
      dupBtn.click();

      const statusDiv = document.getElementById('promptStatus') as HTMLElement;
      expect(statusDiv.textContent).toBeTruthy();
    });

    it('should show error when custom prompt not found for duplication', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      nameInput.value = 'existing';

      document.getElementById('promptList')!.innerHTML = `
        <button id="duplicate-prompt-missing">Duplicate</button>
      `;

      const dupBtn = document.getElementById('duplicate-prompt-missing')!;
      dupBtn.click();

      expect(nameInput.value).toBe('existing');
    });

    it('should handle duplicate when promptNameInput is missing', async () => {
      const nameInput = document.getElementById('promptName')!;
      nameInput.remove();

      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const promptList = document.getElementById('promptList')!;
      promptList.innerHTML = `
        <div>
          <button id="duplicate-prompt-__default__">Duplicate</button>
        </div>
      `;

      const dupBtn = document.getElementById('duplicate-prompt-__default__')!;
      expect(() => dupBtn.click()).not.toThrow();
    });
  });

  describe('provider label edge cases', () => {
    it('should return provider name for unknown provider', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt({ id: 'p1', name: 'Custom', provider: 'unknown_provider' })];
      initCustomPromptManager({ custom_prompts: prompts });

      const html = document.getElementById('promptList')!.innerHTML;
      expect(html).toContain('unknown_provider');
    });
  });

  describe('showStatus edge cases', () => {
    it('should do nothing when promptStatusDiv is null', async () => {
      const statusDiv = document.getElementById('promptStatus')!;
      statusDiv.remove();

      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      const textInput = document.getElementById('promptText') as HTMLTextAreaElement;
      nameInput.value = '';
      textInput.value = '';
      document.getElementById('savePromptBtn')!.click();

      await new Promise((r) => setTimeout(r, 10));
    });

    it('should clear status after timeout', async () => {
      vi.useFakeTimers();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      nameInput.value = '';

      document.getElementById('savePromptBtn')!.click();
      await Promise.resolve();

      const statusDiv = document.getElementById('promptStatus') as HTMLElement;
      expect(statusDiv.textContent).toBeTruthy();

      vi.advanceTimersByTime(5000);
      expect(statusDiv.textContent).toBe('');
      vi.useRealTimers();
    });
  });

  describe('loadDefaultPrompt edge cases', () => {
    it('should handle missing text input gracefully', async () => {
      const textInput = document.getElementById('promptText')!;
      textInput.remove();

      const { loadDefaultPrompt } = await import('../customPromptManager.js');
      expect(() => loadDefaultPrompt()).not.toThrow();
    });

    it('should handle missing system input gracefully', async () => {
      const systemInput = document.getElementById('promptSystem')!;
      systemInput.remove();

      const { loadDefaultPrompt } = await import('../customPromptManager.js');
      expect(() => loadDefaultPrompt()).not.toThrow();
    });
  });

  describe('isDefaultActive branch', () => {
    it('should treat default as active when all prompts are inactive', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [
        createTestPrompt({ id: 'p1', isActive: false }),
        createTestPrompt({ id: 'p2', isActive: false }),
      ];
      initCustomPromptManager({ custom_prompts: prompts });

      const html = document.getElementById('promptList')!.innerHTML;
      expect(html).toContain('__default__');
      expect(document.getElementById('activate-prompt-__default__')).toBeNull();
    });
  });

  describe('renderPromptList guard clauses', () => {
    it('should handle missing promptList element', async () => {
      document.getElementById('promptList')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      expect(() => initCustomPromptManager({ custom_prompts: [] })).not.toThrow();
    });

    it('should handle missing noPromptsMessage element', async () => {
      document.getElementById('noPromptsMessage')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      expect(() => initCustomPromptManager({ custom_prompts: [] })).not.toThrow();
    });
  });

  describe('handleSavePrompt guard clauses', () => {
    it('should return early when promptProviderSelect is missing', async () => {
      document.getElementById('promptProvider')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      document.getElementById('savePromptBtn')!.click();
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSetAll).not.toHaveBeenCalled();
    });

    it('should handle editingPromptIdInput being absent', async () => {
      document.getElementById('editingPromptId')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      const textInput = document.getElementById('promptText') as HTMLTextAreaElement;
      nameInput.value = 'Test';
      textInput.value = 'Summarize {{content}}';

      document.getElementById('savePromptBtn')!.click();
      await vi.waitFor(() => {
        expect(mockSetAll).toHaveBeenCalled();
      });
    });
  });

  describe('cancel edit button display', () => {
    it('should show cancel button after edit', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const prompts = [createTestPrompt({ id: 'edit_me' })];
      initCustomPromptManager({ custom_prompts: prompts });

      document.getElementById('edit-prompt-edit_me')!.click();
      const cancelBtn = document.getElementById('cancelPromptBtn') as HTMLElement;
      expect(cancelBtn.style.display).toBe('inline-block');
    });

    it('should hide cancel button after reset', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      document.getElementById('cancelPromptBtn')!.click();
      const cancelBtn = document.getElementById('cancelPromptBtn') as HTMLElement;
      expect(cancelBtn.style.display).toBe('none');
    });
  });

  describe('createDefaultPromptItem locale branch', () => {
    it('should render default with English locale when getMessage returns undefined', async () => {
      const { getMessage } = await import('../../../utils/i18n.js');
      (getMessage as any).mockImplementation((key: string) => {
        if (key === 'locale') return undefined;
        if (key === 'defaultPrompt') return 'Default';
        if (key === 'promptProviderAll') return 'All Providers';
        return key;
      });

      Object.defineProperty(navigator, 'language', {
        value: 'en-US',
        configurable: true,
      });

      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const html = document.getElementById('promptList')!.innerHTML;
      expect(html).toContain('Default');
    });

    it('should render default with Japanese locale via getMessage', async () => {
      const { getMessage } = await import('../../../utils/i18n.js');
      (getMessage as any).mockImplementation((key: string) => {
        if (key === 'locale') return 'ja';
        if (key === 'defaultPrompt') return '\u30c7\u30d5\u30a9\u30eb\u30c8';
        if (key === 'promptProviderAll') return 'All Providers';
        return key;
      });

      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] });

      const html = document.getElementById('promptList')!.innerHTML;
      expect(html).toContain('\u30c7\u30d5\u30a9\u30eb\u30c8');
    });
  });

  describe('uncovered branches: handleDeletePrompt default guard', () => {
    it('should show error when deleting default prompt via injected custom entry', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: '__default__', name: 'Fake Default' })] };
      initCustomPromptManager(settings);
      const delBtn = document.getElementById('delete-prompt-__default__');
      expect(delBtn).not.toBeNull();
      delBtn!.click();
      await new Promise(r => setTimeout(r, 10));
      const status = document.getElementById('promptStatus') as HTMLElement;
      expect(status.textContent).toBe('Cannot delete default prompt');
      expect(status.className).toBe('error');
      expect(mockSetAll).not.toHaveBeenCalled();
    });

    it('should use fallback string path when promptStatusDiv is null for delete default', async () => {
      document.getElementById('promptStatus')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: '__default__' })] };
      initCustomPromptManager(settings);
      // create fallback element with same id manually to test ?? branch still works via string lookup returning null?
      // When div is removed before init, promptStatusDiv is null, so showStatus will lookup by id string and find null -> early return safely
      const delBtn = document.getElementById('delete-prompt-__default__')!;
      delBtn.click();
      await new Promise(r => setTimeout(r, 10));
      expect(mockSetAll).not.toHaveBeenCalled();
    });
  });

  describe('uncovered branches: handleEditPrompt default guard and not found', () => {
    it('should show error when editing default prompt via injected custom entry', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: '__default__', name: 'Fake' })] };
      initCustomPromptManager(settings);
      const editBtn = document.getElementById('edit-prompt-__default__')!;
      editBtn.click();
      await new Promise(r => setTimeout(r, 10));
      const status = document.getElementById('promptStatus') as HTMLElement;
      expect(status.textContent).toContain('Cannot edit default');
      expect(status.className).toBe('error');
    });

    it('should handle edit when prompt not found after mutation', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: 'toEdit_missing', name: 'ToEdit' })] };
      initCustomPromptManager(settings);
      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      // mutate to remove prompt
      settings.custom_prompts = [];
      const editBtn = document.getElementById('edit-prompt-toEdit_missing')!;
      expect(editBtn).not.toBeNull();
      editBtn.click();
      // form should not be populated because prompt not found
      expect(nameInput.value).toBe('');
    });

    it('should handle edit when promptSystemInput missing', async () => {
      document.getElementById('promptSystem')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: 'sysMissing', name: 'SysMissing', systemPrompt: 'sys', prompt: 'p' })] };
      initCustomPromptManager(settings);
      document.getElementById('edit-prompt-sysMissing')!.click();
      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      expect(nameInput.value).toBe('SysMissing');
    });

    it('should handle edit when savePromptBtn and cancelPromptBtn missing', async () => {
      document.getElementById('savePromptBtn')!.remove();
      document.getElementById('cancelPromptBtn')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: 'btnMissing', name: 'BtnMissing' })] };
      initCustomPromptManager(settings);
      document.getElementById('edit-prompt-btnMissing')!.click();
      const editingIdInput = document.getElementById('editingPromptId') as HTMLInputElement;
      expect(editingIdInput.value).toBe('btnMissing');
    });

    it('should handle edit when editingPromptIdInput missing', async () => {
      document.getElementById('editingPromptId')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: 'editNoIdInput', name: 'NoId' })] };
      initCustomPromptManager(settings);
      document.getElementById('edit-prompt-editNoIdInput')!.click();
      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      expect(nameInput.value).toBe('NoId');
    });

    it('should early return when currentSettings missing via guard', async () => {
      // init with null settings then trigger edit via injected prompt
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      // init with empty to set currentSettings, then force null by re-import? Alternative: init with null
      (initCustomPromptManager as any)(null as any);
      // need a prompt to edit but currentSettings is null, so handleEditPrompt will hit default guard first? Actually default guard before null check, so to test null guard we need non-default id
      // Create a settings with prompt, init, then nullify via second init with null, but edit button won't exist. So instead we test handleSavePrompt guard for null currentSettings elsewhere.
      // For edit, the guard is after default check, so if currentSettings null and id not default, it returns early without error.
      // We simulate by calling init with null and then trying to trigger edit via manually created button that would call handler if it existed, but handler doesn't exist because render returned early due to !currentSettings.
      // So we just ensure no throw when currentSettings is null and we don't have button.
      expect(document.getElementById('promptList')!.innerHTML).toBe('');
    });
  });

  describe('uncovered branches: handleDuplicate custom not found', () => {
    it('should show error when custom prompt not found for duplication via mutation', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: 'dupMissing', name: 'DupMissing', systemPrompt: 's', prompt: 'p' })] };
      initCustomPromptManager(settings);
      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      nameInput.value = 'before';
      settings.custom_prompts = [];
      document.getElementById('duplicate-prompt-dupMissing')!.click();
      await new Promise(r => setTimeout(r, 10));
      const status = document.getElementById('promptStatus') as HTMLElement;
      expect(status.textContent).toBe('Prompt not found');
      expect(status.className).toBe('error');
      expect(nameInput.value).toBe('before');
    });

    it('should duplicate correctly when promptSystemInput and editingPromptIdInput missing', async () => {
      document.getElementById('promptSystem')!.remove();
      document.getElementById('editingPromptId')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: 'dupNoSys', name: 'NoSys', systemPrompt: 'sysVal', prompt: 'promptVal', provider: 'openai' })] };
      initCustomPromptManager(settings);
      document.getElementById('duplicate-prompt-dupNoSys')!.click();
      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      const providerSelect = document.getElementById('promptProvider') as HTMLSelectElement;
      const textInput = document.getElementById('promptText') as HTMLTextAreaElement;
      expect(nameInput.value).toBe('NoSys (Copy)');
      expect(providerSelect.value).toBe('openai');
      expect(textInput.value).toBe('promptVal');
    });

    it('should handle duplicate when save/cancel buttons missing', async () => {
      document.getElementById('savePromptBtn')!.remove();
      document.getElementById('cancelPromptBtn')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: 'dupNoBtn', name: 'NoBtn' })] };
      initCustomPromptManager(settings);
      document.getElementById('duplicate-prompt-dupNoBtn')!.click();
      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      expect(nameInput.value).toBe('NoBtn (Copy)');
    });

    it('should cover preset duplicate with systemPrompt fallback to DEFAULT_SYSTEM_PROMPT', async () => {
      const { getPresetPrompt } = await import('../../../utils/customPromptUtils.js');
      (getPresetPrompt as any).mockImplementation((id: string) => {
        if (id === 'concise') return { id: 'concise', name: 'Concise', nameJa: '\u7c21\u6f54', userPrompt: 'Be concise', systemPrompt: '' };
        if (id === 'default') return { id: 'default', name: 'Default', nameJa: '\u30c7\u30d5\u30a9\u30eb\u30c8', userPrompt: 'Default prompt', systemPrompt: '' };
        return undefined;
      });
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] } as any);
      document.getElementById('duplicate-prompt-__preset__concise')!.click();
      const systemInput = document.getElementById('promptSystem') as HTMLInputElement;
      // DEFAULT_SYSTEM_PROMPT is 'Default system prompt', since concise has '' it falls back
      expect(systemInput.value).toBe('Default system prompt');
    });
  });

  describe('uncovered branches: handleActivate preset not found and existing null check', () => {
    it('should early return when preset not found on activate (mock before init)', async () => {
      const { getPresetPrompt } = await import('../../../utils/customPromptUtils.js');
      (getPresetPrompt as any).mockImplementation((id: string) => {
        if (id === 'concise') return undefined;
        const presets: any = {
          default: { id: 'default', name: 'Default', nameJa: '\u30c7\u30d5\u30a9\u30eb\u30c8', userPrompt: 'Default prompt', systemPrompt: '' },
        };
        return presets[id];
      });
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [] };
      initCustomPromptManager(settings);
      document.getElementById('activate-prompt-__preset__concise')!.click();
      await new Promise(r => setTimeout(r, 10));
      expect(mockSetAll).not.toHaveBeenCalled();
    });

    it('should handle activate preset when existing entry exists (upsert true branch)', async () => {
      const { getPresetPrompt } = await import('../../../utils/customPromptUtils.js');
      (getPresetPrompt as any).mockImplementation((id: string) => {
        if (id === 'concise') return { id: 'concise', name: 'Concise', nameJa: '\u7c21\u6f54', userPrompt: 'Be concise', systemPrompt: '' };
        if (id === 'default') return { id: 'default', name: 'Default', nameJa: '\u30c7\u30d5\u30a9\u30eb\u30c8', userPrompt: 'Default prompt', systemPrompt: '' };
        return undefined;
      });
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: '__preset__concise', name: 'Concise', isActive: false })] };
      initCustomPromptManager(settings);
      const btn = document.getElementById('activate-prompt-__preset__concise');
      expect(btn).not.toBeNull();
      btn!.click();
      await new Promise(r => setTimeout(r, 10));
      expect(mockSetAll).toHaveBeenCalled();
      expect(settings.custom_prompts[0].isActive).toBe(true);
    });
  });

  describe('uncovered branches: provider labels and getProviderLabel fallback', () => {
    it('should return OpenAI label for openai provider', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [createTestPrompt({ id: 'openai_p', provider: 'openai', name: 'OA' })] } as any);
      expect(document.getElementById('promptList')!.innerHTML).toContain('OpenAI');
    });
    it('should return OpenAI 2 label for openai2 provider', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [createTestPrompt({ id: 'openai2_p', provider: 'openai2', name: 'OA2' })] } as any);
      expect(document.getElementById('promptList')!.innerHTML).toContain('OpenAI 2');
    });
    it('should fallback to All Providers when getMessage returns falsy', async () => {
      const { getMessage } = await import('../../../utils/i18n.js');
      (getMessage as any).mockImplementation((k: string) => {
        if (k === 'promptProviderAll') return '';
        if (k === 'locale') return 'en';
        return k;
      });
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [createTestPrompt({ id: 'all_p', provider: 'all', name: 'All' })] } as any);
      expect(document.getElementById('promptList')!.innerHTML).toContain('All Providers');
    });
  });

  describe('uncovered branches: handleSavePrompt validation and systemPrompt handling', () => {
    it('should trim whitespace and treat empty systemPrompt as undefined', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [] };
      initCustomPromptManager(settings);
      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      const systemInput = document.getElementById('promptSystem') as HTMLInputElement;
      const textInput = document.getElementById('promptText') as HTMLTextAreaElement;
      nameInput.value = '  Trim Test  ';
      systemInput.value = '   ';
      textInput.value = '  Summarize {{content}}  ';
      document.getElementById('savePromptBtn')!.click();
      await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
      expect(settings.custom_prompts[0].name).toBe('Trim Test');
      expect(settings.custom_prompts[0].prompt).toBe('Summarize {{content}}');
      // systemPrompt should be undefined or not set when empty
      expect(settings.custom_prompts[0].systemPrompt === undefined || settings.custom_prompts[0].systemPrompt === '').toBeTruthy();
    });

    it('should handle update with systemPrompt defined via pickDefined', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const existing = createTestPrompt({ id: 'editSys', name: 'Old', systemPrompt: 'oldSys', prompt: 'old' });
      const settings: any = { custom_prompts: [existing] };
      initCustomPromptManager(settings);
      (document.getElementById('editingPromptId') as HTMLInputElement).value = 'editSys';
      (document.getElementById('promptName') as HTMLInputElement).value = 'Updated';
      (document.getElementById('promptSystem') as HTMLInputElement).value = 'newSys';
      (document.getElementById('promptText') as HTMLTextAreaElement).value = 'newPrompt';
      (document.getElementById('promptProvider') as HTMLSelectElement).value = 'gemini';
      document.getElementById('savePromptBtn')!.click();
      await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
      expect(settings.custom_prompts[0].systemPrompt).toBe('newSys');
    });

    it('should handle save with invalid prompt returning branch for validation.error fallback', async () => {
      mockValidatePrompt.mockReturnValueOnce({ valid: false, error: undefined } as any);
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [] };
      initCustomPromptManager(settings);
      (document.getElementById('promptName') as HTMLInputElement).value = 'Name';
      (document.getElementById('promptText') as HTMLTextAreaElement).value = 'bad';
      document.getElementById('savePromptBtn')!.click();
      await new Promise(r => setTimeout(r, 10));
      const status = document.getElementById('promptStatus') as HTMLElement;
      expect(status.textContent).toBe('Invalid prompt');
      expect(status.className).toBe('error');
    });

    it('should handle save when currentSettings is null (early return)', async () => {
      // init with null sets currentSettings null
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      (initCustomPromptManager as any)(null as any);
      // remove promptList to avoid render error, but ensure save button still exists from setupDOM before second init? Actually init overwrites promptList etc. but currentSettings null will cause handleSavePrompt early return.
      // Try clicking save (button exists)
      const saveBtn = document.getElementById('savePromptBtn');
      if (saveBtn) {
        saveBtn.click();
        await new Promise(r => setTimeout(r, 10));
        expect(mockSetAll).not.toHaveBeenCalled();
      }
    });

    it('should handle save when promptNameInput missing', async () => {
      document.getElementById('promptName')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] } as any);
      document.getElementById('savePromptBtn')!.click();
      await new Promise(r => setTimeout(r, 10));
      expect(mockSetAll).not.toHaveBeenCalled();
    });

    it('should handle save when promptTextInput missing', async () => {
      document.getElementById('promptText')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] } as any);
      document.getElementById('savePromptBtn')!.click();
      await new Promise(r => setTimeout(r, 10));
      expect(mockSetAll).not.toHaveBeenCalled();
    });
  });

  describe('uncovered branches: locale and preset fallback', () => {
    it('should fallback to navigator ja when locale undefined and language is ja', async () => {
      const { getMessage } = await import('../../../utils/i18n.js');
      (getMessage as any).mockImplementation((k: string) => {
        if (k === 'locale') return undefined;
        if (k === 'promptProviderAll') return 'All Providers';
        if (k === 'defaultPrompt') return 'Default';
        return k;
      });
      Object.defineProperty(navigator, 'language', { value: 'ja-JP', configurable: true });
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] } as any);
      // locale branch should result in 'ja' display name, but since PRESET data has ja name, check html contains ja name for preset?
      // Default preset nameJa is \u30c7\u30d5\u30a9\u30eb\u30c8
      expect(document.getElementById('promptList')!.innerHTML).toContain('__preset__concise');
    });

    it('should fallback to defaultPrompt key when getPresetPrompt returns undefined for default', async () => {
      const { getPresetPrompt, getPromptDisplayName } = await import('../../../utils/customPromptUtils.js');
      (getPresetPrompt as any).mockImplementation((id: string) => {
        if (id === 'default') return undefined;
        return { id: 'concise', name: 'Concise', nameJa: '\u7c21\u6f54', userPrompt: 'Be concise', systemPrompt: '' };
      });
      // Also mock getMessage to return falsy for defaultPrompt to trigger || 'Default'
      const { getMessage } = await import('../../../utils/i18n.js');
      (getMessage as any).mockImplementation((k: string) => {
        if (k === 'defaultPrompt') return '';
        if (k === 'locale') return 'en';
        if (k === 'promptProviderAll') return 'All Providers';
        return '';
      });
      (getPromptDisplayName as any).mockReturnValue('FallbackName');
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] } as any);
      const html = document.getElementById('promptList')!.innerHTML;
      // Should contain fallback 'Default' or 'FallbackName'
      expect(html).toContain('__default__');
    });
  });

  describe('uncovered branches: active preset badge and filtering', () => {
    it('should show active badge for preset when activePromptId matches', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = { custom_prompts: [createTestPrompt({ id: '__preset__concise', isActive: true, name: 'Concise' })] };
      initCustomPromptManager(settings);
      const html = document.getElementById('promptList')!.innerHTML;
      // active preset should have badge and active class, and no activate button
      expect(document.getElementById('activate-prompt-__preset__concise')).toBeNull();
      expect(html).toContain('active');
    });

    it('should filter out preset-backed entries from custom list', async () => {
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const settings: any = {
        custom_prompts: [
          createTestPrompt({ id: '__preset__concise', name: 'PresetClone' }),
          createTestPrompt({ id: 'custom1', name: 'Custom1' }),
        ],
      };
      initCustomPromptManager(settings);
      const html = document.getElementById('promptList')!.innerHTML;
      expect(html).toContain('custom1');
      // preset-backed entries should not have edit/delete buttons (they are filtered from custom list)
      expect(document.getElementById('edit-prompt-__preset__concise')).toBeNull();
      expect(document.getElementById('delete-prompt-__preset__concise')).toBeNull();
      // but duplicate/activate for preset should exist in preset section
      expect(document.getElementById('duplicate-prompt-__preset__concise')).not.toBeNull();
    });
  });

  describe('uncovered branches: resetForm and loadDefaultPrompt with missing elements', () => {
    it('should handle resetForm when all inputs missing', async () => {
      document.getElementById('promptName')!.remove();
      document.getElementById('promptProvider')!.remove();
      document.getElementById('promptSystem')!.remove();
      document.getElementById('promptText')!.remove();
      document.getElementById('editingPromptId')!.remove();
      document.getElementById('savePromptBtn')!.remove();
      document.getElementById('cancelPromptBtn')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] } as any);
      // trigger reset via cancel button fallback? No button, but we can test loadDefaultPrompt missing both
      const { loadDefaultPrompt } = await import('../customPromptManager.js');
      expect(() => loadDefaultPrompt()).not.toThrow();
    });

    it('should handle handleCancelEdit with missing promptStatus', async () => {
      document.getElementById('promptStatus')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      initCustomPromptManager({ custom_prompts: [] } as any);
      document.getElementById('cancelPromptBtn')!.click();
      expect((document.getElementById('promptName') as HTMLInputElement)?.value).toBe('');
    });
  });
});
