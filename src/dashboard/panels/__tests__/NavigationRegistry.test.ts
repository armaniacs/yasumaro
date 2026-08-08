// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavigationRegistry } from '../NavigationRegistry.js';
import { type AsyncDataPanel, type StaticFormPanel, type DiagnosticPanel } from '../types.js';

function mockAsyncPanel(overrides?: Partial<AsyncDataPanel>): AsyncDataPanel {
  return {
    id: 'panel-test',
    category: 'async-data',
    mount: vi.fn(),
    loadData: vi.fn().mockResolvedValue(undefined),
    onActivate: vi.fn(),
    onDeactivate: vi.fn(),
    ...overrides,
  };
}

describe('NavigationRegistry', () => {
  let registry: NavigationRegistry;

  beforeEach(() => {
    registry = new NavigationRegistry();
  });

  it('register stores a panel', () => {
    const panel = mockAsyncPanel();
    registry.register(panel);
    expect(registry.activeId).toBeNull();
  });

  it('register throws on duplicate id', () => {
    registry.register(mockAsyncPanel({ id: 'panel-a' }));
    expect(() => registry.register(mockAsyncPanel({ id: 'panel-a' }))).toThrow('already registered');
  });

  it('navigate activates a panel and calls lifecycle methods', async () => {
    const panel = mockAsyncPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a');
    expect(registry.activeId).toBe('panel-a');
    expect(panel.onActivate).toHaveBeenCalled();
    expect(panel.loadData).toHaveBeenCalled();
  });

  it('navigate deactivates previous panel before activating new one', async () => {
    const panelA = mockAsyncPanel({ id: 'panel-a' });
    const panelB = mockAsyncPanel({ id: 'panel-b' });
    registry.register(panelA);
    registry.register(panelB);
    registry.navigate('panel-a');
    registry.navigate('panel-b');
    expect(panelA.onDeactivate).toHaveBeenCalled();
    expect(panelB.onActivate).toHaveBeenCalled();
    expect(registry.activeId).toBe('panel-b');
  });

  it('navigate to same panel calls onActivate with new init', () => {
    const panel = mockAsyncPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a');
    vi.clearAllMocks();
    registry.navigate('panel-a', { searchTag: 'AI' });
    expect(panel.onDeactivate).not.toHaveBeenCalled();
    expect(panel.onActivate).toHaveBeenCalledWith({ searchTag: 'AI' });
  });

  it('navigate throws on unregistered panel', () => {
    expect(() => registry.navigate('panel-unknown')).toThrow('not registered');
  });

  it('navigate passes init context to onActivate', () => {
    const panel = mockAsyncPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a', { searchTag: 'AI' });
    expect(panel.onActivate).toHaveBeenCalledWith({ searchTag: 'AI' });
  });

  it('StaticFormPanel does not call loadData (only refresh is available)', () => {
    const panel: StaticFormPanel = {
      id: 'panel-form',
      category: 'static-form',
      mount: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    registry.register(panel);
    registry.navigate('panel-form');
    expect(registry.activeId).toBe('panel-form');
  });

  describe('per-category activation', () => {
    it('passes init only to async-data panels, since only they accept it', () => {
      const asyncPanel = mockAsyncPanel({ id: 'panel-async' });
      const formPanel: StaticFormPanel = {
        id: 'panel-form',
        category: 'static-form',
        mount: vi.fn().mockResolvedValue(undefined),
        onActivate: vi.fn(),
      };
      registry.register(asyncPanel);
      registry.register(formPanel);

      registry.navigate('panel-async', { searchTag: 'AI' });
      registry.navigate('panel-form', { searchTag: 'AI' });

      expect(asyncPanel.onActivate).toHaveBeenCalledWith({ searchTag: 'AI' });
      // StaticFormPanel.onActivate takes no argument.
      expect(formPanel.onActivate).toHaveBeenCalledWith();
    });

    it('activates a diagnostic panel, which has no activation hook', () => {
      const panel: DiagnosticPanel = {
        id: 'panel-diag',
        category: 'diagnostic',
        mount: vi.fn().mockResolvedValue(undefined),
      };
      registry.register(panel);

      expect(() => registry.navigate('panel-diag')).not.toThrow();
      expect(registry.activeId).toBe('panel-diag');
    });

    it('does not require refresh(): panels with nothing to re-read may omit it', () => {
      // refresh is optional on the contract; NavigationRegistry never calls it.
      const panel: StaticFormPanel = {
        id: 'panel-no-refresh',
        category: 'static-form',
        mount: vi.fn().mockResolvedValue(undefined),
      };
      registry.register(panel);

      expect(() => registry.navigate('panel-no-refresh')).not.toThrow();
      expect(registry.activeId).toBe('panel-no-refresh');
    });

    it('only deactivates async-data panels, the sole category with onDeactivate', () => {
      const formPanel: StaticFormPanel = {
        id: 'panel-form',
        category: 'static-form',
        mount: vi.fn().mockResolvedValue(undefined),
      };
      const asyncPanel = mockAsyncPanel({ id: 'panel-async' });
      registry.register(formPanel);
      registry.register(asyncPanel);

      registry.navigate('panel-form');
      expect(() => registry.navigate('panel-async')).not.toThrow();
      expect(registry.activeId).toBe('panel-async');
    });
  });

  describe('mount behavior', () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.id = 'panel-a';
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('calls mount with the container element on first navigate', () => {
      const panel = mockAsyncPanel({ id: 'panel-a' });
      registry.register(panel);
      registry.navigate('panel-a');
      expect(panel.mount).toHaveBeenCalledTimes(1);
      expect(panel.mount).toHaveBeenCalledWith(container);
    });

    it('does not call mount again on subsequent navigate to same panel', () => {
      const panel = mockAsyncPanel({ id: 'panel-a' });
      registry.register(panel);
      registry.navigate('panel-a');
      vi.clearAllMocks();
      registry.navigate('panel-a', { searchTag: 'AI' });
      expect(panel.mount).not.toHaveBeenCalled();
    });

    it('calls mount for each panel only once', () => {
      const containerB = document.createElement('div');
      containerB.id = 'panel-b';
      document.body.appendChild(containerB);

      const panelA = mockAsyncPanel({ id: 'panel-a' });
      const panelB = mockAsyncPanel({ id: 'panel-b' });
      registry.register(panelA);
      registry.register(panelB);

      registry.navigate('panel-a');
      expect(panelA.mount).toHaveBeenCalledTimes(1);
      expect(panelA.mount).toHaveBeenCalledWith(container);

      registry.navigate('panel-b');
      expect(panelB.mount).toHaveBeenCalledTimes(1);
      expect(panelB.mount).toHaveBeenCalledWith(containerB);

      registry.navigate('panel-a');
      expect(panelA.mount).toHaveBeenCalledTimes(1);

      document.body.removeChild(containerB);
    });
  });
});
