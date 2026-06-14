// @vitest-environment jsdom
/**
 * diagnosticsPanel.test.ts
 * Tests for diagnostics panel — storage stats, extension info,
 * Obsidian/AI settings display, and connection test handlers.
 *
 * Coverage target: 17.2% → 80%+
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initDiagnosticsPanel } from '../diagnosticsPanel.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../popup/i18n.js', () => ({
  getMessage: (key: string) => key,
}));

const mockGetSettings = vi.fn();
vi.mock('../../utils/storage.js', () => ({
  getSettings: () => mockGetSettings(),
  StorageKeys: {
    OBSIDIAN_API_KEY: 'obsidian_api_key',
    OBSIDIAN_PROTOCOL: 'obsidian_protocol',
    OBSIDIAN_PORT: 'obsidian_port',
    OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
    AI_PROVIDER: 'ai_provider',
    GEMINI_API_KEY: 'gemini_api_key',
    GEMINI_MODEL: 'gemini_model',
    OPENAI_BASE_URL: 'openai_base_url',
    OPENAI_API_KEY: 'openai_api_key',
    OPENAI_MODEL: 'openai_model',
    OPENAI_2_BASE_URL: 'openai_2_base_url',
    OPENAI_2_API_KEY: 'openai_2_api_key',
    OPENAI_2_MODEL: 'openai_2_model',
  },
}));

const mockGetSavedUrlCount = vi.fn().mockResolvedValue(42);
vi.mock('../../utils/storageUrls.js', () => ({
  getSavedUrlCount: () => mockGetSavedUrlCount(),
}));

// ---------------------------------------------------------------------------
// Chrome API overrides — vitest.setup.ts beforeEach() resets these, so we
// reassign them in each test's beforeEach.
// ---------------------------------------------------------------------------

const mockGetBytesInUse = vi.fn().mockResolvedValue(102400);
const mockGetManifest = vi.fn().mockReturnValue({ version: '1.0.0', name: 'Test Extension' });
const mockSendMessage = vi.fn();
const mockStorageLocalGet = vi.fn().mockResolvedValue({});
const mockStorageLocalSet = vi.fn().mockResolvedValue(undefined);

function setupChromeMocks(): void {
  const c = globalThis as any;
  if (c.chrome?.storage?.local) {
    c.chrome.storage.local.getBytesInUse = mockGetBytesInUse;
    c.chrome.storage.local.get = mockStorageLocalGet;
    c.chrome.storage.local.set = mockStorageLocalSet;
  }
  if (c.chrome?.runtime) {
    c.chrome.runtime.getManifest = mockGetManifest;
    c.chrome.runtime.sendMessage = mockSendMessage;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDOM(includeConnectionResult = true): void {
  document.body.innerHTML = `
    <div id="diagStorageStats"></div>
    <div id="diagExtInfo"></div>
    <button id="diagTestObsidianBtn"></button>
    <button id="diagTestAiBtn"></button>
    ${includeConnectionResult ? '<div id="diagConnectionResult"></div>' : ''}
    <div id="diagObsidianSettings"></div>
    <div id="diagAiSettings"></div>
    <input type="checkbox" id="diagDebugModeToggle" role="switch">
    <div id="diagDeficiencyStats"></div>
    <details id="diagCompileOptionsSection"></details>
    <div id="diagDivergenceWarning" style="display: none;"></div>
  `;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('makeStatRow (tested via initDiagnosticsPanel output)', () => {
  beforeEach(async () => {
    setupChromeMocks();
    setupDOM();
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'my-key',
      obsidian_daily_path: '/notes',
      ai_provider: 'gemini',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates div elements with diag-stat-row class', () => {
    const rows = document.querySelectorAll('.diag-stat-row');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('each row contains a label span and a value span', () => {
    const rows = document.querySelectorAll('.diag-stat-row');
    rows.forEach((row) => {
      expect(row.querySelector('.diag-stat-label')).not.toBeNull();
      expect(row.querySelector('.diag-stat-value')).not.toBeNull();
    });
  });

  it('does NOT add diag-stat-masked when masked=false (key present)', () => {
    const keyRow = Array.from(document.querySelectorAll('.diag-stat-row')).find(
      (row) => row.querySelector('.diag-stat-label')?.textContent === 'diagApiKey'
    );
    const valueSpan = keyRow!.querySelector('.diag-stat-value');
    expect(valueSpan!.classList.contains('diag-stat-masked')).toBe(false);
  });

  it('adds diag-stat-masked when masked=true (key not set)', async () => {
    document.body.innerHTML = '';
    setupChromeMocks();
    setupDOM();
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: '',
      obsidian_daily_path: '/notes',
      ai_provider: 'gemini',
    });
    await initDiagnosticsPanel();

    const keyRow = Array.from(document.querySelectorAll('.diag-stat-row')).find(
      (row) => row.querySelector('.diag-stat-label')?.textContent === 'diagApiKey'
    );
    const valueSpan = keyRow!.querySelector('.diag-stat-value');
    expect(valueSpan!.classList.contains('diag-stat-masked')).toBe(true);
  });
});

describe('initDiagnosticsPanel — Obsidian settings', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockReset();
    mockGetSavedUrlCount.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders protocol, port, REST URL, and daily path', async () => {
    setupDOM();
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'http',
      obsidian_port: '27123',
      obsidian_api_key: 'secret123',
      obsidian_daily_path: 'Daily/Notes',
      ai_provider: 'gemini',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();

    const el = document.getElementById('diagObsidianSettings')!;
    expect(el.textContent).toContain('http');
    expect(el.textContent).toContain('27123');
    expect(el.textContent).toContain('http://127.0.0.1:27123');
    expect(el.textContent).toContain('Daily/Notes');
  });

  it('shows configured API key as bullets with (configured) label', async () => {
    setupDOM();
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'my-api-key',
      obsidian_daily_path: '/notes',
      ai_provider: 'gemini',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();

    const el = document.getElementById('diagObsidianSettings')!;
    expect(el.textContent).toContain('configured');
    expect(el.textContent).toContain('••••••••');
  });

  it('shows (not set) for missing API key', async () => {
    setupDOM();
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: '',
      obsidian_daily_path: '/notes',
      ai_provider: 'gemini',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();

    const el = document.getElementById('diagObsidianSettings')!;
    expect(el.textContent).toContain('notSet');
  });

  it('shows (default) for empty daily path', async () => {
    setupDOM();
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '',
      ai_provider: 'gemini',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();

    const el = document.getElementById('diagObsidianSettings')!;
    expect(el.textContent).toContain('defaultValue');
  });
});

describe('initDiagnosticsPanel — AI settings (provider-specific)', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockReset();
    mockGetSavedUrlCount.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders gemini model and key when provider is gemini', async () => {
    setupDOM();
    mockGetSettings.mockResolvedValue({
      ai_provider: 'gemini',
      gemini_model: 'gemini-2.0-flash',
      gemini_api_key: 'gem-key',
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();

    const el = document.getElementById('diagAiSettings')!;
    expect(el.textContent).toContain('Google Gemini');
    expect(el.textContent).toContain('gemini-2.0-flash');
    expect(el.textContent).toContain('configured');
  });

  it('renders openai base URL, model, and key when provider is openai', async () => {
    setupDOM();
    mockGetSettings.mockResolvedValue({
      ai_provider: 'openai',
      openai_base_url: 'https://api.openai.com/v1',
      openai_model: 'gpt-4o',
      openai_api_key: 'sk-xxx',
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();

    const el = document.getElementById('diagAiSettings')!;
    expect(el.textContent).toContain('OpenAI Compatible');
    expect(el.textContent).toContain('https://api.openai.com/v1');
    expect(el.textContent).toContain('gpt-4o');
    expect(el.textContent).toContain('configured');
  });

  it('renders openai2 base URL, model, and key when provider is openai2', async () => {
    setupDOM();
    mockGetSettings.mockResolvedValue({
      ai_provider: 'openai2',
      openai_2_base_url: 'https://other.api.com',
      openai_2_model: 'claude-3',
      openai_2_api_key: 'sk-xxx-2',
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();

    const el = document.getElementById('diagAiSettings')!;
    expect(el.textContent).toContain('OpenAI Compatible 2');
    expect(el.textContent).toContain('https://other.api.com');
    expect(el.textContent).toContain('claude-3');
    expect(el.textContent).toContain('configured');
  });

  it('shows notSet for missing AI model and key', async () => {
    setupDOM();
    mockGetSettings.mockResolvedValue({
      ai_provider: 'gemini',
      gemini_model: '',
      gemini_api_key: '',
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();

    const el = document.getElementById('diagAiSettings')!;
    expect(el.textContent).toContain('notSet');
  });
});

describe('initDiagnosticsPanel — Storage stats', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockReset();
    mockGetSavedUrlCount.mockClear();
    setupDOM();
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '',
      ai_provider: 'gemini',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('calls getBytesInUse and getSavedUrlCount', async () => {
    await initDiagnosticsPanel();

    expect(mockGetBytesInUse).toHaveBeenCalledWith(null);
    expect(mockGetSavedUrlCount).toHaveBeenCalled();
  });

  it('renders KB value and URL count', async () => {
    mockGetBytesInUse.mockResolvedValue(204800);
    mockGetSavedUrlCount.mockResolvedValue(99);
    await initDiagnosticsPanel();

    const el = document.getElementById('diagStorageStats')!;
    expect(el.textContent).toContain('200.0');
    expect(el.textContent).toContain('KB');
    expect(el.textContent).toContain('99');
  });

  it('shows error message when getBytesInUse throws', async () => {
    mockGetBytesInUse.mockRejectedValue(new Error('storage error'));
    await initDiagnosticsPanel();

    const el = document.getElementById('diagStorageStats')!;
    expect(el.textContent).toBe('diagLoadError');
  });
});

describe('initDiagnosticsPanel — Extension info', () => {
  beforeEach(async () => {
    setupChromeMocks();
    setupDOM();
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '',
      ai_provider: 'gemini',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('calls chrome.runtime.getManifest()', () => {
    expect(mockGetManifest).toHaveBeenCalled();
  });

  it('renders version and extension name', () => {
    const el = document.getElementById('diagExtInfo')!;
    expect(el.textContent).toContain('1.0.0');
    expect(el.textContent).toContain('Test Extension');
  });
});

describe('initDiagnosticsPanel — Error handling', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows error in obsidianSettingsEl when getSettings throws', async () => {
    setupChromeMocks();
    setupDOM();
    mockGetSettings.mockRejectedValue(new Error('fail'));
    await initDiagnosticsPanel();

    const el = document.getElementById('diagObsidianSettings')!;
    expect(el.textContent).toBe('diagLoadError');
  });

  it('gracefully handles missing DOM elements (no crash)', async () => {
    document.body.innerHTML = '';
    setupChromeMocks();
    mockGetSettings.mockResolvedValue({ ai_provider: 'gemini' });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await expect(initDiagnosticsPanel()).resolves.toBeUndefined();
  });
});

describe('initDiagnosticsPanel — Placeholder text', () => {
  beforeEach(async () => {
    setupChromeMocks();
    setupDOM();
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '',
      ai_provider: 'gemini',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sets placeholder data attribute on connectionResult', () => {
    const el = document.getElementById('diagConnectionResult')!;
    expect(el.dataset['placeholder']).toBe('diagConnectionPlaceholder');
  });
});

describe('initDiagnosticsPanel — Obsidian connection test button', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockReset();
    mockGetSavedUrlCount.mockClear();
    setupDOM();
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '',
      ai_provider: 'gemini',
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('disables button, shows testing text, then shows success result', async () => {
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();

    const btn = document.getElementById('diagTestObsidianBtn') as HTMLButtonElement;
    const result = document.getElementById('diagConnectionResult')!;

    btn.click();
    expect(btn.disabled).toBe(true);
    expect(result.textContent).toBe('testing');

    await vi.waitFor(() => {
      expect(btn.disabled).toBe(false);
    });
    expect(result.textContent).toContain('✓');
    expect(result.textContent).toContain('OK');
  });

  it('shows failure result when obsidian test fails', async () => {
    mockSendMessage.mockResolvedValue({ obsidian: { success: false, message: 'Connection refused' } });
    await initDiagnosticsPanel();

    const btn = document.getElementById('diagTestObsidianBtn') as HTMLButtonElement;
    const result = document.getElementById('diagConnectionResult')!;

    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('✗');
    });
    expect(result.textContent).toContain('Connection refused');
  });

  it('shows error message when sendMessage throws', async () => {
    mockSendMessage.mockRejectedValue(new Error('network error'));
    await initDiagnosticsPanel();

    const btn = document.getElementById('diagTestObsidianBtn') as HTMLButtonElement;
    const result = document.getElementById('diagConnectionResult')!;

    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toBe('testError');
    });
    expect(btn.disabled).toBe(false);
  });
});

describe('initDiagnosticsPanel — AI connection test button', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockReset();
    mockGetSavedUrlCount.mockClear();
    setupDOM();
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '',
      ai_provider: 'gemini',
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('disables button, shows testing text, then shows success result', async () => {
    mockSendMessage.mockResolvedValue({ ai: { success: true, message: 'AI OK' } });
    await initDiagnosticsPanel();

    const btn = document.getElementById('diagTestAiBtn') as HTMLButtonElement;
    const result = document.getElementById('diagConnectionResult')!;

    btn.click();
    expect(btn.disabled).toBe(true);
    expect(result.textContent).toBe('testing');

    await vi.waitFor(() => {
      expect(btn.disabled).toBe(false);
    });
    expect(result.textContent).toContain('✓');
    expect(result.textContent).toContain('AI OK');
  });

  it('shows failure result when AI test fails', async () => {
    mockSendMessage.mockResolvedValue({ ai: { success: false, message: 'API error' } });
    await initDiagnosticsPanel();

    const btn = document.getElementById('diagTestAiBtn') as HTMLButtonElement;
    const result = document.getElementById('diagConnectionResult')!;

    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('✗');
    });
    expect(result.textContent).toContain('API error');
  });

  it('shows error message when sendMessage throws for AI test', async () => {
    mockSendMessage.mockRejectedValue(new Error('timeout'));
    await initDiagnosticsPanel();

    const btn = document.getElementById('diagTestAiBtn') as HTMLButtonElement;
    const result = document.getElementById('diagConnectionResult')!;

    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toBe('testError');
    });
    expect(btn.disabled).toBe(false);
  });
});

describe('initDiagnosticsPanel — Connection test with missing connectionResult', () => {
  beforeEach(async () => {
    setupChromeMocks();
    mockGetSettings.mockReset();
    mockGetSavedUrlCount.mockClear();
    setupDOM(false);
    mockGetSettings.mockResolvedValue({
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '',
      ai_provider: 'gemini',
    });
    mockSendMessage.mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    await initDiagnosticsPanel();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('obsidian test button handler returns early when connectionResult is null', () => {
    const btn = document.getElementById('diagTestObsidianBtn') as HTMLButtonElement;
    expect(document.getElementById('diagConnectionResult')).toBeNull();
    expect(() => btn.click()).not.toThrow();
  });

  it('AI test button handler returns early when connectionResult is null', () => {
    const btn = document.getElementById('diagTestAiBtn') as HTMLButtonElement;
    expect(() => btn.click()).not.toThrow();
  });
});
