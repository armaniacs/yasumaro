// @vitest-environment jsdom
/**
 * navigation.a11y.test.ts
 * ARIA Tabs pattern tests for dashboard navigation (N2)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initNavigation } from '../navigation.js';

describe('dashboard navigation — ARIA tabs (N2)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav role="tablist">
        <button role="tab" id="tab-1" aria-selected="false" aria-controls="panel-1">Tab 1</button>
        <button role="tab" id="tab-2" aria-selected="false" aria-controls="panel-2">Tab 2</button>
      </nav>
      <section id="panel-1" role="tabpanel" aria-labelledby="tab-1" hidden>Panel 1</section>
      <section id="panel-2" role="tabpanel" aria-labelledby="tab-2" hidden>Panel 2</section>
    `;
  });

  it('toggles aria-selected when a tab is clicked', () => {
    initNavigation();
    const tab2 = document.getElementById('tab-2')!;
    tab2.click();
    expect(tab2.getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('tab-1')!.getAttribute('aria-selected')).toBe('false');
  });

  it('shows the corresponding panel and hides others', () => {
    initNavigation();
    const tab2 = document.getElementById('tab-2')!;
    tab2.click();
    expect(document.getElementById('panel-2')!.hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('panel-1')!.hasAttribute('hidden')).toBe(true);
  });

  it('supports keyboard navigation (Arrow Right)', () => {
    initNavigation();
    const tab1 = document.getElementById('tab-1')!;
    tab1.focus();
    tab1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(document.getElementById('tab-2'));
  });
});
