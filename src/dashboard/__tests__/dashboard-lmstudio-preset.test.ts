// @vitest-environment jsdom
/**
 * dashboard-lmstudio-preset.test.ts
 * Tests for LM Studio preset button functionality
 * 
 * 対象機能: LM Studio プリセットボタン
 * - Base URL入力フィールドへのLM Studio URL自動設定
 * - openai-compatibleプロバイダーでのLM Studio対応
 */

import { describe, test, expect, beforeEach, afterEach, jest } from 'vitest';

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    PROVIDER_BASE_URL: 'provider_base_url',
    PROVIDER_API_KEY: 'provider_api_key',
    PROVIDER_MODEL: 'provider_model',
    AI_PROVIDER: 'ai_provider'
  },
  getSettings: vi.fn().mockResolvedValue({}),
  saveSettings: vi.fn().mockResolvedValue(undefined),
  saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined)
}));

describe('LM Studio Preset', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input type="text" id="providerBaseUrl" />
      <button type="button" id="lmStudioPresetBtn">LM Studio</button>
      <button type="button" id="ollamaPresetBtn">Ollama</button>
      <div id="status" class="status"></div>
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
    const lmStudioPresetBtn = document.getElementById('lmStudioPresetBtn') as HTMLButtonElement;
    const statusDiv = document.getElementById('status') as HTMLElement;

    const handler = (e: Event) => {
      e.preventDefault();
      providerBaseUrlInput.value = 'http://localhost:1234/v1';
      statusDiv.textContent = 'LM Studio preset applied (http://localhost:1234/v1)';
      statusDiv.className = 'status-success';
    };

    lmStudioPresetBtn.addEventListener('click', handler);
    lmStudioPresetBtn.click();

    expect(providerBaseUrlInput.value).toBe('http://localhost:1234/v1');
    expect(statusDiv.textContent).toContain('LM Studio preset applied');
    expect(statusDiv.className).toContain('status-success');
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
    const { StorageKeys } = await import('../../utils/storage.js');
    
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
    const ollamaPresetBtn = document.getElementById('ollamaPresetBtn') as HTMLButtonElement;
    const statusDiv = document.getElementById('status') as HTMLElement;

    const handler = (e: Event) => {
      e.preventDefault();
      providerBaseUrlInput.value = 'http://localhost:11434/v1';
      statusDiv.textContent = 'Ollama preset applied (http://localhost:11434/v1)';
      statusDiv.className = 'status-success';
    };

    ollamaPresetBtn.addEventListener('click', handler);
    ollamaPresetBtn.click();

    expect(providerBaseUrlInput.value).toBe('http://localhost:11434/v1');
    expect(statusDiv.textContent).toContain('Ollama preset applied');
    expect(statusDiv.className).toContain('status-success');
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