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
const mockUpdatePrompt = vi.fn((prompts: any, id: string, updates: any) =>
  prompts.map((p: any) => (p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p))
);
const mockDeletePrompt = vi.fn((prompts: any, id: string) => prompts.filter((p: any) => p.id !== id));
const mockSetActivePrompt = vi.fn((prompts: any, id: string) =>
  prompts.map((p: any) => ({
    ...p,
    isActive: p.id === id,
    updatedAt: p.id === id ? Date.now() : p.updatedAt,
  }))
);
const mockValidatePrompt = vi.fn().mockReturnValue({ valid: true });
const mockGetMessage = vi.fn((key: string) => {
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
  return (key in messages ? (messages as any)[key] : key) as string;
});
const mockApplyI18n = vi.fn();
const mockGetPresetPrompt = vi.fn((id: string) => {
  const presets: Record<string, any> = {
    default: { id: 'default', name: 'Default', nameJa: 'デフォルト', userPrompt: 'Default prompt', systemPrompt: '' },
    concise: { id: 'concise', name: 'Concise', nameJa: '簡潔', userPrompt: 'Be concise', systemPrompt: '' },
  };
  return presets[id];
});
const mockGetPromptDisplayName = vi.fn((preset: any, locale: string) => (locale === 'ja' ? preset.nameJa : preset.name));

vi.mock('../../../utils/i18n.js', () => ({
  getMessage: mockGetMessage,
  applyI18n: mockApplyI18n,
}));

vi.mock('../../../utils/customPromptUtils.js', () => ({
  createPrompt: mockCreatePrompt,
  updatePrompt: mockUpdatePrompt,
  deletePrompt: mockDeletePrompt,
  setActivePrompt: mockSetActivePrompt,
  validatePrompt: mockValidatePrompt,
  DEFAULT_USER_PROMPT: 'Default user prompt',
  DEFAULT_SYSTEM_PROMPT: 'Default system prompt',
  PRESET_PROMPTS: [
    { id: 'default', name: 'Default', nameJa: 'デフォルト', userPrompt: 'Default prompt', systemPrompt: '' },
    { id: 'concise', name: 'Concise', nameJa: '簡潔', userPrompt: 'Be concise', systemPrompt: '' },
  ],
  getPresetPrompt: mockGetPresetPrompt,
  getPromptDisplayName: mockGetPromptDisplayName,
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

describe('customPromptManager - r3 remaining branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    mockValidatePrompt.mockReturnValue({ valid: true });
    mockGetMessage.mockImplementation((key: string) => {
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
      return (key in messages ? (messages as any)[key] : key) as string;
    });
    mockGetPresetPrompt.mockImplementation((id: string) => {
      const presets: Record<string, any> = {
        default: { id: 'default', name: 'Default', nameJa: 'デフォルト', userPrompt: 'Default prompt', systemPrompt: '' },
        concise: { id: 'concise', name: 'Concise', nameJa: '簡潔', userPrompt: 'Be concise', systemPrompt: '' },
      };
      return presets[id];
    });
    mockGetPromptDisplayName.mockImplementation((preset: any, locale: string) => (locale === 'ja' ? preset.nameJa : preset.name));
  });

  afterEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  it('covers isDefaultActive when currentSettings is null and prompts fallback || []', async () => {
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({} as any);
    expect(document.getElementById('promptList')!.innerHTML).toContain('__default__');
    expect(document.getElementById('activate-prompt-__default__')).toBeNull();
  });

  it('covers isDefaultActive with undefined custom_prompts via missing key', async () => {
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: undefined } as any);
    expect(document.getElementById('promptList')!.innerHTML).toContain('__default__');
  });

  it('covers locale fallback to ja via navigator.language when getMessage locale falsy', async () => {
    mockGetMessage.mockImplementation((k: string) => {
      if (k === 'locale') return '' as any;
      if (k === 'promptProviderAll') return '';
      if (k === 'defaultPrompt') return '';
      return '' as any;
    });
    Object.defineProperty(navigator, 'language', { value: 'ja-JP', configurable: true });
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] } as any);
    const html = document.getElementById('promptList')!.innerHTML;
    expect(html).toContain('__preset__concise');
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
  });

  it('covers showStatus fallback branches for promptStatusDiv null and getMessage falsy on validation', async () => {
    document.getElementById('promptStatus')!.remove();
    mockGetMessage.mockImplementation(() => '' as any);
    mockValidatePrompt.mockReturnValueOnce({ valid: false, error: undefined } as any);
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] } as any);
    (document.getElementById('promptName') as HTMLInputElement).value = 'Name';
    (document.getElementById('promptText') as HTMLTextAreaElement).value = 'bad';
    document.getElementById('savePromptBtn')!.click();
    await new Promise((r) => setTimeout(r, 20));
    const fallbackDiv = document.createElement('div');
    fallbackDiv.id = 'promptStatus';
    document.body.appendChild(fallbackDiv);
    mockValidatePrompt.mockReturnValueOnce({ valid: false } as any);
    // need fresh click with same null div? promptStatusDiv is still null, fallback lookup will use new div
    document.getElementById('savePromptBtn')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(fallbackDiv.textContent).toBeTruthy();
  });

  it('covers promptNameRequired fallback when getMessage returns falsy and promptStatusDiv null', async () => {
    document.getElementById('promptStatus')!.remove();
    mockGetMessage.mockImplementation((k: string) => {
      if (k === 'promptNameRequired') return '';
      return '' as any;
    });
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] } as any);
    (document.getElementById('promptText') as HTMLTextAreaElement).value = 'something';
    document.getElementById('savePromptBtn')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('covers handleSavePrompt create and update with getMessage falsy for success messages and promptStatusDiv null', async () => {
    document.getElementById('promptStatus')!.remove();
    mockGetMessage.mockImplementation(() => '' as any);
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    const settings: any = { custom_prompts: [] };
    initCustomPromptManager(settings);
    (document.getElementById('promptName') as HTMLInputElement).value = 'My Prompt';
    (document.getElementById('promptText') as HTMLTextAreaElement).value = 'Summarize {{content}}';
    (document.getElementById('promptProvider') as HTMLSelectElement).value = 'all';
    document.getElementById('savePromptBtn')!.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(settings.custom_prompts).toHaveLength(1);
    mockSetAll.mockClear();
    const existingId = settings.custom_prompts[0].id;
    (document.getElementById('editingPromptId') as HTMLInputElement).value = existingId;
    (document.getElementById('promptName') as HTMLInputElement).value = 'Updated Name';
    (document.getElementById('promptText') as HTMLTextAreaElement).value = 'Updated {{content}}';
    document.getElementById('savePromptBtn')!.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(settings.custom_prompts[0].name).toBe('Updated Name');
  });

  it('covers handleEditPrompt default guard with promptStatusDiv null fallback', async () => {
    document.getElementById('promptStatus')!.remove();
    mockGetMessage.mockImplementation(() => '' as any);
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    const settings: any = { custom_prompts: [createTestPrompt({ id: '__default__', name: 'Fake' })] };
    initCustomPromptManager(settings);
    document.getElementById('edit-prompt-__default__')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById('edit-prompt-__default__')).not.toBeNull();
  });

  it('covers handleDeletePrompt confirm fallback when getMessage returns falsy and promptStatusDiv null', async () => {
    document.getElementById('promptStatus')!.remove();
    mockGetMessage.mockImplementation((k: string) => {
      if (k === 'confirmDeletePrompt') return '';
      if (k === 'promptDeleted') return '';
      return '' as any;
    });
    (global.confirm as any) = vi.fn().mockReturnValue(true);
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    const settings: any = { custom_prompts: [createTestPrompt({ id: 'del1' })] };
    initCustomPromptManager(settings);
    document.getElementById('delete-prompt-del1')!.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(settings.custom_prompts).toHaveLength(0);
  });

  it('covers handleDeletePrompt cannot delete default with promptStatusDiv null', async () => {
    document.getElementById('promptStatus')!.remove();
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    const settings: any = { custom_prompts: [createTestPrompt({ id: '__default__' })] };
    initCustomPromptManager(settings);
    document.getElementById('delete-prompt-__default__')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('covers handleActivatePrompt default deactivation with promptStatusDiv null and getMessage falsy', async () => {
    document.getElementById('promptStatus')!.remove();
    mockGetMessage.mockImplementation(() => '' as any);
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    const settings: any = { custom_prompts: [createTestPrompt({ id: 'p1', isActive: true })] };
    initCustomPromptManager(settings);
    document.getElementById('activate-prompt-__default__')!.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(settings.custom_prompts[0].isActive).toBe(false);
  });

  it('covers handleActivatePrompt preset with locale ja branch and systemPrompt fallback', async () => {
    mockGetMessage.mockImplementation((k: string) => {
      if (k === 'locale') return undefined as any;
      if (k === 'promptActivated') return '';
      return k;
    });
    Object.defineProperty(navigator, 'language', { value: 'ja-JP', configurable: true });
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    const settings: any = { custom_prompts: [] };
    initCustomPromptManager(settings);
    document.getElementById('activate-prompt-__preset__concise')!.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(settings.custom_prompts[0].id).toBe('__preset__concise');
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
  });

  it('covers handleActivatePrompt custom prompt with getMessage falsy', async () => {
    document.getElementById('promptStatus')!.remove();
    mockGetMessage.mockImplementation(() => '' as any);
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    const settings: any = {
      custom_prompts: [
        createTestPrompt({ id: 'p1', isActive: true }),
        createTestPrompt({ id: 'p2', isActive: false }),
      ],
    };
    initCustomPromptManager(settings);
    document.getElementById('activate-prompt-p2')!.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(mockSetAll).toHaveBeenCalled();
  });

  it('covers handleDuplicatePrompt preset not found with promptStatusDiv null', async () => {
    document.getElementById('promptStatus')!.remove();
    mockGetPresetPrompt.mockImplementation((id: string) => {
      if (id === 'concise') return undefined;
      return { id: 'default', name: 'Default', nameJa: 'デフォルト', userPrompt: 'Default', systemPrompt: '' };
    });
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] } as any);
    document.getElementById('duplicate-prompt-__preset__concise')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('covers handleDuplicatePrompt custom not found with promptStatusDiv null', async () => {
    document.getElementById('promptStatus')!.remove();
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    const settings: any = { custom_prompts: [createTestPrompt({ id: 'dupMissing', name: 'Dup' })] };
    initCustomPromptManager(settings);
    settings.custom_prompts = [];
    document.getElementById('duplicate-prompt-dupMissing')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('covers handleDuplicatePrompt default with getMessage falsy for defaultPrompt and locale fallback', async () => {
    mockGetPresetPrompt.mockImplementation((id: string) => {
      if (id === 'default') return undefined;
      return { id: 'concise', name: 'Concise', nameJa: '簡潔', userPrompt: 'Be concise', systemPrompt: '' };
    });
    mockGetMessage.mockImplementation((k: string) => {
      if (k === 'defaultPrompt') return '';
      if (k === 'locale') return undefined as any;
      if (k === 'promptDuplicated') return '';
      if (k === 'savePrompt') return '';
      return '' as any;
    });
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] } as any);
    document.getElementById('duplicate-prompt-__default__')!.click();
    const nameInput = document.getElementById('promptName') as HTMLInputElement;
    expect(nameInput.value).toContain('(Copy)');
  });

  it('covers handleDuplicatePrompt preset systemPrompt fallback to DEFAULT_SYSTEM_PROMPT', async () => {
    mockGetPresetPrompt.mockImplementation((id: string) => {
      if (id === 'concise') return { id: 'concise', name: 'Concise', nameJa: '簡潔', userPrompt: 'Be concise', systemPrompt: '' };
      if (id === 'default') return { id: 'default', name: 'Default', nameJa: 'デフォルト', userPrompt: 'Default', systemPrompt: '' };
      return undefined;
    });
    mockGetMessage.mockImplementation((k: string) => {
      if (k === 'locale') return 'en';
      if (k === 'promptDuplicated') return '';
      return k;
    });
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] } as any);
    document.getElementById('duplicate-prompt-__preset__concise')!.click();
    const systemInput = document.getElementById('promptSystem') as HTMLInputElement;
    expect(systemInput.value).toBe('Default system prompt');
  });

  it('covers resetForm branches when all inputs missing', async () => {
    document.getElementById('promptName')!.remove();
    document.getElementById('promptProvider')!.remove();
    document.getElementById('promptSystem')!.remove();
    document.getElementById('promptText')!.remove();
    document.getElementById('editingPromptId')!.remove();
    document.getElementById('savePromptBtn')!.remove();
    document.getElementById('cancelPromptBtn')!.remove();
    document.getElementById('promptStatus')!.remove();
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] } as any);
    const { loadDefaultPrompt } = await import('../customPromptManager.js');
    expect(() => loadDefaultPrompt()).not.toThrow();
  });

  it('covers getProviderLabel fallback for unknown and known via getMessage falsy', async () => {
    mockGetMessage.mockImplementation((k: string) => {
      if (k === 'promptProviderAll') return '';
      return k;
    });
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({
      custom_prompts: [
        createTestPrompt({ id: 'all1', provider: 'all' }),
        createTestPrompt({ id: 'gem1', provider: 'gemini' }),
        createTestPrompt({ id: 'oa1', provider: 'openai' }),
        createTestPrompt({ id: 'oa21', provider: 'openai2' }),
        createTestPrompt({ id: 'unk1', provider: 'customProvider' }),
      ],
    } as any);
    const html = document.getElementById('promptList')!.innerHTML;
    expect(html).toContain('All Providers');
    expect(html).toContain('googleGemini');
    expect(html).toContain('openaiCompatible');
    expect(html).toContain('openaiCompatible2');
    expect(html).toContain('customProvider');
  });

  it('covers renderPromptList duplicateBtn null branch for preset and default when not present', async () => {
    document.getElementById('promptList')!.remove();
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    expect(() => initCustomPromptManager({ custom_prompts: [] } as any)).not.toThrow();
  });

  it('covers createDefaultPromptItem fallback when getPresetPrompt returns undefined', async () => {
    mockGetPresetPrompt.mockImplementation((id: string) => {
      if (id === 'default') return undefined;
      return { id: 'concise', name: 'Concise', nameJa: '簡潔', userPrompt: 'Be concise', systemPrompt: '' };
    });
    mockGetMessage.mockImplementation((k: string) => {
      if (k === 'defaultPrompt') return '';
      if (k === 'locale') return 'en';
      if (k === 'promptProviderAll') return '';
      return '' as any;
    });
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] } as any);
    expect(document.getElementById('promptList')!.innerHTML).toContain('__default__');
  });

  it('covers handleSavePrompt early returns when DOM elements missing', async () => {
    document.getElementById('promptProvider')!.remove();
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] } as any);
    document.getElementById('savePromptBtn')!.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('covers handleActivatePrompt when currentSettings null early return', async () => {
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    (initCustomPromptManager as any)(null as any);
    expect(document.getElementById('promptList')!.innerHTML).toBe('');
  });

  it('covers updatePrompt fallback when getMessage returns falsy', async () => {
    mockGetMessage.mockImplementation((k: string) => (k === 'updatePrompt' ? '' : k));
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [createTestPrompt({ id: 'upd1' })] } as any);
    document.getElementById('edit-prompt-upd1')!.click();
    const saveBtn = document.getElementById('savePromptBtn') as HTMLButtonElement;
    // When getMessage returns falsy, fallback 'Update Prompt' should be used
    expect(saveBtn.textContent).toBe('Update Prompt');
  });

  it('covers promptDuplicated fallback when getMessage returns falsy', async () => {
    mockGetMessage.mockImplementation((k: string) => (k === 'promptDuplicated' ? '' : k));
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] } as any);
    document.getElementById('duplicate-prompt-__default__')!.click();
    await new Promise((r) => setTimeout(r, 10));
    // should still set name with (Copy) even when status message fallback triggered
    expect((document.getElementById('promptName') as HTMLInputElement).value).toContain('(Copy)');
  });

  it('covers prompts fallback || [] in delete/activate/duplicate handlers with missing key', async () => {
    // Use settings without custom_prompts key to hit || [] in handlers that read currentSettings
    mockGetMessage.mockImplementation(() => '' as any);
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    // Settings with undefined custom_prompts, but we will trigger preset activate which exists regardless
    initCustomPromptManager({} as any);
    // preset activate should hit let prompts = (currentSettings[...] || []) fallback
    document.getElementById('activate-prompt-__preset__concise')!.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    // also test duplicate with same settings
    mockSetAll.mockClear();
    document.getElementById('duplicate-prompt-__default__')!.click();
    expect((document.getElementById('promptName') as HTMLInputElement).value).toContain('(Copy)');
  });

  it('covers showStatus fallback for promptActivated when getMessage falsy', async () => {
    document.getElementById('promptStatus')!.remove();
    mockGetMessage.mockImplementation((k: string) => (k === 'promptActivated' ? '' : ''));
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [createTestPrompt({ id: 'p1' }), createTestPrompt({ id: 'p2' })] } as any);
    document.getElementById('activate-prompt-p2')!.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(mockSetAll).toHaveBeenCalled();
  });
});
