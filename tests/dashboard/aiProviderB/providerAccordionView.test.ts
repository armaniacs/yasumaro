import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { createBProviderAccordionView } from '../../../src/dashboard/aiProviderB/providerAccordionView.js';

function setupDom() {
  const dom = new JSDOM(`
    <div id="bProviderAccordion"></div>
    <div id="geminiSettings">gemini</div>
    <div id="openaiSettings">openai</div>
    <div id="openai2Settings">openai2</div>
    <div id="lm-studioSettings">lm</div>
    <div id="ollamaSettings">ollama</div>
    <div id="openai-compatibleSettings">compat</div>
    <div id="built-in-aiSettings">built</div>
  `);
  global.document = dom.window.document as unknown as Document;
  return dom.window.document;
}

describe('createBProviderAccordionView', () => {
  it('7プロバイダのアコーディオンが生成される', () => {
    const doc = setupDom();
    const container = doc.getElementById('bProviderAccordion') as HTMLElement;
    createBProviderAccordionView(container);
    expect(container.querySelectorAll('details.b-provider-details').length).toBe(7);
  });
  it('既存の#geminiSettingsなどがアコーディオン内に移動する', () => {
    const doc = setupDom();
    const container = doc.getElementById('bProviderAccordion') as HTMLElement;
    createBProviderAccordionView(container);
    expect(container.querySelector('#geminiSettings')).not.toBeNull();
  });
  it('destroyで元の親に戻る', () => {
    const doc = setupDom();
    const container = doc.getElementById('bProviderAccordion') as HTMLElement;
    const view = createBProviderAccordionView(container);
    view.destroy();
    // 元の親（body直下）に残っているかは、containされていないことで確認
    expect(container.querySelector('#geminiSettings')).toBeNull();
  });
});
