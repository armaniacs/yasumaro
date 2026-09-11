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

  it('shows both settings sections when different providers are selected for priorities 1 and 2', () => {
    updateAIProviderVisibilityMulti(elements, ['gemini', 'openai2']);

    expect(elements.settings.gemini!.style.display).toBe('block');
    expect(elements.settings.openai2!.style.display).toBe('block');
    expect(elements.settings.openai!.style.display).toBe('none');
  });

  it('keeps settings sections of unselected providers hidden', () => {
    updateAIProviderVisibilityMulti(elements, ['ollama']);

    expect(elements.settings.ollama!.style.display).toBe('block');
    expect(elements.settings.gemini!.style.display).toBe('none');
    expect(elements.settings.openai!.style.display).toBe('none');
    expect(elements.settings.openai2!.style.display).toBe('none');
  });

  it('ignores empty strings (unset)', () => {
    updateAIProviderVisibilityMulti(elements, ['gemini', '', '']);

    expect(elements.settings.gemini!.style.display).toBe('block');
    expect(elements.settings.openai!.style.display).toBe('none');
  });
});
