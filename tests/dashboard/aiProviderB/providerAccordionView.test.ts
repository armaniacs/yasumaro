// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createBProviderAccordionView } from '../../../src/dashboard/aiProviderB/providerAccordionView.js';

function container(): HTMLElement {
  document.body.innerHTML = '<div id="bProviderAccordion"></div>';
  return document.getElementById('bProviderAccordion') as HTMLElement;
}

describe('createBProviderAccordionView', () => {
  it('7プロバイダのアコーディオンが catalog 順で生成される', () => {
    const c = container();
    createBProviderAccordionView(c);
    const details = [...c.querySelectorAll<HTMLElement>('details.b-provider-details')];
    expect(details.length).toBe(7);
    expect(details.map((d) => d.dataset.provider)).toEqual([
      'geminiSettings', 'openaiSettings', 'openai2Settings', 'lm-studioSettings',
      'ollamaSettings', 'openai-compatibleSettings', 'built-in-aiSettings',
    ]);
  });

  it('各 accordion body が provider の settings フォームを持つ（catalog 生成）', () => {
    const c = container();
    createBProviderAccordionView(c);
    // gemini body — api key + model + api version
    expect(c.querySelector('#geminiSettings input[data-storage-key="gemini_api_key"]')).not.toBeNull();
    expect(c.querySelector('#geminiSettings #geminiApiVersion')).not.toBeNull();
    // openai-compatible — models-dev button
    expect(c.querySelector('#openai-compatibleSettings #openModelsDevDialogBtn')).not.toBeNull();
    // built-in-ai — help text only
    expect(c.querySelector('#built-in-aiSettings .help-text')).not.toBeNull();
    expect(c.querySelector('#built-in-aiSettings input')).toBeNull();
  });

  it('gemini はデフォルトで開いている', () => {
    const c = container();
    createBProviderAccordionView(c);
    const gemini = c.querySelector<HTMLDetailsElement>('details[data-provider="geminiSettings"]');
    expect(gemini?.open).toBe(true);
  });

  it('destroy で container が空になる', () => {
    const c = container();
    const view = createBProviderAccordionView(c);
    view.destroy();
    expect(c.querySelector('details')).toBeNull();
    expect(c.innerHTML).toBe('');
  });
});
