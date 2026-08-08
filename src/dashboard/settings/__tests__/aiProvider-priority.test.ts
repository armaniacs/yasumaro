// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { updateAIProviderVisibilityMulti, AIProviderElements } from '../aiProvider.js';

function createMockElement(): HTMLElement {
  const el = document.createElement('div');
  return el;
}

function createMockSelect(value: string): HTMLSelectElement {
  const select = document.createElement('select');
  const option = document.createElement('option');
  option.value = value;
  option.selected = true;
  select.appendChild(option);
  select.value = value;
  return select;
}

describe('updateAIProviderVisibilityMulti', () => {
  let elements: AIProviderElements;

  beforeEach(() => {
    elements = {
      select: createMockSelect('gemini'),
      geminiSettings: createMockElement(),
      openaiSettings: createMockElement(),
      openai2Settings: createMockElement(),
      lmStudioSettings: createMockElement(),
      ollamaSettings: createMockElement(),
      openaiCompatibleSettings: createMockElement()
    };
  });

  it('優先度1位と2位で異なるプロバイダーを選択した場合、両方の設定欄を表示する', () => {
    updateAIProviderVisibilityMulti(elements, ['gemini', 'openai2']);

    expect(elements.geminiSettings.style.display).toBe('block');
    expect(elements.openai2Settings.style.display).toBe('block');
    expect(elements.openaiSettings.style.display).toBe('none');
  });

  it('選択されていないプロバイダーの設定欄は非表示のままにする', () => {
    updateAIProviderVisibilityMulti(elements, ['ollama']);

    expect(elements.ollamaSettings?.style.display).toBe('block');
    expect(elements.geminiSettings.style.display).toBe('none');
    expect(elements.openaiSettings.style.display).toBe('none');
    expect(elements.openai2Settings.style.display).toBe('none');
  });

  it('空文字列（未設定）は無視する', () => {
    updateAIProviderVisibilityMulti(elements, ['gemini', '', '']);

    expect(elements.geminiSettings.style.display).toBe('block');
    expect(elements.openaiSettings.style.display).toBe('none');
  });
});
