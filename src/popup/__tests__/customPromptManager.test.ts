// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    CUSTOM_PROMPTS: 'custom_prompts',
  },
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/customPromptUtils.js', () => ({
  createPrompt: vi.fn(),
  updatePrompt: vi.fn(),
  deletePrompt: vi.fn(),
  setActivePrompt: vi.fn(),
  validatePrompt: vi.fn().mockReturnValue({ valid: true }),
  DEFAULT_USER_PROMPT: 'Default user prompt',
  DEFAULT_SYSTEM_PROMPT: 'Default system prompt',
  PRESET_PROMPTS: [
    { id: 'default', name: { ja: 'デフォルト', en: 'Default' }, userPrompt: 'Default prompt', systemPrompt: '' },
    { id: 'concise', name: { ja: '簡潔', en: 'Concise' }, userPrompt: 'Be concise', systemPrompt: '' },
  ],
  getPresetPrompt: vi.fn((id) => {
    if (id === 'default') return { id: 'default', name: { ja: 'デフォルト', en: 'Default' }, userPrompt: 'Default prompt', systemPrompt: '' };
    if (id === 'concise') return { id: 'concise', name: { ja: '簡潔', en: 'Concise' }, userPrompt: 'Be concise', systemPrompt: '' };
    return undefined;
  }),
  getPromptDisplayName: vi.fn((preset, locale) => locale === 'ja' ? preset.name.ja : preset.name.en),
}));

vi.mock('../i18n.js', () => ({
  applyI18n: vi.fn(),
  getMessage: vi.fn((key) => key),
}));

vi.mock('../errorUtils.js', () => ({
  escapeHtml: vi.fn((s) => s),
}));

describe('customPromptManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="promptList"></div>
      <div id="noPromptsMessage"></div>
      <input id="promptName" />
      <select id="promptProvider"><option value="all">All</option></select>
      <input id="promptSystem" />
      <textarea id="promptText"></textarea>
      <input id="editingPromptId" />
      <button id="savePromptBtn"></button>
      <button id="cancelPromptBtn"></button>
      <div id="promptStatus"></div>
    `;
  });

  afterEach(() => {
    // Clear module cache to ensure fresh imports
    vi.resetModules();
  });

  it('should export initCustomPromptManager function', async () => {
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    expect(typeof initCustomPromptManager).toBe('function');
  });

  it('should export loadDefaultPrompt function', async () => {
    const { loadDefaultPrompt } = await import('../customPromptManager.js');
    expect(typeof loadDefaultPrompt).toBe('function');
  });

  it('should render prompt list with default prompt', async () => {
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] });
    const promptList = document.getElementById('promptList');
    expect(promptList?.innerHTML).toContain('prompt-item');
  });

  it('should render default prompt with __default__ id', async () => {
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] });
    const promptList = document.getElementById('promptList');
    expect(promptList?.innerHTML).toContain('__default__');
  });

  it('should hide noPromptsMessage', async () => {
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] });
    const noPromptsMsg = document.getElementById('noPromptsMessage');
    expect(noPromptsMsg?.style.display).toBe('none');
  });

  it('should render duplicate button for default prompt', async () => {
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    initCustomPromptManager({ custom_prompts: [] });
    const promptList = document.getElementById('promptList');
    expect(promptList?.innerHTML).toContain('btn-duplicate');
  });

  it('should attach event listeners to buttons', async () => {
    const { initCustomPromptManager } = await import('../customPromptManager.js');
    const addEventListenerSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    initCustomPromptManager({ custom_prompts: [] });
    expect(addEventListenerSpy).toHaveBeenCalled();
  });
});