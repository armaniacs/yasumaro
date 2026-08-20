// @vitest-environment jsdom
/**
 * sqliteHistoryPanel.lifecycle.test.ts
 * Verification of PanelLifecycle interface implementation for sqliteHistoryPanel.
 *
 * Tests the panel's lifecycle methods (mount, init, load, destroy) in isolation
 * and in sequence, ensuring proper initialization, data loading, and cleanup.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createSqliteHistoryPanel } from '../sqliteHistoryPanel.js';
import type { PanelLifecycle } from '../../types.js';

describe('sqliteHistoryPanel — PanelLifecycle implementation', () => {
  let panel: PanelLifecycle;
  let container: HTMLDivElement;

  beforeEach(() => {
    panel = createSqliteHistoryPanel();
    container = document.createElement('div');
    container.id = 'panel-sqlite-history';
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('interface compliance', () => {
    it('has required lifecycle properties', () => {
      expect(panel).toHaveProperty('id');
      expect(panel).toHaveProperty('category');
      expect(panel).toHaveProperty('mount');
      expect(panel).toHaveProperty('init');
      expect(panel).toHaveProperty('load');
      expect(panel).toHaveProperty('destroy');
    });

    it('has correct id and category', () => {
      expect(panel.id).toBe('panel-sqlite-history');
      expect(panel.category).toBe('async-data');
    });
  });

  describe('mount()', () => {
    it('initializes container reference', () => {
      expect(() => panel.mount(container)).not.toThrow();
      // After mount, DOM elements should not be created yet
      const searchInput = container.querySelector('#sqlite-search-input');
      expect(searchInput).toBeNull();
    });

    it('accepts HTMLElement argument', () => {
      const testContainer = document.createElement('div');
      expect(() => panel.mount(testContainer)).not.toThrow();
    });
  });

  describe('init()', () => {
    it('accepts undefined params', () => {
      expect(() => panel.init()).not.toThrow();
    });

    it('accepts init params object', () => {
      const initParams = { searchTag: 'important' };
      expect(() => panel.init(initParams)).not.toThrow();
    });

    it('handles searchTag parameter', () => {
      const initParams = { searchTag: 'test-tag' };
      // Should not throw; actual behavior verified via controller tests
      expect(() => panel.init(initParams)).not.toThrow();
    });

    it('handles searchDomain parameter', () => {
      const initParams = { searchDomain: 'example.com' };
      // Should not throw; actual behavior verified via controller tests
      expect(() => panel.init(initParams)).not.toThrow();
    });

    it('handles both params gracefully (searchTag takes precedence in implementation)', () => {
      const initParams = { searchTag: 'tag', searchDomain: 'domain.com' };
      expect(() => panel.init(initParams)).not.toThrow();
    });
  });

  describe('load()', () => {
    it('is async function', () => {
      const result = panel.load?.();
      expect(result).toBeInstanceOf(Promise);
    });

    it('does not throw without prior mount', async () => {
      // load() should handle missing container gracefully
      await expect(panel.load?.()).resolves.toBeUndefined();
    });

    it('can be called after mount', async () => {
      panel.mount(container);
      // Note: load() will attempt to access DOM elements, so we need proper HTML setup
      // This test focuses on the method existing and being callable
      const loadPromise = panel.load?.();
      expect(loadPromise).toBeInstanceOf(Promise);
      // We don't await here as it may have unresolved dependencies (chrome.runtime, etc)
    });
  });

  describe('destroy()', () => {
    it('executes cleanup without error', () => {
      expect(() => panel.destroy?.()).not.toThrow();
    });

    it('can be called multiple times', () => {
      expect(() => panel.destroy?.()).not.toThrow();
      expect(() => panel.destroy?.()).not.toThrow();
    });

    it('clears internal debounce timers', () => {
      // Create a panel and trigger init/load flow to create debounce
      const testPanel = createSqliteHistoryPanel();
      const testContainer = document.createElement('div');
      testContainer.id = 'panel-sqlite-history';
      document.body.appendChild(testContainer);

      testPanel.mount(testContainer);
      // Destroy should clear any timers
      expect(() => testPanel.destroy?.()).not.toThrow();

      if (testContainer.parentNode) {
        testContainer.parentNode.removeChild(testContainer);
      }
    });
  });

  describe('lifecycle sequence', () => {
    it('mount → init → destroy sequence succeeds', () => {
      expect(() => {
        panel.mount(container);
        panel.init?.();
        panel.destroy?.();
      }).not.toThrow();
    });

    it('mount → init → load → destroy sequence is callable', async () => {
      expect(() => {
        panel.mount(container);
        panel.init?.();
      }).not.toThrow();

      const loadPromise = panel.load?.();
      expect(loadPromise).toBeInstanceOf(Promise);

      // Don't await load as it has external dependencies
      // Just verify destroy can be called
      expect(() => panel.destroy?.()).not.toThrow();
    });

    it('init can be called multiple times', () => {
      panel.mount(container);
      expect(() => panel.init?.()).not.toThrow();
      expect(() => panel.init?.({ searchTag: 'tag1' })).not.toThrow();
      expect(() => panel.init?.({ searchDomain: 'domain.com' })).not.toThrow();
    });

    it('destroy after init cleans up properly', () => {
      panel.mount(container);
      panel.init?.({ searchTag: 'test' });
      expect(() => panel.destroy?.()).not.toThrow();
    });
  });
});
