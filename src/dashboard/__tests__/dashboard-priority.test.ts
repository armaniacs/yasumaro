// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { collectProviderPrioritySlots, applyProviderPrioritySlots, resetDashboardElements } from '../dashboard.js';

const ALL_OPTIONS = `
  <option value="">未設定</option>
  <option value="gemini">Google Gemini</option>
  <option value="openai">OpenAI Compatible</option>
  <option value="openai2">OpenAI Compatible 2</option>
  <option value="lm-studio">LM Studio</option>
  <option value="ollama">Ollama</option>
  <option value="openai-compatible">OpenAI Compatible (Models.dev)</option>
`;

describe('AIプロバイダ優先度スロットのDOM連携', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="aiProvider">${ALL_OPTIONS}</select>
      <input id="aiProviderPriority1Model" />
      <select id="aiProviderPriority2">${ALL_OPTIONS}</select>
      <input id="aiProviderPriority2Model" />
      <select id="aiProviderPriority3">${ALL_OPTIONS}</select>
      <input id="aiProviderPriority3Model" />
    `;
    resetDashboardElements();
  });

  it('1位のみ選択されている場合、長さ1の配列を返す', () => {
    (document.getElementById('aiProvider') as HTMLSelectElement).value = 'gemini';
    const slots = collectProviderPrioritySlots();
    expect(slots).toEqual([{ provider: 'gemini' }]);
  });

  it('1位・2位にモデル指定ありで選択されている場合、両方をスロットとして返す', () => {
    (document.getElementById('aiProvider') as HTMLSelectElement).value = 'gemini';
    (document.getElementById('aiProviderPriority1Model') as HTMLInputElement).value = 'gemini-2.5-pro';
    (document.getElementById('aiProviderPriority2') as HTMLSelectElement).value = 'openai2';
    (document.getElementById('aiProviderPriority2Model') as HTMLInputElement).value = 'gpt-4o-mini';

    const slots = collectProviderPrioritySlots();
    expect(slots).toEqual([
      { provider: 'gemini', model: 'gemini-2.5-pro' },
      { provider: 'openai2', model: 'gpt-4o-mini' }
    ]);
  });

  it('applyProviderPrioritySlotsは配列をDOMに反映する', () => {
    applyProviderPrioritySlots([
      { provider: 'openai2' },
      { provider: 'ollama', model: 'llama3' }
    ]);

    expect((document.getElementById('aiProvider') as HTMLSelectElement).value).toBe('openai2');
    expect((document.getElementById('aiProviderPriority2') as HTMLSelectElement).value).toBe('ollama');
    expect((document.getElementById('aiProviderPriority2Model') as HTMLInputElement).value).toBe('llama3');
    expect((document.getElementById('aiProviderPriority3') as HTMLSelectElement).value).toBe('');
  });
});
