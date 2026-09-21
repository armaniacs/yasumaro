/**
 * @vitest-environment jsdom
 * providerAccordionView.golden.test.ts (PBI 2026-09-21-14)
 * DOM pins of the CURRENT accordion rendering: gemini open, the rest closed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createBProviderAccordionView } from '../providerAccordionView.js';

describe('provider accordion DOM goldens', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one details per provider with gemini open and the rest closed', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = createBProviderAccordionView(container);
    const details = [...container.querySelectorAll('details.b-provider-details')];
    expect(details.map((d) => d.getAttribute('data-provider'))).toEqual([
      'geminiSettings',
      'openaiSettings',
      'openai2Settings',
      'lm-studioSettings',
      'ollamaSettings',
      'openai-compatibleSettings',
      'built-in-aiSettings',
    ]);
    for (const d of details) {
      const isGemini = d.getAttribute('data-provider') === 'geminiSettings';
      expect((d as HTMLDetailsElement).open).toBe(isGemini);
      expect(d.querySelector('summary.b-provider-summary')?.textContent?.length).toBeGreaterThan(0);
      expect(d.querySelector('div[id$="Settings"]')).not.toBeNull();
    }
    view.destroy();
    expect(container.innerHTML).toBe('');
    container.remove();
  });
});
