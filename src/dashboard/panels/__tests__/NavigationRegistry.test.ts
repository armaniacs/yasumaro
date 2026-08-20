// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavigationRegistry } from '../NavigationRegistry.js';
import { type PanelLifecycle } from '../types.js';

function mockPanel(overrides?: Partial<PanelLifecycle>): PanelLifecycle {
  return {
    id: 'panel-test',
    category: 'async-data',
    mount: vi.fn(),
    activate: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn(),
    ...overrides,
  };
}

describe('NavigationRegistry', () => {
  let registry: NavigationRegistry;

  beforeEach(() => {
    registry = new NavigationRegistry();
  });

  it('register stores a panel', () => {
    const panel = mockPanel();
    registry.register(panel);
    expect(registry.activeId).toBeNull();
  });

  it('register throws on duplicate id', () => {
    registry.register(mockPanel({ id: 'panel-a' }));
    expect(() => registry.register(mockPanel({ id: 'panel-a' }))).toThrow('already registered');
  });

  it('navigate activates a panel and calls lifecycle methods', async () => {
    const panel = mockPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a');
    expect(registry.activeId).toBe('panel-a');
    expect(panel.activate).toHaveBeenCalled();
    expect(panel.load).toHaveBeenCalled();
  });

  it('navigate deactivates previous panel before activating new one', async () => {
    const panelA = mockPanel({ id: 'panel-a' });
    const panelB = mockPanel({ id: 'panel-b' });
    registry.register(panelA);
    registry.register(panelB);
    registry.navigate('panel-a');
    registry.navigate('panel-b');
    expect(panelA.deactivate).toHaveBeenCalled();
    expect(panelB.activate).toHaveBeenCalled();
    expect(registry.activeId).toBe('panel-b');
  });

  it('navigate to same panel calls activate with new init', () => {
    const panel = mockPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a');
    vi.clearAllMocks();
    registry.navigate('panel-a', { searchTag: 'AI' });
    expect(panel.deactivate).not.toHaveBeenCalled();
    expect(panel.activate).toHaveBeenCalledWith({ searchTag: 'AI' });
  });

  it('navigate throws on unregistered panel', () => {
    expect(() => registry.navigate('panel-unknown')).toThrow('not registered');
  });

  it('navigate passes init context to activate', () => {
    const panel = mockPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a', { searchTag: 'AI' });
    expect(panel.activate).toHaveBeenCalledWith({ searchTag: 'AI' });
  });

  it('StaticFormPanel category does not call load', () => {
    const panel = mockPanel({ id: 'panel-form', category: 'static-form' });
    registry.register(panel);
    registry.navigate('panel-form');
    expect(registry.activeId).toBe('panel-form');
    expect(panel.load).not.toHaveBeenCalled();
  });

  describe('per-category activation', () => {
    it('passes init to async-data panels', () => {
      const asyncPanel = mockPanel({ id: 'panel-async', category: 'async-data' });
      const formPanel = mockPanel({ id: 'panel-form', category: 'static-form', load: undefined });
      registry.register(asyncPanel);
      registry.register(formPanel);

      registry.navigate('panel-async', { searchTag: 'AI' });
      registry.navigate('panel-form', { searchTag: 'AI' });

      expect(asyncPanel.activate).toHaveBeenCalledWith({ searchTag: 'AI' });
      expect(formPanel.activate).toHaveBeenCalledWith({ searchTag: 'AI' });
    });

    it('activates a diagnostic panel, which has no activation hook', () => {
      const panel = mockPanel({ id: 'panel-diag', category: 'diagnostic', activate: undefined, load: undefined });
      registry.register(panel);

      expect(() => registry.navigate('panel-diag')).not.toThrow();
      expect(registry.activeId).toBe('panel-diag');
    });

    it('does not require load(): panels with nothing to re-read may omit it', () => {
      const panel = mockPanel({ id: 'panel-no-load', category: 'static-form', load: undefined });
      registry.register(panel);

      expect(() => registry.navigate('panel-no-load')).not.toThrow();
      expect(registry.activeId).toBe('panel-no-load');
    });

    it('only deactivates when deactivate is defined', () => {
      const formPanel = mockPanel({ id: 'panel-form', category: 'static-form', deactivate: undefined });
      const asyncPanel = mockPanel({ id: 'panel-async' });
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
      const panel = mockPanel({ id: 'panel-a' });
      registry.register(panel);
      registry.navigate('panel-a');
      expect(panel.mount).toHaveBeenCalledTimes(1);
      expect(panel.mount).toHaveBeenCalledWith(container);
    });

    it('does not call mount again on subsequent navigate to same panel', () => {
      const panel = mockPanel({ id: 'panel-a' });
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

      const panelA = mockPanel({ id: 'panel-a' });
      const panelB = mockPanel({ id: 'panel-b' });
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
