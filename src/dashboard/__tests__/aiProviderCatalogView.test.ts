/**
 * @vitest-environment jsdom
 * aiProviderCatalogView.test.ts — catalog-driven provider UI builders.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderProviderOptions,
  renderProviderSettings,
  providerIdsInOrder,
} from '../aiProviderCatalogView.js';

describe('providerIdsInOrder', () => {
  it('returns the dropdown order', () => {
    expect(providerIdsInOrder()).toEqual([
      'gemini', 'openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible', 'built-in-ai',
    ]);
  });
});

describe('renderProviderOptions', () => {
  let sel: HTMLSelectElement;
  beforeEach(() => { sel = document.createElement('select'); });

  it('renders all 7 providers in catalog order with localized text', () => {
    renderProviderOptions(sel);
    expect([...sel.options].map((o) => o.value)).toEqual([
      'gemini', 'openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible', 'built-in-ai',
    ]);
    expect(sel.options[0].textContent).toBe('Google Gemini');
    expect(sel.options[6].textContent).toContain('Built-in AI');
  });

  it('includeNone prepends an empty option', () => {
    renderProviderOptions(sel, { includeNone: true });
    expect(sel.options[0].value).toBe('');
    expect(sel.options.length).toBe(8);
  });

  it('customPrompt keeps only gemini/openai/openai2/lm-studio/ollama and prepends "all"', () => {
    renderProviderOptions(sel, { customPrompt: true });
    expect([...sel.options].map((o) => o.value)).toEqual(['all', 'gemini', 'openai', 'openai2', 'lm-studio', 'ollama']);
  });

  it('preserves the current value when the option still exists', () => {
    sel.innerHTML = '<option value="ollama">x</option>';
    sel.value = 'ollama';
    renderProviderOptions(sel);
    expect(sel.value).toBe('ollama');
  });
});

describe('renderProviderSettings', () => {
  let c: HTMLElement;
  beforeEach(() => { c = document.createElement('div'); document.body.appendChild(c); });

  it('gemini: password api key + model + api version rows', () => {
    renderProviderSettings(c, 'gemini');
    expect(c.id).toBe('geminiSettings');
    expect(c.querySelector('input[data-storage-key="gemini_api_key"]')?.getAttribute('type')).toBe('password');
    expect(c.querySelector('#geminiModel')?.getAttribute('data-storage-key')).toBe('gemini_model');
    expect(c.querySelector('#geminiApiVersion')?.getAttribute('data-storage-key')).toBe('gemini_api_version');
    expect(c.querySelector('#geminiApiVersionNote')).not.toBeNull();
    expect(c.querySelector('#geminiApiVersionError')).not.toBeNull();
  });

  it('openai: base url + api key + model with correct storage keys', () => {
    renderProviderSettings(c, 'openai');
    expect(c.id).toBe('openaiSettings');
    expect(c.classList.contains('openai-settings')).toBe(true);
    expect(c.querySelector('#openaiBaseUrl')?.getAttribute('data-storage-key')).toBe('openai_base_url');
    expect(c.querySelector('#openaiApiKey')?.getAttribute('type')).toBe('password');
    expect(c.querySelector('#openaiModel')?.getAttribute('data-storage-key')).toBe('openai_model');
  });

  it('lm-studio: no api key row (requiresApiKey false)', () => {
    renderProviderSettings(c, 'lm-studio');
    expect(c.querySelector('input[type="password"]')).toBeNull();
    expect(c.querySelector('#lmStudioBaseUrl')).not.toBeNull();
    expect(c.querySelector('#lmStudioModel')).not.toBeNull();
  });

  it('built-in-ai: help text only, no inputs', () => {
    renderProviderSettings(c, 'built-in-ai');
    expect(c.querySelector('.help-text')).not.toBeNull();
    expect(c.querySelector('input')).toBeNull();
  });

  it('openai-compatible: models-dev button + preset buttons + provider_* inputs', () => {
    renderProviderSettings(c, 'openai-compatible');
    expect(c.querySelector('#openModelsDevDialogBtn')).not.toBeNull();
    expect(c.querySelector('#lmStudioPresetBtn')).not.toBeNull();
    expect(c.querySelector('#ollamaPresetBtn')).not.toBeNull();
    expect(c.querySelector('#selectedProviderInfo')).not.toBeNull();
    expect(c.querySelector('#providerInfoDisplay')).not.toBeNull();
    expect(c.querySelector('#providerBaseUrl')?.getAttribute('data-storage-key')).toBe('provider_base_url');
    expect(c.querySelector('#providerApiKey')?.getAttribute('type')).toBe('password');
    expect(c.querySelector('#providerModel')?.getAttribute('data-storage-key')).toBe('provider_model');
  });

  it('applies i18n placeholders to the generated inputs', () => {
    renderProviderSettings(c, 'openai');
    const baseUrl = c.querySelector('#openaiBaseUrl') as HTMLInputElement;
    expect(baseUrl.placeholder.length).toBeGreaterThan(0);
  });

  it('rebuilds cleanly on a second call', () => {
    renderProviderSettings(c, 'openai');
    renderProviderSettings(c, 'gemini');
    expect(c.id).toBe('geminiSettings');
    expect(c.querySelector('#openaiBaseUrl')).toBeNull();
    expect(c.querySelector('#geminiApiVersion')).not.toBeNull();
  });
});
