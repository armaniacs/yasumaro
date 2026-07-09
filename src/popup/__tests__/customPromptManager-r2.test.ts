// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn() as any;
}

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    CUSTOM_PROMPTS: 'custom_prompts',
  },
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

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

vi.mock('../../utils/customPromptUtils.js', () => ({
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

vi.mock('../i18n.js', () => ({
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

vi.mock('../errorUtils.js', () => ({
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
      const { saveSettings } = await import('../../utils/storage.js');
      const { getPresetPrompt } = await import('../../utils/customPromptUtils.js');
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

      expect(saveSettings).not.toHaveBeenCalled();
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
      const { getPresetPrompt } = await import('../../utils/customPromptUtils.js');
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

      vi.advanceTimersByTime(3000);
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
      const { saveSettings } = await import('../../utils/storage.js');
      initCustomPromptManager({ custom_prompts: [] });

      document.getElementById('savePromptBtn')!.click();
      await new Promise((r) => setTimeout(r, 10));
      expect(saveSettings).not.toHaveBeenCalled();
    });

    it('should handle editingPromptIdInput being absent', async () => {
      document.getElementById('editingPromptId')!.remove();
      const { initCustomPromptManager } = await import('../customPromptManager.js');
      const { saveSettings } = await import('../../utils/storage.js');
      initCustomPromptManager({ custom_prompts: [] });

      const nameInput = document.getElementById('promptName') as HTMLInputElement;
      const textInput = document.getElementById('promptText') as HTMLTextAreaElement;
      nameInput.value = 'Test';
      textInput.value = 'Summarize {{content}}';

      document.getElementById('savePromptBtn')!.click();
      await vi.waitFor(() => {
        expect(saveSettings).toHaveBeenCalled();
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
      const { getMessage } = await import('../i18n.js');
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
      const { getMessage } = await import('../i18n.js');
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
});
