// @vitest-environment jsdom
/**
 * navigation-r2.test.ts
 * R2: Cover remaining branches — missing tablist, sidebar-nav fallback,
 * ArrowUp/ArrowLeft/Home/End keyboard, navigate-to-tag event,
 * active-state detection on init, and focus management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initNavigation } from '../navigation.js';

vi.mock('../historyPanel.js', () => ({
  searchForTagInHistory: vi.fn(),
}));

describe('navigation-r2 — initialization edge cases', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns early when no tablist and no sidebar-nav', () => {
    document.body.innerHTML = '<div>no nav</div>';
    expect(() => initNavigation()).not.toThrow();
  });

  it('initializes from sidebar-nav when no role="tablist" exists', () => {
    document.body.innerHTML = `
      <div id="sidebar">
        <div class="sidebar-nav">
          <button class="sidebar-nav-btn" data-panel="panel-1">Tab 1</button>
        </div>
      </div>
      <section id="panel-1">Panel 1</section>
    `;
    initNavigation();
    const btn = document.querySelector('.sidebar-nav-btn')!;
    expect(btn.getAttribute('role')).toBe('tab');
    expect(btn.getAttribute('aria-controls')).toBe('panel-1');
  });

  it('returns early when sidebar-nav has no buttons', () => {
    document.body.innerHTML = `
      <div id="sidebar">
        <div class="sidebar-nav"></div>
      </div>
    `;
    expect(() => initNavigation()).not.toThrow();
  });

  it('assigns auto-generated id to sidebar-nav buttons', () => {
    document.body.innerHTML = `
      <div id="sidebar">
        <div class="sidebar-nav">
          <button class="sidebar-nav-btn" data-panel="panel-1">Tab 1</button>
        </div>
      </div>
      <section id="panel-1">Panel 1</section>
    `;
    initNavigation();
    const btn = document.querySelector('.sidebar-nav-btn')!;
    expect(btn.id).toBe('sidebar-tab-0');
  });

  it('sets aria-labelledby on panels via tab id', () => {
    document.body.innerHTML = `
      <nav role="tablist">
        <button role="tab" id="tab-a" aria-controls="panel-a">A</button>
      </nav>
      <section id="panel-a">Panel A</section>
    `;
    initNavigation();
    const panel = document.getElementById('panel-a')!;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('tab-a');
  });
});

describe('navigation-r2 — keyboard navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav role="tablist">
        <button role="tab" id="tab-1" aria-controls="panel-1">Tab 1</button>
        <button role="tab" id="tab-2" aria-controls="panel-2">Tab 2</button>
        <button role="tab" id="tab-3" aria-controls="panel-3">Tab 3</button>
      </nav>
      <section id="panel-1">Panel 1</section>
      <section id="panel-2">Panel 2</section>
      <section id="panel-3">Panel 3</section>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('ArrowRight moves to next tab', () => {
    initNavigation();
    const tab1 = document.getElementById('tab-1')!;
    tab1.focus();
    tab1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.getElementById('tab-2')!.getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('tab-1')!.getAttribute('aria-selected')).toBe('false');
  });

  it('ArrowDown moves to next tab', () => {
    initNavigation();
    const tab1 = document.getElementById('tab-1')!;
    tab1.focus();
    tab1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.getElementById('tab-2')!.getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowLeft moves to previous tab', () => {
    initNavigation();
    const tab2 = document.getElementById('tab-2')!;
    tab2.focus();
    tab2.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.getElementById('tab-1')!.getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowUp moves to previous tab', () => {
    initNavigation();
    const tab2 = document.getElementById('tab-2')!;
    tab2.focus();
    tab2.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.getElementById('tab-1')!.getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowRight wraps to first tab from last tab', () => {
    initNavigation();
    const tab3 = document.getElementById('tab-3')!;
    tab3.focus();
    tab3.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.getElementById('tab-1')!.getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowLeft wraps to last tab from first tab', () => {
    initNavigation();
    const tab1 = document.getElementById('tab-1')!;
    tab1.focus();
    tab1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.getElementById('tab-3')!.getAttribute('aria-selected')).toBe('true');
  });

  it('Home key goes to first tab', () => {
    initNavigation();
    const tab3 = document.getElementById('tab-3')!;
    tab3.focus();
    tab3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.getElementById('tab-1')!.getAttribute('aria-selected')).toBe('true');
  });

  it('End key goes to last tab', () => {
    initNavigation();
    const tab1 = document.getElementById('tab-1')!;
    tab1.focus();
    tab1.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.getElementById('tab-3')!.getAttribute('aria-selected')).toBe('true');
  });

  it('non-navigation key does not change tab', () => {
    initNavigation();
    const tab1 = document.getElementById('tab-1')!;
    tab1.focus();
    tab1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('tab-1')!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('navigation-r2 — navigate-to-tag event', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav role="tablist">
        <button role="tab" data-panel="panel-sqlite-history">History</button>
        <button role="tab" data-panel="panel-settings">Settings</button>
      </nav>
      <section id="panel-sqlite-history">History</section>
      <section id="panel-settings">Settings</section>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('switches to history panel on navigate-to-tag event', async () => {
    const hp = await import('../historyPanel.js');
    const searchSpy = vi.spyOn(hp, 'searchForTagInHistory').mockImplementation(() => {});
    initNavigation();
    document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: 'tech' }));
    const historyPanel = document.getElementById('panel-sqlite-history')!;
    expect(historyPanel.classList.contains('active')).toBe(true);
    expect(historyPanel.hasAttribute('hidden')).toBe(false);
  });

  it('calls searchForTagInHistory when tag is provided', async () => {
    const hp = await import('../historyPanel.js');
    const searchSpy = vi.spyOn(hp, 'searchForTagInHistory').mockImplementation(() => {});
    initNavigation();
    document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: 'news' }));
    expect(searchSpy).toHaveBeenCalledWith('news');
  });

  it('does not crash when no history panel exists', () => {
    document.body.innerHTML = `
      <nav role="tablist">
        <button role="tab" data-panel="panel-other">Other</button>
      </nav>
    `;
    initNavigation();
    expect(() => {
      document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: 'tag' }));
    }).not.toThrow();
  });
});

describe('navigation-r2 — active state on init', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('activates first tab when no tab has active class', () => {
    document.body.innerHTML = `
      <nav role="tablist">
        <button role="tab" id="tab-1" aria-controls="panel-1">Tab 1</button>
        <button role="tab" id="tab-2" aria-controls="panel-2">Tab 2</button>
      </nav>
      <section id="panel-1">Panel 1</section>
      <section id="panel-2">Panel 2</section>
    `;
    initNavigation();
    expect(document.getElementById('tab-1')!.getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('tab-1')!.classList.contains('active')).toBe(true);
  });

  it('activates tab with active class on init', () => {
    document.body.innerHTML = `
      <nav role="tablist">
        <button role="tab" id="tab-1" class="active" aria-controls="panel-1">Tab 1</button>
        <button role="tab" id="tab-2" aria-controls="panel-2">Tab 2</button>
      </nav>
      <section id="panel-1">Panel 1</section>
      <section id="panel-2">Panel 2</section>
    `;
    initNavigation();
    expect(document.getElementById('tab-1')!.getAttribute('aria-selected')).toBe('true');
  });

  it('activates tab with aria-selected=true on init', () => {
    document.body.innerHTML = `
      <nav role="tablist">
        <button role="tab" id="tab-1" aria-selected="false" aria-controls="panel-1">Tab 1</button>
        <button role="tab" id="tab-2" aria-selected="true" aria-controls="panel-2">Tab 2</button>
      </nav>
      <section id="panel-1">Panel 1</section>
      <section id="panel-2">Panel 2</section>
    `;
    initNavigation();
    expect(document.getElementById('tab-2')!.getAttribute('aria-selected')).toBe('true');
  });
});
