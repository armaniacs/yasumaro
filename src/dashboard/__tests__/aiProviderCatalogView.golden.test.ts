/**
 * @vitest-environment jsdom
 * aiProviderCatalogView.golden.test.ts (PBI 2026-09-21-14)
 * DOM pins of the CURRENT rendering, captured before the gemini branches
 * become catalog fields. Green before AND after: any rendering drift fails.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderProviderSettings } from '../aiProviderCatalogView.js';
import type { ProviderId } from '../../utils/storage/types.js';

const ALL_IDS: ProviderId[] = [
  'gemini', 'openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible', 'built-in-ai',
];

function render(id: ProviderId): HTMLElement {
  const c = document.createElement('div');
  document.body.appendChild(c);
  renderProviderSettings(c, id);
  return c;
}

function inputAttrs(c: HTMLElement): string[] {
  return [...c.querySelectorAll('input')].map((el) =>
    [el.id, el.type, el.getAttribute('data-storage-key'), el.getAttribute('data-i18n-input-placeholder')].join('|'),
  );
}

function labelKeys(c: HTMLElement): string[] {
  return [...c.querySelectorAll('label')].map((el) => el.getAttribute('data-i18n') ?? '');
}

describe('catalog view DOM goldens', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('container id is <id>Settings and openai-settings class is on every non-gemini block', () => {
    for (const id of ALL_IDS) {
      const c = render(id);
      expect(c.id).toBe(`${id}Settings`);
      expect(c.classList.contains('openai-settings')).toBe(id !== 'gemini');
      c.remove();
    }
  });

  it('apiKey label key is geminiApiKey only for gemini, aiApiKey elsewhere', () => {
    for (const id of ALL_IDS) {
      const c = render(id);
      const keys = labelKeys(c);
      if (id === 'gemini' || id === 'openai' || id === 'openai2') {
        expect(keys).toContain(id === 'gemini' ? 'geminiApiKey' : 'aiApiKey');
      } else {
        expect(keys).not.toContain('geminiApiKey');
      }
      c.remove();
    }
  });

  it('gemini extra-field block keeps its exact a11y structure', () => {
    const c = render('gemini');
    const extra = c.querySelector('#geminiApiVersion') as HTMLInputElement;
    expect(extra.getAttribute('type')).toBe('text');
    expect(extra.getAttribute('data-storage-key')).toBe('gemini_api_version');
    expect(extra.placeholder).toBe('v1beta');
    expect(extra.getAttribute('aria-invalid')).toBe('false');
    expect(extra.getAttribute('aria-describedby')).toBe('geminiApiVersionNote geminiApiVersionError');
    const note = c.querySelector('#geminiApiVersionNote');
    expect(note?.className).toBe('help-text');
    expect(note?.getAttribute('data-i18n')).toBe('note_gemini_api_version');
    const err = c.querySelector('#geminiApiVersionError');
    expect(err?.className).toBe('field-error');
    expect(err?.getAttribute('role')).toBe('alert');
    const group = extra.closest('.form-group');
    expect(group?.querySelector('label')?.getAttribute('data-i18n')).toBe('label_gemini_api_version');
    c.remove();
  });

  it('non-gemini providers render no a11y note/error nodes', () => {
    for (const id of ['openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible', 'built-in-ai'] as ProviderId[]) {
      const c = render(id);
      expect(c.querySelector('#geminiApiVersionNote')).toBeNull();
      expect(c.querySelector('#geminiApiVersionError')).toBeNull();
      expect(c.querySelector('[aria-describedby]')).toBeNull();
      c.remove();
    }
  });

  it('input inventory per provider is stable', () => {
    const gemini = render('gemini');
    expect(inputAttrs(gemini).map((s) => s.split('|').slice(0, 3).join('|'))).toEqual([
      'geminiApiKey|password|gemini_api_key',
      'geminiModel|text|gemini_model',
      'geminiApiVersion|text|gemini_api_version',
    ]);
    gemini.remove();

    const openai = render('openai');
    expect(inputAttrs(openai).map((s) => s.split('|').slice(0, 3).join('|'))).toEqual([
      'openaiBaseUrl|text|openai_base_url',
      'openaiApiKey|password|openai_api_key',
      'openaiModel|text|openai_model',
    ]);
    openai.remove();

    const lmStudio = render('lm-studio');
    expect(lmStudio.querySelector('input[type="password"]')).toBeNull();
    expect(inputAttrs(lmStudio).map((s) => s.split('|').slice(0, 3).join('|'))).toEqual([
      'lmStudioBaseUrl|text|lm_studio_base_url',
      'lmStudioModel|text|lm_studio_model',
    ]);
    lmStudio.remove();

    const builtin = render('built-in-ai');
    expect(builtin.querySelectorAll('input')).toHaveLength(0);
    expect(builtin.querySelector('.help-text')).not.toBeNull();
    builtin.remove();
  });

  it('gemini and openai outerHTML snapshots pin the full rendering', () => {
    const gemini = render('gemini');
    expect(gemini.outerHTML).toMatchSnapshot();
    gemini.remove();
    const openai = render('openai');
    expect(openai.outerHTML).toMatchSnapshot();
    openai.remove();
  });
});
