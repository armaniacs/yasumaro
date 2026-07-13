// @vitest-environment jsdom

import { loadSettingsToInputs, extractSettingsFromInputs } from '../settingsFormBinding.js';

function setupDOM(): void {
  document.body.innerHTML = `
    <div id="form">
      <input type="text" id="obsidian_port" data-storage-key="obsidian_port" />
      <input type="text" id="obsidian_protocol" data-storage-key="obsidian_protocol" />
      <input type="password" id="obsidian_api_key" data-storage-key="obsidian_api_key" />
      <input type="password" id="gemini_api_key" data-storage-key="gemini_api_key" />
      <input type="password" id="openai_api_key" data-storage-key="openai_api_key" />
      <input type="checkbox" id="ublock_format_enabled" data-storage-key="ublock_format_enabled" />
      <input type="checkbox" id="simple_format_enabled" data-storage-key="simple_format_enabled" />
      <input type="number" id="min_visit_duration" data-storage-key="min_visit_duration" />
      <textarea id="obsidian_daily_path" data-storage-key="obsidian_daily_path"></textarea>
      <select id="ai_provider" data-storage-key="ai_provider">
        <option value="gemini">Gemini</option>
        <option value="openai">OpenAI</option>
      </select>
      <input type="text" id="no-key-input" />
    </div>
  `;
}

describe('settingsFormBinding', () => {
  beforeEach(() => {
    setupDOM();
  });

  describe('loadSettingsToInputs', () => {
    test('populates text input', () => {
      loadSettingsToInputs(document.getElementById('form')!, { obsidian_port: '27123' });
      expect((document.getElementById('obsidian_port') as HTMLInputElement).value).toBe('27123');
    });

    test('populates checkbox', () => {
      loadSettingsToInputs(document.getElementById('form')!, { ublock_format_enabled: true, simple_format_enabled: false });
      expect((document.getElementById('ublock_format_enabled') as HTMLInputElement).checked).toBe(true);
      expect((document.getElementById('simple_format_enabled') as HTMLInputElement).checked).toBe(false);
    });

    test('populates select', () => {
      loadSettingsToInputs(document.getElementById('form')!, { ai_provider: 'openai' });
      expect((document.getElementById('ai_provider') as HTMLSelectElement).value).toBe('openai');
    });

    test('populates textarea', () => {
      loadSettingsToInputs(document.getElementById('form')!, { obsidian_daily_path: 'Daily/{{date}}' });
      expect((document.getElementById('obsidian_daily_path') as HTMLTextAreaElement).value).toBe('Daily/{{date}}');
    });

    test('skips elements without data-storage-key', () => {
      const el = document.getElementById('no-key-input') as HTMLInputElement;
      el.value = 'should stay';
      loadSettingsToInputs(document.getElementById('form')!, {});
      expect(el.value).toBe('should stay');
    });

    test('skips missing settings keys gracefully', () => {
      expect(() => loadSettingsToInputs(document.getElementById('form')!, {})).not.toThrow();
    });

    test('sets placeholder for API key fields with existing value', () => {
      loadSettingsToInputs(document.getElementById('form')!, { obsidian_api_key: 'secret' });
      const el = document.getElementById('obsidian_api_key') as HTMLInputElement;
      expect(el.placeholder).toBe('\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf (Already set)');
      expect(el.value).toBe('');
    });

    test('leaves empty API key field empty without placeholder', () => {
      loadSettingsToInputs(document.getElementById('form')!, { obsidian_api_key: '' });
      const el = document.getElementById('obsidian_api_key') as HTMLInputElement;
      expect(el.placeholder).toBe('');
    });
  });

  describe('extractSettingsFromInputs', () => {
    test('extracts text input value', () => {
      (document.getElementById('obsidian_port') as HTMLInputElement).value = '27123';
      const settings = extractSettingsFromInputs(document.getElementById('form')!);
      expect(settings.obsidian_port).toBe('27123');
    });

    test('extracts checkbox boolean', () => {
      (document.getElementById('ublock_format_enabled') as HTMLInputElement).checked = true;
      const settings = extractSettingsFromInputs(document.getElementById('form')!);
      expect(settings.ublock_format_enabled).toBe(true);
    });

    test('extracts number input as Number', () => {
      (document.getElementById('min_visit_duration') as HTMLInputElement).value = '30';
      const settings = extractSettingsFromInputs(document.getElementById('form')!);
      expect(settings.min_visit_duration).toBe(30);
    });

    test('extracts select value', () => {
      (document.getElementById('ai_provider') as HTMLSelectElement).value = 'openai';
      const settings = extractSettingsFromInputs(document.getElementById('form')!);
      expect(settings.ai_provider).toBe('openai');
    });

    test('skips masked API key fields', () => {
      (document.getElementById('obsidian_api_key') as HTMLInputElement).value = '\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf';
      const settings = extractSettingsFromInputs(document.getElementById('form')!);
      expect(settings.obsidian_api_key).toBeUndefined();
    });

    test('skips empty API key fields', () => {
      (document.getElementById('gemini_api_key') as HTMLInputElement).value = '';
      const settings = extractSettingsFromInputs(document.getElementById('form')!);
      expect(settings.gemini_api_key).toBeUndefined();
    });

    test('extracts unmasked API key field', () => {
      (document.getElementById('gemini_api_key') as HTMLInputElement).value = 'new_key_123';
      const settings = extractSettingsFromInputs(document.getElementById('form')!);
      expect(settings.gemini_api_key).toBe('new_key_123');
    });

    test('skips elements without data-storage-key', () => {
      (document.getElementById('no-key-input') as HTMLInputElement).value = 'ignored';
      const settings = extractSettingsFromInputs(document.getElementById('form')!);
      expect(Object.keys(settings)).not.toContain('no-key-input');
    });

    test('trims string values', () => {
      (document.getElementById('obsidian_port') as HTMLInputElement).value = '  27123  ';
      const settings = extractSettingsFromInputs(document.getElementById('form')!);
      expect(settings.obsidian_port).toBe('27123');
    });

    test('extracts multiple fields at once', () => {
      (document.getElementById('obsidian_port') as HTMLInputElement).value = '27123';
      (document.getElementById('obsidian_protocol') as HTMLInputElement).value = 'https';
      (document.getElementById('ublock_format_enabled') as HTMLInputElement).checked = true;
      (document.getElementById('ai_provider') as HTMLSelectElement).value = 'gemini';
      const settings = extractSettingsFromInputs(document.getElementById('form')!);
      expect(settings.obsidian_port).toBe('27123');
      expect(settings.obsidian_protocol).toBe('https');
      expect(settings.ublock_format_enabled).toBe(true);
      expect(settings.ai_provider).toBe('gemini');
    });
  });
});
