// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { updateAIProviderVisibilityMulti, AIProviderElements } from '../aiProvider.js';

function createMockSelect(value: string): HTMLSelectElement {
  const select = document.createElement('select');
  const option = document.createElement('option');
  option.value = value;
  option.selected = true;
  select.appendChild(option);
  select.value = value;
  return select;
}

function settingsMap(): Record<string, HTMLElement | undefined> {
  const ids = ['gemini', 'openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible', 'built-in-ai'];
  const map: Record<string, HTMLElement | undefined> = {};
  ids.forEach((id) => { map[id] = document.createElement('div'); });
  return map;
}

describe('updateAIProviderVisibilityMulti', () => {
  let elements: AIProviderElements;

  beforeEach(() => {
    elements = {
      select: createMockSelect('gemini'),
      settings: settingsMap(),
    };
  });

  it('優先度1位と2位で異なるプロバイダーを選択した場合、両方の設定欄を表示する', () => {
    updateAIProviderVisibilityMulti(elements, ['gemini', 'openai2']);

    expect(elements.settings.gemini!.style.display).toBe('block');
    expect(elements.settings.openai2!.style.display).toBe('block');
    expect(elements.settings.openai!.style.display).toBe('none');
  });

  it('選択されていないプロバイダーの設定欄は非表示のままにする', () => {
    updateAIProviderVisibilityMulti(elements, ['ollama']);

    expect(elements.settings.ollama!.style.display).toBe('block');
    expect(elements.settings.gemini!.style.display).toBe('none');
    expect(elements.settings.openai!.style.display).toBe('none');
    expect(elements.settings.openai2!.style.display).toBe('none');
  });

  it('空文字列（未設定）は無視する', () => {
    updateAIProviderVisibilityMulti(elements, ['gemini', '', '']);

    expect(elements.settings.gemini!.style.display).toBe('block');
    expect(elements.settings.openai!.style.display).toBe('none');
  });
});
