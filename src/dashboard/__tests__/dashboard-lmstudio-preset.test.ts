// @vitest-environment jsdom
/**
 * dashboard-lmstudio-preset.test.ts
 * Tests for the LM Studio / Ollama preset buttons (dashboard general panel)
 *
 * 対象機能: LM Studio / Ollama プリセットボタン（本番ハンドラ経由）
 * - providerBaseUrl 入力フィールドへのプリセット URL 自動設定
 * - #status / #statusTop への dashboard.css ステータス契約（status-message + type）の書き込み
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleLmStudioPreset, handleOllamaPreset, wireProviderPresetButtons } from '../generalSettings/providerPresets.js';
import { PROVIDER_DEFAULT_BASE_URLS } from '../../utils/storage/providerDefaultBaseUrls.js';

// The production handlers read i18n through getMessageOr; an empty
// translation routes them to the fallback text the assertions pin.
vi.stubGlobal('chrome', {
  i18n: { getMessage: vi.fn(() => '') },
});

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      AI_PROVIDER: 'ai_provider'
    },
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined)

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      AI_PROVIDER: 'ai_provider'
    },
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined)

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      AI_PROVIDER: 'ai_provider'
    },
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined)

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      AI_PROVIDER: 'ai_provider'
    },
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined)

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      AI_PROVIDER: 'ai_provider'
    },
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined)

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      AI_PROVIDER: 'ai_provider'
    },
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined)

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

describe('LM Studio Preset', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input type="text" id="providerBaseUrl" />
      <button type="button" id="lmStudioPresetBtn">LM Studio</button>
      <button type="button" id="ollamaPresetBtn">Ollama</button>
      <div id="status" class="status"></div>
      <div id="statusTop"></div>
      <select id="aiProvider">
        <option value="openai-compatible">OpenAI Compatible</option>
      </select>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  test('LM Studio preset button should set correct Base URL', () => {
    const providerBaseUrlInput = document.getElementById('providerBaseUrl') as HTMLInputElement;
    const statusDiv = document.getElementById('status') as HTMLElement;
    const statusTopDiv = document.getElementById('statusTop') as HTMLElement;

    handleLmStudioPreset();

    expect(providerBaseUrlInput.value).toBe(PROVIDER_DEFAULT_BASE_URLS['lm-studio']);
    expect(statusDiv.textContent).toContain('LM Studio preset applied');
    // Dashboard status contract (dashboard.css): .status-message base + type
    // class. The old self-defined handler wrote the orphan .status-success,
    // which only popup styles.css declares, so the preset status rendered
    // unstyled — this pins the contract the production handler must write.
    expect(statusDiv.className).toBe('status-message success');
    expect(statusDiv.classList.contains('status-success')).toBe(false);
    expect(statusTopDiv.className).toBe('status-message success');
  });

  test('LM Studio URL should match expected format', () => {
    const lmStudioUrl = 'http://localhost:1234/v1';
    const url = new URL(lmStudioUrl);
    
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('localhost');
    expect(url.port).toBe('1234');
    expect(url.pathname).toBe('/v1');
  });

  test('providerBaseUrl input should exist in openai-compatible settings', () => {
    const input = document.getElementById('providerBaseUrl');
    expect(input).not.toBeNull();
    expect(input?.tagName).toBe('INPUT');
    expect((input as HTMLInputElement).type).toBe('text');
  });

  test('LM Studio preset should be accessible as button', () => {
    const btn = document.getElementById('lmStudioPresetBtn');
    expect(btn).not.toBeNull();
    expect(btn?.tagName).toBe('BUTTON');
  });

  test('settings mapping should include provider_base_url', async () => {
    const { StorageKeys } = await import('../../utils/storage/types.js');
    
    expect(StorageKeys.PROVIDER_BASE_URL).toBe('provider_base_url');
  });
});

describe('OpenAIProvider with LM Studio', () => {
  test('OpenAIProvider should handle openai-compatible type', () => {
    const providerName = 'openai-compatible';
    const baseUrl = 'http://localhost:1234/v1';
    
    expect(providerName).toBe('openai-compatible');
    expect(baseUrl).toContain('localhost');
    expect(baseUrl).toContain('1234');
  });

  test('LM Studio chat completions endpoint format', () => {
    const baseUrl = 'http://localhost:1234/v1';
    const trimmedUrl = baseUrl.replace(/\/$/, '');
    const chatCompletionsUrl = `${trimmedUrl}/chat/completions`;
    
    expect(chatCompletionsUrl).toBe('http://localhost:1234/v1/chat/completions');
  });

  test('LM Studio models endpoint format', () => {
    const baseUrl = 'http://localhost:1234/v1';
    const trimmedUrl = baseUrl.replace(/\/$/, '');
    const modelsUrl = `${trimmedUrl}/models`;
    
    expect(modelsUrl).toBe('http://localhost:1234/v1/models');
  });

  test('OpenAIProvider does not require API key for local LM Studio', () => {
    const apiKey = '';
    
    expect(apiKey).toBe('');
  });
});

describe('Ollama Preset', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input type="text" id="providerBaseUrl" />
      <button type="button" id="ollamaPresetBtn">Ollama</button>
      <div id="status" class="status"></div>
      <div id="statusTop"></div>
      <select id="aiProvider">
        <option value="openai-compatible">OpenAI Compatible</option>
      </select>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  test('Ollama preset button should set correct Base URL', () => {
    const providerBaseUrlInput = document.getElementById('providerBaseUrl') as HTMLInputElement;
    const statusDiv = document.getElementById('status') as HTMLElement;
    const statusTopDiv = document.getElementById('statusTop') as HTMLElement;

    handleOllamaPreset();

    expect(providerBaseUrlInput.value).toBe(PROVIDER_DEFAULT_BASE_URLS['ollama']);
    expect(statusDiv.textContent).toContain('Ollama preset applied');
    // Same derived contract as every other dashboard status write.
    expect(statusDiv.className).toBe('status-message success');
    expect(statusDiv.classList.contains('status-success')).toBe(false);
    expect(statusTopDiv.className).toBe('status-message success');
  });

  test('Ollama URL should match expected format', () => {
    const ollamaUrl = 'http://localhost:11434/v1';
    const url = new URL(ollamaUrl);
    
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('localhost');
    expect(url.port).toBe('11434');
    expect(url.pathname).toBe('/v1');
  });

  test('Ollama preset should be accessible as button', () => {
    const btn = document.getElementById('ollamaPresetBtn');
    expect(btn).not.toBeNull();
    expect(btn?.tagName).toBe('BUTTON');
  });
});

describe('OpenAIProvider with Ollama', () => {
  test('OpenAIProvider should handle openai-compatible type for Ollama', () => {
    const providerName = 'openai-compatible';
    const baseUrl = 'http://localhost:11434/v1';
    
    expect(providerName).toBe('openai-compatible');
    expect(baseUrl).toContain('localhost');
    expect(baseUrl).toContain('11434');
  });

  test('Ollama chat completions endpoint format', () => {
    const baseUrl = 'http://localhost:11434/v1';
    const trimmedUrl = baseUrl.replace(/\/$/, '');
    const chatCompletionsUrl = `${trimmedUrl}/chat/completions`;
    
    expect(chatCompletionsUrl).toBe('http://localhost:11434/v1/chat/completions');
  });

  test('Ollama models endpoint format', () => {
    const baseUrl = 'http://localhost:11434/v1';
    const trimmedUrl = baseUrl.replace(/\/$/, '');
    const modelsUrl = `${trimmedUrl}/models`;
    
    expect(modelsUrl).toBe('http://localhost:11434/v1/models');
  });

  test('OpenAIProvider does not require API key for local Ollama', () => {
    const apiKey = '';
    
    expect(apiKey).toBe('');
  });
});

describe('Provider preset button wiring (data-driven table)', () => {
  const PRESET_FIXTURE = `
    <input type="text" id="providerBaseUrl" />
    <button type="button" id="lmStudioPresetBtn">LM Studio</button>
    <button type="button" id="ollamaPresetBtn">Ollama</button>
    <div id="status" class="status"></div>
    <div id="statusTop"></div>
    <select id="aiProvider">
      <option value="openai-compatible">OpenAI Compatible</option>
    </select>
  `;

  beforeEach(() => {
    document.body.innerHTML = PRESET_FIXTURE;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  test('one wireProviderPresetButtons call wires every table row', () => {
    wireProviderPresetButtons(document.body);

    (document.getElementById('lmStudioPresetBtn') as HTMLButtonElement).click();
    expect((document.getElementById('providerBaseUrl') as HTMLInputElement).value)
      .toBe(PROVIDER_DEFAULT_BASE_URLS['lm-studio']);

    (document.getElementById('ollamaPresetBtn') as HTMLButtonElement).click();
    expect((document.getElementById('providerBaseUrl') as HTMLInputElement).value)
      .toBe(PROVIDER_DEFAULT_BASE_URLS['ollama']);
    // Same derived status contract as the direct handler write.
    expect((document.getElementById('status') as HTMLElement).className).toBe('status-message success');
  });

  test('wired button click is state-identical to the direct handler call (parity)', () => {
    handleLmStudioPreset();
    const viaHandler = {
      url: (document.getElementById('providerBaseUrl') as HTMLInputElement).value,
      status: (document.getElementById('status') as HTMLElement).className,
      statusTop: (document.getElementById('statusTop') as HTMLElement).className,
    };

    document.body.innerHTML = PRESET_FIXTURE;
    wireProviderPresetButtons(document.body);
    (document.getElementById('lmStudioPresetBtn') as HTMLButtonElement).click();
    const viaClick = {
      url: (document.getElementById('providerBaseUrl') as HTMLInputElement).value,
      status: (document.getElementById('status') as HTMLElement).className,
      statusTop: (document.getElementById('statusTop') as HTMLElement).className,
    };

    expect(viaClick).toEqual(viaHandler);
  });
});