import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { createBPriorityListView, collectBProviderPrioritySlots, validateBSlots } from '../../../src/dashboard/aiProviderB/priorityListView.js';
import type { ProviderSlot } from '../../../src/utils/storage/types.js';

function setupDom() {
  const dom = new JSDOM('<div id="bPriorityList"></div>');
  global.document = dom.window.document as unknown as Document;
  return dom.window.document.getElementById('bPriorityList') as HTMLElement;
}

describe('collectBProviderPrioritySlots', () => {
  it('3行のselect+inputからProviderSlot[]を収集（空は無視、trim）', () => {
    const container = setupDom();
    createBPriorityListView(container, [{ provider: 'openai', model: '  gpt  ' }, { provider: '' }, { provider: 'gemini' }]);
    const slots = collectBProviderPrioritySlots(container);
    expect(slots).toEqual([{ provider: 'openai', model: 'gpt' }, { provider: 'gemini' }]);
  });
  it('model省略時はundefinedではなく省略', () => {
    const container = setupDom();
    createBPriorityListView(container, [{ provider: 'gemini' }]);
    const slots = collectBProviderPrioritySlots(container);
    expect(slots[0]).toEqual({ provider: 'gemini' });
    expect('model' in slots[0] && slots[0].model === '').toBe(false);
  });
});

describe('validateBSlots', () => {
  it('同一provider+同一modelの重複はinvalid', () => {
    const slots: ProviderSlot[] = [{ provider: 'openai', model: 'a' }, { provider: 'openai', model: 'a' }];
    const result = validateBSlots(slots);
    expect(result.valid).toBe(false);
    expect(result.duplicateIndices).toEqual([0, 1]);
  });
  it('同一provider+異なるmodelはvalid', () => {
    const slots: ProviderSlot[] = [{ provider: 'openai', model: 'a' }, { provider: 'openai', model: 'b' }];
    expect(validateBSlots(slots).valid).toBe(true);
  });
  it('異なるproviderはvalid', () => {
    const slots: ProviderSlot[] = [{ provider: 'openai' }, { provider: 'gemini' }];
    expect(validateBSlots(slots).valid).toBe(true);
  });
});

describe('drag reorder', () => {
  it('moveSlotで順序が入れ替わる', async () => {
    const container = setupDom();
    const view = createBPriorityListView(container, [{ provider: 'openai' }, { provider: 'gemini' }, { provider: 'ollama' }]);
    view.moveSlot(0, 2); // openaiを末尾へ
    const slots = collectBProviderPrioritySlots(container);
    expect(slots.map(s => s.provider)).toEqual(['gemini', 'ollama', 'openai']);
  });
});
