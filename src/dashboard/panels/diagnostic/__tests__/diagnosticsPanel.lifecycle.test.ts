// @vitest-environment jsdom
/**
 * diagnosticsPanel.lifecycle.test.ts
 * Verification of PanelLifecycle interface implementation for diagnosticsPanel.
 * Wave2 migration — adaptLegacyPanel removal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDiagnosticsPanel } from '../diagnosticsPanel.js';
import type { PanelLifecycle } from '../../types.js';
import { NavigationRegistry } from '../../NavigationRegistry.js';

describe('diagnosticsPanel — PanelLifecycle implementation', () => {
  let panel: PanelLifecycle;
  let container: HTMLDivElement;

  beforeEach(() => {
    // Ensure chrome.runtime.getManifest is mocked (not provided by default setup)
    if (!(global as unknown as Record<string, unknown>).chrome) {
      (global as unknown as Record<string, unknown>).chrome = {} as unknown as never;
    }
    const chromeAny = (global as unknown as { chrome: Record<string, unknown> }).chrome as Record<string, unknown>;
    const runtime = (chromeAny.runtime as Record<string, unknown>) || {};
    runtime.getManifest = vi.fn(() => ({ version: '6.7.61', name: 'Yasumaro', manifest_version: 3 }));
    chromeAny.runtime = runtime as unknown as typeof chromeAny.runtime;

    panel = createDiagnosticsPanel();
    container = document.createElement('div');
    container.id = 'panel-diagnostics';
    // Minimal DOM required by mount()
    container.innerHTML = `
      <div id="diagStorageStats"></div>
      <div id="diagExtInfo"></div>
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagConnectionResult"></div>
      <div id="diagSqliteStats"></div>
      <div id="diagDeficiencyStats"></div>
      <div id="diagBuiltInAiStats"></div>
      <button id="diagBuiltInAiDownloadBtn"></button>
      <div id="diagCompileOptionsStats"></div>
      <div id="diagDivergenceWarning"></div>
      <div id="diagMigrationStats"></div>
      <div id="diagCompileOptionsSection"></div>
      <input id="diagDebugModeToggle" type="checkbox" />
      <button id="diagTestObsidianBtn"></button>
      <button id="diagTestAiBtn"></button>
      <button id="diagTestSqliteBtn"></button>
      <div id="diagSqliteResult"></div>
      <button id="diagOpfsSpikeBtn"></button>
      <div id="diagOpfsSpikeResult"></div>
      <button id="diagMigrateBtn"></button>
      <div id="diagMigrateResult"></div>
      <button id="diagBackfillBtn"></button>
      <div id="diagBackfillResult"></div>
      <button id="diagCleanupBtn"></button>
      <div id="diagCleanupResult"></div>
      <div id="diagBuiltInAiDownloadResult"></div>
    `;
    document.body.appendChild(container);
    // Need panel element for NavigationRegistry show/hide
    const panelEl = document.createElement('div');
    panelEl.id = 'panel-diagnostics';
    document.body.appendChild(panelEl);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('interface compliance', () => {
    it('has required lifecycle properties', () => {
      expect(panel).toHaveProperty('id');
      expect(panel).toHaveProperty('category');
      expect(panel).toHaveProperty('mount');
      expect(panel).toHaveProperty('load');
      expect(panel).toHaveProperty('destroy');
    });

    it('has correct id and category', () => {
      expect(panel.id).toBe('panel-diagnostics');
      expect(panel.category).toBe('diagnostic');
    });

    it('does not expose legacy refresh property', () => {
      expect((panel as unknown as Record<string, unknown>).refresh).toBeUndefined();
    });
  });

  describe('mount()', () => {
    it('initializes without throw', async () => {
      await expect(panel.mount(container)).resolves.toBeUndefined();
    });

    it('accepts HTMLElement argument', async () => {
      const c = document.createElement('div');
      c.innerHTML = container.innerHTML;
      await expect(panel.mount(c)).resolves.toBeUndefined();
    });

    it('wires debug toggle without error', async () => {
      await panel.mount(container);
      const toggle = container.querySelector('#diagDebugModeToggle') as HTMLInputElement | null;
      expect(toggle).toBeDefined();
    });
  });

  describe('load()', () => {
    it('is async function returning Promise', async () => {
      panel.mount(container);
      const result = panel.load?.();
      expect(result).toBeInstanceOf(Promise);
      await result;
    });

    it('does not throw without prior mount (null container guard)', async () => {
      const p2 = createDiagnosticsPanel();
      await expect(p2.load?.()).resolves.toBeUndefined();
    });

    it('can be called after mount', async () => {
      await panel.mount(container);
      await expect(panel.load?.()).resolves.toBeUndefined();
    });

    it('populates extension info from manifest after load', async () => {
      await panel.mount(container);
      await panel.load?.();
      const extInfo = container.querySelector('#diagExtInfo');
      expect(extInfo?.textContent).toContain('6.7.61');
      expect(extInfo?.textContent).toContain('Yasumaro');
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

    it('clears container reference so subsequent load is no-op', async () => {
      await panel.mount(container);
      panel.destroy?.();
      await expect(panel.load?.()).resolves.toBeUndefined();
    });
  });

  describe('lifecycle sequence', () => {
    it('mount → load → destroy sequence succeeds', async () => {
      await panel.mount(container);
      await expect(panel.load?.()).resolves.toBeUndefined();
      expect(() => panel.destroy?.()).not.toThrow();
    });

    it('mount → destroy without load succeeds', async () => {
      await panel.mount(container);
      expect(() => panel.destroy?.()).not.toThrow();
    });

    it('destroy before mount is safe', () => {
      const p2 = createDiagnosticsPanel();
      expect(() => p2.destroy?.()).not.toThrow();
    });

    it('remount after destroy works', async () => {
      await panel.mount(container);
      panel.destroy?.();
      const c2 = document.createElement('div');
      c2.innerHTML = container.innerHTML;
      c2.id = 'panel-diagnostics';
      await expect(panel.mount(c2)).resolves.toBeUndefined();
      await expect(panel.load?.()).resolves.toBeUndefined();
    });
  });

  describe('NavigationRegistry integration', () => {
    it('registry calls load() for diagnostic category', async () => {
      const registry = new NavigationRegistry();
      const diagPanel = createDiagnosticsPanel();
      const spy = vi.spyOn(diagPanel, 'load');
      // Create container for registry mount
      const regContainer = document.createElement('div');
      regContainer.id = 'panel-diagnostics';
      document.body.appendChild(regContainer);
      // Need mount container element
      const mountContainer = document.createElement('div');
      mountContainer.id = 'panel-diagnostics';
      // NavigationRegistry mounts via getElementById(panelId)
      // So ensure document.getElementById returns container with required innerHTML
      regContainer.innerHTML = container.innerHTML;

      registry.register(diagPanel);
      registry.navigate('panel-diagnostics');

      // load is async and registry catches errors; spy should have been called
      expect(spy).toHaveBeenCalled();
      // Allow microtask
      await new Promise((r) => setTimeout(r, 0));
      document.body.removeChild(regContainer);
    });

    it('registry mount is called on first navigate', async () => {
      const registry = new NavigationRegistry();
      const diagPanel = createDiagnosticsPanel();
      const mountSpy = vi.spyOn(diagPanel, 'mount');
      const regContainer = document.createElement('div');
      regContainer.id = 'panel-diagnostics';
      regContainer.innerHTML = container.innerHTML;
      document.body.appendChild(regContainer);
      registry.register(diagPanel);
      registry.navigate('panel-diagnostics');
      expect(mountSpy).toHaveBeenCalled();
      document.body.removeChild(regContainer);
    });
  });
});
