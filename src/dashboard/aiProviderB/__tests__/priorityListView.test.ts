// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn(() => ''),
}));

import {
  collectBProviderPrioritySlots,
  createBPriorityListView,
  resolveModelDisplayName,
} from '../priorityListView.js';
import { StorageKeys } from '../../../utils/storage/types.js';

const SETTINGS = {
  [StorageKeys.GEMINI_MODEL]: 'gemini-2.0-flash',
  // openai_model intentionally absent → falls back to catalog default
};

function rowInputs(container: HTMLElement, index = 0): { select: HTMLSelectElement; input: HTMLInputElement } {
  const row = container.querySelectorAll<HTMLElement>('.b-priority-row')[index]!;
  return {
    select: row.querySelector<HTMLSelectElement>('select')!,
    input: row.querySelector<HTMLInputElement>('input.b-priority-model-input')!,
  };
}

describe('resolveModelDisplayName', () => {
  it('returns the explicit model when present', () => {
    expect(resolveModelDisplayName('gemini', 'gemini-3.8-flash', SETTINGS)).toBe('gemini-3.8-flash');
  });

  it('falls back to the stored provider setting when explicit is empty', () => {
    expect(resolveModelDisplayName('gemini', undefined, SETTINGS)).toBe('gemini-2.0-flash');
  });

  it('falls back to the catalog default when stored setting is empty', () => {
    expect(resolveModelDisplayName('openai', undefined, {})).toBe('gpt-3.5-turbo');
  });

  it('returns empty when there is no explicit, stored, or default model', () => {
    expect(resolveModelDisplayName('gemini', undefined, {})).toBe('');
  });

  it('returns empty for an empty provider id', () => {
    expect(resolveModelDisplayName('', undefined, SETTINGS)).toBe('');
  });

  it('returns empty for Built-in AI (no modelKey, no default)', () => {
    expect(resolveModelDisplayName('built-in-ai', undefined, SETTINGS)).toBe('');
  });
});

describe('createBPriorityListView model display', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('shows the explicit slot model and keeps it saveable', () => {
    createBPriorityListView(container, [{ provider: 'gemini', model: 'gemini-3.8-flash' }], SETTINGS);
    const { input } = rowInputs(container);
    expect(input.value).toBe('gemini-3.8-flash');
    expect(input.dataset.resolved).toBeUndefined();
    expect(collectBProviderPrioritySlots(container)[0]).toEqual({ provider: 'gemini', model: 'gemini-3.8-flash' });
  });

  it('shows the stored setting when the slot has no model and omits it on save', () => {
    createBPriorityListView(container, [{ provider: 'gemini' }], SETTINGS);
    const { input } = rowInputs(container);
    expect(input.value).toBe('gemini-2.0-flash');
    expect(input.dataset.resolved).toBe('true');
    // resolved display must not be persisted as an explicit model
    expect(collectBProviderPrioritySlots(container)[0]).toEqual({ provider: 'gemini' });
  });

  it('shows the catalog default when stored setting is empty and omits it on save', () => {
    createBPriorityListView(container, [{ provider: 'openai' }], {});
    const { input } = rowInputs(container);
    expect(input.value).toBe('gpt-3.5-turbo');
    expect(input.dataset.resolved).toBe('true');
    expect(collectBProviderPrioritySlots(container)[0]).toEqual({ provider: 'openai' });
  });

  it('leaves the input empty (placeholder only) when no model can be resolved', () => {
    createBPriorityListView(container, [{ provider: 'built-in-ai' }], SETTINGS);
    const { input } = rowInputs(container);
    expect(input.value).toBe('');
    expect(input.dataset.resolved).toBeUndefined();
    expect(collectBProviderPrioritySlots(container)[0]).toEqual({ provider: 'built-in-ai' });
  });

  it('re-resolves the display when the provider changes and no user edit exists', () => {
    createBPriorityListView(container, [{ provider: 'gemini' }], SETTINGS);
    const { select, input } = rowInputs(container);
    expect(input.value).toBe('gemini-2.0-flash');

    select.value = 'openai';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(input.value).toBe('gpt-3.5-turbo');
    expect(input.dataset.resolved).toBe('true');
  });

  it('preserves a user-typed model when the provider changes', () => {
    createBPriorityListView(container, [{ provider: 'gemini' }], SETTINGS);
    const { select, input } = rowInputs(container);
    expect(input.value).toBe('gemini-2.0-flash');

    input.value = 'my-custom-model';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.dataset.resolved).toBeUndefined();

    select.value = 'openai';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(input.value).toBe('my-custom-model');
    expect(collectBProviderPrioritySlots(container)[0]).toEqual({ provider: 'openai', model: 'my-custom-model' });
  });

  it('resets to empty resolution when the provider is cleared', () => {
    createBPriorityListView(container, [{ provider: 'openai' }], {});
    const { select, input } = rowInputs(container);
    expect(input.value).toBe('gpt-3.5-turbo');

    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(input.value).toBe('');
    expect(collectBProviderPrioritySlots(container)).toEqual([]);
  });
});
