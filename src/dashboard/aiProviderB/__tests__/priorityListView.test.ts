// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../../testDir/i18nMock.js');
  const getMessage = vi.fn(() => '');
  return i18nMock(getMessage);
});

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

describe('live validation warnings', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  const warnEl = (): HTMLElement | null => container.querySelector<HTMLElement>('.b-priority-warn');
  const reqWarnEl = (): HTMLElement | null => container.querySelector<HTMLElement>('.b-priority-req-warn');

  it('renders the duplicate warning (field-error, role=alert, i18n text) and marks duplicate rows', () => {
    createBPriorityListView(
      container,
      [
        { provider: 'gemini', model: 'dup-model' },
        { provider: 'gemini', model: 'dup-model' },
      ],
      SETTINGS,
    );
    container.dispatchEvent(new Event('change', { bubbles: true }));

    const warn = warnEl();
    expect(warn).not.toBeNull();
    expect(warn!.classList.contains('field-error')).toBe(true);
    expect(warn!.getAttribute('role')).toBe('alert');
    expect(warn!.textContent).toBe('Duplicate provider and model');
    expect(container.querySelectorAll('.b-priority-row.has-error')).toHaveLength(2);
  });

  it('removes the duplicate warning and has-error once the duplicate is resolved', () => {
    createBPriorityListView(
      container,
      [
        { provider: 'gemini', model: 'dup-model' },
        { provider: 'gemini', model: 'dup-model' },
      ],
      SETTINGS,
    );
    container.dispatchEvent(new Event('change', { bubbles: true }));
    expect(warnEl()).not.toBeNull();

    const inputs = container.querySelectorAll<HTMLInputElement>('input.b-priority-model-input');
    inputs[1]!.value = 'other-model';
    inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));

    expect(warnEl()).toBeNull();
    expect(container.querySelectorAll('.b-priority-row.has-error')).toHaveLength(0);
  });

  it('renders the P1-required warning (field-error, role=alert, i18n text) and removes it once P1 is filled', () => {
    createBPriorityListView(container, [{ provider: 'gemini', model: 'x' }], SETTINGS);
    const select0 = container.querySelector<HTMLSelectElement>('.b-priority-row select')!;

    select0.value = '';
    select0.dispatchEvent(new Event('change', { bubbles: true }));

    const reqWarn = reqWarnEl();
    expect(reqWarn).not.toBeNull();
    expect(reqWarn!.classList.contains('field-error')).toBe(true);
    expect(reqWarn!.getAttribute('role')).toBe('alert');
    expect(reqWarn!.textContent).toBe('Priority 1 is required');

    select0.value = 'openai';
    select0.dispatchEvent(new Event('change', { bubbles: true }));
    expect(reqWarnEl()).toBeNull();
  });
});
