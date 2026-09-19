// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavigationRegistry } from '../NavigationRegistry.js';
import { type PanelLifecycle } from '../types.js';

type PanelOverrides = { [K in keyof PanelLifecycle]?: PanelLifecycle[K] | undefined };

function mockPanel(overrides?: PanelOverrides): PanelLifecycle {
  const base: PanelLifecycle = {
    id: 'panel-test',
    category: 'async-data',
    mount: vi.fn(),
    activate: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn(),
  };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) {
      delete (base as unknown as Record<string, unknown>)[key];
    } else {
      (base as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return base;
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
    await registry.navigate('panel-a');
    expect(registry.activeId).toBe('panel-a');
    expect(panel.activate).toHaveBeenCalled();
    expect(panel.load).toHaveBeenCalled();
  });

  it('navigate deactivates previous panel before activating new one', async () => {
    const panelA = mockPanel({ id: 'panel-a' });
    const panelB = mockPanel({ id: 'panel-b' });
    registry.register(panelA);
    registry.register(panelB);
    await registry.navigate('panel-a');
    await registry.navigate('panel-b');
    expect(panelA.deactivate).toHaveBeenCalled();
    expect(panelB.activate).toHaveBeenCalled();
    expect(registry.activeId).toBe('panel-b');
  });

  it('navigate to same panel calls activate with new init', async () => {
    const panel = mockPanel({ id: 'panel-a' });
    registry.register(panel);
    await registry.navigate('panel-a');
    vi.clearAllMocks();
    await registry.navigate('panel-a', { searchTag: 'AI' });
    expect(panel.deactivate).not.toHaveBeenCalled();
    expect(panel.activate).toHaveBeenCalledWith({ searchTag: 'AI' });
  });

  it('navigate throws on unregistered panel', async () => {
    await expect(registry.navigate('panel-unknown')).rejects.toThrow('not registered');
  });

  it('navigate passes init context to activate', async () => {
    const panel = mockPanel({ id: 'panel-a' });
    registry.register(panel);
    await registry.navigate('panel-a', { searchTag: 'AI' });
    expect(panel.activate).toHaveBeenCalledWith({ searchTag: 'AI' });
  });

  it('StaticFormPanel category does not call load', async () => {
    const panel = mockPanel({ id: 'panel-form', category: 'static-form' });
    registry.register(panel);
    await registry.navigate('panel-form');
    expect(registry.activeId).toBe('panel-form');
    expect(panel.load).not.toHaveBeenCalled();
  });

  describe('per-category activation', () => {
    it('passes init to async-data panels', async () => {
      const asyncPanel = mockPanel({ id: 'panel-async', category: 'async-data' });
      const formPanel = mockPanel({ id: 'panel-form', category: 'static-form', load: undefined });
      registry.register(asyncPanel);
      registry.register(formPanel);

      await registry.navigate('panel-async', { searchTag: 'AI' });
      await registry.navigate('panel-form', { searchTag: 'AI' });

      expect(asyncPanel.activate).toHaveBeenCalledWith({ searchTag: 'AI' });
      expect(formPanel.activate).toHaveBeenCalledWith({ searchTag: 'AI' });
    });

    it('activates a diagnostic panel, which has no activation hook', async () => {
      const panel = mockPanel({ id: 'panel-diag', category: 'diagnostic', activate: undefined, load: undefined });
      registry.register(panel);

      await expect(registry.navigate('panel-diag')).resolves.not.toThrow();
      expect(registry.activeId).toBe('panel-diag');
    });

    it('does not require load(): panels with nothing to re-read may omit it', async () => {
      const panel = mockPanel({ id: 'panel-no-load', category: 'static-form', load: undefined });
      registry.register(panel);

      await expect(registry.navigate('panel-no-load')).resolves.not.toThrow();
      expect(registry.activeId).toBe('panel-no-load');
    });

    it('only deactivates when deactivate is defined', async () => {
      const formPanel = mockPanel({ id: 'panel-form', category: 'static-form', deactivate: undefined });
      const asyncPanel = mockPanel({ id: 'panel-async' });
      registry.register(formPanel);
      registry.register(asyncPanel);

      await registry.navigate('panel-form');
      await expect(registry.navigate('panel-async')).resolves.not.toThrow();
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

    it('calls mount with the container element on first navigate', async () => {
      const panel = mockPanel({ id: 'panel-a' });
      registry.register(panel);
      await registry.navigate('panel-a');
      expect(panel.mount).toHaveBeenCalledTimes(1);
      expect(panel.mount).toHaveBeenCalledWith(container);
    });

    it('does not call mount again on subsequent navigate to same panel', async () => {
      const panel = mockPanel({ id: 'panel-a' });
      registry.register(panel);
      await registry.navigate('panel-a');
      vi.clearAllMocks();
      await registry.navigate('panel-a', { searchTag: 'AI' });
      expect(panel.mount).not.toHaveBeenCalled();
    });

    it('calls mount for each panel only once', async () => {
      const containerB = document.createElement('div');
      containerB.id = 'panel-b';
      document.body.appendChild(containerB);

      const panelA = mockPanel({ id: 'panel-a' });
      const panelB = mockPanel({ id: 'panel-b' });
      registry.register(panelA);
      registry.register(panelB);

      await registry.navigate('panel-a');
      expect(panelA.mount).toHaveBeenCalledTimes(1);
      expect(panelA.mount).toHaveBeenCalledWith(container);

      await registry.navigate('panel-b');
      expect(panelB.mount).toHaveBeenCalledTimes(1);
      expect(panelB.mount).toHaveBeenCalledWith(containerB);

      await registry.navigate('panel-a');
      expect(panelA.mount).toHaveBeenCalledTimes(1);

      document.body.removeChild(containerB);
    });
  });

  describe('mount() completion is awaited (regression for dashboard-task-flows CI flake)', () => {
    it('navigate() does not resolve until an async mount() finishes', async () => {
      let mountResolved = false;
      let resolveMount!: () => void;
      const mountPromise = new Promise<void>((resolve) => {
        resolveMount = () => {
          mountResolved = true;
          resolve();
        };
      });

      const container = document.createElement('div');
      container.id = 'panel-slow';
      document.body.appendChild(container);

      const panel = mockPanel({
        id: 'panel-slow',
        mount: vi.fn().mockReturnValue(mountPromise),
      });
      registry.register(panel);

      const navigatePromise = registry.navigate('panel-slow');
      // mount() has been called but not yet resolved.
      expect(panel.mount).toHaveBeenCalledTimes(1);
      expect(mountResolved).toBe(false);

      resolveMount();
      await navigatePromise;

      expect(mountResolved).toBe(true);

      document.body.removeChild(container);
    });
  });

  describe('stale navigation guard (concurrent navigate() calls)', () => {
    it('does not resume init/activate/load for a panel superseded during its mount await', async () => {
      const containerA = document.createElement('div');
      containerA.id = 'panel-a';
      document.body.appendChild(containerA);
      const containerB = document.createElement('div');
      containerB.id = 'panel-b';
      document.body.appendChild(containerB);

      let resolveMountA!: () => void;
      const mountAPromise = new Promise<void>((resolve) => {
        resolveMountA = resolve;
      });

      const panelA = mockPanel({ id: 'panel-a', mount: vi.fn().mockReturnValue(mountAPromise) });
      const panelB = mockPanel({ id: 'panel-b', mount: vi.fn().mockResolvedValue(undefined) });
      registry.register(panelA);
      registry.register(panelB);

      const promiseA = registry.navigate('panel-a');
      // A is suspended awaiting mount(); activate/load must not have run yet.
      expect(panelA.activate).not.toHaveBeenCalled();

      const promiseB = registry.navigate('panel-b');
      // B's navigate runs its synchronous prefix immediately (mount resolves
      // right away), which deactivates A and makes B the active panel.
      await promiseB;
      expect(registry.activeId).toBe('panel-b');
      expect(panelA.deactivate).toHaveBeenCalled();
      expect(panelB.activate).toHaveBeenCalled();
      expect(panelB.load).toHaveBeenCalled();

      // Now let A's mount resolve. Without the generation guard, A's
      // suspended #navigateInternal call would resume and call activate/load
      // on a panel that's already been deactivated and hidden.
      resolveMountA();
      await promiseA;

      expect(panelA.activate).not.toHaveBeenCalled();
      expect(panelA.load).not.toHaveBeenCalled();
      // Final state must still point at B, unaffected by A's stale resume.
      expect(registry.activeId).toBe('panel-b');

      document.body.removeChild(containerA);
      document.body.removeChild(containerB);
    });
  });
});
