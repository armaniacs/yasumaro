// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHistoryPanel } from '../historyPanel.js';
import type { PanelLifecycle } from '../../types.js';

describe('historyPanel — PanelLifecycle', () => {
  let panel: PanelLifecycle;
  let container: HTMLDivElement;

  beforeEach(() => {
    // Ensure chrome.storage.onChanged mock exists (not provided by default setup)
    const chromeAny = (global as unknown as { chrome: Record<string, unknown> }).chrome as Record<string, unknown>;
    if (chromeAny) {
      const storage = (chromeAny.storage as Record<string, unknown>) || {};
      if (!storage.onChanged) {
        storage.onChanged = {
          addListener: () => {},
          removeListener: () => {},
          hasListener: () => false,
        } as unknown as typeof chrome.storage.onChanged;
        chromeAny.storage = storage as unknown as typeof chrome.storage;
      }
    }
    panel = createHistoryPanel();
    container = document.createElement('div');
    container.id = 'panel-history';
    container.innerHTML = `
      <input id="historySearch" />
      <div id="historyList"></div>
      <div id="historyStats"></div>
      <div id="pendingSection"></div>
      <div id="pendingList"></div>
      <button class="history-filter-btn" data-filter="all"></button>
      <div id="tagEditModal"></div>
      <button id="closeTagEditModalBtn"></button>
      <div id="tagEditUrl"></div>
      <div id="currentTagsList"></div>
      <div id="noCurrentTagsMsg"></div>
      <select id="tagCategorySelect"></select>
      <button id="addTagBtn"></button>
      <button id="saveTagEditsBtn"></button>
    `;
    document.body.appendChild(container);
    const panelEl = document.createElement('div');
    panelEl.id = 'panel-history';
    document.body.appendChild(panelEl);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('has correct id and category', () => {
    expect(panel.id).toBe('panel-history');
    expect(panel.category).toBe('async-data');
  });

  it('exposes mount/load/destroy/init', () => {
    expect(panel.mount).toBeDefined();
    expect(panel.load).toBeDefined();
    expect(panel.destroy).toBeDefined();
    expect(panel.init).toBeDefined();
  });

  it('mount does not throw', () => {
    expect(() => panel.mount(container)).not.toThrow();
  });

  it('load is async and does not throw without mount', async () => {
    const p2 = createHistoryPanel();
    await expect(p2.load?.()).resolves.toBeUndefined();
  });

  it('load after mount returns promise', async () => {
    panel.mount(container);
    const r = panel.load?.();
    expect(r).toBeInstanceOf(Promise);
    // Don't await full load to avoid storage dependency flakiness
  });

  it('destroy cleans up without throw', () => {
    expect(() => panel.destroy?.()).not.toThrow();
  });

  it('init is callable with no args', () => {
    expect(() => panel.init?.()).not.toThrow();
  });

  it('lifecycle sequence mount→load→destroy succeeds', async () => {
    panel.mount(container);
    const pr = panel.load?.();
    expect(pr).toBeInstanceOf(Promise);
    expect(() => panel.destroy?.()).not.toThrow();
  });
});
